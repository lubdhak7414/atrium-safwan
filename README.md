# Atrium

## Migration notes

`npm run migrate` records applied filenames in `schema_migrations` and runs each new migration in its own transaction. A second run is a no-op.

Databases created by the original runner have no migration history. Before using the new runner on one of those databases, verify that `001_init.sql` completed and manually record `001_init.sql` in `schema_migrations`. This repair is intentionally not hidden in the application.

`002_data_corrections.sql` preserves the seed rows while correcting the audited fractional credits, invalid durations and opening times, room and coach overlaps, invalid enrolments, over-capacity enrolments, and two cancelled sessions with live enrolments. The historical 48-hour booking breaches remain preserved for enforcement in the booking service.

`003_schema_hardening.sql` converts all credit values to integers, adds the domain checks and active-booking/check-in uniqueness rules, prevents overlapping non-cancelled room sessions with a half-open range exclusion constraint, adds query-driven indexes, and creates the email outbox, scheduler, and password-setup tables.

The outbox deduplicates by `(event_key, recipient)` and leases due work through `status` and `available_at`. Daily jobs deduplicate by `(job_name, local_day)`, while `scheduler_state` stores the per-job watermark needed for restart-safe catch-up. Password setup stores only a token hash and records expiry and consumption timestamps.

Before/after `EXPLAIN (ANALYZE, BUFFERS)` output for the five audited query shapes is in `evidence/phase1/query-plans.txt`. The email lookup remains a sequential scan on the 40-row seed table; its unique constraint still supplies the lookup index and enforces the invariant.

## Phase 2 Authentication

Use a separate test database and the tracked migrations:

```text
createdb atrium_test
npm run migrate:test
npm test
```

Set a non-default `SESSION_SECRET` in `.env`. The API refuses to boot when it is missing or still set to `change-me`. New passwords use Argon2id; successful logins transparently upgrade legacy lowercase 64-character SHA-256 seed hashes. Login failures for unknown, inactive, and incorrect-password accounts use the same generic response. Sessions expire after 12 hours, reject future-issued cookies, use timing-safe MAC comparison, and reload the active person from PostgreSQL on every request.

In local development, `POST /api/dev/setup-token` with a selected active seed email returns a loopback setup URL. Redeem it once with `POST /api/dev/setup-password`; only the token hash is stored, and token consumption and the Argon2id password update commit together. These routes require a loopback request and are disabled outside `NODE_ENV=development`. No coach or participant passwords are stored in the repository.
