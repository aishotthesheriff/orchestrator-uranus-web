import pkg from 'pg';

const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  let client;
  try {
    client = await pool.connect();
    console.log('✓ Connected to database');
  } catch (error) {
    console.error('✗ Failed to connect to database:', error);
    console.error('\nTip: If you are running locally, use localhost instead of postgres:');
    console.error('   DATABASE_URL=postgresql://postgres:password@localhost:5432/uranus_dungeon npx tsx scripts/migrate-add-visual-styles-rank-default.ts');
    console.error('\nOr run inside Docker:');
    console.error('   docker-compose exec app npx tsx scripts/migrate-add-visual-styles-rank-default.ts');
    throw error;
  }
  
  try {
    await client.query('BEGIN');
    
    console.log('Adding columns "rank" and "default" to mod_visual_styles table...');
    
    // Check if columns already exist
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'mod_visual_styles' 
        AND column_name IN ('rank', 'default');
    `);
    
    const hasRank = columnCheck.rows.some(r => r.column_name === 'rank');
    const hasDefault = columnCheck.rows.some(r => r.column_name === 'default');
    
    if (hasRank && hasDefault) {
      console.log('✓ Columns "rank" and "default" already exist. Migration may have already completed.');
      await client.query('COMMIT');
      console.log('✓ No changes needed.');
      return;
    }
    
    // Add rank column (integer, unique, nullable initially)
    if (!hasRank) {
      console.log('Adding "rank" column...');
      await client.query('ALTER TABLE mod_visual_styles ADD COLUMN rank INTEGER');
      
      // Add unique constraint on rank
      console.log('Adding unique constraint on "rank"...');
      await client.query('ALTER TABLE mod_visual_styles ADD CONSTRAINT mod_visual_styles_rank_key UNIQUE (rank)');
    }
    
    // Add default column (boolean, default false)
    // Note: "default" is a reserved keyword, so we quote it
    if (!hasDefault) {
      console.log('Adding "default" column...');
      await client.query('ALTER TABLE mod_visual_styles ADD COLUMN "default" BOOLEAN NOT NULL DEFAULT false');
      
      // Create a partial unique index to ensure only one row can have default = true
      console.log('Creating partial unique index to ensure only one row can be default...');
      // Check if index already exists
      const indexCheck = await client.query(`
        SELECT indexname 
        FROM pg_indexes 
        WHERE tablename = 'mod_visual_styles' 
          AND indexname = 'mod_visual_styles_default_true_unique';
      `);
      
      if (indexCheck.rows.length === 0) {
        // Create a partial unique index using a constant expression
        // This ensures only one row can have "default" = true
        // Syntax: CREATE UNIQUE INDEX ... ON table ((constant)) WHERE condition
        await client.query(`
          CREATE UNIQUE INDEX mod_visual_styles_default_true_unique 
          ON mod_visual_styles ((1)) 
          WHERE "default" = true
        `);
      } else {
        console.log('Partial unique index already exists, skipping...');
      }
    }
    
    await client.query('COMMIT');
    console.log('✓ Migration completed successfully');
    
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to rollback:', rollbackError);
      }
    }
    console.error('✗ Migration failed:', error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

migrate().catch(console.error);

