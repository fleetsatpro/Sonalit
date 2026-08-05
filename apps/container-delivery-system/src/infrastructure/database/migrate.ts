// Database Migration Runner

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import { createPool, closePool } from './config.js';
import { logger } from '../../shared/utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
  const pool = createPool({} as any);
  
  try {
    // Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cds_schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Get applied migrations
    const applied = await pool.query('SELECT name FROM cds_schema_migrations');
    const appliedNames = new Set(applied.rows.map((r: any) => r.name));

    // Get migration files
    const migrationsDir = join(__dirname, '../../../migrations');
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // Apply pending migrations
    for (const file of files) {
      if (appliedNames.has(file)) {
        logger.info(`Migration already applied: ${file}`);
        continue;
      }

      logger.info(`Applying migration: ${file}`);
      
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO cds_schema_migrations (name) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        logger.info(`Migration applied: ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`Migration failed: ${file}`, { error });
        throw error;
      } finally {
        client.release();
      }
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed', { error });
    process.exit(1);
  } finally {
    await closePool();
  }
}

// Run if executed directly
runMigrations();
