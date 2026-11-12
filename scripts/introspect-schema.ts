import pkg from 'pg';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function introspectSchema() {
  const client = await pool.connect();
  
  try {
    // Get all tables in the public schema
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const tables = tablesResult.rows.map(row => row.table_name);
    console.log(`Found ${tables.length} tables: ${tables.join(', ')}`);

    const schemaParts: string[] = [];
    schemaParts.push('import { z } from "zod";');
    schemaParts.push('');

    // For each table, get column information
    for (const tableName of tables) {
      const columnsResult = await client.query(`
        SELECT 
          column_name,
          data_type,
          udt_name,
          character_maximum_length,
          is_nullable,
          column_default,
          numeric_precision,
          numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public' 
        AND table_name = $1
        ORDER BY ordinal_position;
      `, [tableName]);

      // Convert snake_case to camelCase for interface name
      const camelTableName = tableName.replace(/_([a-z])/g, (_match: string, letter: string) => letter.toUpperCase());
      const interfaceName = camelTableName.charAt(0).toUpperCase() + camelTableName.slice(1);
      
      schemaParts.push(`export interface ${interfaceName} {`);
      
      for (const col of columnsResult.rows) {
        const colName = col.column_name;
        const isNullable = col.is_nullable === 'YES';
        
        // Convert snake_case to camelCase for property name
        const camelName = colName.replace(/_([a-z])/g, (_match: string, letter: string) => letter.toUpperCase());
        
        // Map PostgreSQL types to TypeScript types
        let tsType = 'string';
        
        if (col.data_type === 'integer' || col.udt_name === 'int4' || col.data_type === 'smallint' || col.udt_name === 'int2') {
          tsType = 'number';
        } else if (col.data_type === 'bigint' || col.udt_name === 'int8') {
          tsType = 'number'; // or 'bigint' if you prefer
        } else if (col.data_type === 'numeric' || col.data_type === 'decimal') {
          tsType = 'number';
        } else if (col.data_type === 'real' || col.data_type === 'double precision') {
          tsType = 'number';
        } else if (col.data_type === 'boolean') {
          tsType = 'boolean';
        } else if (col.data_type === 'json' || col.data_type === 'jsonb') {
          tsType = 'any';
        } else if (col.data_type === 'timestamp without time zone' || col.data_type === 'timestamp with time zone') {
          tsType = 'Date';
        } else {
          tsType = 'string';
        }
        
        const nullable = isNullable ? ' | null' : '';
        schemaParts.push(`  ${camelName}: ${tsType}${nullable};`);
      }

      schemaParts.push('}');
      schemaParts.push('');

      // Generate insert schema (basic version) - omit auto-generated fields
      const omitFields = ['id', 'created_at', 'updated_at', 'createdAt', 'updatedAt', 'published_at'];
      const shouldOmit = (field: string) => {
        const lowerField = field.toLowerCase();
        return omitFields.some(omit => lowerField.includes(omit));
      };
      
      const omitList = columnsResult.rows
        .filter(col => shouldOmit(col.column_name))
        .map(col => col.column_name.replace(/_([a-z])/g, (_match: string, letter: string) => letter.toUpperCase()));
      
      if (omitList.length > 0) {
        const insertSchemaName = `insert${interfaceName}Schema`;
        schemaParts.push(`export const ${insertSchemaName} = z.object({`);
        
        for (const col of columnsResult.rows) {
          const camelName = col.column_name.replace(/_([a-z])/g, (_match: string, letter: string) => letter.toUpperCase());
          if (omitList.includes(camelName)) {
            continue;
          }
          
          const isNullable = col.is_nullable === 'YES';
          let zodType = 'z.string()';
          
          if (col.data_type === 'integer' || col.udt_name === 'int4' || col.data_type === 'smallint' || col.udt_name === 'int2') {
            zodType = 'z.number()';
          } else if (col.data_type === 'bigint' || col.udt_name === 'int8') {
            zodType = 'z.number()';
          } else if (col.data_type === 'numeric' || col.data_type === 'decimal') {
            zodType = 'z.number()';
          } else if (col.data_type === 'real' || col.data_type === 'double precision') {
            zodType = 'z.number()';
          } else if (col.data_type === 'boolean') {
            zodType = 'z.boolean()';
          } else if (col.data_type === 'json' || col.data_type === 'jsonb') {
            zodType = 'z.any()';
          } else {
            zodType = 'z.string()';
          }
          
          if (isNullable) {
            zodType += '.nullable()';
          }
          
          // Check for default values
          if (col.column_default) {
            if (col.column_default.includes('gen_random_uuid()') || col.column_default.includes('now()') || col.column_default.includes('CURRENT_TIMESTAMP')) {
              // Skip defaults that are handled automatically
            } else if (col.column_default.match(/^\d+$/)) {
              zodType += `.default(${col.column_default})`;
            } else if (col.column_default.match(/^'[^']*'::/)) {
              const defaultVal = col.column_default.match(/^'([^']*)'::/)?.[1];
              zodType += `.default('${defaultVal}')`;
            }
          }
          
          zodType += '.optional()';
          schemaParts.push(`  ${camelName}: ${zodType},`);
        }
        
        schemaParts.push('});');
        schemaParts.push('');
        schemaParts.push(`export type Insert${interfaceName} = z.infer<typeof ${insertSchemaName}>;`);
        schemaParts.push('');
      }
    }

    // Read existing file to preserve game-specific types and schemas
    const schemaPath = join(process.cwd(), 'shared', 'schema.ts');
    let existingContent = '';
    try {
      existingContent = readFileSync(schemaPath, 'utf-8');
    } catch (e) {
      console.log('No existing schema file found');
    }

    // Extract everything after "// Game state types" comment
    const gameTypesMatch = existingContent.match(/\/\/ Game state types[\s\S]*$/);
    const gameTypes = gameTypesMatch ? gameTypesMatch[0] : '';

    // Write the schema file
    const schemaContent = schemaParts.join('\n');
    const finalContent = schemaContent + '\n' + gameTypes;

    writeFileSync(schemaPath, finalContent, 'utf-8');
    console.log(`✓ Schema updated at ${schemaPath}`);
    console.log(`✓ Generated definitions for ${tables.length} tables`);

  } finally {
    client.release();
    await pool.end();
  }
}

introspectSchema().catch(console.error);
