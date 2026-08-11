import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index';
import { hashPassword } from '../src/auth';
import { pool, query } from '../src/db';
import { assertIntegrationDatabaseConfigured, resetDatabase } from './helpers/database';

assertIntegrationDatabaseConfigured();

describe('assistant integration', () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'assistant-integration-secret';
    process.env.MODEL_PROVIDER = 'stub';
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  });

  async function fixture() {
    await resetDatabase();
    async function person(kind: 'admin' | 'coach' | 'participant') {
      const email = `${crypto.randomUUID()}@assistant.local`;
      const password = crypto.randomBytes(18).toString('base64url');
      const rows = await query<{ id: number }>(
        `insert into person (email, password_hash, full_name, kind, credits, active, created_at)
         values ($1, $2, $3, $4, 4000, true, now()) returning id`,
        [email, await hashPassword(password), `${kind} Assistant User`, kind]
      );
      return { id: rows[0].id, email, password };
    }
    const admin = await person('admin');
    const coach = await person('coach');
    const participant = await person('participant');
    const room = await query<{ id: number }>(
      "insert into room (name, capacity) values ('Assistant Room', 4) returning id"
    );
    const starts = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const ends = new Date(starts.getTime() + 60 * 60 * 1000);
    const session = await query<{ id: number }>(
      `insert into session (room_id, coach_id, discipline, session_type, status, starts_at, ends_at, room_fee_credits, seat_fee_credits, created_at)
       values ($1, $2, 'assistant-fitness', 'standard', 'scheduled', $3, $4, 40, 20, now()) returning id`,
      [room[0].id, coach.id, starts.toISOString(), ends.toISOString()]
    );
    await query(
      `insert into enrolment (session_id, person_id, status, credits_charged, credits_refunded, enrolled_at)
       values ($1, $2, 'active', 20, 0, now())`,
      [session[0].id, participant.id]
    );
    return { admin, coach, participant, sessionId: session[0].id };
  }

  async function login(account: { email: string; password: string }): Promise<string> {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: account.email, password: account.password })
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.ok(cookie);
    return cookie.split(';')[0];
  }

  async function assistant(body: unknown, cookie?: string): Promise<Response> {
    return fetch(`${baseUrl}/api/assistant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body)
    });
  }

  test('the same search is filtered for anonymous, participant, coach, and administrator callers', async () => {
    const data = await fixture();
    const message = 'show upcoming sessions';
    const anonymous = await (await assistant({ message })).json();
    assert.equal(anonymous.tool, 'search_sessions');
    assert.equal('coach_name' in anonymous.data.sessions[0], false);

    const participant = await (await assistant({ message }, await login(data.participant))).json();
    assert.equal('my_enrolment' in participant.data.sessions[0], true);
    assert.equal('coach_name' in participant.data.sessions[0], false);

    const coach = await (await assistant({ message }, await login(data.coach))).json();
    assert.equal(coach.data.sessions[0].is_own_session, true);
    assert.equal('coach_name' in coach.data.sessions[0], true);

    const admin = await (await assistant({ message }, await login(data.admin))).json();
    assert.equal('coach_name' in admin.data.sessions[0], true);
    assert.notEqual(anonymous.reply, participant.reply);
    assert.notEqual(participant.reply, coach.reply);
  });

  test('credits are caller-owned and anonymous callers cannot request them', async () => {
    const data = await fixture();
    const anonymous = await assistant({ message: 'what is my credit balance?' });
    assert.equal(anonymous.status, 401);
    const participant = await assistant({ message: 'what is my credit balance?' }, await login(data.participant));
    assert.equal(participant.status, 200);
    const body = await participant.json();
    assert.equal(body.data.credits, 4000);
  });

  test('anonymous new booking creates the participant, booking, hashed setup token, and outbox email together', async () => {
    const data = await fixture();
    const email = `${crypto.randomUUID()}@new.local`;
    const response = await assistant({
      message: `book session ${data.sessionId}`,
      tool: 'book_session',
      input: { session_id: data.sessionId, email, full_name: 'New Assistant Participant' }
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.booking.status, 'received');
    const people = await query<{ id: number; credits: number; password_hash: string }>('select id, credits, password_hash from person where email = $1', [email]);
    assert.equal(people.length, 1);
    assert.equal(Number(people[0].credits), 3980);
    assert.match(people[0].password_hash, /^\$argon2id\$/);
    assert.equal((await query('select id from enrolment where person_id = $1 and session_id = $2', [people[0].id, data.sessionId])).length, 1);
    assert.equal((await query('select token_hash from password_setup_token where person_id = $1', [people[0].id])).length, 1);
    assert.equal((await query("select recipient from email_outbox where recipient = $1 and event_type = 'participant.account_setup'", [email])).length, 1);
  });

  test('existing email does not attach a booking or issue a setup token', async () => {
    const data = await fixture();
    const before = await query<{ count: string }>('select count(*)::text as count from person');
    const response = await assistant({
      message: `book session ${data.sessionId}`,
      tool: 'book_session',
      input: { session_id: data.sessionId, email: data.participant.email, full_name: 'Attempted Account Takeover' }
    });
    assert.equal(response.status, 200);
    assert.equal((await query<{ count: string }>('select count(*)::text as count from person'))[0].count, before[0].count);
    assert.equal((await query('select token_hash from password_setup_token')).length, 0);
  });

  test('caller identity cannot be overridden by request fields and forbidden tools fail structurally', async () => {
    const data = await fixture();
    const response = await assistant({ message: 'show my credits', role: 'admin', person_id: data.admin.id }, await login(data.participant));
    assert.equal(response.status, 400);
    const normal = await assistant({ message: 'show my credits' }, await login(data.participant));
    assert.equal(normal.status, 200);
    assert.equal((await normal.json()).data.credits, 4000);
    const forbidden = await assistant({ message: 'show people', tool: 'admin_people', input: {} }, await login(data.participant));
    assert.equal(forbidden.status, 403);
  });

  test('an invalid session id returns 404 for both existing and new emails, so no account existence is revealed', async () => {
    const data = await fixture();
    const existing = await assistant({
      message: 'book session 999999',
      tool: 'book_session',
      input: { session_id: 999999, email: data.participant.email, full_name: 'Enumeration Probe' }
    });
    assert.equal(existing.status, 404);
    const fresh = await assistant({
      message: 'book session 999999',
      tool: 'book_session',
      input: { session_id: 999999, email: `${crypto.randomUUID()}@probe.local`, full_name: 'Enumeration Probe' }
    });
    assert.equal(fresh.status, 404);
    assert.equal((await query('select count(*)::text as count from person'))[0].count, '3');
  });

  test('anonymous booking rejects malformed emails and missing names', async () => {
    const data = await fixture();
    const missingAt = await assistant({
      message: `book session ${data.sessionId}`,
      tool: 'book_session',
      input: { session_id: data.sessionId, email: 'not-an-email', full_name: 'Probe' }
    });
    assert.equal(missingAt.status, 400);
    const emailOnly = await assistant({
      message: `book session ${data.sessionId}`,
      tool: 'book_session',
      input: { session_id: data.sessionId, email: `${crypto.randomUUID()}@valid.local`, full_name: '' }
    });
    assert.equal(emailOnly.status, 200);
    assert.equal((await query('select count(*)::text as count from person'))[0].count, '4');
  });

  test('the anonymous setup email carries the one-time setup URL', async () => {
    const data = await fixture();
    const email = `${crypto.randomUUID()}@setup.local`;
    await assistant({
      message: `book session ${data.sessionId}`,
      tool: 'book_session',
      input: { session_id: data.sessionId, email, full_name: 'Setup Link Participant' }
    });
    const setup = await query<{ body: string }>(
      "select body from email_outbox where recipient = $1 and event_type = 'participant.account_setup'",
      [email]
    );
    assert.equal(setup.length, 1);
    assert.match(setup[0].body, /\/setup-password\?token=[A-Za-z0-9_-]{43}/);
  });

  test('a signed-in participant books through the same tool without a setup token', async () => {
    const data = await fixture();
    const roomId = (await query<{ room_id: number }>('select room_id from session where id = $1', [data.sessionId]))[0].room_id;
    const laterStarts = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);
    const laterEnds = new Date(laterStarts.getTime() + 60 * 60 * 1000);
    const destination = await query<{ id: number }>(
      `insert into session (room_id, coach_id, discipline, session_type, status, starts_at, ends_at, room_fee_credits, seat_fee_credits, created_at)
       values ($1, $2, 'assistant-yoga', 'standard', 'scheduled', $3, $4, 40, 20, now()) returning id`,
      [roomId, data.coach.id, laterStarts.toISOString(), laterEnds.toISOString()]
    );
    const cookie = await login(data.participant);
    const before = await query<{ credits: number }>('select credits from person where id = $1', [data.participant.id]);
    const response = await assistant({
      message: `book session ${destination[0].id}`,
      tool: 'book_session',
      input: { session_id: destination[0].id }
    }, cookie);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.booking.status, 'active');
    assert.equal((await query('select count(*)::text as count from password_setup_token where person_id = $1', [data.participant.id]))[0].count, '0');
    const after = await query<{ credits: number }>('select credits from person where id = $1', [data.participant.id]);
    assert.equal(Number(after[0].credits), Number(before[0].credits) - 20);
  });

  test('the stub does not misroute change or cancel requests into book_session', async () => {
    const data = await fixture();
    const cookie = await login(data.participant);
    const changed = await assistant({ message: `change my booking session ${data.sessionId}` }, cookie);
    assert.equal(changed.status, 200);
    const changedBody = await changed.json();
    assert.equal('tool' in changedBody, false);
    const cancelled = await assistant({ message: 'cancel my booking session 5' }, cookie);
    const cancelledBody = await cancelled.json();
    assert.equal('tool' in cancelledBody, false);
  });

  test('the stub routes an explicit session cancellation to cancel_session', async () => {
    const data = await fixture();
    const coachCookie = await login(data.coach);
    const response = await assistant({ message: `cancel session ${data.sessionId}` }, coachCookie);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.tool, 'cancel_session');
    assert.equal(body.data.result.status, 'cancelled');
    assert.equal((await query('select status from session where id = $1', [data.sessionId]))[0].status, 'cancelled');
  });
});
