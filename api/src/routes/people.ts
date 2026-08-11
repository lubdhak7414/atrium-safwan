import { Router } from 'express';
import { z } from 'zod';
import { requireSession } from '../auth';
import { listPeopleForCaller } from '../permissions';
import { parseRequest } from '../validation';

const router = Router();

const peopleQuerySchema = z.object({
  kind: z.enum(['admin', 'coach', 'participant']).optional()
}).strict();

router.get('/', requireSession, async (req, res) => {
  try {
    const input = parseRequest(peopleQuerySchema, req.query, res);
    if (!input) return;
    const people = await listPeopleForCaller(res.locals.person, input.kind);
    res.json(people);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load the people' });
  }
});

export default router;
