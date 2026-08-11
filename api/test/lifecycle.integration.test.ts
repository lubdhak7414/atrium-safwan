import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, test } from 'node:test';
import { bootstrap } from '../src/index';
import { pool } from '../src/db';
import { assertIntegrationDatabaseConfigured } from './helpers/database';

assertIntegrationDatabaseConfigured();

describe('bootstrap lifecycle integration', () => {
  const originalPort = process.env.API_PORT;
  const originalScheduler = process.env.SCHEDULER_ENABLED;
  const originalSecret = process.env.SESSION_SECRET;
  let port: number;

  before(async () => {
    port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          const freePort = address.port;
          server.close(() => resolve(freePort));
        } else {
          server.close(() => reject(new Error('could not allocate a port')));
        }
      });
    });
    process.env.API_PORT = String(port);
    process.env.SCHEDULER_ENABLED = 'false';
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'lifecycle-test-secret';
  });

  after(() => {
    if (originalPort === undefined) delete process.env.API_PORT;
    else process.env.API_PORT = originalPort;
    if (originalScheduler === undefined) delete process.env.SCHEDULER_ENABLED;
    else process.env.SCHEDULER_ENABLED = originalScheduler;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  });

  test('bootstrap fails fast without a usable session secret', async () => {
    delete process.env.SESSION_SECRET;
    try {
      await assert.rejects(bootstrap(), /SESSION_SECRET/);
    } finally {
      process.env.SESSION_SECRET = 'lifecycle-test-secret';
    }
  });

  test('bootstrap serves requests and shutdown drains workers and the pool', async () => {
    const shutdown = await bootstrap();

    const response = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'lifecycle@example.test' })
    });
    assert.equal(response.status, 400);

    await shutdown();
    await shutdown();

    await assert.rejects(pool.query('select 1'));
  });
});
