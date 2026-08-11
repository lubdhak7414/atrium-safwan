import path from 'node:path';
import { config } from 'dotenv';
import { Pool, PoolClient, QueryResultRow } from 'pg';

config({ path: path.resolve(__dirname, '..', '..', '.env') });

export const pool = new Pool({
  connectionString: process.env.NODE_ENV === 'test'
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL,
  max: 10
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(text, params as any[]);
  return result.rows;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback');
      const code = (err as { code?: string }).code;
      const retryable = code === '40P01' || code === '40001' || (err as Error).name === 'TransactionRetryError';
      if (!retryable || attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    } finally {
      client.release();
    }
  }

  throw new Error('transaction retry limit reached');
}
