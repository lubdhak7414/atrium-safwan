import { Router } from 'express';
import { z } from 'zod';
import { requireRole, requireSession, optionalSession } from '../auth';
import { parseRequest } from '../validation';
import { getSessionForCaller, listSessionsForCaller } from '../permissions';
import {
  cancelSession,
  checkIn,
  completeSession,
  createSession,
  enrolSession,
  reassignSession,
  responseError,
  rescheduleSession
} from '../booking';

const router = Router();
const sessionIdSchema = z.coerce.number().int().positive();
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTimeSchema = z.string().regex(/^\d{2}:\d{2}$/);

const sessionListQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
}).strict();

const createSessionSchema = z.object({
  room_id: z.number().int().positive(),
  coach_id: z.number().int().positive().optional(),
  discipline: z.string().trim().min(1).max(100),
  session_type: z.enum(['short', 'standard', 'intensive']),
  local_date: localDateSchema,
  local_start_time: localTimeSchema,
  local_end_time: localTimeSchema
}).strict();

const rescheduleSchema = z.object({
  room_id: z.number().int().positive(),
  local_date: localDateSchema,
  local_start_time: localTimeSchema,
  local_end_time: localTimeSchema
}).strict();

const checkInSchema = z.object({
  enrolment_id: z.number().int().positive()
}).strict();

const reassignSchema = z.object({
  coach_id: z.number().int().positive()
}).strict();

const emptyBodySchema = z.object({}).strict().optional();

function sendError(res: any, error: unknown, fallback: string): void {
  const mapped = responseError(error);
  if (mapped) {
    res.status(mapped.status).json({ error: mapped.message });
    return;
  }
  console.error(error);
  res.status(500).json({ error: fallback });
}

function parseId(value: unknown, res: any): number | null {
  const parsed = sessionIdSchema.safeParse(value);
  if (!parsed.success) {
    res.status(404).json({ error: 'no such session' });
    return null;
  }
  return parsed.data;
}

router.get('/', optionalSession, async (req, res) => {
  try {
    const input = parseRequest(sessionListQuerySchema, req.query, res);
    if (!input) return;
    const feed = await listSessionsForCaller(
      res.locals.person,
      input.from ?? new Date().toISOString(),
      input.to
    );
    res.json(feed);
  } catch (error) {
    sendError(res, error, 'could not load the calendar');
  }
});

router.get('/:id', requireSession, async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    const session = await getSessionForCaller(id, res.locals.person);
    if (!session) {
      res.status(404).json({ error: 'no such session' });
      return;
    }
    res.json(session);
  } catch (error) {
    sendError(res, error, 'could not load the session');
  }
});

router.post('/', requireSession, requireRole('coach', 'admin'), async (req, res) => {
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
  try {
    const created = await createSession({
      roomId: body.room_id,
      coachId: caller.kind === 'coach' ? caller.id : body.coach_id!,
      discipline: body.discipline,
      sessionType: body.session_type,
      localDate: body.local_date,
      localStartTime: body.local_start_time,
      localEndTime: body.local_end_time
    });
    res.status(201).json(created);
  } catch (error) {
    sendError(res, error, 'could not create the session');
  }
});

router.post('/:id/enrol', requireSession, async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  if (parseRequest(emptyBodySchema, req.body, res) === null) return;
  try {
    res.status(201).json(await enrolSession(id, res.locals.person));
  } catch (error) {
    sendError(res, error, 'could not enrol in the session');
  }
});

router.post('/:id/cancel', requireSession, requireRole('coach', 'admin'), async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  if (parseRequest(emptyBodySchema, req.body, res) === null) return;
  try {
    res.json(await cancelSession(id, res.locals.person));
  } catch (error) {
    sendError(res, error, 'could not cancel the session');
  }
});

router.post('/:id/reschedule', requireSession, requireRole('coach', 'admin'), async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const body = parseRequest(rescheduleSchema, req.body, res);
  if (!body) return;
  try {
    res.json(await rescheduleSession(id, {
      roomId: body.room_id,
      localDate: body.local_date,
      localStartTime: body.local_start_time,
      localEndTime: body.local_end_time
    }, res.locals.person));
  } catch (error) {
    sendError(res, error, 'could not reschedule the session');
  }
});

router.post('/:id/reassign', requireSession, requireRole('admin'), async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const body = parseRequest(reassignSchema, req.body, res);
  if (!body) return;
  try {
    res.json(await reassignSession(id, body.coach_id, res.locals.person));
  } catch (error) {
    sendError(res, error, 'could not reassign the session');
  }
});

router.post('/:id/complete', requireSession, requireRole('coach', 'admin'), async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  if (parseRequest(emptyBodySchema, req.body, res) === null) return;
  try {
    res.json(await completeSession(id, res.locals.person));
  } catch (error) {
    sendError(res, error, 'could not complete the session');
  }
});

router.post('/:id/check-ins', requireSession, requireRole('coach', 'admin'), async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const body = parseRequest(checkInSchema, req.body, res);
  if (!body) return;
  try {
    res.status(201).json(await checkIn(id, body.enrolment_id, res.locals.person));
  } catch (error) {
    sendError(res, error, 'could not check in the attendee');
  }
});

export default router;
