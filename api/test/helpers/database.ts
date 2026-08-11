import { pool } from '../../src/db';

function databaseTargetKey(connectionString: string): string {
  const url = new URL(connectionString);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const normalizedHost = ['localhost', '127.0.0.1', '::1'].includes(host) ? 'loopback' : host;
  const port = url.port || '5432';
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  return `${normalizedHost}:${port}/${database}`;
}

export function assertIntegrationDatabaseConfigured(): void {
  const testUrl = process.env.TEST_DATABASE_URL;
  const applicationUrl = process.env.DATABASE_URL;
  if (!testUrl) {
    throw new Error('TEST_DATABASE_URL is required; integration tests must never use DATABASE_URL');
  }
  if (applicationUrl && databaseTargetKey(testUrl) === databaseTargetKey(applicationUrl)) {
    throw new Error('TEST_DATABASE_URL must point to a database distinct from DATABASE_URL');
  }
}

export async function resetDatabase(): Promise<void> {
  assertIntegrationDatabaseConfigured();

  await pool.query(`
    truncate table
      check_in,
      enrolment,
      session,
      room,
      person,
      password_setup_token,
      email_outbox,
      job_run,
      scheduler_state
    restart identity cascade
  `);
}
