import { Router } from 'express';
import { z } from 'zod';
import { requireSession } from '../auth';
import { emptyBodySchema, parseRequest, positiveIdSchema } from '../validation';
import { cancelBooking, changeBooking, sendError } from '../booking';

const router = Router();
const changeBookingSchema = z.object({
  destination_session_id: z.number().int().positive()
}).strict();

function parseId(value: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): number | null {
  const parsed = positiveIdSchema.safeParse(value);
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
