import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db';
import { optionalSession, requireRole, requireSession } from '../auth';
import { hoursOfNotice, refundAmount, refundPercent, roomFee, seatFee } from '../credits';
import { getSessionForCaller, listSessionsForCaller } from '../permissions';
import { validateSessionWindow } from '../time';
import { parseRequest } from '../validation';

const router = Router();

const sessionListQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
}).strict();

const sessionIdSchema = z.coerce.number().int().positive();

const createSessionSchema = z.object({
  room_id: z.number().int().positive(),
  coach_id: z.number().int().positive().optional(),
  discipline: z.string().trim().min(1).max(100),
  session_type: z.enum(['short', 'standard', 'intensive']),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true })
}).strict();

const emptyBodySchema = z.object({}).strict().optional();

router.get('/', optionalSession, async (req, res) => {
  try {
    const input = parseRequest(sessionListQuerySchema, req.query, res);
    if (!input) return;
    const caller = res.locals.person;
    const feed = await listSessionsForCaller(
      caller,
      input.from ?? new Date().toISOString(),
      input.to
    );
    res.json(feed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load the calendar' });
  }
});

router.get('/:id', requireSession, async (req, res) => {
  try {
    const parsedId = sessionIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      res.status(404).json({ error: 'no such session' });
      return;
    }
    const session = await getSessionForCaller(parsedId.data, res.locals.person);
    if (!session) {
      res.status(404).json({ error: 'no such session' });
      return;
    }
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load the session' });
  }
});

router.post('/', requireSession, requireRole('coach', 'admin'), async (req, res) => {
  try {
    const body = parseRequest(createSessionSchema, req.body, res);
    if (!body) return;
    const caller = res.locals.person;
    if (caller.kind === 'coach' && body.coach_id !== undefined) {
      res.status(400).json({ error: 'coach_id is assigned from the signed-in coach' });
      return;
    }
    if (caller.kind === 'admin' && body.coach_id === undefined) {
      res.status(400).json({ error: 'coach_id is required for an administrator' });
      return;
    }
    const coach_id = caller.kind === 'coach' ? caller.id : body.coach_id!;
    const { room_id, discipline, session_type, starts_at, ends_at } = body;

    const created = await withTransaction(async (client) => {
      const rooms = await client.query('select id, name, capacity from room where id = $1 for update', [room_id]);
      if (rooms.rowCount === 0) {
        throw Object.assign(new Error('no such room'), { name: 'BadRequestError' });
      }

      const coaches = await client.query(
        "select id, credits, kind, active from person where id = $1 for update",
        [coach_id]
      );
      if (coaches.rowCount === 0 || coaches.rows[0].kind !== 'coach' || !coaches.rows[0].active) {
        throw Object.assign(new Error('no such coach'), { name: 'BadRequestError' });
      }

      const databaseNow = await client.query<{ now: Date }>('select now() as now');
      const validationError = validateSessionWindow(
        starts_at,
        ends_at,
        session_type,
        new Date(databaseNow.rows[0].now)
      );
      if (validationError) {
        throw Object.assign(new Error(validationError), { name: 'BadRequestError' });
      }

      const clashes = await client.query(
        `select id
           from session
          where room_id = $1
            and status <> 'cancelled'
            and tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
          limit 1`,
        [room_id, starts_at, ends_at]
      );
      if ((clashes.rowCount ?? 0) > 0) {
        throw Object.assign(new Error(`${rooms.rows[0].name} is already booked for that time`), {
          name: 'ConflictError'
        });
      }

      const commitments = await client.query(
        `select 1
           from session s
          where s.status <> 'cancelled'
            and (s.coach_id = $1 or exists (
              select 1
                from enrolment e
               where e.session_id = s.id
                 and e.person_id = $1
                 and e.status = 'active'
            ))
            and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
          limit 1`,
        [coach_id, starts_at, ends_at]
      );
      if ((commitments.rowCount ?? 0) > 0) {
        throw Object.assign(new Error('the coach is already committed during that time'), {
          name: 'ConflictError'
        });
      }

      const fee = roomFee(session_type);
      const seat = seatFee(session_type);
      const inserted = await client.query(
        `insert into session
           (room_id, coach_id, discipline, session_type, status, starts_at, ends_at,
            room_fee_credits, seat_fee_credits)
         values ($1, $2, $3, $4, 'scheduled', $5, $6, $7, $8)
         returning *`,
        [room_id, coach_id, discipline, session_type, starts_at, ends_at, fee, seat]
      );

      const debited = await client.query(
        'update person set credits = credits - $1 where id = $2 and credits >= $1 returning id',
        [fee, coach_id]
      );
      if (debited.rowCount !== 1) {
        throw Object.assign(new Error('the coach does not have enough credits'), { name: 'ConflictError' });
      }

      return inserted.rows[0];
    });

    res.status(201).json(created);
  } catch (err) {
    if (err instanceof Error && err.name === 'BadRequestError') {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.name === 'ConflictError') {
      res.status(409).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'could not create the session' });
  }
});

router.post('/:id/cancel', requireSession, requireRole('coach', 'admin'), async (req, res) => {
  try {
    const parsedId = sessionIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      res.status(404).json({ error: 'no such session' });
      return;
    }
    if (parseRequest(emptyBodySchema, req.body, res) === null) return;
    const id = parsedId.data;
    const caller = res.locals.person;

    const summary = await withTransaction(async (client) => {
      const lockedSessions = await client.query('select * from session where id = $1 for update', [id]);
      if (lockedSessions.rowCount === 0) {
        throw Object.assign(new Error('no such session'), { name: 'NotFoundError' });
      }
      const session = lockedSessions.rows[0];
      if (caller.kind === 'coach' && session.coach_id !== caller.id) {
        throw Object.assign(new Error('only the teaching coach may cancel this session'), { name: 'ForbiddenError' });
      }
      if (session.status === 'cancelled') {
        throw Object.assign(new Error('that session is already cancelled'), { name: 'ConflictError' });
      }
      if (session.status !== 'scheduled') {
        throw Object.assign(new Error('only scheduled sessions may be cancelled'), { name: 'ConflictError' });
      }
      if (new Date(session.starts_at).getTime() <= Date.now()) {
        throw Object.assign(new Error('a session cannot be cancelled after it starts'), { name: 'ConflictError' });
      }

      const percent = refundPercent(hoursOfNotice(new Date(), new Date(session.starts_at)));
      const roomRefund = refundAmount(Number(session.room_fee_credits), percent);
      const enrolments = await client.query(
        "select id, person_id, credits_charged from enrolment where session_id = $1 and status = 'active'",
        [id]
      );

      let seatsRefunded = 0;

      for (const enrolment of enrolments.rows) {
        const participantRefund = Number(enrolment.credits_charged);

        await client.query(
          `update enrolment
              set status = 'cancelled', credits_refunded = $1, cancelled_at = now(),
                  cancelled_by_person_id = $3
            where id = $2`,
          [participantRefund, enrolment.id, caller.id]
        );

        await client.query('update person set credits = credits + $1 where id = $2', [
          participantRefund,
          enrolment.person_id
        ]);

        seatsRefunded += participantRefund;
      }

      await client.query('update person set credits = credits + $1 where id = $2', [
        roomRefund,
        session.coach_id
      ]);

      await client.query(
        "update session set status = 'cancelled', cancelled_at = now(), cancelled_by_person_id = $2 where id = $1",
        [id, caller.id]
      );

      return { enrolments: enrolments.rowCount, seatsRefunded, percent, roomRefund };
    });

    res.json({
      id,
      status: 'cancelled',
      refund_percent: summary.percent,
      room_fee_refunded: summary.roomRefund,
      enrolments_cancelled: summary.enrolments,
      seat_fees_refunded: summary.seatsRefunded
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'NotFoundError') {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.name === 'ForbiddenError') {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.name === 'ConflictError') {
      res.status(409).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'could not cancel the session' });
  }
});

export default router;
