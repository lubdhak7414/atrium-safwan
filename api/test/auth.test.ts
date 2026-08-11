import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/index';
import { hashPassword, isLegacyPasswordHash, readSession, signSession } from '../src/auth';

test('a session cookie round trips and a tampered one is rejected', () => {
  process.env.SESSION_SECRET = 'atrium-test-secret';

  const issuedAt = Date.now();
  const cookie = signSession(41, issuedAt);
  const session = readSession(cookie);

  assert.notEqual(session, null);
  assert.equal(session ? session.personId : null, 41);
  assert.equal(session ? session.issuedAt : null, issuedAt);

  assert.equal(readSession(`42.${issuedAt}.${cookie.split('.')[2]}`), null);
  assert.equal(readSession('41'), null);
  assert.equal(readSession(undefined), null);
});

test('future-issued session cookies are rejected', () => {
  process.env.SESSION_SECRET = 'atrium-test-secret';
  assert.equal(readSession(signSession(41, Date.now() + 60_000)), null);
});

test('session cookies older than twelve hours are rejected', () => {
  process.env.SESSION_SECRET = 'atrium-test-secret';
  assert.equal(readSession(signSession(41, Date.now() - (12 * 60 * 60 * 1000 + 1))), null);
});

test('new passwords use Argon2id and legacy hashes are detected exactly', async () => {
  const passwordHash = await hashPassword(crypto.randomBytes(16).toString('hex'));
  assert.match(passwordHash, /^\$argon2id\$/);
  assert.equal(isLegacyPasswordHash('a'.repeat(64)), true);
  assert.equal(isLegacyPasswordHash('A'.repeat(64)), false);
  assert.equal(isLegacyPasswordHash(`${'a'.repeat(63)}-`), false);
});

test('app construction refuses a missing or default session secret', () => {
  const original = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  assert.throws(() => createApp(), /SESSION_SECRET/);
  process.env.SESSION_SECRET = 'change-me';
  assert.throws(() => createApp(), /SESSION_SECRET/);
  if (original === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = original;
});
