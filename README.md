# Atrium

## Migration notes

`npm run migrate` records applied filenames in `schema_migrations` and runs each new migration in its own transaction. A second run is a no-op.

Databases created by the original runner have no migration history. Before using the new runner on one of those databases, verify that `001_init.sql` completed and manually record `001_init.sql` in `schema_migrations`. This repair is intentionally not hidden in the application.

`002_data_corrections.sql` preserves the seed rows while correcting the audited fractional credits, invalid durations and opening times, room and coach overlaps, invalid enrolments, over-capacity enrolments, and two cancelled sessions with live enrolments. The historical 48-hour booking breaches remain preserved for enforcement in the booking service.

`003_schema_hardening.sql` converts all credit values to integers, adds the domain checks and active-booking/check-in uniqueness rules, prevents overlapping non-cancelled room sessions with a half-open range exclusion constraint, adds query-driven indexes, and creates the email outbox, scheduler, and password-setup tables. `004_phase5_hardening.sql` adds fenced worker lease tokens and terminal-delivery timestamps without rewriting the earlier migration.

The outbox deduplicates by `(event_key, recipient)`, claims due rows with `FOR UPDATE SKIP LOCKED`, and uses a five-minute lease token so an expired worker cannot overwrite a newer worker's result. Transient SMTP failures retry five times with capped backoff; permanent SMTP 5xx failures become visible `failed` rows and require manual requeue. Daily jobs deduplicate by `(job_name, local_day)`, while `scheduler_state` stores the per-job watermark needed for restart-safe catch-up. Password setup stores only a token hash and redacts the setup URL from the outbox body after successful or terminal delivery.

## Phase 5 Email and Scheduler

Install and run Mailpit locally, then start the API:

```text
Mailpit SMTP: localhost:1025
Mailpit inbox: http://localhost:8025
npm run migrate
npm run dev:api
```

For a containerized Mailpit instance, use `docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit`. To verify the event paths, clear the Mailpit inbox, create a future session, enrol a participant, change and cancel bookings, enrol a coach attendee and reschedule or reassign the session, then cancel the populated session. The inbox should show the booking, change, cancellation, coach-attendee, room-booked, and room-cancelled messages with the expected recipients. A participant booking change emits `participant.booking.changed`, not a second `participant.booking.created`; an administrator cancellation emits `session.cancelled` without `room.cancelled_by_coach`.

The API performs one scheduler reconciliation during startup and then wakes the two durable jobs at midnight in `CENTRE_TIMEZONE`. Set `SCHEDULER_ENABLED=false` for an API process that should not run digest jobs. The coach digest covers the next centre-local day and is omitted when the coach has no bookings. The administrator digest covers the completed preceding centre-local day. Local-midnight windows use calendar arithmetic, so DST transition days are 23 or 25 hours rather than a fixed 24-hour duration.

Dispatch is at-least-once: a process crash after SMTP accepts a message but before the database update can cause a duplicate. Stable hashed `Message-ID` values identify the `(event_key, recipient)` pair, but do not claim exactly-once SMTP delivery.

To explicitly retry a terminal row after correcting its SMTP problem, requeue it with `update email_outbox set status = 'pending', available_at = now(), failed_at = null, last_error = null where id = <id> and status = 'failed';`.

If a digest materialization reaches its retry limit, inspect `last_error` and requeue the durable run with `update job_run set status = 'pending', attempts = 0, available_at = now(), lease_until = null, lease_token = null, last_error = null, completed_at = null where job_name = '<job_name>' and local_day = '<local-day>' and status = 'failed';`. Reconciliation will then retry the report date in order.

Before/after `EXPLAIN (ANALYZE, BUFFERS)` output for the five audited query shapes is in `evidence/phase1/query-plans.txt`. The email lookup remains a sequential scan on the 40-row seed table; its unique constraint still supplies the lookup index and enforces the invariant.

## Phase 2 Authentication

Use a separate test database and the tracked migrations:

```text
createdb atrium_test
npm run migrate:test
npm test
```

Set a non-default `SESSION_SECRET` in `.env`. The API refuses to boot when it is missing or still set to `change-me`. New passwords use Argon2id; successful logins transparently upgrade legacy lowercase 64-character SHA-256 seed hashes. Login failures for unknown, inactive, and incorrect-password accounts use the same generic response. Sessions expire after 12 hours, reject future-issued cookies, use timing-safe MAC comparison, and reload the active person from PostgreSQL on every request.

In local development, `POST /api/dev/setup-token` with a selected active seed email returns a single-use setup URL on the web app (`http://localhost:3000/setup-password?token=...`) that shows the account and asks for a new password and a confirmation. Redeeming it (via the page or `POST /api/dev/setup-password`) stores only the token hash, and token consumption and the Argon2id password update commit together. These routes require a loopback request and are disabled outside `NODE_ENV=development`. No coach or participant passwords are stored in the repository.

## Local development accounts

The seed migration (`001_init.sql`) stores legacy SHA-256 password hashes. Only the administrator credential is published:

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@atrium.local` | `admin` |

Coach and participant seed passwords are intentionally not published and are not recoverable from their hashes. To log in as any other active seed account (for example a coach or a participant), set a password with the local setup-token flow:

```text
# One command per account (requires the API running in dev; Node 18+ only)
node scripts/dev-passwords.mjs oscar.lindqvist@atrium.local your-password
node scripts/dev-passwords.mjs sofia.marino@atrium.local your-password
```

Or step by step:

```text
# 1. Issue a one-time setup token for the account (loopback only, dev only)
curl -X POST http://localhost:4000/api/dev/setup-token \
  -H 'Content-Type: application/json' \
  -d '{"email": "oscar.lindqvist@atrium.local"}'
# -> {"setup_url":"http://localhost:3000/setup-password?token=...","expires_at":"..."}

# 2. Open the setup_url in a browser: it shows the account and asks for
#    a new password plus a confirmation. Redeem it there, or with curl
#    (single use, 30-minute expiry):
curl -X POST 'http://localhost:4000/api/dev/setup-password?token=<TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"password": "your-password"}'
# -> {"password_set": true}
```

Suggested seed accounts for exercising the Phase 6 role-based UI:

| Role | Email |
|---|---|
| Coach | `oscar.lindqvist@atrium.local` |
| Participant | `sofia.marino@atrium.local` |

After setting a password, sign in at `http://localhost:3000/login`; the app routes by role — participant → `/dashboard`, coach → `/coach`, admin → `/admin`.
