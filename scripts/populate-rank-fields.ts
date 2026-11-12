import pkg from 'pg';

const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function populateRanks() {
  let client;
  try {
    client = await pool.connect();
    console.log('✓ Connected to database');
  } catch (error) {
    console.error('✗ Failed to connect to database:', error);
    console.error('\nTip: If you are running locally, use localhost instead of postgres:');
    console.error('   DATABASE_URL=postgresql://postgres:password@localhost:5432/uranus_dungeon npx tsx scripts/populate-rank-fields.ts');
    console.error('\nOr run inside Docker:');
    console.error('   docker-compose exec app npx tsx scripts/populate-rank-fields.ts');
    throw error;
  }
  
  try {
    await client.query('BEGIN');
    
    console.log('Populating rank fields based on current sort order...\n');
    
    // Check if columns exist
    const columnCheck = await client.query(`
      SELECT table_name, column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name IN ('mod_visual_styles', 'mod_story_themes')
        AND column_name = 'rank';
    `);
    
    const hasVisualStylesRank = columnCheck.rows.some(r => r.table_name === 'mod_visual_styles');
    const hasStoryThemesRank = columnCheck.rows.some(r => r.table_name === 'mod_story_themes');
    
    if (!hasVisualStylesRank) {
      console.error('✗ Column "rank" does not exist in mod_visual_styles');
      console.error('  Please run: docker-compose exec app npx tsx scripts/migrate-add-visual-styles-rank-default.ts');
      await client.query('ROLLBACK');
      return;
    }
    
    if (!hasStoryThemesRank) {
      console.error('✗ Column "rank" does not exist in mod_story_themes');
      console.error('  Please run: docker-compose exec app npx tsx scripts/migrate-add-story-themes-rank-default.ts');
      await client.query('ROLLBACK');
      return;
    }
    
    // Populate mod_visual_styles rank (sorted by category, then label)
    console.log('Populating mod_visual_styles rank...');
    const visualStylesResult = await client.query(`
      SELECT id, category, label
      FROM mod_visual_styles
      ORDER BY category, label
    `);
    
    let rank = 1;
    for (const row of visualStylesResult.rows) {
      await client.query(
        'UPDATE mod_visual_styles SET rank = $1 WHERE id = $2',
        [rank, row.id]
      );
      console.log(`  Rank ${rank}: ${row.category} - ${row.label}`);
      rank++;
    }
    console.log(`✓ Updated ${visualStylesResult.rows.length} visual styles\n`);
    
    // Populate mod_story_themes rank (sorted by label)
    console.log('Populating mod_story_themes rank...');
    const storyThemesResult = await client.query(`
      SELECT id, label
      FROM mod_story_themes
      ORDER BY label
    `);
    
    rank = 1;
    for (const row of storyThemesResult.rows) {
      await client.query(
        'UPDATE mod_story_themes SET rank = $1 WHERE id = $2',
        [rank, row.id]
      );
      console.log(`  Rank ${rank}: ${row.label}`);
      rank++;
    }
    console.log(`✓ Updated ${storyThemesResult.rows.length} story themes\n`);
    
    await client.query('COMMIT');
    console.log('✓ Rank fields populated successfully');
    
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to rollback:', rollbackError);
      }
    }
    console.error('✗ Failed to populate rank fields:', error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

populateRanks().catch(console.error);

