# Atrium Coaching Centre

Full-stack booking system for a 12-room coaching centre in `America/New_York`: coaches book rooms, participants book seats, credits move on cancel/change, email goes out on every event path, two scheduled digests run at centre-local midnight, and a single AI assistant answers by role.

Node 20+, PostgreSQL 15, Express + TypeScript API, Next.js (App Router) web app, monorepo via npm workspaces (`api/`, `web/`).

---

## Stack

| Choice | What | Why |
|---|---|---|
| DB access | `pg` (raw SQL, parameterized) | The brief's hardest problems are concurrency, ranges and exclusion constraints; raw SQL keeps those explicit. No ORM mapping layer to fight. |
| Validation | `zod` | Every body/query is parsed once at the boundary, rejected with a 400. |
| Testing | `node:test` + tsx | Already wired in the starter, zero setup. Unit + integration suites against a real Postgres (`atrium_test`). |
| Email | Nodemailer → Mailpit | Single binary, offline, marker can watch mail in a browser at `localhost:8025`. No credentials involved. |
| Scheduler | node-cron + durable `job_run`/`scheduler_state` tables | cron only wakes the process; state lives in Postgres, so restarts catch up without duplicating digests. |
| Assistant | tool-calling endpoint; providers: deterministic stub, Ollama (`qwen32k:latest`) | Stub keeps tests deterministic offline; Ollama behind `MODEL_BASE_URL`/`MODEL_NAME` for a live demo. |
| UI | Hand-written CSS + a small token set | The brief says don't sink time into it. No component framework. |

---

## Quick start (clean clone)

Prerequisites: Node >= 20, PostgreSQL >= 15 running locally.

```bash
# 1. Database (adjust for your local setup)
createdb atrium
createdb atrium_test

# 2. Environment
cp env.example .env
#   - set DATABASE_URL and TEST_DATABASE_URL for your machine
#   - replace SESSION_SECRET (the API refuses to boot on the default "change-me")
#   - NEXT_PUBLIC_API_BASE_URL stays http://localhost:4000 in dev

# 3. Install and migrate (idempotent — a second run is a no-op)
npm install
npm run migrate
npm run migrate:test

# 4. Run
npm run dev:api     # API on :4000
npm run dev:web     # web on :3000
```

Open http://localhost:3000. Sign in at `/login` — one form, routing by role:

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@atrium.local` | `admin` (published seed credential only) |
| Coach (suggested) | `oscar.lindqvist@atrium.local` | set via setup token, below |
| Participant (suggested) | `sofia.marino@atrium.local` | set via setup token, below |

Seed coach/participant passwords are not published and are not recoverable from their (legacy SHA-256) hashes. Set one with the dev-only, loopback-bound setup flow:

```bash
# Requires the API running in dev; one command per account
node scripts/dev-passwords.mjs oscar.lindqvist@atrium.local your-password
node scripts/dev-passwords.mjs sofia.marino@atrium.local your-password
```

The flow issues a single-use, 30-minute token; redemption writes an Argon2id hash in the same transaction as token consumption. It never prints or commits a password.

### Mailpit (email)

```bash
docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit   # or: brew install mailpit && mailpit
```

SMTP `localhost:1025`, inbox http://localhost:8025. The `SMTP_*` block in `env.example` already points there.

To watch mail arrive: as a coach, create a session in the future (`/create`), then sign in as a participant and book a place in it. You should see `participant.booking.created` to the coach, then `room.booked_by_coach` to the admin, then — cancel the booking — `participant.booking.cancelled` to the coach. Cancel the whole session as the coach and every affected participant plus the admin get `session.cancelled` (with `room.cancelled_by_coach` to the admin). The assistant's anonymous booking path sends an `account-setup` email the same way.

### Scheduled jobs

`SCHEDULER_ENABLED=true` runs two jobs at 00:00 `America/New_York` (the API also reconciles once at startup, so a restart catches up missed dates):

- **Coach digest** — that coach's bookings for the next local day. No bookings, no email, by design.
- **Admin digest** — the completed preceding local day's bookings and attendances.

Day windows are local-midnight to local-midnight via Luxon, so the 25-hour day on 2026-11-01 and the 23-hour day on 2026-03-08 come out right. A UTC-anchored `+24h` window is wrong twice a year; this code doesn't do that.

### Assistant

`MODEL_PROVIDER=stub` (default, deterministic) or `ollama` (needs `MODEL_BASE_URL`/`MODEL_NAME`; `MODEL_API_KEY` is reserved for a future hosted provider). One endpoint, `POST /api/assistant`, caller identity from the session cookie only — anonymous, participant, coach and admin get different answers to the same question because each tool runs a permission-filtered query as the caller. The model only ever sees tool results, never raw tables. Try it at `/assistant`.

### Tests

```bash
npm test
```

Integration suites run against `TEST_DATABASE_URL` through the tracked migrations and reset between suites. They cover the access-control matrix (anonymous × participant × coach × admin, asserting response fields), refund boundaries (`30 × 0.25 = 8`), DST day windows, concurrency (double-booking, concurrent cancel, one winner), all six email paths, the scheduler, and the assistant in all four caller states.

---

## Fees, credits and refunds

Fees are per session (not per hour), defined once in `api/src/credits.ts` and rendered on the public pages from the same constants:

| Type | Duration (room hold) | Room fee (coach) | Seat fee (participant) |
|---|---|---|---|
| SHORT | 45 min | 30 | 15 |
| STANDARD | 60 min | 40 | 20 |
| INTENSIVE | 180 min teaching, holds the room 210 (30 min lunch break inside) | 120 | 60 |

Credits: participants start with 4000, coaches with 2000, admins 0 (explicit policy — an admin uses the flow as a participant if they want to attend). Always integers, enforced by `integer` columns and `>= 0` checks.

**Coach cancellation** (of the room fee), tiers fixed by the brief:

| Notice before start | Refund |
|---|---|
| >= 96 h | 100 % |
| 48–96 h | 50 % |
| 24–48 h | 25 % |
| < 24 h | 0 % |

**Participant cancellation** (of the seat fee), designed, not inherited:

| Notice before start | Refund |
|---|---|
| >= 24 h | 100 % |
| 12–24 h | 50 % |
| < 12 h | 0 % |

Shape mirrors the coach policy but shorter, because a freed seat is resellable much closer to start than a freed room is. Disjoint, deliberately boring, easy to state on the marketing page.

**When the coach cancels, every affected participant gets 100 % of `credits_charged` back, unconditionally.** The participant did nothing wrong; the starter applied coach notice tiers to participant refunds, which is gone.

**Rounding:** half-up (`Math.round`), applied identically to both sides. `30 × 0.25 = 7.5` refunds as `8`. Half-up was chosen over floor so a partial refund never systematically short-changes anyone by a fraction of a credit.

No cancellation is accepted after the session starts — the API returns 409 and no refund. Notice is measured as non-negative hours to start (the starter's `Math.abs` refunded past sessions as if they were hours away; fixed).

---

## Defects found in the starter

Found during the audit, fixed in `002_data_corrections.sql` (row-level, seed-preserving) and `003_schema_hardening.sql` (constraints, indexes, new tables). Full inventory with root causes is in `DECISIONS.md` (Decision 2); here is the short form:

| # | Defect | Root cause | Fix |
|---|---|---|---|
| 1 | Fractional credits on 5 persons, 3 sessions, 6 enrolments | `numeric(10,2)` in a credits-only world | Round half-up in 002; `integer` columns + non-negative checks in 003 |
| 2 | Intensives 142/749 held the room 180 min, not 210 | Wrong duration constant | `ends_at = starts_at + 210 min`; exact-duration check (`45/60/210`) in 003 |
| 3 | Sessions 69 (ends 21:30), 419 (Sunday 1 Nov), 463 (03:00) outside opening hours | No opening-hours validation existed | Moved to valid same-type slots; centre-zone validator in the service |
| 4 | Room 5 double-booked (sessions 617/485, 2026-09-15) | Check-then-insert race, closed interval | One moved; half-open `tstzrange` exclusion constraint in 003 |
| 5 | Coach 19 teaching sessions 256 and 557 at once | No person-commitment check | One moved; commitment query checks teaching + attending |
| 6 | Coach 28 attended session 503 while teaching 302 | Same gap | Enrolment moved; checker covers both roles |
| 7 | Enrolment 1928: coach 28 enrolled in own session 639 | No self-enrolment rule | Cancelled, fully refunded, row kept; rule enforced in service |
| 8 | Session 83: 11 active enrolments in a room of 8 | No capacity enforcement | Three latest cancelled/refunded; capacity checked under the session row lock |
| 9 | Sessions 136/459 cancelled with live, unrefunded enrolments (1659, 585) | Cancel path left enrolments dangling | Treated as coach cancellations at the instant the enrolments record — `2026-08-22T22:28:00Z` and `2026-09-12T13:28:00Z`, both > 96 h notice — full refunds; single cancel service now closes and refunds atomically |
| 10 | Sessions 667/726 booked inside the 48 h window | Rule never enforced | Rows preserved; 48 h gate enforced forward in the service |
| 11 | Check-in 1058 checked in twice (rows 797, 1251) | No uniqueness | Duplicate marked `legacy_seed_defect = true`; partial unique index blocks new duplicates |
| 12 | Only index was `idx_session_created_discipline_status` | Matched no real predicate | Four query-driven indexes (+ exclusion constraint) |
| 13 | Migrations untracked: a second `npm run migrate` failed | Runner applied files blindly | `schema_migrations` table, per-file transaction, idempotent |
| 14 | SHA-256 hashes, inactive accounts could log in, `SESSION_SECRET` defaulted to `change-me`, cookie trusted without reloading the person row, future-dated cookies accepted | Starter auth | Argon2id, legacy hashes rehashed on login, generic failures, boot-time secret check, person reloaded per request, 12 h expiry |
| 15 | No authorization anywhere: any signed-in user could create a session as any coach, read every balance (`/api/people`) and every attendee list (`/api/sessions/:id`), rewrite `status`/`coach_id` via generic `PATCH` | No permission layer | Permission-filtered query builders, explicit cancel/complete/reschedule/reassign services, ownership re-checked inside every transaction |
| 16 | `hoursOfNotice` used `Math.abs` | Refunded past sessions | Non-negative notice; post-start cancel → 409 |
| 17 | Browser `new Date(\`${date}T${time}\`)` and `14*24h` windows | DST-broken date math | Luxon centre-timezone parsing everywhere; calendar-day windows |

The check-in counts above are measured at the `2026-08-10T00:00:00Z` audit snapshot (1,940 of 2,000 check-ins belong to sessions that hadn't started at that instant).

## Performance: EXPLAIN before/after

The starter's only index served no real query, so 003 added `session(starts_at)`, `session(room_id, starts_at)`, `enrolment(session_id)`, `enrolment(person_id)`, and reused `person.email`'s unique constraint as the lookup index rather than duplicating it. Every audit query ran with `EXPLAIN (ANALYZE, BUFFERS)` before and after; raw output is in [`evidence/phase1/query-plans.txt`](evidence/phase1/query-plans.txt) and reproduced below.

| Query | Before | After |
|---|---|---|
| Upcoming sessions (30 days) | seq scan, 708 rows filtered | `session_starts_at_idx` bitmap scan, 7 filtered |
| Room overlap | seq scan, 800 rows filtered | exclusion constraint index, 1 row |
| Active capacity (session 83) | seq scan, 3024 rows filtered | `enrolment_active_person_session_unique` bitmap, 8 rows |
| Own bookings (person 2) | seq scan, 2905 rows filtered | `enrolment_person_id_idx` bitmap, 127 rows |
| Email lookup | seq scan (40 rows) | unchanged by design — table is 40 rows; the unique constraint is the lookup index |

<details>
<summary>Raw EXPLAIN (ANALYZE, BUFFERS) — before → after</summary>

```text
=== upcoming: before 003 ===
Sort  (cost=29.18..29.42 rows=96 width=55) (actual time=0.120..0.124 rows=93.00 loops=1)
  Sort Key: starts_at
  ->  Seq Scan on session  (cost=0.00..26.02 rows=96 width=55) (actual time=0.007..0.083 rows=93.00 loops=1)
        Filter: ((starts_at >= ...) AND (starts_at < ...) AND (status <> 'cancelled'))
        Rows Removed by Filter: 708
  Execution Time: 0.155 ms

=== upcoming: after 003 ===
Sort  (cost=26.21..26.45 rows=96 width=55) (actual time=0.132..0.138 rows=93.00 loops=1)
  ->  Bitmap Heap Scan on session  (cost=5.30..23.05 rows=96 width=55)
        Recheck Cond: (starts_at >= ... AND starts_at < ...)
        Filter: (status <> 'cancelled')  Rows Removed by Filter: 7
        ->  Bitmap Index Scan on session_starts_at_idx  (cost=0.00..5.28 rows=100 width=0)
  Execution Time: 0.194 ms

=== room_overlap: before 003 ===
Seq Scan on session  (cost=0.00..28.02 rows=1 width=4) (actual time=0.064..0.083 rows=1.00 loops=1)
  Filter: ((status <> 'cancelled') AND (room_id = 5) AND (tstzrange(starts_at, ends_at, '[)') && ...))
  Rows Removed by Filter: 800
  Execution Time: 0.088 ms

=== room_overlap: after 003 ===
Index Scan using session_room_time_exclusion on session  (cost=0.14..8.16 rows=1 width=4)
  Index Cond: ((room_id = 5) AND (tstzrange(starts_at, ends_at, '[)') && ...))
  Execution Time: 0.392 ms

=== active_capacity: before 003 ===
Aggregate  (cost=71.50..71.51 rows=1 width=8) (actual time=0.166..0.166 rows=1.00 loops=1)
  ->  Seq Scan on enrolment  (cost=0.00..71.48 rows=9 width=0)
        Filter: ((session_id = 83) AND (status = 'active'))
        Rows Removed by Filter: 3024
  Execution Time: 0.177 ms

=== active_capacity: after 003 ===
Aggregate  (cost=24.51..24.52 rows=1 width=8) (actual time=0.036..0.036 rows=1.00 loops=1)
  ->  Bitmap Heap Scan on enrolment  (cost=4.35..24.48 rows=9 width=0)
        Recheck Cond: ((session_id = 83) AND (status = 'active'))
        ->  Bitmap Index Scan on enrolment_active_person_session_unique
  Execution Time: 0.047 ms

=== own_bookings: before 003 ===
Seq Scan on enrolment  (cost=0.00..63.90 rows=127 width=31) (actual time=0.009..0.144 rows=127.00 loops=1)
  Filter: (person_id = 2)
  Rows Removed by Filter: 2905
  Execution Time: 0.152 ms

=== own_bookings: after 003 ===
Bitmap Heap Scan on enrolment  (cost=5.26..38.85 rows=127 width=31) (actual time=0.026..0.069 rows=127.00 loops=1)
  Recheck Cond: (person_id = 2)
  ->  Bitmap Index Scan on enrolment_person_id_idx  (cost=0.00..5.23 rows=127 width=0)
  Execution Time: 0.079 ms

=== email_lookup: before/after 003 ===
Seq Scan on person  (cost=0.00..2.50 rows=1 width=53)  →  (cost=0.00..1.50 rows=1 width=53)
  Filter: (email = 'sofia.marino@atrium.local')
  Rows Removed by Filter: 39
  Execution Time: 0.012 ms → 0.021 ms
  Unchanged by design: 40-row table; the unique email constraint is the lookup index.
```

</details>

---

## Roles and visibility

Access control is enforced at the API, not the screen (fields never reach the browser without permission). One permission layer — `api/src/permissions.ts` — serves the REST routes, the server-rendered pages and the assistant, keyed by the caller loaded from the session:

- **Participant** — own bookings, own balance. Nothing about any other participant.
- **Coach** — own sessions with full attendee detail; other coaches' sessions as busy blocks only (time, room, discipline — no attendee data, no coach identity); own balance.
- **Administrator** — everything.

The access-control integration suite asserts response *fields* per caller (anonymous × participant × coach × admin), not just status codes. The assistant runs the same builders: a tool result is permission-filtered data, and a request from a lower-privileged caller simply never fetches the rows.

## Where each invariant lives, and why

Rule of thumb: if a rule applies to one row, put it in the schema; if it needs the wall-clock meaning of a timezone or spans multiple tables, enforce it in the service transaction — where it is also given a proper error message.

| Invariant | Layer | Why |
|---|---|---|
| One non-cancelled session per room; half-open intervals | PostgreSQL exclusion constraint (`btree_gist` on `room_id`, `tstzrange(...,'[)') &&`) | The database is the final arbiter; two conflicting inserts cannot both commit. Touching intervals are valid. |
| Exact duration by type (45/60/210); status/type/kind values; integer, non-negative credits; `ends_at > starts_at`; capacity > 0; one active enrolment per `(session, person)`; one check-in per enrolment (partial unique, legacy duplicate exempt) | PostgreSQL `check` / unique constraints | Malformed rows can't be written by any path, including future ones. |
| Opening hours 07:00–21:00 Mon–Sat (centre zone) | Application (Luxon, `CENTRE_TIMEZONE`) | "Monday" and "21:00" are wall-clock meanings a `timestamptz` check can't express reliably. |
| No person double-booked (teaching + attending, incl. intensive lunch) | Application, after locking all involved `person` rows in ascending ID order | Spans `session` and `enrolment`; there's no single row a constraint could protect. |
| Capacity excludes the coach | Application, under the session row `FOR UPDATE` | The session row is the stable capacity lock; `READ COMMITTED` alone allows two stale counts. |
| No self-enrolment; ownership of every write | Application, inside the transaction | Cross-table rule + caller identity; checked again after locks are taken. |
| Refunds: exact amount recorded per enrolment; one cancellation; post-start → 409 | Application (explicit services; no generic `PATCH`) | Needs timezone-relative notice and per-row audit values. |

## Write paths: isolation, locks, and what `READ COMMITTED` alone would not prevent

All write transactions run at the default `READ COMMITTED`. Every one locks resources in the same order — rooms, then sessions, then people, ascending by ID — and any exclusion/unique/check/balance conflict surfaces as HTTP 409. Transient deadlocks (`40P01`) retry a bounded number of times. The table says, for each path, what the lock closes that plain `READ COMMITTED` would leave open.

| Write path | Locks taken | Anomaly `READ COMMITTED` alone would not prevent |
|---|---|---|
| Create session | room row, coach row (ID order) | Two coaches booking the same room in the same slot (both check-then-insert); closed by the exclusion constraint. |
| Enrol / anonymous booking | session row, person rows | Overselling a seat: two enrolments both read `count < capacity`; closed by the session row lock. |
| Change booking | rooms, old + new sessions, participant | Double-spending the refund/debit pair; closed by the enrolment + person locks. |
| Participant cancel | room, session, enrolment, participant | Refunding one seat twice (two requests); second request sees `status = 'cancelled'` under the lock. |
| Coach cancel | room, session, enrolments, all people | Double refund of room fee + participants; idempotent under the session lock. |
| Reschedule | old/new rooms, session, all people | Destination room over capacity, or coach double-booked in the new slot; closed by locks + checks. |
| Reassign (admin) | old/new coach rows, session | New coach double-booked or already enrolled; checked under locks. |
| Complete / check-in | room, session (enrolment) | Double completion / duplicate check-in; second gets 409 (partial unique index backs it). |
| Password setup | token row (`consumed_at = now() ... returning`) | Two redemptions of one token; atomic update means exactly one wins. |
| Scheduler materialization / outbox dispatch | `scheduler_state` / outbox rows (`FOR UPDATE SKIP LOCKED`) | Two scheduler instances both materializing the same report date; closed by the state lock + `(job_name, local_day)` unique. |
| Outbox dispatch | row claim with lease | Two workers sending the same email; lease + `SKIP LOCKED` means one claim wins. |

Nothing here runs at `SERIALIZABLE`; the predictable lock order plus database constraints is what makes `READ COMMITTED` sufficient. `READ COMMITTED` still permits non-repeatable reads and stale reads where no lock is taken — that's why every mutating path takes the locks above and re-reads mutable values after locking.

## Assumptions

Where the brief was ambiguous, this is what was decided, and what breaks if it's wrong:

| Assumption | If wrong |
|---|---|
| The check-in audit snapshot is `2026-08-10T00:00:00Z` | The "1,940 pre-start" count and the legacy-duplicate story change. |
| The intensive lunch break is inside the 210-minute room hold; the commitment check treats the whole hold as blocked | Commitment conflicts and the 210-minute duration interpretation change. |
| All wall-clock inputs mean `America/New_York`; invalid/ambiguous DST inputs are rejected | A displayed slot silently becomes a different instant. |
| The 48 h deadline also governs rescheduling into a new slot | A coach can move a session to within 48 h of start. |
| Participant tiers are `>=24 h` / `12–<24 h` / `<12 h` | Refund amounts and the marketing page change. |
| Coach cancels → every affected enrollee refunded 100 % | Participant balances and notifications change. |
| Cancellation after session start is refused (409, no refund) | The notice calculation and published policy change. |
| Seed sessions 136/459 are treated as coach cancellations at `2026-08-22T22:28:00Z` / `2026-09-12T13:28:00Z` (both > 96 h notice) | Corrected historical balances and audit fields change. |
| Anonymous booking with an existing email reveals nothing and books nothing (no token issued on email alone) | Otherwise any email owner's account could be hijacked via the setup flow. |
| Admins receive 0 credits by policy | Admin booking eligibility changes. |
| The known duplicate seed check-in is a preserved legacy exception | The partial unique index policy changes. |
| Coach digest = next local day; admin digest = completed preceding local day | Digest contents change (admin can't have attendances for a day that hasn't happened). |

## Unfinished

- **375 px pass.** Responsive CSS (breakpoints at 1023/639 px) and loading/empty/error states are in place, but not every page looks good at 375 px on a real viewport.
- **Anonymous-booking test matrix.** New email and existing participant behavior are covered, but the dedicated existing coach/admin, expired-token, and cross-account cases were not added.
- **Assistant breadth.** Coach history now includes past own sessions and participant details, but the administrator assistant does not expose every possible account-management action.
- **Coach account provisioning.** Existing coach seed accounts have their configured balances, but there is no general application flow for creating a new coach account with 2000 credits.
- **Scheduler interpretation.** The administrator digest reports the completed preceding local day; if the brief intends the upcoming current day at midnight, that date window must be changed.
- **Clean-clone verification.** The README setup was not followed from a fresh clone using only Node and PostgreSQL during the final pass.
- **Submission artifacts.** The walkthrough video, raw AI transcripts, signed-out video-link check, repository visibility/template-origin check, and submission email remain to be completed manually.
- Some UI/UX could have been improved.


Stopping here is deliberate: the three things the brief says are looked at first — public page + policies, unified login resolving by role, the assistant answering by role — are complete and tested.
