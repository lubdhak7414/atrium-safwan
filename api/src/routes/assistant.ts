import { Router } from 'express';
import { optionalSession } from '../auth';
import { parseRequest } from '../validation';
import { assistantRequestSchema, answerAssistant } from '../assistant';
import { responseError } from '../booking';

const router = Router();
const anonymousBookingAttempts = new Map<string, number[]>();
const ANONYMOUS_BOOKING_WINDOW_MS = 15 * 60 * 1000;
const ANONYMOUS_BOOKING_LIMIT = 20;

function exceedsAnonymousBookingLimit(key: string): boolean {
  const now = Date.now();
  const recent = (anonymousBookingAttempts.get(key) || []).filter((time) => now - time < ANONYMOUS_BOOKING_WINDOW_MS);
  recent.push(now);
  anonymousBookingAttempts.set(key, recent);
  return recent.length > ANONYMOUS_BOOKING_LIMIT;
}

router.post('/', optionalSession, async (req, res) => {
  const input = parseRequest(assistantRequestSchema, req.body, res);
  if (!input) return;
  const bookingIntent = input.tool === 'book_session' || /\b(book|reserve|enrol|enroll)\b/i.test(input.message);
  if (!res.locals.person && bookingIntent && exceedsAnonymousBookingLimit(req.ip || 'unknown')) {
    res.status(429).json({ error: 'too many anonymous booking requests; try again later' });
    return;
  }
  try {
    res.json(await answerAssistant(input.message, res.locals.person, input.tool, input.input));
  } catch (error) {
    const mapped = responseError(error);
    if (mapped) {
      res.status(mapped.status).json({ error: mapped.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'could not answer the assistant request' });
  }
});

export default router;
