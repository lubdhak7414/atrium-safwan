# Phase 5 — Live six-path Mailpit walkthrough (evidence)

**Date:** 2026-08-11 (walkthrough executed against Mailpit on `localhost:1025`/`8025`, already running)

**Setup:** scratch database `atrium_walkthrough` migrated through the same tracked migrations (`001`–`004`); API started on port 4123 with `SCHEDULER_ENABLED=false`, `NODE_ENV=development`, a throwaway `SESSION_SECRET`; five local accounts (admin, coach A, coach B, participant 1, participant 2) and two rooms created; all API calls over real HTTP; delivery through the real Nodemailer → SMTP → Mailpit path (the outbox dispatcher's 5 s poll).

## Steps executed (all HTTP 200/201)

| # | Action | Expected notification |
|---|--------|----------------------|
| 1 | Coach A creates session A (room 1, 2026-08-15 10:00 NY) | Path 5: `room.booked_by_coach` → admins |
| 2 | Coach B creates session B (room 2, 2026-08-17 10:00 NY) | Path 5: `room.booked_by_coach` → admins |
| 3 | Participant 1 enrols in A | Path 2: `participant.booking.created` → coach A |
| 4 | Participant 2 enrols in A | Path 2: `participant.booking.created` → coach A |
| 5 | Participant 1 changes A → B | Path 3: `participant.booking.changed` → coaches A and B |
| 6 | Participant 2 cancels their booking on A | Path 3: `participant.booking.cancelled` → coach A |
| 7 | Coach B enrols in A as a coach attendee | Path 2: `participant.booking.created` → coach A |
| 8 | Coach A reschedules A (room 2, 2026-08-18 10:00 NY) | Path 4: `coach.attendee.session_changed` → coach B |
| 9 | Coach A cancels session A | Path 1: `session.cancelled` → admins + affected enrollees (coach B); Path 6: `room.cancelled_by_coach` → admins |
| 10 | Admin creates session C for coach A | Path 5: `room.booked_by_coach` → admins |
| 11 | Participant 2 enrols in C | Path 2: `participant.booking.created` → coach A |
| 12 | Admin cancels session C | Path 1: `session.cancelled` → admins + participant 2; **no** `room.cancelled_by_coach` |

## Result: 22 outbox rows written inside the domain transactions, all `sent`

```
event_type                        recipient
coach.attendee.session_changed    wt-coach-b@atrium.local
participant.booking.cancelled     wt-coach-a@atrium.local
participant.booking.changed       wt-coach-a@atrium.local
participant.booking.changed       wt-coach-b@atrium.local
participant.booking.created       wt-coach-a@atrium.local  (×4: enrolments 3033, 3034, 3035, session C)
room.booked_by_coach              admin@atrium.local       (×3: sessions A, B, C)
room.booked_by_coach              wt-admin@atrium.local    (×3)
room.cancelled_by_coach           admin@atrium.local       (×1: coach cancellation only)
room.cancelled_by_coach           wt-admin@atrium.local    (×1)
session.cancelled                 admin@atrium.local       (×2: sessions A and C)
session.cancelled                 wt-admin@atrium.local    (×2)
session.cancelled                 wt-coach-b@atrium.local  (×1: coach attendee of A)
session.cancelled                 wt-participant-2@atrium.local (×1: enrollee of C)
```

Every one of the 22 rows was delivered to the Mailpit inbox (verified via `GET http://localhost:8025/api/v1/messages`):
- Recipients match the contract exactly; no message was sent to a party outside the documented recipient set.
- The admin-cancellation variant (step 12) produced `session.cancelled` **without** `room.cancelled_by_coach` — the two administrator paths stay distinct.
- Stable hashed Message-IDs observed in Mailpit: `atrium-<64 hex>@atrium.local`, one per `(event_key, recipient)`.
- The dispatcher marked each row `sent` only after SMTP accepted it (no row left `processing`).

## Notes

- The seed administrator `admin@atrium.local` is included because the walkthrough database contains the seed data (`enqueueAdmins` selects every active admin).
- At-least-once semantics confirmed in practice: the walkthrough exercised claim → send → mark-`sent`; no duplicate rows were produced (`(event_key, recipient)` unique held for all 22 rows).
- Scheduler disabled during the walkthrough; digest delivery was previously evidenced separately (3 `digest.coach` messages in Mailpit).
