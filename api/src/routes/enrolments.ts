import { Router } from 'express';
import { z } from 'zod';
import { requireSession } from '../auth';
import { parseRequest } from '../validation';
import { cancelBooking, changeBooking, responseError } from '../booking';

const router = Router();
const enrolmentIdSchema = z.coerce.number().int().positive();
const changeBookingSchema = z.object({
  destination_session_id: z.number().int().positive()
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
  const parsed = enrolmentIdSchema.safeParse(value);
  if (!parsed.success) {
    res.status(404).json({ error: 'no such enrolment' });
    return null;
  }
  return parsed.data;
}

router.post('/:id/cancel', requireSession, async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  if (parseRequest(emptyBodySchema, req.body, res) === null) return;
  try {
    res.json(await cancelBooking(id, res.locals.person));
  } catch (error) {
    sendError(res, error, 'could not cancel the booking');
  }
});

router.post('/:id/change', requireSession, async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const body = parseRequest(changeBookingSchema, req.body, res);
  if (!body) return;
  try {
    res.json(await changeBooking(id, body.destination_session_id, res.locals.person));
  } catch (error) {
    sendError(res, error, 'could not change the booking');
  }
});

export default router;
