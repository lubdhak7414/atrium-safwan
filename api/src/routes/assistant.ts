import { Router } from 'express';
import { optionalSession } from '../auth';
import { parseRequest } from '../validation';
import { AssistantDeniedError, assistantRequestSchema, answerAssistant } from '../assistant';
import { responseError } from '../booking';

const router = Router();

router.post('/', optionalSession, async (req, res) => {
  const input = parseRequest(assistantRequestSchema, req.body, res);
  if (!input) return;
  try {
    res.json(await answerAssistant(input.message, res.locals.person, input.tool, input.input, req.ip || 'unknown'));
  } catch (error) {
    const mapped = responseError(error);
    if (mapped) {
      if (error instanceof AssistantDeniedError) {
        res.status(mapped.status).json({ error: mapped.message, suggestions: error.suggestions });
        return;
      }
      res.status(mapped.status).json({ error: mapped.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'could not answer the assistant request' });
  }
});

export default router;
