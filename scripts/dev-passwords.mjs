// Sets a password on any active seed account through the local setup-token flow.
// Cross-platform (Node 18+ built-in fetch; no curl/psql required).
// Keeps coach/participant passwords out of source control (DECISIONS.md): the
// API issues a single-use, 30-minute loopback-only token and stores Argon2id
// hashes only. Requires the API running in NODE_ENV=development.
//
// Usage:
//   node scripts/dev-passwords.mjs oscar.lindqvist@atrium.local your-password
//   node scripts/dev-passwords.mjs sofia.marino@atrium.local your-password
//
// The published starter credential is admin@atrium.local / admin (SHA-256 seed,
// upgraded to Argon2id on first successful login). Seed coach and participant
// passwords are never committed; set them per machine with this script.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function apiBaseUrl() {
  if (process.env.API_BASE_URL) return process.env.API_BASE_URL;
  const envFile = join(root, '.env');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*API_BASE_URL\s*=\s*(.*)$/i);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return 'http://localhost:4000';
}

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error('usage: node scripts/dev-passwords.mjs <email> <new-password>');
  process.exit(2);
}

const base = apiBaseUrl();

const tokenResponse = await fetch(`${base}/api/dev/setup-token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email })
});
const tokenBody = await tokenResponse.json();
const token = tokenBody?.setup_url?.match(/token=([^&]+)/)?.[1];
if (!tokenResponse.ok || !token) {
  console.error(`could not issue a setup token: ${JSON.stringify(tokenBody)}`);
  console.error('is the API running in development? (npm run dev:api) — setup tokens are loopback-only.');
  process.exit(1);
}

const redeemResponse = await fetch(`${base}/api/dev/setup-password?token=${encodeURIComponent(token)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password })
});
const redeemBody = await redeemResponse.json();
if (!redeemResponse.ok || redeemBody?.password_set !== true) {
  console.error(`could not set the password: ${JSON.stringify(redeemBody)}`);
  process.exit(1);
}

console.log(`password set for ${email}`);
