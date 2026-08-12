import crypto from 'node:crypto';
import { z } from 'zod';
import { withTransaction } from './db';
import { DomainError } from './booking';
import { createSetupTokenForClient, hashPassword } from './auth';
import { webBaseUrl } from './config';
import { INITIAL_CREDITS } from './credits';
import { EMAIL_PATTERN } from './validation';

export const signupSchema = z.object({
  email: z.string().trim().min(1).max(254),
  full_name: z.string().trim().min(1).max(120)
}).strict();

export async function createParticipantAccount(input: { email: string; fullName: string }): Promise<{ status: 'received' }> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim() || email.slice(0, email.indexOf('@'));
  if (!EMAIL_PATTERN.test(email) || email.length > 254 || !fullName || fullName.length > 120) {
    throw new DomainError(400, 'a valid email and full name are required');
  }

  // Hash before the existence check and before the transaction so both paths
  // pay the password-work cost without holding a pooled connection open.
  const randomPassword = crypto.randomBytes(32).toString('base64url');
  const passwordHash = await hashPassword(randomPassword);

  try {
    return await withTransaction(async (client) => {
      const existing = await client.query('select id from person where lower(email) = lower($1) for update', [email]);
      if (existing.rowCount !== 0) {
        // Do not disclose whether an account already exists or issue a token from an email alone.
        return { status: 'received' as const };
      }

      const person = await client.query<{ id: number }>(
        `insert into person (email, password_hash, full_name, kind, credits, active, created_at)
         values ($1, $2, $3, 'participant', $4, true, now())
         returning id`,
        [email, passwordHash, fullName, INITIAL_CREDITS.participant]
      );
      const personId = Number(person.rows[0].id);

      const setup = await createSetupTokenForClient(client, personId);
      await client.query(
        `insert into email_outbox (event_key, event_type, recipient, subject, body)
         values ($1, $2, $3, $4, $5)
         on conflict (event_key, recipient) do nothing`,
        [
          `account-setup:${personId}`,
          'participant.account_setup',
          email,
          'Finish setting up your Atrium account',
          `Welcome to Atrium! Your participant account has been created with ${INITIAL_CREDITS.participant} credits to spend on sessions.

Set your password here within 30 minutes:
${webBaseUrl()}/setup-password?token=${encodeURIComponent(setup.token)}`
        ]
      );
      return { status: 'received' as const };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return { status: 'received' as const };
    throw error;
  }
}
