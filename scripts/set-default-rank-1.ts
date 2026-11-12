import pkg from 'pg';

const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function setDefaultRank1() {
  let client;
  try {
    client = await pool.connect();
    console.log('✓ Connected to database');
  } catch (error) {
    console.error('✗ Failed to connect to database:', error);
    console.error('\nTip: If you are running locally, use localhost instead of postgres:');
    console.error('   DATABASE_URL=postgresql://postgres:password@localhost:5432/uranus_dungeon npx tsx scripts/set-default-rank-1.ts');
    console.error('\nOr run inside Docker:');
    console.error('   docker-compose exec app npx tsx scripts/set-default-rank-1.ts');
    throw error;
  }
  
  try {
    await client.query('BEGIN');
    
    console.log('Setting rank 1 as default in both tables...\n');
    
    // First, set all defaults to false (to clear any existing defaults)
    console.log('Clearing existing defaults...');
    await client.query('UPDATE mod_visual_styles SET "default" = false');
    await client.query('UPDATE mod_story_themes SET "default" = false');
    
    // Set rank 1 as default in mod_visual_styles
    console.log('Setting default in mod_visual_styles...');
    const visualStyleResult = await client.query(`
      UPDATE mod_visual_styles 
      SET "default" = true 
      WHERE rank = 1 
      RETURNING id, category, label
    `);
    
    if (visualStyleResult.rows.length > 0) {
      const row = visualStyleResult.rows[0];
      console.log(`  ✓ Set default: ${row.category} - ${row.label}`);
    } else {
      console.log('  ⚠ No row with rank = 1 found in mod_visual_styles');
    }
    
    // Set rank 1 as default in mod_story_themes
    console.log('Setting default in mod_story_themes...');
    const storyThemeResult = await client.query(`
      UPDATE mod_story_themes 
      SET "default" = true 
      WHERE rank = 1 
      RETURNING id, label
    `);
    
    if (storyThemeResult.rows.length > 0) {
      const row = storyThemeResult.rows[0];
      console.log(`  ✓ Set default: ${row.label}`);
    } else {
      console.log('  ⚠ No row with rank = 1 found in mod_story_themes');
    }
    
    await client.query('COMMIT');
    console.log('\n✓ Default fields set successfully');
    
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to rollback:', rollbackError);
      }
    }
    console.error('✗ Failed to set defaults:', error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

setDefaultRank1().catch(console.error);

