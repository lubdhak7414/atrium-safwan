import { Router } from 'express';
import { parseRequest } from '../validation';
import { createParticipantAccount, signupSchema } from '../signup';
import { sendError } from '../booking';
import { slidingWindowLimit } from '../rateLimit';

const router = Router();
const signupAttempts = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 10;

function exceedsSignupLimit(key: string): boolean {
  return slidingWindowLimit(key, signupAttempts, WINDOW_MS, LIMIT);
}

router.post('/', async (req, res) => {
  const input = parseRequest(signupSchema, req.body, res);
  if (!input) return;
  if (exceedsSignupLimit(req.ip || 'unknown')) {
    res.status(429).json({ error: 'too many account requests; try again later' });
    return;
  }
  try {
    res.json(await createParticipantAccount({ email: input.email, fullName: input.full_name }));
  } catch (error) {
    sendError(res, error, 'could not create the account');
  }
});

export default router;
