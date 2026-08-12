import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { requireRole, requireSession, createSetupTokenForClient, hashPassword } from '../auth';
import { withTransaction, query } from '../db';
import { listPeopleForCaller } from '../permissions';
import { parseRequest, positiveIdSchema, EMAIL_PATTERN } from '../validation';
import { DomainError, responseError, sendError } from '../booking';
import { webBaseUrl } from '../config';
import { INITIAL_CREDITS } from '../credits';

const router = Router();

const createPersonSchema = z.object({
  email: z.string().trim().min(1).max(254),
  full_name: z.string().trim().min(1).max(120)
}).strict();

function parseId(value: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): number | null {
  const parsed = positiveIdSchema.safeParse(value);
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
    sendError(res, err, 'could not load the people');
  }
});

router.post('/', requireSession, requireRole('admin'), async (req, res) => {
  const input = parseRequest(createPersonSchema, req.body, res);
  if (!input) return;
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    res.status(400).json({ error: 'a valid email is required' });
    return;
  }
  const randomPassword = crypto.randomBytes(32).toString('base64url');
  try {
    const passwordHash = await hashPassword(randomPassword);
    const result = await withTransaction(async (client) => {
      const existing = await client.query('select id from person where lower(email) = lower($1) for update', [email]);
      if (existing.rowCount !== 0) {
        throw new DomainError(409, 'a person with that email already exists');
      }
      const person = await client.query<{ id: number; email: string; full_name: string; kind: string; credits: number; active: boolean }>(
        `insert into person (email, password_hash, full_name, kind, credits, active, created_at)
         values ($1, $2, $3, 'coach', $4, true, now())
         returning id, email, full_name, kind, credits, active`,
        [email, passwordHash, input.full_name.trim(), INITIAL_CREDITS.coach]
      );
      const created = person.rows[0];
      const { token, expiresAt } = await createSetupTokenForClient(client, created.id);
      const setupUrl = `${webBaseUrl()}/setup-password?token=${encodeURIComponent(token)}`;
      await client.query(
        `insert into email_outbox (event_key, event_type, recipient, subject, body)
         values ($1, $2, $3, $4, $5)
         on conflict (event_key, recipient) do nothing`,
        [
          `account-setup:${created.id}`,
          'coach.account_setup',
          created.email,
          'Finish setting up your Atrium account',
          `Welcome to Atrium! Your coach account has been created with ${INITIAL_CREDITS.coach} credits.

Set your password here within 30 minutes:
${setupUrl}`
        ]
      );
      return { created, setupUrl, expiresAt };
    });
    res.status(201).json({ person: result.created, setup_url: result.setupUrl, expires_at: result.expiresAt.toISOString() });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'a person with that email already exists' });
      return;
    }
    const mapped = responseError(error);
    if (mapped) {
      res.status(mapped.status).json({ error: mapped.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'could not create the coach' });
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
    sendError(res, err, 'could not deactivate the person');
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

    const result = await withTransaction(async (client) => {
      const { token, expiresAt } = await createSetupTokenForClient(client, id);
      const setupUrl = `${webBaseUrl()}/setup-password?token=${encodeURIComponent(token)}`;
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
    sendError(res, err, 'could not send the password reset email');
  }
});

export default router;
