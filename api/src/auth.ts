import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import { query } from './db';
import { withTransaction } from './db';

export const SESSION_COOKIE = 'atrium_session';

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;
const SETUP_TOKEN_MAX_AGE_MS = 1000 * 60 * 30;
const AUTH_FAILURE = 'invalid email or password';
const SETUP_FAILURE = 'invalid, expired, or already used setup token';

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret === 'change-me') {
    throw new Error('SESSION_SECRET must be set to a non-default value');
  }
  return secret;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isLegacyPasswordHash(passwordHash: string): boolean {
  return /^[0-9a-f]{64}$/.test(passwordHash);
}

async function verifyPassword(password: string, passwordHash: string): Promise<{ valid: boolean; legacy: boolean }> {
  if (isLegacyPasswordHash(passwordHash)) {
    const expected = Buffer.from(passwordHash, 'hex');
    const actual = crypto.createHash('sha256').update(password).digest();
    return { valid: safeEqual(actual, expected), legacy: true };
  }

  try {
    return { valid: await argon2.verify(passwordHash, password), legacy: false };
  } catch {
    return { valid: false, legacy: false };
  }
}

export function signSession(personId: number, issuedAt: number = Date.now()): string {
  const payload = `${personId}.${issuedAt}`;
  const mac = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  return `${payload}.${mac}`;
}

export function readSession(cookie: string | undefined): { personId: number; issuedAt: number } | null {
  if (!cookie) return null;

  const parts = cookie.split('.');
  if (parts.length !== 3) return null;

  const payload = `${parts[0]}.${parts[1]}`;
  const expectedMac = crypto.createHmac('sha256', sessionSecret()).update(payload).digest();
  const suppliedMac = Buffer.from(parts[2], 'hex');
  if (!safeEqual(expectedMac, suppliedMac)) return null;

  const personId = Number(parts[0]);
  const issuedAt = Number(parts[1]);
  if (!Number.isSafeInteger(personId) || !Number.isSafeInteger(issuedAt)) return null;
  const now = Date.now();
  if (issuedAt > now || now - issuedAt > SESSION_MAX_AGE_MS) return null;

  return { personId, issuedAt };
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = readSession(req.cookies ? req.cookies[SESSION_COOKIE] : undefined);
  if (!session) {
    res.status(401).json({ error: 'not signed in' });
    return;
  }

  try {
    const people = await query(
      'select id, email, full_name, kind, credits, active from person where id = $1',
      [session.personId]
    );
    const person = people[0];
    if (!person || !person.active) {
      res.status(401).json({ error: 'not signed in' });
      return;
    }
    res.locals.personId = person.id;
    res.locals.person = person;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not authenticate the request' });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const email = req.body ? req.body.email : undefined;
  const password = req.body ? req.body.password : undefined;

  if (typeof email !== 'string' || !email || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  try {
    const people = await query(
      'select id, email, full_name, kind, password_hash, active from person where email = $1',
      [email]
    );

    if (people.length === 0) {
      res.status(401).json({ error: AUTH_FAILURE });
      return;
    }

    const person = people[0];
    if (!person.active) {
      res.status(401).json({ error: AUTH_FAILURE });
      return;
    }

    const verification = await verifyPassword(password, person.password_hash);
    if (!verification.valid) {
      res.status(401).json({ error: AUTH_FAILURE });
      return;
    }

    if (verification.legacy) {
      const upgradedHash = await hashPassword(password);
      const upgraded = await query(
        'update person set password_hash = $1 where id = $2 and password_hash = $3 returning id',
        [upgradedHash, person.id, person.password_hash]
      );
      if (upgraded.length !== 1) {
        res.status(401).json({ error: AUTH_FAILURE });
        return;
      }
    }

    res.cookie(SESSION_COOKIE, signSession(person.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS
    });

    res.json({
      id: person.id,
      email: person.email,
      full_name: person.full_name,
      kind: person.kind
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not sign in' });
  }
}

function isLocalhostRequest(req: Request): boolean {
  if (process.env.NODE_ENV !== 'development') return false;

  const hostname = req.hostname.toLowerCase();
  const address = (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
    && ['127.0.0.1', '::1'].includes(address);
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function issueSetupToken(req: Request, res: Response): Promise<void> {
  if (!isLocalhostRequest(req)) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  const email = req.body ? req.body.email : undefined;
  if (typeof email !== 'string' || !email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }

  try {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SETUP_TOKEN_MAX_AGE_MS);
    const people = await query(
      'select id from person where email = $1 and active = true',
      [email]
    );
    if (people.length === 0) {
      res.status(404).json({ error: 'no active seed account found' });
      return;
    }

    await query(
      'insert into password_setup_token (token_hash, person_id, expires_at) values ($1, $2, $3)',
      [tokenHash(token), people[0].id, expiresAt]
    );

    const port = Number(process.env.API_PORT) || 4000;
    res.json({
      setup_url: `http://localhost:${port}/api/dev/setup-password?token=${encodeURIComponent(token)}`,
      expires_at: expiresAt.toISOString()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not issue a setup token' });
  }
}

export async function redeemSetupToken(req: Request, res: Response): Promise<void> {
  if (!isLocalhostRequest(req)) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  const token = typeof req.body?.token === 'string' ? req.body.token : typeof req.query.token === 'string' ? req.query.token : '';
  const password = req.body?.password;
  if (!token || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'token and password are required' });
    return;
  }

  try {
    const passwordHash = await hashPassword(password);
    await withTransaction(async (client) => {
      const consumed = await client.query<{ person_id: number }>(
        `update password_setup_token
            set consumed_at = now()
          where token_hash = $1
            and consumed_at is null
            and expires_at > now()
          returning person_id`,
        [tokenHash(token)]
      );

      if (consumed.rowCount !== 1) {
        const error = new Error(SETUP_FAILURE);
        error.name = 'SetupTokenError';
        throw error;
      }

      const updated = await client.query(
        'update person set password_hash = $1 where id = $2 and active = true returning id',
        [passwordHash, consumed.rows[0].person_id]
      );
      if (updated.rowCount !== 1) {
        const error = new Error(SETUP_FAILURE);
        error.name = 'SetupTokenError';
        throw error;
      }
    });

    res.json({ password_set: true });
  } catch (err) {
    if (err instanceof Error && err.name === 'SetupTokenError') {
      res.status(409).json({ error: SETUP_FAILURE });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'could not set the password' });
  }
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ signed_out: true });
}

export async function me(_req: Request, res: Response): Promise<void> {
  try {
    const people = await query(
      'select id, email, full_name, kind, credits, active from person where id = $1',
      [res.locals.personId]
    );

    if (people.length === 0) {
      res.status(401).json({ error: 'not signed in' });
      return;
    }

    res.json(people[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load the current user' });
  }
}
