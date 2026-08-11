import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index';
import { hashPassword } from '../src/auth';
import { pool, query } from '../src/db';
import { assertIntegrationDatabaseConfigured, resetDatabase } from './helpers/database';

assertIntegrationDatabaseConfigured();

describe('booking engine integration', () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'booking-integration-secret';
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

  async function fixture(): Promise<any> {
    await resetDatabase();

    async function person(kind: 'admin' | 'coach' | 'participant') {
      const email = `${crypto.randomUUID()}@booking.local`;
      const password = crypto.randomBytes(18).toString('base64url');
      const rows = await query<{ id: number }>(
        `insert into person (email, password_hash, full_name, kind, credits, active, created_at)
         values ($1, $2, $3, $4, 4000, true, now()) returning id`,
        [email, await hashPassword(password), `${kind} Booking User`, kind]
      );
      return { id: rows[0].id, email, password };
    }

    const admin = await person('admin');
    const coach = await person('coach');
    const otherCoach = await person('coach');
    const replacementCoach = await person('coach');
    const first = await person('participant');
    const second = await person('participant');
    const rooms = await query<{ id: number }>(
      `insert into room (name, capacity)
       values ('Booking Room A', 4), ('Booking Room B', 4), ('Booking Room C', 4),
              ('Booking Room D', 4), ('Booking Small', 1)
       returning id`
    );
    const sessions = await query<{ id: number }>(
      `insert into session
         (room_id, coach_id, discipline, session_type, status, starts_at, ends_at,
          room_fee_credits, seat_fee_credits, created_at)
       values
         ($1, $6, 'source', 'standard', 'scheduled', '2030-01-15 15:00:00+00', '2030-01-15 16:00:00+00', 40, 20, now()),
         ($2, $7, 'destination', 'standard', 'scheduled', '2030-01-16 15:00:00+00', '2030-01-16 16:00:00+00', 40, 20, now()),
         ($3, $7, 'intensive', 'intensive', 'scheduled', '2030-01-17 14:00:00+00', '2030-01-17 17:30:00+00', 120, 60, now()),
         ($4, $7, 'overlap', 'standard', 'scheduled', '2030-01-15 15:30:00+00', '2030-01-15 16:30:00+00', 40, 20, now()),
         ($5, $7, 'small', 'standard', 'scheduled', '2030-01-18 15:00:00+00', '2030-01-18 16:00:00+00', 40, 20, now()),
         ($4, $7, 'lunch-overlap', 'short', 'scheduled', '2030-01-17 15:30:00+00', '2030-01-17 16:15:00+00', 30, 15, now()),
         ($4, $6, 'past', 'standard', 'scheduled', '2020-01-15 15:00:00+00', '2020-01-15 16:00:00+00', 40, 20, now())
       returning id`,
      [rooms[0].id, rooms[1].id, rooms[2].id, rooms[3].id, rooms[4].id, coach.id, otherCoach.id]
    );
    return {
      admin,
      coach,
      otherCoach,
      replacementCoach,
      first,
      second,
      sourceId: sessions[0].id,
      destinationId: sessions[1].id,
      intensiveId: sessions[2].id,
      overlapId: sessions[3].id,
      smallId: sessions[4].id,
      lunchOverlapId: sessions[5].id,
      pastId: sessions[6].id,
      sourceRoomId: rooms[0].id,
      destinationRoomId: rooms[1].id,
      smallRoomId: rooms[4].id
    };
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

  async function request(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    return fetch(`${baseUrl}${path}`, { ...init, headers });
  }

  function post(body?: unknown): RequestInit {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {})
    };
  }

  test('enrolment, capacity, coach attendance, and participant cancellation are transactional', async () => {
    const data = await fixture();
    const firstCookie = await login(data.first);
    const secondCookie = await login(data.second);
    const coachCookie = await login(data.coach);

    const self = await request(`/api/sessions/${data.sourceId}/enrol`, post(), coachCookie);
    assert.equal(self.status, 409);

    const coachAttendee = await request(`/api/sessions/${data.destinationId}/enrol`, post(), coachCookie);
    assert.equal(coachAttendee.status, 201);

    const firstBooking = await request(`/api/sessions/${data.sourceId}/enrol`, post(), firstCookie);
    const secondBooking = await request(`/api/sessions/${data.sourceId}/enrol`, post(), secondCookie);
    assert.equal(firstBooking.status, 201);
    assert.equal(secondBooking.status, 201);
    const firstEnrolment = await firstBooking.json();
    const createdEvents = await query<{ count: string }>(
      "select count(*)::text as count from email_outbox where event_type = 'participant.booking.created'",
    );
    assert.equal(Number(createdEvents[0].count), 3);
    const createdRecipients = await query<{ recipient: string }>(
      "select recipient from email_outbox where event_type = 'participant.booking.created' order by recipient",
    );
    assert.deepEqual(createdRecipients.map((row) => row.recipient), [data.coach.email, data.coach.email, data.otherCoach.email].sort());

    const overlap = await request(`/api/sessions/${data.overlapId}/enrol`, post(), firstCookie);
    assert.equal(overlap.status, 409);

    const feed = await request('/api/sessions?from=2029-01-01T00:00:00Z&to=2031-01-01T00:00:00Z');
    const source = (await feed.json()).find((row: { id: number }) => row.id === data.sourceId);
    assert.equal(source.enrolled_count, 2);
    assert.equal(source.places_remaining, 2);

    const cancelled = await request(`/api/enrolments/${firstEnrolment.id}/cancel`, post(), firstCookie);
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).credits_refunded, 20);
    const cancelledEvents = await query<{ count: string }>(
      "select count(*)::text as count from email_outbox where event_type = 'participant.booking.cancelled'",
    );
    assert.equal(Number(cancelledEvents[0].count), 1);
    const cancelledEvent = await query<{ event_key: string; recipient: string }>(
      "select event_key, recipient from email_outbox where event_type = 'participant.booking.cancelled'",
    );
    assert.deepEqual(cancelledEvent, [{
      event_key: `booking-change:${firstEnrolment.id}:1`,
      recipient: data.coach.email
    }]);
    const remaining = await query<{ status: string }>(
      'select status from enrolment where session_id = $1 order by person_id',
      [data.sourceId]
    );
    assert.equal(remaining.filter((row) => row.status === 'active').length, 1);
  });

  test('all session durations, centre-local input, and intensive lunch commitments are enforced', async () => {
    const data = await fixture();
    const adminCookie = await login(data.admin);
    const firstCookie = await login(data.first);

    const shortSession = await request('/api/sessions', post({
      room_id: data.sourceRoomId,
      coach_id: data.replacementCoach.id,
      discipline: 'short-created',
      session_type: 'short',
      local_date: '2030-01-22',
      local_start_time: '10:00',
      local_end_time: '10:45'
    }), adminCookie);
    assert.equal(shortSession.status, 201);
    const shortRow = await shortSession.json();
    assert.equal(shortRow.starts_at, '2030-01-22T15:00:00.000Z');

    const standardSession = await request('/api/sessions', post({
      room_id: data.sourceRoomId,
      coach_id: data.replacementCoach.id,
      discipline: 'standard-created',
      session_type: 'standard',
      local_date: '2030-01-22',
      local_start_time: '10:45',
      local_end_time: '11:45'
    }), adminCookie);
    assert.equal(standardSession.status, 201);

    const intensiveSession = await request('/api/sessions', post({
      room_id: data.destinationRoomId,
      coach_id: data.replacementCoach.id,
      discipline: 'intensive-created',
      session_type: 'intensive',
      local_date: '2030-01-23',
      local_start_time: '10:00',
      local_end_time: '13:30'
    }), adminCookie);
    assert.equal(intensiveSession.status, 201);
    const intensiveRow = await intensiveSession.json();
    assert.equal(new Date(intensiveRow.ends_at).getTime() - new Date(intensiveRow.starts_at).getTime(), 210 * 60 * 1000);
    const roomBookedEvents = await query<{ event_key: string; recipient: string }>(
      "select event_key, recipient from email_outbox where event_type = 'room.booked_by_coach' order by event_key",
    );
    assert.equal(roomBookedEvents.length, 3);
    assert.ok(roomBookedEvents.every((row) => row.recipient === data.admin.email));

    const intensiveBooking = await request(`/api/sessions/${data.intensiveId}/enrol`, post(), firstCookie);
    assert.equal(intensiveBooking.status, 201);
    const lunchOverlap = await request(`/api/sessions/${data.lunchOverlapId}/enrol`, post(), firstCookie);
    assert.equal(lunchOverlap.status, 409);
  });

  test('touching room intervals are allowed but one-minute overlaps lose the race', async () => {
    const data = await fixture();
    const adminCookie = await login(data.admin);
    const touching = await request('/api/sessions', post({
      room_id: data.sourceRoomId,
      coach_id: data.replacementCoach.id,
      discipline: 'touching',
      session_type: 'standard',
      local_date: '2030-01-15',
      local_start_time: '11:00',
      local_end_time: '12:00'
    }), adminCookie);
    assert.equal(touching.status, 201);
    const oneMinuteOverlap = await request('/api/sessions', post({
      room_id: data.sourceRoomId,
      coach_id: data.replacementCoach.id,
      discipline: 'one-minute-overlap',
      session_type: 'standard',
      local_date: '2030-01-15',
      local_start_time: '10:59',
      local_end_time: '11:59'
    }), adminCookie);
    assert.equal(oneMinuteOverlap.status, 409);
  });

  test('concurrent room creation has exactly one winner', async () => {
    const data = await fixture();
    const adminCookie = await login(data.admin);
    const body = (coachId: number, discipline: string) => post({
      room_id: data.destinationRoomId,
      coach_id: coachId,
      discipline,
      session_type: 'standard',
      local_date: '2030-01-24',
      local_start_time: '10:00',
      local_end_time: '11:00'
    });
    const results = await Promise.all([
      request('/api/sessions', body(data.coach.id, 'room-race-a'), adminCookie),
      request('/api/sessions', body(data.replacementCoach.id, 'room-race-b'), adminCookie)
    ]);
    assert.deepEqual(results.map((response) => response.status).sort(), [201, 409]);
  });

  test('booking change cancels the old row and inserts a new charged row', async () => {
    const data = await fixture();
    const firstCookie = await login(data.first);
    const booking = await request(`/api/sessions/${data.sourceId}/enrol`, post(), firstCookie);
    assert.equal(booking.status, 201);
    const old = await booking.json();

    const changed = await request(
      `/api/enrolments/${old.id}/change`,
      post({ destination_session_id: data.destinationId }),
      firstCookie
    );
    assert.equal(changed.status, 200);
    const result = await changed.json();
    assert.equal(result.old_enrolment.status, 'cancelled');
    assert.equal(result.new_enrolment.session_id, data.destinationId);
    const changedEvents = await query<{ count: string }>(
      "select count(*)::text as count from email_outbox where event_type = 'participant.booking.changed'",
    );
    assert.equal(Number(changedEvents[0].count), 2);
    const changedKeys = await query<{ event_key: string; recipient: string }>(
      "select event_key, recipient from email_outbox where event_type = 'participant.booking.changed' order by recipient",
    );
    assert.deepEqual(changedKeys.sort((left, right) => left.recipient.localeCompare(right.recipient)), [
      { event_key: `booking-change:${old.id}:1`, recipient: data.coach.email },
      { event_key: `booking-change:${old.id}:1`, recipient: data.otherCoach.email }
    ].sort((left, right) => left.recipient.localeCompare(right.recipient)));
    const rows = await query<{ session_id: number; status: string; credits_charged: number; credits_refunded: number }>(
      'select session_id, status, credits_charged, credits_refunded from enrolment where person_id = $1 order by id',
      [data.first.id]
    );
    assert.deepEqual(rows.map((row) => [row.session_id, row.status, row.credits_charged, row.credits_refunded]), [
      [data.sourceId, 'cancelled', 20, 20],
      [data.destinationId, 'active', 20, 0]
    ]);
  });

  test('concurrent capacity checks produce exactly one successful enrolment', async () => {
    const data = await fixture();
    const firstCookie = await login(data.first);
    const secondCookie = await login(data.second);
    const results = await Promise.all([
      request(`/api/sessions/${data.smallId}/enrol`, post(), firstCookie),
      request(`/api/sessions/${data.smallId}/enrol`, post(), secondCookie)
    ]);
    assert.deepEqual(results.map((response) => response.status).sort(), [201, 409]);
    const active = await query<{ count: string }>(
      "select count(*)::text as count from enrolment where session_id = $1 and status = 'active'",
      [data.smallId]
    );
    assert.equal(Number(active[0].count), 1);
  });

  test('reschedule preserves enrolments and rejects a room that cannot hold them', async () => {
    const data = await fixture();
    const firstCookie = await login(data.first);
    const secondCookie = await login(data.second);
    const coachCookie = await login(data.coach);
    const otherCoachCookie = await login(data.otherCoach);
    const attendeeCookie = await login(data.replacementCoach);
    await request(`/api/sessions/${data.sourceId}/enrol`, post(), firstCookie);
    await request(`/api/sessions/${data.sourceId}/enrol`, post(), secondCookie);
    await request(`/api/sessions/${data.sourceId}/enrol`, post(), attendeeCookie);

    const crossCancel = await request(`/api/sessions/${data.sourceId}/cancel`, post(), otherCoachCookie);
    assert.equal(crossCancel.status, 403);
    const crossComplete = await request(`/api/sessions/${data.sourceId}/complete`, post(), otherCoachCookie);
    assert.equal(crossComplete.status, 403);
    const crossReschedule = await request(`/api/sessions/${data.sourceId}/reschedule`, post({
      room_id: data.destinationRoomId,
      local_date: '2030-01-21',
      local_start_time: '10:00',
      local_end_time: '11:00'
    }), otherCoachCookie);
    assert.equal(crossReschedule.status, 403);

    const tooSmall = await request(`/api/sessions/${data.sourceId}/reschedule`, post({
      room_id: data.smallRoomId,
      local_date: '2030-01-21',
      local_start_time: '10:00',
      local_end_time: '11:00'
    }), coachCookie);
    assert.equal(tooSmall.status, 409, JSON.stringify(await tooSmall.json()));

    const moved = await request(`/api/sessions/${data.sourceId}/reschedule`, post({
      room_id: data.destinationRoomId,
      local_date: '2030-01-21',
      local_start_time: '10:00',
      local_end_time: '11:00'
    }), coachCookie);
    assert.equal(moved.status, 200);
    const session = await query<{ room_id: number; starts_at: Date }>('select room_id, starts_at from session where id = $1', [data.sourceId]);
    assert.equal(session[0].room_id, data.destinationRoomId);
    const enrolments = await query<{ status: string }>('select status from enrolment where session_id = $1', [data.sourceId]);
    assert.deepEqual(enrolments.map((row) => row.status), ['active', 'active', 'active']);
    const sessionChanges = await query<{ event_key: string; recipient: string }>(
      "select event_key, recipient from email_outbox where event_type = 'coach.attendee.session_changed'",
    );
    assert.deepEqual(sessionChanges, [{
      event_key: `session-change:${data.sourceId}:1:coach.attendee.session_changed`,
      recipient: data.replacementCoach.email
    }]);
  });

  test('cancelling a session releases its room for a later booking', async () => {
    const data = await fixture();
    const coachCookie = await login(data.coach);
    const adminCookie = await login(data.admin);
    const firstCookie = await login(data.first);
    const attendeeCookie = await login(data.replacementCoach);
    assert.equal((await request(`/api/sessions/${data.sourceId}/enrol`, post(), firstCookie)).status, 201);
    assert.equal((await request(`/api/sessions/${data.sourceId}/enrol`, post(), attendeeCookie)).status, 201);
    const cancelled = await request(`/api/sessions/${data.sourceId}/cancel`, post(), coachCookie);
    assert.equal(cancelled.status, 200);
    const sessionCancellationEvents = await query<{ count: string }>(
      "select count(*)::text as count from email_outbox where event_type = 'session.cancelled'",
    );
    assert.equal(Number(sessionCancellationEvents[0].count), 3);
    const sessionCancellationRecipients = await query<{ recipient: string }>(
      "select recipient from email_outbox where event_type = 'session.cancelled' order by recipient",
    );
    assert.deepEqual(sessionCancellationRecipients.map((row) => row.recipient), [
      data.admin.email,
      data.first.email,
      data.replacementCoach.email
    ].sort());
    const roomCancellationEvents = await query<{ count: string }>(
      "select count(*)::text as count from email_outbox where event_type = 'room.cancelled_by_coach'",
    );
    assert.equal(Number(roomCancellationEvents[0].count), 1);
    const replacement = await request('/api/sessions', post({
      room_id: data.sourceRoomId,
      coach_id: data.coach.id,
      discipline: 'replacement',
      session_type: 'standard',
      local_date: '2030-01-15',
      local_start_time: '10:00',
      local_end_time: '11:00'
    }), adminCookie);
    assert.equal(replacement.status, 201);
  });

  test('cancellation is idempotent and concurrent cancellation has one winner', async () => {
    const data = await fixture();
    const coachCookie = await login(data.coach);
    const adminCookie = await login(data.admin);
    const results = await Promise.all([
      request(`/api/sessions/${data.sourceId}/cancel`, post(), coachCookie),
      request(`/api/sessions/${data.sourceId}/cancel`, post(), adminCookie)
    ]);
    assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
    const repeated = await request(`/api/sessions/${data.sourceId}/cancel`, post(), coachCookie);
    assert.equal(repeated.status, 409);
    const balance = await query<{ credits: number }>('select credits from person where id = $1', [data.coach.id]);
    assert.equal(balance[0].credits, 4040);
  });

  test('participant and coach refund boundaries use the published rounding rules', async () => {
    const data = await fixture();
    const firstCookie = await login(data.first);
    const secondCookie = await login(data.second);
    const coachCookie = await login(data.coach);

    await query("update session set starts_at = now() + interval '30 hours', ends_at = now() + interval '31 hours' where id = $1", [data.sourceId]);
    const fullBooking = await request(`/api/sessions/${data.sourceId}/enrol`, post(), firstCookie);
    const fullCancel = await request(`/api/enrolments/${(await fullBooking.json()).id}/cancel`, post(), firstCookie);
    assert.equal((await fullCancel.json()).credits_refunded, 20);

    await query("update session set starts_at = now() + interval '18 hours', ends_at = now() + interval '19 hours' where id = $1", [data.destinationId]);
    const halfBooking = await request(`/api/sessions/${data.destinationId}/enrol`, post(), secondCookie);
    const halfCancel = await request(`/api/enrolments/${(await halfBooking.json()).id}/cancel`, post(), secondCookie);
    assert.equal((await halfCancel.json()).credits_refunded, 10);

    await query("update session set starts_at = now() + interval '6 hours', ends_at = now() + interval '7 hours' where id = $1", [data.smallId]);
    const noRefundBooking = await request(`/api/sessions/${data.smallId}/enrol`, post(), firstCookie);
    const noRefundCancel = await request(`/api/enrolments/${(await noRefundBooking.json()).id}/cancel`, post(), firstCookie);
    assert.equal((await noRefundCancel.json()).credits_refunded, 0);

    await query("update session set room_fee_credits = 30, starts_at = now() + interval '36 hours', ends_at = now() + interval '37 hours' where id = $1", [data.sourceId]);
    const coachCancel = await request(`/api/sessions/${data.sourceId}/cancel`, post(), coachCookie);
    assert.equal((await coachCancel.json()).room_fee_refunded, 8);
  });

  test('reassignment is administrator-only and transfers the room charge', async () => {
    const data = await fixture();
    const coachCookie = await login(data.coach);
    const adminCookie = await login(data.admin);
    const forbidden = await request(`/api/sessions/${data.sourceId}/reassign`, post({ coach_id: data.replacementCoach.id }), coachCookie);
    assert.equal(forbidden.status, 403);

    const reassigned = await request(`/api/sessions/${data.sourceId}/reassign`, post({ coach_id: data.replacementCoach.id }), adminCookie);
    assert.equal(reassigned.status, 200, JSON.stringify(await reassigned.json()));
    const session = await query<{ coach_id: number }>('select coach_id from session where id = $1', [data.sourceId]);
    assert.equal(session[0].coach_id, data.replacementCoach.id);
    const balances = await query<{ id: number; credits: number }>(
      'select id, credits from person where id = any($1::int[]) order by id',
      [[data.coach.id, data.replacementCoach.id]]
    );
    assert.deepEqual(balances.map((row) => [row.id, row.credits]), [
      [data.coach.id, 4040],
      [data.replacementCoach.id, 3960]
    ]);
    const reassignedEvents = await query<{ event_key: string; recipient: string }>(
      "select event_key, recipient from email_outbox where event_type = 'coach.reassigned'",
    );
    assert.deepEqual(reassignedEvents, [{
      event_key: `session-change:${data.sourceId}:1:coach.reassigned`,
      recipient: data.coach.email
    }]);
  });

  test('completion and check-in enforce actor and timing rules', async () => {
    const data = await fixture();
    const firstCookie = await login(data.first);
    const coachCookie = await login(data.coach);
    const otherCoachCookie = await login(data.otherCoach);
    const booking = await request(`/api/sessions/${data.pastId}/enrol`, post(), firstCookie);
    assert.equal(booking.status, 409);

    const earlyComplete = await request(`/api/sessions/${data.sourceId}/complete`, post(), coachCookie);
    assert.equal(earlyComplete.status, 409);

    const completed = await request(`/api/sessions/${data.pastId}/complete`, post(), coachCookie);
    assert.equal(completed.status, 200);
    const repeated = await request(`/api/sessions/${data.pastId}/complete`, post(), coachCookie);
    assert.equal(repeated.status, 409);
    const closedCheckIn = await request(`/api/sessions/${data.pastId}/check-ins`, post({ enrolment_id: 999 }), coachCookie);
    assert.equal(closedCheckIn.status, 404);

    const inserted = await query<{ id: number }>(
      `insert into enrolment (session_id, person_id, status, credits_charged, credits_refunded, enrolled_at)
       values ($1, $2, 'active', 20, 0, now()) returning id`,
      [data.sourceId, data.first.id]
    );
    const earlyCheckIn = await request(`/api/sessions/${data.sourceId}/check-ins`, post({ enrolment_id: inserted[0].id }), coachCookie);
    assert.equal(earlyCheckIn.status, 409);
    await query(
      "update session set starts_at = now() - interval '30 minutes', ends_at = now() + interval '30 minutes', status = 'scheduled' where id = $1",
      [data.sourceId]
    );
    const unauthorized = await request(`/api/sessions/${data.sourceId}/check-ins`, post({ enrolment_id: inserted[0].id }), otherCoachCookie);
    assert.equal(unauthorized.status, 403);
    const checkIn = await request(`/api/sessions/${data.sourceId}/check-ins`, post({ enrolment_id: inserted[0].id }), coachCookie);
    assert.equal(checkIn.status, 201);
    const duplicate = await request(`/api/sessions/${data.sourceId}/check-ins`, post({ enrolment_id: inserted[0].id }), coachCookie);
    assert.equal(duplicate.status, 409);

    const legacy = await query<{ id: number }>(
      `insert into enrolment (session_id, person_id, status, credits_charged, credits_refunded, enrolled_at)
       values ($1, $2, 'active', 20, 0, now()) returning id`,
      [data.sourceId, data.second.id]
    );
    await query('insert into check_in (enrolment_id, checked_in_at, legacy_seed_defect) values ($1, now(), true)', [legacy[0].id]);
    const legacyDuplicate = await request(`/api/sessions/${data.sourceId}/check-ins`, post({ enrolment_id: legacy[0].id }), coachCookie);
    assert.equal(legacyDuplicate.status, 409);

    await query("update session set starts_at = now() - interval '60 minutes', ends_at = now() where id = $1", [data.destinationId]);
    const ended = await query<{ id: number }>(
      `insert into enrolment (session_id, person_id, status, credits_charged, credits_refunded, enrolled_at)
       values ($1, $2, 'active', 20, 0, now()) returning id`,
      [data.destinationId, data.second.id]
    );
    const afterEnd = await request(`/api/sessions/${data.destinationId}/check-ins`, post({ enrolment_id: ended[0].id }), otherCoachCookie);
    assert.equal(afterEnd.status, 409);
  });

  test('an administrator cancellation notifies only via session.cancelled, never room.cancelled_by_coach', async () => {
    const data = await fixture();
    const adminCookie = await login(data.admin);
    const firstCookie = await login(data.first);
    assert.equal((await request(`/api/sessions/${data.sourceId}/enrol`, post(), firstCookie)).status, 201);

    const cancelled = await request(`/api/sessions/${data.sourceId}/cancel`, post(), adminCookie);
    assert.equal(cancelled.status, 200);

    const sessionCancelled = await query<{ event_key: string; recipient: string }>(
      "select event_key, recipient from email_outbox where event_type = 'session.cancelled' order by recipient",
    );
    assert.deepEqual(sessionCancelled, [
      { event_key: `session-change:${data.sourceId}:1:session.cancelled`, recipient: data.admin.email },
      { event_key: `session-change:${data.sourceId}:1:session.cancelled`, recipient: data.first.email }
    ].sort((left, right) => left.recipient.localeCompare(right.recipient)));

    const roomCancelled = await query<{ count: string }>(
      "select count(*)::text as count from email_outbox where event_type = 'room.cancelled_by_coach'",
    );
    assert.equal(Number(roomCancelled[0].count), 0);
  });
});
