import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index';
import { hashPassword } from '../src/auth';
import { pool, query } from '../src/db';
import { assertIntegrationDatabaseConfigured, resetDatabase } from './helpers/database';

assertIntegrationDatabaseConfigured();

describe('access-control integration', () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'integration-test-secret';
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

  async function fixture(): Promise<{
    admin: { id: number; email: string; password: string };
    coach: { id: number; email: string; password: string };
    otherCoach: { id: number; email: string; password: string };
    participant: { id: number; email: string; password: string };
    sessionId: number;
    otherSessionId: number;
  }> {
    await resetDatabase();

    async function person(kind: 'admin' | 'coach' | 'participant') {
      const email = `${crypto.randomUUID()}@access.local`;
      const password = crypto.randomBytes(18).toString('base64url');
      const people = await query<{ id: number }>(
        `insert into person (email, password_hash, full_name, kind, credits, active, created_at)
         values ($1, $2, $3, $4, 4000, true, now())
         returning id`,
        [email, await hashPassword(password), `${kind} Access User`, kind]
      );
      return { id: people[0].id, email, password };
    }

    const admin = await person('admin');
    const coach = await person('coach');
    const otherCoach = await person('coach');
    const participant = await person('participant');

    const rooms = await query<{ id: number }>(
      `insert into room (name, capacity)
       values ('Access Studio A', 12), ('Access Studio B', 10), ('Access Studio C', 10)
       returning id`
    );

    const sessions = await query<{ id: number }>(
      `insert into session
         (room_id, coach_id, discipline, session_type, status, starts_at, ends_at,
          room_fee_credits, seat_fee_credits, created_at)
       values
         ($3, $1, 'access-control', 'standard', 'scheduled', '2030-01-15 15:00:00+00', '2030-01-15 16:00:00+00', 40, 20, now()),
         ($4, $2, 'private-busy-block', 'standard', 'scheduled', '2030-01-16 15:00:00+00', '2030-01-16 16:00:00+00', 40, 20, now())
       returning id`,
      [coach.id, otherCoach.id, rooms[0].id, rooms[1].id]
    );

    await query(
      `insert into enrolment (session_id, person_id, status, credits_charged, credits_refunded, enrolled_at)
       values ($1, $2, 'active', 20, 0, now()), ($1, $3, 'active', 20, 0, now())`,
      [sessions[0].id, participant.id, otherCoach.id]
    );

    return {
      admin,
      coach,
      otherCoach,
      participant,
      sessionId: sessions[0].id,
      otherSessionId: sessions[1].id
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

  test('catalogue and detail views do not leak coach or attendee identity', async () => {
    const data = await fixture();
    const invalidQuery = await request('/api/sessions?from=not-a-date');
    assert.equal(invalidQuery.status, 400);
    const publicResponse = await request(`/api/sessions?from=2029-01-01T00:00:00Z&to=2031-01-01T00:00:00Z`);
    assert.equal(publicResponse.status, 200);
    const publicRows = await publicResponse.json();
    assert.ok(publicRows.length >= 2);
    assert.equal('coach_id' in publicRows[0], false);
    assert.equal('coach_name' in publicRows[0], false);

    const participantCookie = await login(data.participant);
    const anonymousMe = await request('/api/me');
    assert.equal(anonymousMe.status, 401);
    const roomsResponse = await request('/api/rooms', {}, participantCookie);
    assert.equal(roomsResponse.status, 200);
    assert.equal((await roomsResponse.json())[0].email, undefined);
    const participantRowsResponse = await request(
      `/api/sessions?from=2029-01-01T00:00:00Z&to=2031-01-01T00:00:00Z`,
      {},
      participantCookie
    );
    const participantRows = await participantRowsResponse.json();
    assert.equal('coach_name' in participantRows[0], false);
    assert.equal('my_enrolment' in participantRows[0], true);

    const participantDetailResponse = await request(`/api/sessions/${data.sessionId}`, {}, participantCookie);
    const participantDetail = await participantDetailResponse.json();
    assert.equal(participantDetailResponse.status, 200);
    assert.ok(participantDetail.enrolment);
    assert.equal('attendees' in participantDetail, false);
    assert.equal('coach' in participantDetail, false);

    const otherCoachCookie = await login(data.otherCoach);
    const busyResponse = await request(`/api/sessions/${data.sessionId}`, {}, otherCoachCookie);
    const busy = await busyResponse.json();
    assert.deepEqual(Object.keys(busy).sort(), [
      'discipline', 'ends_at', 'id', 'room_id', 'room_name', 'session_type', 'starts_at', 'visibility'
    ]);
    assert.equal('coach_id' in busy, false);
    assert.equal('attendees' in busy, false);

    const ownerCookie = await login(data.coach);
    const ownerDetail = await (await request(`/api/sessions/${data.sessionId}`, {}, ownerCookie)).json();
    assert.equal(ownerDetail.attendees.length, 2);
    assert.equal(ownerDetail.attendees[0].email !== undefined, true);

    const adminCookie = await login(data.admin);
    const adminDetail = await (await request(`/api/sessions/${data.sessionId}`, {}, adminCookie)).json();
    assert.equal(adminDetail.attendees.length, 2);
    assert.equal(adminDetail.coach.email !== undefined, true);
  });

  test('people data is own-only except for administrators', async () => {
    const data = await fixture();
    const participantCookie = await login(data.participant);
    const participantResponse = await request('/api/people', {}, participantCookie);
    assert.equal(participantResponse.status, 200);
    assert.deepEqual((await participantResponse.json()).map((person: { id: number }) => person.id), [data.participant.id]);

    const coachCookie = await login(data.coach);
    const coachResponse = await request('/api/people?kind=participant', {}, coachCookie);
    assert.equal(coachResponse.status, 200);
    assert.deepEqual((await coachResponse.json()).map((person: { id: number }) => person.id), [data.coach.id]);

    const adminCookie = await login(data.admin);
    const invalidKind = await request('/api/people?kind=unknown', {}, adminCookie);
    assert.equal(invalidKind.status, 400);
    const adminResponse = await request('/api/people?kind=coach', {}, adminCookie);
    assert.equal(adminResponse.status, 200);
    const coaches = await adminResponse.json();
    assert.ok(coaches.some((person: { id: number }) => person.id === data.coach.id));
    assert.ok(coaches.some((person: { id: number }) => person.id === data.otherCoach.id));
  });

  test('session creation uses the caller identity and generic patching is gone', async () => {
    const data = await fixture();
    const participantCookie = await login(data.participant);
    const forbidden = await request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room_id: 3,
        coach_id: data.coach.id,
        discipline: 'fitness',
        session_type: 'standard',
         local_date: '2030-02-01',
         local_start_time: '10:00',
         local_end_time: '11:00'
      })
    }, participantCookie);
    assert.equal(forbidden.status, 403);

    const coachCookie = await login(data.coach);
    const bodyCoachId = await request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room_id: 3,
        coach_id: data.otherCoach.id,
        discipline: 'mindfulness',
        session_type: 'standard',
         local_date: '2030-02-01',
         local_start_time: '15:00',
         local_end_time: '16:00'
      })
    }, coachCookie);
    assert.equal(bodyCoachId.status, 400);

    const createdResponse = await request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room_id: 3,
        discipline: 'financial',
        session_type: 'standard',
         local_date: '2030-02-02',
         local_start_time: '15:00',
         local_end_time: '16:00'
      })
    }, coachCookie);
    assert.equal(createdResponse.status, 201);
    assert.equal((await createdResponse.json()).coach_id, data.coach.id);

    const overlappingCoachSession = await request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
         room_id: 3,
         discipline: 'lifestyle',
         session_type: 'standard',
         local_date: '2030-01-15',
         local_start_time: '10:00',
         local_end_time: '11:00'
      })
    }, coachCookie);
    assert.equal(overlappingCoachSession.status, 409);

    const tooSoonStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tooSoon = await request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room_id: 3,
        discipline: 'career',
        session_type: 'standard',
         local_date: tooSoonStart.toISOString().slice(0, 10),
         local_start_time: '12:00',
         local_end_time: '13:00'
      })
    }, coachCookie);
    assert.equal(tooSoon.status, 400);

    const badHours = await request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room_id: 3,
        discipline: 'nutrition',
        session_type: 'standard',
         local_date: '2030-02-03',
         local_start_time: '03:00',
         local_end_time: '04:00'
      })
    }, coachCookie);
    assert.equal(badHours.status, 400);

    const backwards = await request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room_id: 3,
        discipline: 'fitness',
        session_type: 'standard',
         local_date: '2030-02-04',
         local_start_time: '15:00',
         local_end_time: '14:00'
      })
    }, coachCookie);
    assert.equal(backwards.status, 400);

    await query('update person set credits = 0 where id = $1', [data.coach.id]);
    const insufficient = await request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room_id: 3,
        discipline: 'lifestyle',
        session_type: 'standard',
         local_date: '2030-02-05',
         local_start_time: '15:00',
         local_end_time: '16:00'
      })
    }, coachCookie);
    assert.equal(insufficient.status, 409);
    const rolledBack = await query('select id from session where discipline = $1', ['lifestyle']);
    assert.equal(rolledBack.length, 0);

    const patchResponse = await request(`/api/sessions/${data.sessionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    }, coachCookie);
    assert.equal(patchResponse.status, 404);
  });

  test('only the teaching coach or administrator may cancel a session', async () => {
    const data = await fixture();
    const otherCoachCookie = await login(data.otherCoach);
    const crossCoach = await request(`/api/sessions/${data.sessionId}/cancel`, { method: 'POST' }, otherCoachCookie);
    assert.equal(crossCoach.status, 403);

    const participantCookie = await login(data.participant);
    const participant = await request(`/api/sessions/${data.sessionId}/cancel`, { method: 'POST' }, participantCookie);
    assert.equal(participant.status, 403);

    const adminCookie = await login(data.admin);
    const cancelled = await request(`/api/sessions/${data.sessionId}/cancel`, { method: 'POST' }, adminCookie);
    assert.equal(cancelled.status, 200);
    const cancellation = await cancelled.json();
    assert.equal(cancellation.status, 'cancelled');
    assert.equal(cancellation.seat_fees_refunded, 40);

    const audit = await query<{
      status: string;
      cancelled_by_person_id: number;
      cancelled_at: string | null;
    }>('select status, cancelled_by_person_id, cancelled_at from session where id = $1', [data.sessionId]);
    assert.equal(audit[0].status, 'cancelled');
    assert.equal(audit[0].cancelled_by_person_id, data.admin.id);
    assert.ok(audit[0].cancelled_at);

    const enrolmentAudit = await query<{
      status: string;
      credits_refunded: number;
      cancelled_by_person_id: number;
    }>(
      'select status, credits_refunded, cancelled_by_person_id from enrolment where session_id = $1 order by id',
      [data.sessionId]
    );
    assert.deepEqual(enrolmentAudit.map((row) => [row.status, row.credits_refunded, row.cancelled_by_person_id]), [
      ['cancelled', 20, data.admin.id],
      ['cancelled', 20, data.admin.id]
    ]);

    const hiddenForOtherCoach = await request(`/api/sessions/${data.sessionId}`, {}, otherCoachCookie);
    assert.equal(hiddenForOtherCoach.status, 404);
    const visibleToParticipant = await request(`/api/sessions/${data.sessionId}`, {}, participantCookie);
    assert.equal(visibleToParticipant.status, 200);
    assert.equal((await visibleToParticipant.json()).enrolment.status, 'cancelled');

    await query("update session set status = 'completed' where id = $1", [data.otherSessionId]);
    const completedCancellation = await request(`/api/sessions/${data.otherSessionId}/cancel`, { method: 'POST' }, adminCookie);
    assert.equal(completedCancellation.status, 409);
  });
});
