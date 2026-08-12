import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../src/auth';
import { pool, query } from '../src/db';
import { resetAssistantModelState } from '../src/assistant';
import { assertIntegrationDatabaseConfigured, resetDatabase } from './helpers/database';
import { login as sharedLogin, startTestServer } from './helpers/server';

assertIntegrationDatabaseConfigured();

describe('assistant integration', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  before(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'assistant-integration-secret';
    process.env.MODEL_PROVIDER = 'stub';
    const server = await startTestServer();
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  after(async () => {
    await closeServer();
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
    // Deliberately outside DISCIPLINES so discipline-filtered searches exclude it.
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
    return sharedLogin(baseUrl, account);
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
    const message = 'show all sessions';
    const anonymous = await (await assistant({ message })).json();
    assert.equal(anonymous.tool, 'search_sessions');
    assert.equal('coach_name' in anonymous.data.sessions[0], false);
    assert.equal('id' in anonymous.data.sessions[0], true);

    const participant = await (await assistant({ message }, await login(data.participant))).json();
    assert.equal('my_enrolment' in participant.data.sessions[0], true);
    assert.equal('coach_name' in participant.data.sessions[0], false);

    const coach = await (await assistant({ message }, await login(data.coach))).json();
    assert.equal(coach.data.sessions[0].is_own_session, true);
    assert.equal('coach_name' in coach.data.sessions[0], true);

    const admin = await (await assistant({ message }, await login(data.admin))).json();
    assert.equal('coach_name' in admin.data.sessions[0], true);
    assert.equal(anonymous.reply, participant.reply);
    assert.equal(participant.reply, coach.reply);
  });

  test('a generic session search asks a clarifying question instead of dumping data', async () => {
    const data = await fixture();
    const response = await assistant({ message: 'show upcoming sessions' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal('tool' in body, false);
    assert.equal('data' in body, false);
    assert.match(body.reply, /all upcoming sessions/i);
    assert.ok(Array.isArray(body.suggestions));
    assert.equal(body.suggestions[0], 'show all upcoming sessions');
    const explicit = await assistant({ message: 'show all upcoming sessions' });
    assert.equal(explicit.status, 200);
    assert.equal((await explicit.json()).tool, 'search_sessions');
  });

  test('a named discipline narrows the search to that discipline', async () => {
    const data = await fixture();
    const laterStarts = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);
    const laterEnds = new Date(laterStarts.getTime() + 60 * 60 * 1000);
    const roomId = (await query<{ room_id: number }>('select room_id from session where id = $1', [data.sessionId]))[0].room_id;
    const fitness = await query<{ id: number }>(
      `insert into session (room_id, coach_id, discipline, session_type, status, starts_at, ends_at, room_fee_credits, seat_fee_credits, created_at)
       values ($1, $2, 'fitness', 'standard', 'scheduled', $3, $4, 40, 20, now()) returning id`,
      [roomId, data.coach.id, laterStarts.toISOString(), laterEnds.toISOString()]
    );
    const response = await assistant({ message: 'show fitness sessions' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.tool, 'search_sessions');
    assert.ok(Array.isArray(body.data.sessions));
    assert.equal(body.data.sessions.length, 1);
    assert.equal(body.data.sessions[0].id, fitness[0].id);
    assert.equal(body.data.sessions[0].discipline, 'fitness');
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

  test('permission denials explain the role and suggest actions that caller can take', async () => {
    const data = await fixture();
    const anonymous = await assistant({ message: 'how many credits do I have?' });
    assert.equal(anonymous.status, 401);
    const anonymousBody = await anonymous.json();
    assert.match(anonymousBody.error, /sign in/i);
    assert.match(anonymousBody.error, /browse/i);
    assert.deepEqual(anonymousBody.suggestions, ['show all upcoming sessions']);

    const participant = await assistant({ message: 'show people', tool: 'admin_people', input: {} }, await login(data.participant));
    assert.equal(participant.status, 403);
    const participantBody = await participant.json();
    assert.match(participantBody.error, /administrators/i);
    assert.match(participantBody.error, /participant/i);
    assert.deepEqual(participantBody.suggestions, ['my bookings', 'how many credits do I have?', 'show all upcoming sessions']);

    const coach = await assistant({ message: 'reassign everyone', tool: 'reassign_session', input: { session_id: data.sessionId, coach_id: 1 } }, await login(data.coach));
    assert.equal(coach.status, 403);
    const coachBody = await coach.json();
    assert.match(coachBody.error, /administrators/i);
    assert.match(coachBody.error, /coach/i);
    assert.deepEqual(coachBody.suggestions, ['show all upcoming sessions', 'how many credits do I have?']);
  });

  test('suggestions are returned with successful answers', async () => {
    const data = await fixture();
    const anonymous = await (await assistant({ message: 'show all upcoming sessions' })).json();
    assert.ok(Array.isArray(anonymous.suggestions));
    assert.ok(!anonymous.suggestions.some((suggestion) => suggestion.startsWith('book session')));
    assert.ok(anonymous.suggestions.includes('show fitness sessions'));

    const participant = await (await assistant({ message: 'show all upcoming sessions' }, await login(data.participant))).json();
    assert.ok(Array.isArray(participant.suggestions));
    assert.equal(participant.suggestions[0], `book session ${data.sessionId}`);

    const credits = await (await assistant({ message: 'how many credits do I have?' }, await login(data.participant))).json();
    assert.deepEqual(credits.suggestions, ['show all upcoming sessions', 'my bookings']);
  });

  test('a model-picked tool the caller cannot use falls back to the sessions they can see', async () => {
    const data = await fixture();
    const modelServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { tool_calls: [{ function: { name: 'admin_sessions', arguments: {} } }] } }));
    });
    await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
    const address = modelServer.address();
    assert.ok(address && typeof address === 'object');
    process.env.MODEL_PROVIDER = 'ollama';
    process.env.MODEL_BASE_URL = `http://127.0.0.1:${address.port}`;
    resetAssistantModelState();
    try {
      const response = await assistant({ message: 'show all upcoming sessions' });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.tool, 'search_sessions');
      assert.match(body.reply, /permission/i);
      assert.ok(Array.isArray(body.data.sessions));
    } finally {
      process.env.MODEL_PROVIDER = 'stub';
      await new Promise<void>((resolve, reject) => modelServer.close((error) => error ? reject(error) : resolve()));
    }
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

  test('booking with an existing coach or administrator email attaches nothing and reveals nothing', async () => {
    const data = await fixture();
    const before = await query<{ count: string }>('select count(*)::text as count from person');
    for (const account of [data.coach, data.admin]) {
      const response = await assistant({
        message: `book session ${data.sessionId}`,
        tool: 'book_session',
        input: { session_id: data.sessionId, email: account.email, full_name: 'Existing Account Probe' }
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.booking.status, 'received');
    }
    assert.equal((await query<{ count: string }>('select count(*)::text as count from person'))[0].count, before[0].count);
    assert.equal((await query<{ count: string }>('select count(*)::text as count from enrolment'))[0].count, '1');
    assert.equal((await query('select token_hash from password_setup_token')).length, 0);
  });

  test('a full session returns the same refusal to existing and new emails, so no account existence is revealed', async () => {
    const data = await fixture();
    const room = await query<{ capacity: number }>(
      'select r.capacity from session s join room r on r.id = s.room_id where s.id = $1',
      [data.sessionId]
    );
    const needed = Number(room[0].capacity) - 1;
    const fillers: number[] = [];
    for (let i = 0; i < needed; i++) {
      const rows = await query<{ id: number }>(
        `insert into person (email, password_hash, full_name, kind, credits, active, created_at)
         values ($1, $2, $3, 'participant', 4000, true, now()) returning id`,
        [`${crypto.randomUUID()}@fill.local`, await hashPassword(crypto.randomBytes(18).toString('base64url')), 'Capacity Filler']
      );
      fillers.push(rows[0].id);
    }
    await query(
      `insert into enrolment (session_id, person_id, status, credits_charged, credits_refunded, enrolled_at)
       select $1, unnest($2::int[]), 'active', 20, 0, now()`,
      [data.sessionId, fillers]
    );
    const existing = await assistant({
      message: `book session ${data.sessionId}`,
      tool: 'book_session',
      input: { session_id: data.sessionId, email: data.participant.email, full_name: 'Capacity Probe' }
    });
    const fresh = await assistant({
      message: `book session ${data.sessionId}`,
      tool: 'book_session',
      input: { session_id: data.sessionId, email: `${crypto.randomUUID()}@probe.local`, full_name: 'Capacity Probe' }
    });
    assert.equal(existing.status, 409);
    assert.equal(fresh.status, 409);
    assert.equal((await existing.json()).error, (await fresh.json()).error);
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

  test('an anonymous booking setup token that expires cannot be redeemed and the account stays locked', async () => {
    const data = await fixture();
    const email = `${crypto.randomUUID()}@expiry.local`;
    const booked = await assistant({
      message: `book session ${data.sessionId}`,
      tool: 'book_session',
      input: { session_id: data.sessionId, email, full_name: 'Expiry Participant' }
    });
    assert.equal(booked.status, 200);
    const setup = await query<{ body: string }>(
      "select body from email_outbox where recipient = $1 and event_type = 'participant.account_setup'",
      [email]
    );
    assert.equal(setup.length, 1);
    const match = setup[0].body.match(/\/setup-password\?token=([A-Za-z0-9_-]+)/);
    assert.ok(match);
    const token = match[1];

    const password = crypto.randomBytes(18).toString('base64url');
    await query('update password_setup_token set expires_at = now() - interval \'1 minute\'');
    const expired = await fetch(`${baseUrl}/api/dev/setup-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password })
    });
    assert.equal(expired.status, 409);
    const tokens = await query<{ consumed_at: string | null }>('select consumed_at from password_setup_token');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].consumed_at, null);
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    assert.equal(login.status, 401);
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

  test('a signed-in caller cannot book on behalf of another account via request fields', async () => {
    const data = await fixture();
    const roomId = (await query<{ room_id: number }>('select room_id from session where id = $1', [data.sessionId]))[0].room_id;
    const laterStarts = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);
    const laterEnds = new Date(laterStarts.getTime() + 60 * 60 * 1000);
    const target = await query<{ id: number }>(
      `insert into session (room_id, coach_id, discipline, session_type, status, starts_at, ends_at, room_fee_credits, seat_fee_credits, created_at)
       values ($1, $2, 'assistant-cross', 'standard', 'scheduled', $3, $4, 40, 20, now()) returning id`,
      [roomId, data.coach.id, laterStarts.toISOString(), laterEnds.toISOString()]
    );
    const cookie = await login(data.participant);
    const before = await query<{ credits: number }>('select credits from person where id = $1', [data.participant.id]);
    const beforeAdmin = await query<{ credits: number }>('select credits from person where id = $1', [data.admin.id]);
    const response = await assistant({
      message: `book session ${target[0].id}`,
      tool: 'book_session',
      input: { session_id: target[0].id, email: data.admin.email, full_name: 'Admin Identity Probe' }
    }, cookie);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.booking.status, 'active');

    const enrolment = await query<{ person_id: number }>(
      'select person_id from enrolment where session_id = $1',
      [target[0].id]
    );
    assert.equal(enrolment.length, 1);
    assert.equal(Number(enrolment[0].person_id), data.participant.id);
    assert.equal((await query<{ count: string }>('select count(*)::text as count from person'))[0].count, '3');
    assert.equal((await query('select token_hash from password_setup_token')).length, 0);

    const after = await query<{ credits: number }>('select credits from person where id = $1', [data.participant.id]);
    const afterAdmin = await query<{ credits: number }>('select credits from person where id = $1', [data.admin.id]);
    assert.equal(Number(after[0].credits), Number(before[0].credits) - 20);
    assert.equal(Number(afterAdmin[0].credits), Number(beforeAdmin[0].credits));
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

  test('an unreachable model provider falls back to the stub router instead of a null reply', async () => {
    const data = await fixture();
    process.env.MODEL_PROVIDER = 'ollama';
    process.env.MODEL_BASE_URL = 'http://127.0.0.1:1';
    resetAssistantModelState();
    try {
      const response = await assistant({ message: 'what are my bookings?' }, await login(data.participant));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.tool, 'my_bookings');
    } finally {
      process.env.MODEL_PROVIDER = 'stub';
    }
  });

  test('an Ollama provider answers conversationally from the permission-filtered tool result', async () => {
    const data = await fixture();
    const mockReply = 'You have 4000 credits right now — plenty for any seat or room you want to book.';
    const responses = [
      { message: { tool_calls: [{ function: { name: 'my_credits', arguments: {} } }] } },
      { message: { content: mockReply } }
    ];
    const modelServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(responses.shift() ?? { message: {} }));
    });
    await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
    const address = modelServer.address();
    assert.ok(address && typeof address === 'object');
    process.env.MODEL_PROVIDER = 'ollama';
    process.env.MODEL_BASE_URL = `http://127.0.0.1:${address.port}`;
    resetAssistantModelState();
    try {
      const response = await assistant({ message: 'what are my credits?' }, await login(data.participant));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.reply, mockReply);
      assert.equal(body.tool, 'my_credits');
      assert.equal(body.data.credits, 4000);
    } finally {
      process.env.MODEL_PROVIDER = 'stub';
      await new Promise<void>((resolve, reject) => modelServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  test('string tool arguments from the provider are parsed and applied', async () => {
    const data = await fixture();
    const laterStarts = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);
    const laterEnds = new Date(laterStarts.getTime() + 60 * 60 * 1000);
    const roomId = (await query<{ room_id: number }>('select room_id from session where id = $1', [data.sessionId]))[0].room_id;
    await query(
      `insert into session (room_id, coach_id, discipline, session_type, status, starts_at, ends_at, room_fee_credits, seat_fee_credits, created_at)
       values ($1, $2, 'fitness', 'standard', 'scheduled', $3, $4, 40, 20, now())`,
      [roomId, data.coach.id, laterStarts.toISOString(), laterEnds.toISOString()]
    );
    const modelServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { tool_calls: [{ function: { name: 'search_sessions', arguments: '{"discipline": "fitness"}' } }] } }));
    });
    await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
    const address = modelServer.address();
    assert.ok(address && typeof address === 'object');
    process.env.MODEL_PROVIDER = 'ollama';
    process.env.MODEL_BASE_URL = `http://127.0.0.1:${address.port}`;
    resetAssistantModelState();
    try {
      const response = await assistant({ message: 'show fitness sessions' });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.tool, 'search_sessions');
      assert.equal(body.data.sessions.length, 1);
      assert.equal(body.data.sessions[0].discipline, 'fitness');
    } finally {
      process.env.MODEL_PROVIDER = 'stub';
      await new Promise<void>((resolve, reject) => modelServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  test('a discipline named in the message is applied when the model omits the argument', async () => {
    const data = await fixture();
    const laterStarts = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);
    const laterEnds = new Date(laterStarts.getTime() + 60 * 60 * 1000);
    const roomId = (await query<{ room_id: number }>('select room_id from session where id = $1', [data.sessionId]))[0].room_id;
    await query(
      `insert into session (room_id, coach_id, discipline, session_type, status, starts_at, ends_at, room_fee_credits, seat_fee_credits, created_at)
       values ($1, $2, 'fitness', 'standard', 'scheduled', $3, $4, 40, 20, now())`,
      [roomId, data.coach.id, laterStarts.toISOString(), laterEnds.toISOString()]
    );
    const modelServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { tool_calls: [{ function: { name: 'search_sessions', arguments: {} } }] } }));
    });
    await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
    const address = modelServer.address();
    assert.ok(address && typeof address === 'object');
    process.env.MODEL_PROVIDER = 'ollama';
    process.env.MODEL_BASE_URL = `http://127.0.0.1:${address.port}`;
    resetAssistantModelState();
    try {
      const response = await assistant({ message: 'show fitness sessions' });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.tool, 'search_sessions');
      assert.equal(body.data.sessions.length, 1);
      assert.equal(body.data.sessions[0].discipline, 'fitness');
    } finally {
      process.env.MODEL_PROVIDER = 'stub';
      await new Promise<void>((resolve, reject) => modelServer.close((error) => error ? reject(error) : resolve()));
    }
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
