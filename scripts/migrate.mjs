// Applies every .sql file in migrations/ in filename order.
// Uses node + pg so that psql does not need to be on PATH.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const file = join(root, '.env');
  if (!existsSync(file)) {
    console.error('No .env found. Copy env.example to .env and set DATABASE_URL.');
    process.exit(1);
  }
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

loadEnv();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set in .env');
  process.exit(1);
}

const dir = join(root, 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

if (files.length === 0) {
  console.error('No migrations found in migrations/');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
} catch (err) {
  console.error(`Could not connect using DATABASE_URL: ${err.message}`);
  console.error('Is PostgreSQL running, and does the database exist? See INSTRUCTIONS.md.');
  process.exit(1);
}

const migrationLock = 'atrium:migrations';
await client.query(
  'select pg_advisory_lock(hashtextextended($1, 0))',
  [migrationLock],
);

await client.query(`
  create table if not exists schema_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now()
  )
`);

let applied = 0;
let skipped = 0;

for (const file of files) {
  await client.query('begin');
  try {
    const tracked = await client.query(
      'select 1 from schema_migrations where filename = $1',
      [file],
    );

    if (tracked.rowCount > 0) {
      await client.query('commit');
      skipped += 1;
      console.log(`skipping ${file} (already applied)`);
      continue;
    }

    process.stdout.write(`applying ${file} ... `);
    const sql = readFileSync(join(dir, file), 'utf8');
    await client.query(sql);
    await client.query(
      'insert into schema_migrations (filename) values ($1)',
      [file],
    );
    await client.query('commit');
    applied += 1;
    console.log('ok');
  } catch (err) {
    console.log('failed');
    console.error(`\n${file}: ${err.message}`);
    await client.query('rollback').catch(() => {});
    await client.query(
      'select pg_advisory_unlock(hashtextextended($1, 0))',
      [migrationLock],
    ).catch(() => {});
    await client.end();
    process.exit(1);
  }
}

await client.query(
  'select pg_advisory_unlock(hashtextextended($1, 0))',
  [migrationLock],
);
await client.end();
console.log(`\n${applied} migration(s) applied, ${skipped} already applied.`);
