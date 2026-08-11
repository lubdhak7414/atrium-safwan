import { Router } from 'express';
import { z } from 'zod';
import { requireRole, requireSession, createSetupTokenForClient } from '../auth';
import { withTransaction, query } from '../db';
import { listPeopleForCaller } from '../permissions';
import { parseRequest } from '../validation';

const router = Router();

const idSchema = z.coerce.number().int().positive();

function parseId(value: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): number | null {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) {
    res.status(404).json({ error: 'no such person' });
    return null;
  }
  return parsed.data;
}

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

router.delete('/:id', requireSession, requireRole('admin'), async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  if (id === res.locals.person.id) {
    res.status(400).json({ error: 'you cannot deactivate your own account' });
    return;
  }
  try {
    const rows = await query<{ id: number; full_name: string; email: string; kind: string; active: boolean }>(
      `update person set active = false
        where id = $1
        returning id, full_name, email, kind, active`,
      [id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'no such person' });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not deactivate the person' });
  }
});

router.post('/:id/password-reset', requireSession, requireRole('admin'), async (req, res) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    const people = await query<{ email: string; active: boolean }>(
      'select email, active from person where id = $1',
      [id]
    );
    const person = people[0];
    if (!person) {
      res.status(404).json({ error: 'no such person' });
      return;
    }
    if (!person.active) {
      res.status(400).json({ error: 'inactive accounts cannot receive a password reset' });
      return;
    }

    const webBase = process.env.WEB_BASE_URL || 'http://localhost:3000';
    const result = await withTransaction(async (client) => {
      const { token, expiresAt } = await createSetupTokenForClient(client, id);
      const setupUrl = `${webBase}/setup-password?token=${encodeURIComponent(token)}`;
      await client.query(
        `insert into email_outbox (event_key, event_type, recipient, subject, body)
         values ($1, $2, $3, $4, $5)
         on conflict (event_key, recipient) do nothing`,
        [
          `password-setup:${id}:${token.slice(0, 16)}`,
          'password.setup',
          person.email,
          'Set your Atrium password',
          `We received a request to reset the password for your Atrium account.

To set a new password, visit the link below:
${setupUrl}

For your security, this link expires in 30 minutes and can only be used once. If you did not request this email, you can safely ignore it.`
        ]
      );
      return { setupUrl, expiresAt };
    });

    res.json({ setup_url: result.setupUrl, expires_at: result.expiresAt.toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not send the password reset email' });
  }
});

export default router;
