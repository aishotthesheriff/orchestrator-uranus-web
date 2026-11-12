import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import pkg from 'pg';

const { Pool } = pkg;

// Try to load .env file if it exists
if (existsSync(join(process.cwd(), '.env'))) {
  const envContent = readFileSync(join(process.cwd(), '.env'), 'utf-8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=');
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must be set.');
  console.error('Either:');
  console.error('1. Set DATABASE_URL in your .env file');
  console.error('2. Pass it as an environment variable');
  console.error('   DATABASE_URL=postgresql://... npx tsx scripts/query-cache-hits.ts');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function queryCacheHits() {
  try {
    // First, get the most recent game with cache hits
    const recentGamesQuery = `
      SELECT DISTINCT game_id, MAX(created_at) as last_activity
      FROM llm_logs 
      WHERE function_name IN ('generateImage', 'checkImageCache')
        AND metadata->>'cacheHit' = 'true'
      GROUP BY game_id
      ORDER BY last_activity DESC
      LIMIT 5;
    `;
    
    const recentGames = await pool.query(recentGamesQuery);
    
    if (recentGames.rows.length === 0) {
      console.log('No cache hits found in llm_logs.');
      console.log('The server may need to be restarted to pick up the new logging code.');
      await pool.end();
      process.exit(0);
    }
    
    console.log('Found recent games with cache hits:\n');
    recentGames.rows.forEach((row: any, idx: number) => {
      console.log(`${idx + 1}. Game ${row.game_id.substring(0, 8)}... (Last activity: ${row.last_activity})`);
    });
    
    // Query the most recent game
    const gameId = recentGames.rows[0].game_id;
    console.log(`\n=== Cache Hits for Most Recent Game: ${gameId.substring(0, 8)}... ===\n`);
    
    const query = `
      SELECT 
        function_name,
        turn_number,
        metadata->>'cacheStrategy' as strategy,
        metadata->>'similarityScore' as similarity_score,
        metadata->>'cacheHit' as cache_hit,
        metadata->>'templateName' as template,
        metadata->>'cachedImageId' as cached_image_id,
        metadata->>'narrativeSimilarity' as narrative_similarity,
        metadata->>'contextSimilarity' as context_similarity,
        metadata->>'visualSimilarity' as visual_similarity,
        execution_time_ms,
        created_at
      FROM llm_logs 
      WHERE function_name IN ('generateImage', 'checkImageCache')
        AND game_id = $1
        AND metadata->>'cacheHit' = 'true'
      ORDER BY turn_number, created_at DESC;
    `;

    const result = await pool.query(query, [gameId]);
    
    console.log(`\n=== Cache Hits for Game ${gameId.substring(0, 8)}... ===\n`);
    
    if (result.rows.length === 0) {
      console.log('No cache hits found in llm_logs for these turns.');
      console.log('This might mean checkImageCache() was used (which doesn\'t log to llm_logs).');
      console.log('Let me check for any generateImage calls around those times...\n');
      
      // Check for any generateImage calls for this game
      const allQuery = `
        SELECT 
          function_name,
          turn_number,
          metadata->>'cacheStrategy' as strategy,
          metadata->>'similarityScore' as similarity_score,
          metadata->>'cacheHit' as cache_hit,
          metadata->>'templateName' as template,
          execution_time_ms,
          created_at
        FROM llm_logs 
        WHERE function_name IN ('generateImage', 'checkImageCache')
          AND game_id = $1
          AND created_at >= '2025-11-03 01:30:00'::timestamp
          AND created_at <= '2025-11-03 01:35:00'::timestamp
        ORDER BY turn_number, created_at DESC;
      `;
      
      const allResult = await pool.query(allQuery, [gameId]);
      
      if (allResult.rows.length > 0) {
        console.log(`Found ${allResult.rows.length} image cache log entries:`);
        allResult.rows.forEach((row: any) => {
          console.log(`\nTurn ${row.turn_number} (${row.function_name}):`);
          console.log(`  Strategy: ${row.strategy || 'N/A'}`);
          console.log(`  Cache Hit: ${row.cache_hit || 'false'}`);
          console.log(`  Similarity Score: ${row.similarity_score || 'N/A'}`);
          console.log(`  Template: ${row.template || 'N/A'}`);
          console.log(`  Execution Time: ${row.execution_time_ms}ms`);
          console.log(`  Created: ${row.created_at}`);
        });
      } else {
        console.log('No generateImage calls found in llm_logs for this time period.');
        console.log('\nThis suggests the cache hits came from checkImageCache(),');
        console.log('which returns cached images without logging to llm_logs.');
        console.log('\nLet me check the generated_images table for exact matches...\n');
        
        // Check generated_images to see what images exist
        const imagesQuery = `
          SELECT 
            id,
            template_name,
            prompt_hash,
            variables_hash,
            created_at,
            access_count,
            accessed_at
          FROM generated_images
          WHERE template_name = 'general_scene'
          ORDER BY created_at DESC
          LIMIT 10;
        `;
        
        const imagesResult = await pool.query(imagesQuery);
        console.log(`Found ${imagesResult.rows.length} recent general_scene images:`);
        imagesResult.rows.forEach((row: any) => {
          console.log(`  ID: ${row.id.substring(0, 8)}... | Hash: ${row.prompt_hash.substring(0, 8)}... | Accesses: ${row.access_count} | Created: ${row.created_at}`);
        });
      }
    } else {
      result.rows.forEach((row: any) => {
        console.log(`Turn ${row.turn_number} (${row.function_name}):`);
        console.log(`  Strategy: ${row.strategy}`);
        console.log(`  Similarity Score: ${row.similarity_score}`);
        if (row.strategy === 'similar') {
          console.log(`  Narrative Similarity: ${row.narrative_similarity}`);
          console.log(`  Context Similarity: ${row.context_similarity}`);
          console.log(`  Visual Similarity: ${row.visual_similarity}`);
        }
        console.log(`  Template: ${row.template}`);
        console.log(`  Cached Image ID: ${row.cached_image_id?.substring(0, 8)}...`);
        console.log(`  Execution Time: ${row.execution_time_ms}ms`);
        console.log(`  Created: ${row.created_at}`);
        console.log('');
      });
    }
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error querying database:', error);
    await pool.end();
    process.exit(1);
  }
}

queryCacheHits();

