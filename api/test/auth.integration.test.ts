import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index';
import { hashPassword } from '../src/auth';
import { pool, query } from '../src/db';
import { assertIntegrationDatabaseConfigured, resetDatabase } from './helpers/database';

assertIntegrationDatabaseConfigured();

describe('authentication integration', () => {
  let server: http.Server;
  let baseUrl: string;
  let port: number;

  before(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'integration-test-secret';
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    port = address.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  });

  async function fixture(
    options: { active?: boolean; legacy?: boolean } = {},
    reset = true
  ): Promise<{ email: string; password: string; id: number }> {
    if (reset) await resetDatabase();
    const email = `${crypto.randomUUID()}@integration.local`;
    const password = crypto.randomBytes(18).toString('base64url');
    const storedPassword = options.legacy
      ? crypto.createHash('sha256').update(password).digest('hex')
      : await hashPassword(password);
    const people = await query<{ id: number }>(
      `insert into person (email, password_hash, full_name, kind, credits, active, created_at)
       values ($1, $2, 'Integration User', 'participant', 4000, $3, now())
       returning id`,
      [email, storedPassword, options.active ?? true]
    );
    return { email, password, id: people[0].id };
  }

  async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
  }

  function rawPostWithHost(path: string, host: string, body: unknown): Promise<number> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        const payload = JSON.stringify(body);
        socket.write([
          `POST ${path} HTTP/1.1`,
          `Host: ${host}`,
          'Content-Type: application/json',
          `Content-Length: ${Buffer.byteLength(payload)}`,
          'Connection: close',
          '',
          payload
        ].join('\r\n'));
      });
      let data = '';
      socket.on('data', (chunk) => { data += chunk.toString(); });
      socket.on('error', reject);
      socket.on('close', () => {
        const status = data.match(/^HTTP\/1\.1 (\d{3})/);
        resolve(status ? Number(status[1]) : 0);
      });
    });
  }

  test('unknown, inactive, wrong-password, and malformed login failures are distinct only by validation status', async () => {
    const inactive = await fixture({ active: false });
    const active = await fixture({ active: true }, false);
    const unknown = await post('/api/login', { email: 'missing@integration.local', password: inactive.password });
    const inactiveResponse = await post('/api/login', { email: inactive.email, password: inactive.password });
    const wrong = await post('/api/login', { email: active.email, password: `${active.password}wrong` });
    const malformed = await post('/api/login', { email: active.email });

    assert.equal(unknown.status, 401);
    assert.equal(inactiveResponse.status, 401);
    assert.equal(wrong.status, 401);
    const unknownBody = await unknown.json();
    const inactiveBody = await inactiveResponse.json();
    const wrongBody = await wrong.json();
    assert.deepEqual(unknownBody, inactiveBody);
    assert.deepEqual(inactiveBody, wrongBody);
    assert.equal(malformed.status, 400);
  });

  test('a successful legacy login upgrades the stored hash', async () => {
    const account = await fixture({ legacy: true });
    const response = await post('/api/login', { email: account.email, password: account.password });
    assert.equal(response.status, 200);
    const rows = await query<{ password_hash: string }>('select password_hash from person where id = $1', [account.id]);
    assert.match(rows[0].password_hash, /^\$argon2id\$/);
  });

  test('requireSession reloads the account and observes revocation', async () => {
    const account = await fixture();
    const login = await post('/api/login', { email: account.email, password: account.password });
    const cookie = login.headers.get('set-cookie');
    assert.ok(cookie);
    const activeMe = await fetch(`${baseUrl}/api/me`, { headers: { cookie: cookie!.split(';')[0] } });
    assert.equal(activeMe.status, 200);
    assert.equal((await activeMe.json()).kind, 'participant');

    await query("update person set kind = 'coach' where id = $1", [account.id]);
    const changedMe = await fetch(`${baseUrl}/api/me`, { headers: { cookie: cookie!.split(';')[0] } });
    assert.equal(changedMe.status, 200);
    assert.equal((await changedMe.json()).kind, 'coach');

    await query('update person set active = false where id = $1', [account.id]);
    const revokedMe = await fetch(`${baseUrl}/api/me`, { headers: { cookie: cookie!.split(';')[0] } });
    assert.equal(revokedMe.status, 401);
  });

  test('setup tokens are local-only, hashed, atomic, single-use, and expiry checked', async () => {
    const account = await fixture();
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const issued = await post('/api/dev/setup-token', { email: account.email });
      assert.equal(issued.status, 200);
      const setupUrl = (await issued.json()).setup_url as string;
      const token = new URL(setupUrl).searchParams.get('token');
      assert.ok(token);
      const stored = await query<{ token_hash: string }>('select token_hash from password_setup_token');
      assert.equal(stored.length, 1);
      assert.notEqual(stored[0].token_hash, token);

      const password = crypto.randomBytes(18).toString('base64url');
      const redeemed = await post('/api/dev/setup-password', { token, password });
      assert.equal(redeemed.status, 200);
      const reused = await post('/api/dev/setup-password', { token, password });
      assert.equal(reused.status, 409);
      const login = await post('/api/login', { email: account.email, password });
      assert.equal(login.status, 200);

      const expiredToken = crypto.randomBytes(32).toString('base64url');
      await query(
        `insert into password_setup_token (token_hash, person_id, expires_at)
         values ($1, $2, now() - interval '1 minute')`,
        [crypto.createHash('sha256').update(expiredToken).digest('hex'), account.id]
      );
      const expired = await post('/api/dev/setup-password', { token: expiredToken, password });
      assert.equal(expired.status, 409);

      const rollbackAccount = await fixture({}, false);
      const rollbackIssued = await post('/api/dev/setup-token', { email: rollbackAccount.email });
      const rollbackToken = new URL((await rollbackIssued.json()).setup_url).searchParams.get('token');
      assert.ok(rollbackToken);
      await query('update person set active = false where id = $1', [rollbackAccount.id]);
      const rolledBack = await post('/api/dev/setup-password', { token: rollbackToken, password });
      assert.equal(rolledBack.status, 409);
      const rollbackRows = await query<{ consumed_at: string | null }>(
        'select consumed_at from password_setup_token where person_id = $1',
        [rollbackAccount.id]
      );
      assert.equal(rollbackRows[0].consumed_at, null);

      const concurrentAccount = await fixture({}, false);
      const concurrentIssued = await post('/api/dev/setup-token', { email: concurrentAccount.email });
      const concurrentToken = new URL((await concurrentIssued.json()).setup_url).searchParams.get('token');
      assert.ok(concurrentToken);
      const concurrentResponses = await Promise.all([
        post('/api/dev/setup-password', { token: concurrentToken, password }),
        post('/api/dev/setup-password', { token: concurrentToken, password })
      ]);
      assert.deepEqual(
        concurrentResponses.map((response) => response.status).sort((a, b) => a - b),
        [200, 409]
      );
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
    }
  });

  test('setup routes require local development and a loopback request', async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const account = await fixture();
    try {
      process.env.NODE_ENV = 'production';
      const productionResponse = await post('/api/dev/setup-token', { email: account.email });
      assert.equal(productionResponse.status, 404);

      process.env.NODE_ENV = 'development';
      const host = new URL(baseUrl).hostname;
      const spoofedHost = await rawPostWithHost('/api/dev/setup-token', 'example.com', { email: account.email });
      assert.equal(spoofedHost, 404);
      const loopback = await rawPostWithHost('/api/dev/setup-token', host, { email: account.email });
      assert.equal(loopback, 200);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
    }
  });
});
