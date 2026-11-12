import pkg from 'pg';
import { readFileSync } from 'fs';

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
    console.error('   DATABASE_URL=postgresql://postgres:password@localhost:5432/uranus_dungeon npx tsx scripts/migrate-rename-visual-style-name.ts');
    console.error('\nOr run inside Docker:');
    console.error('   docker-compose exec app npx tsx scripts/migrate-rename-visual-style-name.ts');
    throw error;
  }
  
  try {
    await client.query('BEGIN');
    
    console.log('Renaming column "name" to "visual_style_key" in mod_visual_styles table...');
    
    // Check if there's a unique constraint on the name column and rename it if it exists
    const constraintCheck = await client.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'mod_visual_styles'
        AND tc.constraint_type = 'UNIQUE'
        AND kcu.column_name = 'name';
    `);
    
    if (constraintCheck.rows.length > 0) {
      const oldConstraintName = constraintCheck.rows[0].constraint_name;
      const newConstraintName = oldConstraintName.replace(/name/g, 'visual_style_key');
      console.log(`Renaming unique constraint from ${oldConstraintName} to ${newConstraintName}...`);
      await client.query(`ALTER TABLE mod_visual_styles RENAME CONSTRAINT ${oldConstraintName} TO ${newConstraintName}`);
    }
    
    // Rename the column
    await client.query('ALTER TABLE mod_visual_styles RENAME COLUMN name TO visual_style_key');
    console.log('✓ Column renamed successfully');
    
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

