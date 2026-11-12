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
    console.error('   DATABASE_URL=postgresql://postgres:password@localhost:5432/uranus_dungeon npx tsx scripts/migrate-rename-story-theme-value.ts');
    console.error('\nOr run inside Docker:');
    console.error('   docker-compose exec app npx tsx scripts/migrate-rename-story-theme-value.ts');
    throw error;
  }
  
  try {
    await client.query('BEGIN');
    
    // Check if column already renamed (in case migration partially completed)
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'mod_story_themes' 
        AND column_name IN ('value', 'story_theme_key');
    `);
    
    const hasValue = columnCheck.rows.some(r => r.column_name === 'value');
    const hasStoryThemeKey = columnCheck.rows.some(r => r.column_name === 'story_theme_key');
    
    if (hasStoryThemeKey && !hasValue) {
      console.log('✓ Column "story_theme_key" already exists. Migration may have already completed.');
      await client.query('COMMIT');
      console.log('✓ No changes needed.');
      return;
    }
    
    if (!hasValue) {
      throw new Error('Column "value" not found and "story_theme_key" does not exist. Table structure may have changed.');
    }
    
    console.log('Renaming column "value" to "story_theme_key" in mod_story_themes table...');
    
    // Check if there's a unique constraint on the value column and rename it if it exists
    // Only rename if the constraint name still contains "value" (not already renamed)
    const constraintCheck = await client.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'mod_story_themes'
        AND tc.constraint_type = 'UNIQUE'
        AND kcu.column_name = 'value'
        AND tc.constraint_name LIKE '%value%'
        AND tc.constraint_name NOT LIKE '%story_theme_key%';
    `);
    
    if (constraintCheck.rows.length > 0) {
      const oldConstraintName = constraintCheck.rows[0].constraint_name;
      const newConstraintName = oldConstraintName.replace(/value/g, 'story_theme_key');
      console.log(`Renaming unique constraint from ${oldConstraintName} to ${newConstraintName}...`);
      await client.query(`ALTER TABLE mod_story_themes RENAME CONSTRAINT ${oldConstraintName} TO ${newConstraintName}`);
      // Note: PostgreSQL automatically renames the underlying index when a unique constraint is renamed
    }
    
    // Check for standalone indexes on the value column (excluding those tied to unique constraints)
    // We only want indexes whose names still contain "value" (not already renamed by constraint)
    const indexCheck = await client.query(`
      SELECT i.indexname
      FROM pg_indexes i
      WHERE i.tablename = 'mod_story_themes'
        AND i.indexname LIKE '%value%'
        AND i.indexname NOT LIKE '%story_theme_key%'
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint c 
          WHERE c.conname = i.indexname
        );
    `);
    
    if (indexCheck.rows.length > 0) {
      for (const row of indexCheck.rows) {
        const oldIndexName = row.indexname;
        const newIndexName = oldIndexName.replace(/value/g, 'story_theme_key');
        // Skip if the new name would conflict (shouldn't happen, but safety check)
        if (oldIndexName === newIndexName) continue;
        console.log(`Renaming index from ${oldIndexName} to ${newIndexName}...`);
        await client.query(`ALTER INDEX IF EXISTS ${oldIndexName} RENAME TO ${newIndexName}`);
      }
    }
    
    // Rename the column
    await client.query('ALTER TABLE mod_story_themes RENAME COLUMN value TO story_theme_key');
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

