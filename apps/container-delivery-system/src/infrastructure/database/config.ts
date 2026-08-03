// Database Configuration

import { Pool, PoolConfig } from 'pg';
import { logger } from '../../shared/utils/logger.js';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

let pool: Pool | null = null;

export function createPool(config: DatabaseConfig): Pool {
  const poolConfig: PoolConfig = {
    host: config.host || process.env.DB_HOST || 'localhost',
    port: config.port || parseInt(process.env.DB_PORT || '5432'),
    database: config.database || process.env.DB_NAME || 'sonalit',
    user: config.user || process.env.DB_USER || 'postgres',
    password: config.password || process.env.DB_PASSWORD || '',
    max: config.max || 20,
    idleTimeoutMillis: config.idleTimeoutMillis || 30000,
    connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
  };

  pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    logger.error('Unexpected database pool error', { error: err });
  });

  pool.on('connect', () => {
    logger.debug('New database connection established');
  });

  return pool;
}

export function getPool(): Pool {
  if (!pool) {
    pool = createPool({} as DatabaseConfig);
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const pool = getPool();
    const result = await pool.query('SELECT NOW()');
    logger.info('Database connection successful', { time: result.rows[0].now });
    return true;
  } catch (error) {
    logger.error('Database connection failed', { error });
    return false;
  }
}
