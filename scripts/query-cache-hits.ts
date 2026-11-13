/**
 * Prints the image cache hits recorded in llm_logs for the most recent game.
 *
 * Usage: npx tsx scripts/query-cache-hits.ts     (DATABASE_URL from the environment or .env)
 */
import { loadEnv } from './lib/env';

loadEnv();

const { pool } = await import('../server/db');

async function queryCacheHits() {
  try {
    // First, get the most recent game with cache hits
    const recentGamesQuery = `
      SELECT DISTINCT game_id, MAX(created_at) as last_activity
      FROM llm_logs 
      WHERE function_name IN ('generateImage', 'checkImageCache')
        AND JSON_VALUE(metadata, '$.cacheHit') = '1'
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
        JSON_VALUE(metadata, '$.cacheStrategy') as strategy,
        JSON_VALUE(metadata, '$.similarityScore') as similarity_score,
        JSON_VALUE(metadata, '$.cacheHit') as cache_hit,
        JSON_VALUE(metadata, '$.templateName') as template,
        JSON_VALUE(metadata, '$.cachedImageId') as cached_image_id,
        JSON_VALUE(metadata, '$.narrativeSimilarity') as narrative_similarity,
        JSON_VALUE(metadata, '$.contextSimilarity') as context_similarity,
        JSON_VALUE(metadata, '$.visualSimilarity') as visual_similarity,
        execution_time_ms,
        created_at
      FROM llm_logs 
      WHERE function_name IN ('generateImage', 'checkImageCache')
        AND game_id = $1
        AND JSON_VALUE(metadata, '$.cacheHit') = '1'
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
          JSON_VALUE(metadata, '$.cacheStrategy') as strategy,
          JSON_VALUE(metadata, '$.similarityScore') as similarity_score,
          JSON_VALUE(metadata, '$.cacheHit') as cache_hit,
          JSON_VALUE(metadata, '$.templateName') as template,
          execution_time_ms,
          created_at
        FROM llm_logs 
        WHERE function_name IN ('generateImage', 'checkImageCache')
          AND game_id = $1
          AND created_at >= '2025-11-03 01:30:00'
          AND created_at <= '2025-11-03 01:35:00'
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

