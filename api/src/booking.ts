import { PoolClient } from 'pg';
import { Caller } from './permissions';
import { withTransaction } from './db';
import {
  hoursOfNotice,
  participantRefundPercent,
  refundAmount,
  refundPercent,
  roomFee,
  seatFee
} from './credits';
import { formatCentreDateTime, parseLocalSessionWindow } from './time';

export class DomainError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export type SessionInput = {
  roomId: number;
  coachId: number;
  discipline: string;
  sessionType: 'short' | 'standard' | 'intensive';
  localDate: string;
  localStartTime: string;
  localEndTime: string;
};

export type RescheduleInput = {
  roomId: number;
  localDate: string;
  localStartTime: string;
  localEndTime: string;
};

function conflict(message: string): never {
  throw new DomainError(409, message);
}

function badRequest(message: string): never {
  throw new DomainError(400, message);
}

function notFound(message: string): never {
  throw new DomainError(404, message);
}

function forbidden(message: string): never {
  throw new DomainError(403, message);
}

function retryTransaction(message: string): never {
  const retry = new Error(message);
  retry.name = 'TransactionRetryError';
  throw retry;
}

function databaseErrorCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

export function responseError(error: unknown): { status: number; message: string } | null {
  if (error instanceof DomainError) return { status: error.status, message: error.message };
  const code = databaseErrorCode(error);
  if (code === '23P01') return { status: 409, message: 'that room is already booked for the requested time' };
  if (code === '23505') return { status: 409, message: 'that booking already exists' };
  if (code === '23514') return { status: 409, message: 'the requested change violates a booking rule' };
  if (code === '23503') return { status: 400, message: 'the requested record does not exist' };
  return null;
}

async function databaseNow(client: PoolClient): Promise<Date> {
  const result = await client.query<{ now: Date }>('select now() as now');
  return new Date(result.rows[0].now);
}

async function lockRooms(client: PoolClient, ids: number[]): Promise<any[]> {
  const uniqueIds = [...new Set(ids)].sort((a, b) => a - b);
  if (uniqueIds.length === 0) return [];
  const rows = await client.query(
    'select id, name, capacity from room where id = any($1::int[]) order by id for update',
    [uniqueIds]
  );
  if (rows.rowCount !== uniqueIds.length) badRequest('one or more rooms do not exist');
  return rows.rows;
}

async function lockPeople(client: PoolClient, ids: number[]): Promise<any[]> {
  const uniqueIds = [...new Set(ids)].sort((a, b) => a - b);
  if (uniqueIds.length === 0) return [];
  const rows = await client.query(
    'select id, kind, credits, active from person where id = any($1::int[]) order by id for update',
    [uniqueIds]
  );
  if (rows.rowCount !== uniqueIds.length) badRequest('one or more people do not exist');
  return rows.rows;
}

async function lockSessionWithRoom(client: PoolClient, id: number): Promise<any> {
  const metadata = await client.query('select room_id from session where id = $1', [id]);
  if (metadata.rowCount === 0) notFound('no such session');
  const roomId = metadata.rows[0].room_id;
  await lockRooms(client, [roomId]);
  const locked = await client.query('select * from session where id = $1 for update', [id]);
  if (locked.rowCount === 0) notFound('no such session');
  if (locked.rows[0].room_id !== roomId) {
    retryTransaction('session room changed while it was being locked');
  }
  return locked.rows[0];
}

async function lockSessions(client: PoolClient, ids: number[]): Promise<any[]> {
  const uniqueIds = [...new Set(ids)].sort((a, b) => a - b);
  const rows = await client.query(
    'select * from session where id = any($1::int[]) order by id for update',
    [uniqueIds]
  );
  if (rows.rowCount !== uniqueIds.length) notFound('one or more sessions do not exist');
  return rows.rows;
}

async function activePeopleForSession(client: PoolClient, sessionId: number, coachId: number): Promise<number[]> {
  const attendees = await client.query(
    `select person_id
       from enrolment
      where session_id = $1 and status = 'active'`,
    [sessionId]
  );
  return [coachId, ...attendees.rows.map((row) => Number(row.person_id))];
}

async function checkCommitments(
  client: PoolClient,
  personIds: number[],
  startsAt: string,
  endsAt: string,
  excludedSessionIds: number[] = []
): Promise<void> {
  const people = [...new Set(personIds)].sort((a, b) => a - b);
  const excluded = excludedSessionIds.length > 0 ? excludedSessionIds : [-1];
  const conflicts = await client.query(
    `select s.id
       from session s
      where s.status <> 'cancelled'
        and s.id <> all($4::int[])
        and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange($1::timestamptz, $2::timestamptz, '[)')
        and (
          s.coach_id = any($3::int[])
          or exists (
            select 1
              from enrolment e
             where e.session_id = s.id
               and e.person_id = any($3::int[])
               and e.status = 'active'
          )
        )
      limit 1`,
    [startsAt, endsAt, people, excluded]
  );
  if ((conflicts.rowCount ?? 0) > 0) conflict('a person is already committed during that time');
}

async function activeParticipantCount(client: PoolClient, sessionId: number, coachId: number): Promise<number> {
  const count = await client.query<{ count: string }>(
    `select count(*)::text as count
       from enrolment
      where session_id = $1 and status = 'active' and person_id <> $2`,
    [sessionId, coachId]
  );
  return Number(count.rows[0].count);
}

async function enqueueEmail(
  client: PoolClient,
  eventKey: string,
  eventType: string,
  recipient: string,
  subject: string,
  body: string
): Promise<void> {
  await client.query(
    `insert into email_outbox (event_key, event_type, recipient, subject, body)
     values ($1, $2, $3, $4, $5)
     on conflict (event_key, recipient) do nothing`,
    [eventKey, eventType, recipient, subject, body]
  );
}

async function enqueuePeople(
  client: PoolClient,
  personIds: number[],
  eventKey: string,
  eventType: string,
  subject: string,
  body: string
): Promise<void> {
  const ids = [...new Set(personIds)].sort((a, b) => a - b);
  if (ids.length === 0) return;
  const people = await client.query(
    'select email from person where id = any($1::int[]) order by id',
    [ids]
  );
  for (const person of people.rows) {
    await enqueueEmail(client, eventKey, eventType, person.email, subject, body);
  }
}

async function enqueueAdmins(
  client: PoolClient,
  eventKey: string,
  eventType: string,
  subject: string,
  body: string
): Promise<void> {
  const admins = await client.query("select email from person where kind = 'admin' and active = true order by id");
  for (const admin of admins.rows) {
    await enqueueEmail(client, eventKey, eventType, admin.email, subject, body);
  }
}

function requireParsedWindow(input: SessionInput | RescheduleInput, now: Date): { startsAt: string; endsAt: string } {
  const result = parseLocalSessionWindow({
    localDate: input.localDate,
    localStartTime: input.localStartTime,
    localEndTime: input.localEndTime,
    sessionType: 'sessionType' in input ? input.sessionType : 'standard'
  }, now);
  if (typeof result === 'string') badRequest(result);
  return result;
}

export async function createSession(input: SessionInput, caller: Caller): Promise<any> {
  if (caller.kind !== 'coach' && caller.kind !== 'admin') forbidden('only coaches and administrators may create sessions');
  if (caller.kind === 'coach' && input.coachId !== caller.id) forbidden('a coach may only create their own sessions');
  return withTransaction(async (client) => {
    const rooms = await lockRooms(client, [input.roomId]);
    const coaches = await client.query(
      'select id, credits, kind, active, full_name from person where id = $1 for update',
      [input.coachId]
    );
    if (coaches.rowCount === 0 || coaches.rows[0].kind !== 'coach' || !coaches.rows[0].active) {
      badRequest('no such active coach');
    }

    const now = await databaseNow(client);
    const window = requireParsedWindow(input, now);
    const roomClash = await client.query(
      `select 1
         from session
        where room_id = $1
          and status <> 'cancelled'
          and tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
        limit 1`,
      [input.roomId, window.startsAt, window.endsAt]
    );
    if ((roomClash.rowCount ?? 0) > 0) conflict(`${rooms[0].name} is already booked for that time`);

    await checkCommitments(client, [input.coachId], window.startsAt, window.endsAt);
    const inserted = await client.query(
      `insert into session
         (room_id, coach_id, discipline, session_type, status, starts_at, ends_at,
          room_fee_credits, seat_fee_credits)
       values ($1, $2, $3, $4, 'scheduled', $5, $6, $7, $8)
       returning *`,
      [
        input.roomId,
        input.coachId,
        input.discipline,
        input.sessionType,
        window.startsAt,
        window.endsAt,
        roomFee(input.sessionType),
        seatFee(input.sessionType)
      ]
    );
    const debited = await client.query(
      'update person set credits = credits - $1 where id = $2 and credits >= $1 returning id',
      [roomFee(input.sessionType), input.coachId]
    );
    if (debited.rowCount !== 1) conflict('the coach does not have enough credits');
    await enqueueAdmins(
      client,
      `session-created:${inserted.rows[0].id}`,
      'room.booked_by_coach',
      'New session booked',
      `A new coaching session has been booked by ${coaches.rows[0].full_name}.

Session ID: ${inserted.rows[0].id}
Discipline: ${inserted.rows[0].discipline}
Room: ${rooms[0].name}
Starts: ${formatCentreDateTime(inserted.rows[0].starts_at)}
Ends: ${formatCentreDateTime(inserted.rows[0].ends_at)}

You can review the details in the Atrium admin dashboard.`
    );
    return inserted.rows[0];
  });
}

export async function enrolSession(sessionId: number, person: Caller): Promise<any> {
  if (person.kind !== 'participant' && person.kind !== 'coach') forbidden('only participants and coaches may enrol');
  return withTransaction(async (client) => {
    const session = await lockSessionWithRoomless(client, sessionId);
    const now = await databaseNow(client);
    if (session.status !== 'scheduled') conflict('only scheduled sessions may be booked');
    if (new Date(session.starts_at).getTime() <= now.getTime()) conflict('a session that has started cannot be booked');
    if (session.coach_id === person.id) conflict('a coach cannot enrol in their own session');

    const existing = await client.query(
      "select id from enrolment where session_id = $1 and person_id = $2 and status = 'active'",
      [sessionId, person.id]
    );
    if (existing.rowCount !== 0) conflict('you are already enrolled in this session');

    await lockPeople(client, [person.id]);
    const rooms = await client.query('select capacity from room where id = $1', [session.room_id]);
    if (rooms.rowCount === 0) badRequest('no such room');
    const count = await activeParticipantCount(client, sessionId, session.coach_id);
    if (count >= Number(rooms.rows[0].capacity)) conflict('that session is full');
    await checkCommitments(client, [person.id], iso(session.starts_at), iso(session.ends_at), [sessionId]);

    const debited = await client.query(
      'update person set credits = credits - $1 where id = $2 and credits >= $1 returning id',
      [session.seat_fee_credits, person.id]
    );
    if (debited.rowCount !== 1) conflict('you do not have enough credits');
    const inserted = await client.query(
      `insert into enrolment (session_id, person_id, status, credits_charged, credits_refunded, enrolled_at)
       values ($1, $2, 'active', $3, 0, now())
       returning *`,
      [sessionId, person.id, session.seat_fee_credits]
    );
    const coach = await client.query('select email from person where id = $1', [session.coach_id]);
    if (coach.rowCount === 1) {
      await enqueueEmail(
        client,
        `booking-created:${inserted.rows[0].id}`,
        'participant.booking.created',
        coach.rows[0].email,
        'New booking for your session',
        `${person.full_name} has booked a place in your ${session.discipline} session.

Session starts: ${formatCentreDateTime(session.starts_at)}`
      );
    }
    return inserted.rows[0];
  });
}

async function lockSessionWithRoomless(client: PoolClient, id: number): Promise<any> {
  const rows = await client.query('select * from session where id = $1 for update', [id]);
  if (rows.rowCount === 0) notFound('no such session');
  return rows.rows[0];
}

export async function cancelBooking(enrolmentId: number, person: Caller): Promise<any> {
  if (person.kind !== 'participant' && person.kind !== 'coach') forbidden('only participants and coaches may cancel bookings');
  return withTransaction(async (client) => {
    const metadata = await client.query(
      `select e.session_id, s.room_id
         from enrolment e join session s on s.id = e.session_id
        where e.id = $1`,
      [enrolmentId]
    );
    if (metadata.rowCount === 0) notFound('no such enrolment');
    await lockRooms(client, [metadata.rows[0].room_id]);
    const session = await client.query('select * from session where id = $1 for update', [metadata.rows[0].session_id]);
    if (session.rowCount === 0) notFound('no such session');
    if (session.rows[0].room_id !== metadata.rows[0].room_id) {
      retryTransaction('session room changed while the booking was being locked');
    }
    const enrolment = await client.query('select * from enrolment where id = $1 for update', [enrolmentId]);
    if (enrolment.rowCount === 0) notFound('no such enrolment');
    const row = enrolment.rows[0];
    if (row.person_id !== person.id) forbidden('you may only cancel your own booking');
    if (row.status !== 'active') conflict('that booking is already cancelled');
    const now = await databaseNow(client);
    if (session.rows[0].status !== 'scheduled') conflict('only scheduled bookings may be cancelled');
    if (new Date(session.rows[0].starts_at).getTime() <= now.getTime()) conflict('a booking cannot be cancelled after the session starts');

    await lockPeople(client, [person.id]);
    const percent = participantRefundPercent(hoursOfNotice(now, new Date(session.rows[0].starts_at)));
    const refund = refundAmount(Number(row.credits_charged), percent);
    const cancelled = await client.query(
      `update enrolment
          set status = 'cancelled', credits_refunded = $1, cancelled_at = now(), cancelled_by_person_id = $2,
              booking_change_version = booking_change_version + 1
        where id = $3
        returning booking_change_version`,
      [refund, person.id, enrolmentId]
    );
    await client.query('update person set credits = credits + $1 where id = $2', [refund, person.id]);
    const coach = await client.query('select email from person where id = $1', [session.rows[0].coach_id]);
    if (coach.rowCount === 1) {
      await enqueueEmail(
        client,
        `booking-change:${enrolmentId}:${cancelled.rows[0].booking_change_version}`,
        'participant.booking.cancelled',
        coach.rows[0].email,
        'Booking cancelled',
        `${person.full_name} has cancelled their booking for your ${session.rows[0].discipline} session.

The session was scheduled for ${formatCentreDateTime(session.rows[0].starts_at)}.`
      );
    }
    return { id: enrolmentId, status: 'cancelled', refund_percent: percent, credits_refunded: refund };
  });
}

export async function changeBooking(enrolmentId: number, destinationSessionId: number, person: Caller): Promise<any> {
  if (person.kind !== 'participant' && person.kind !== 'coach') forbidden('only participants and coaches may change bookings');
  return withTransaction(async (client) => {
    const metadata = await client.query(
      `select e.session_id as old_session_id, old_s.room_id as old_room_id,
              destination.room_id as destination_room_id
         from enrolment e
         join session old_s on old_s.id = e.session_id
         join session destination on destination.id = $2
        where e.id = $1`,
      [enrolmentId, destinationSessionId]
    );
    if (metadata.rowCount === 0) notFound('no such booking or destination session');
    if (metadata.rows[0].old_session_id === destinationSessionId) conflict('the destination must be a different session');

    const rooms = await lockRooms(client, [metadata.rows[0].old_room_id, metadata.rows[0].destination_room_id]);
    const sessions = await lockSessions(client, [metadata.rows[0].old_session_id, destinationSessionId]);
    const lockedRoomIds = new Set(rooms.map((room) => Number(room.id)));
    if (sessions.some((session) => !lockedRoomIds.has(Number(session.room_id)))) {
      retryTransaction('a session room changed while the booking was being locked');
    }
    const oldSession = sessions.find((row) => row.id === metadata.rows[0].old_session_id);
    const destination = sessions.find((row) => row.id === destinationSessionId);
    await lockPeople(client, [person.id]);
    const oldBooking = await client.query('select * from enrolment where id = $1 for update', [enrolmentId]);
    if (oldBooking.rowCount === 0) notFound('no such enrolment');
    if (oldBooking.rows[0].person_id !== person.id) forbidden('you may only change your own booking');
    if (oldBooking.rows[0].status !== 'active') conflict('that booking is already cancelled');

    const now = await databaseNow(client);
    if (oldSession.status !== 'scheduled' || destination.status !== 'scheduled') conflict('both sessions must be scheduled');
    if (new Date(oldSession.starts_at).getTime() <= now.getTime()) conflict('a booking cannot be changed after the session starts');
    if (new Date(destination.starts_at).getTime() <= now.getTime()) conflict('the destination session has already started');
    if (destination.coach_id === person.id) conflict('a coach cannot enrol in their own session');

    const destinationExisting = await client.query(
      "select id from enrolment where session_id = $1 and person_id = $2 and status = 'active'",
      [destinationSessionId, person.id]
    );
    if (destinationExisting.rowCount !== 0) conflict('you are already enrolled in the destination session');
    const destinationRoom = rooms.find((room) => room.id === destination.room_id);
    const destinationCount = await activeParticipantCount(client, destination.id, destination.coach_id);
    if (destinationCount >= Number(destinationRoom.capacity)) conflict('the destination session is full');
    await checkCommitments(client, [person.id], iso(destination.starts_at), iso(destination.ends_at), [oldSession.id, destination.id]);

    const refund = refundAmount(
      Number(oldBooking.rows[0].credits_charged),
      participantRefundPercent(hoursOfNotice(now, new Date(oldSession.starts_at)))
    );
    const destinationFee = Number(destination.seat_fee_credits);
    const balance = await client.query<{ credits: number }>('select credits from person where id = $1 for update', [person.id]);
    if (Number(balance.rows[0].credits) + refund < destinationFee) conflict('you do not have enough credits for the destination session');

    const cancelled = await client.query(
      `update enrolment
          set status = 'cancelled', credits_refunded = $1, cancelled_at = now(), cancelled_by_person_id = $2,
              booking_change_version = booking_change_version + 1
        where id = $3
        returning id, session_id, person_id, status, credits_charged, credits_refunded, booking_change_version`,
      [refund, person.id, enrolmentId]
    );
    await client.query('update person set credits = credits + $1 - $2 where id = $3', [refund, destinationFee, person.id]);
    const inserted = await client.query(
      `insert into enrolment (session_id, person_id, status, credits_charged, credits_refunded, enrolled_at)
       values ($1, $2, 'active', $3, 0, now())
       returning *`,
      [destination.id, person.id, destinationFee]
    );
    const coaches = await client.query(
      'select distinct on (id) id, email from person where id = any($1::int[]) order by id',
      [[oldSession.coach_id, destination.coach_id]]
    );
    for (const coach of coaches.rows) {
      await enqueueEmail(
        client,
        `booking-change:${enrolmentId}:${cancelled.rows[0].booking_change_version}`,
        'participant.booking.changed',
        coach.email,
        'Booking changed',
        `${person.full_name} has moved their booking to a different session.

Original session: ${oldSession.discipline} (${formatCentreDateTime(oldSession.starts_at)})
New session: ${destination.discipline} (${formatCentreDateTime(destination.starts_at)})`
      );
    }
    return { old_enrolment: cancelled.rows[0], new_enrolment: inserted.rows[0], credits_refunded: refund };
  });
}

export async function cancelSession(sessionId: number, caller: Caller): Promise<any> {
  if (caller.kind !== 'coach' && caller.kind !== 'admin') forbidden('only coaches and administrators may cancel sessions');
  return withTransaction(async (client) => {
    const session = await lockSessionWithRoom(client, sessionId);
    if (caller.kind === 'coach' && session.coach_id !== caller.id) forbidden('only the teaching coach may cancel this session');
    if (session.status === 'cancelled') conflict('that session is already cancelled');
    if (session.status !== 'scheduled') conflict('only scheduled sessions may be cancelled');
    const now = await databaseNow(client);
    if (new Date(session.starts_at).getTime() <= now.getTime()) conflict('a session cannot be cancelled after it starts');

    const enrolments = await client.query(
      "select id, person_id, credits_charged from enrolment where session_id = $1 and status = 'active' order by person_id, id for update",
      [sessionId]
    );
    await lockPeople(client, [session.coach_id, ...enrolments.rows.map((row) => Number(row.person_id))]);
    const percent = refundPercent(hoursOfNotice(now, new Date(session.starts_at)));
    const roomRefund = refundAmount(Number(session.room_fee_credits), percent);
    let seatsRefunded = 0;
    for (const enrolment of enrolments.rows) {
      const refund = Number(enrolment.credits_charged);
      await client.query(
        `update enrolment
            set status = 'cancelled', credits_refunded = $1, cancelled_at = now(), cancelled_by_person_id = $2
          where id = $3`,
        [refund, caller.id, enrolment.id]
      );
      await client.query('update person set credits = credits + $1 where id = $2', [refund, enrolment.person_id]);
      seatsRefunded += refund;
    }
    await client.query('update person set credits = credits + $1 where id = $2', [roomRefund, session.coach_id]);
    const updated = await client.query(
      `update session
          set status = 'cancelled', cancelled_at = now(), cancelled_by_person_id = $2, change_version = change_version + 1
        where id = $1
        returning change_version`,
      [sessionId, caller.id]
    );
    const changeVersion = updated.rows[0].change_version;
    const affectedPeople = enrolments.rows.map((row) => Number(row.person_id));
    await enqueuePeople(
      client,
      affectedPeople,
      `session-change:${sessionId}:${changeVersion}:session.cancelled`,
      'session.cancelled',
      'Session cancelled',
      `We're sorry to let you know that your ${session.discipline} session has been cancelled.

The session was scheduled for ${formatCentreDateTime(session.starts_at)}.

Any credits you paid for this session have been refunded to your account. If you have any questions, please reply to this email.`
    );
    await enqueueAdmins(
      client,
      `session-change:${sessionId}:${changeVersion}:session.cancelled`,
      'session.cancelled',
      'Session cancelled',
      `Session ${sessionId} (${session.discipline}) has been cancelled.

It was scheduled for ${formatCentreDateTime(session.starts_at)}. Refunds have been issued to all enrolled participants and the coach's room fee.`
    );
    if (caller.kind === 'coach') {
      await enqueueAdmins(
        client,
        `session-change:${sessionId}:${changeVersion}:room.cancelled_by_coach`,
        'room.cancelled_by_coach',
        'Room booking cancelled',
        `The room booking for session ${sessionId} (${session.discipline}) has been cancelled by the coach.

It was scheduled for ${formatCentreDateTime(session.starts_at)}.`
      );
    }
    return { id: sessionId, status: 'cancelled', refund_percent: percent, room_fee_refunded: roomRefund, enrolments_cancelled: enrolments.rowCount, seat_fees_refunded: seatsRefunded };
  });
}

export async function rescheduleSession(sessionId: number, input: RescheduleInput, caller: Caller): Promise<any> {
  if (caller.kind !== 'coach' && caller.kind !== 'admin') forbidden('only coaches and administrators may reschedule sessions');
  return withTransaction(async (client) => {
    const metadata = await client.query('select room_id from session where id = $1', [sessionId]);
    if (metadata.rowCount === 0) notFound('no such session');
    const rooms = await lockRooms(client, [metadata.rows[0].room_id, input.roomId]);
    const sessionRows = await client.query('select * from session where id = $1 for update', [sessionId]);
    if (sessionRows.rowCount === 0) notFound('no such session');
    if (sessionRows.rows[0].room_id !== metadata.rows[0].room_id) {
      retryTransaction('session room changed while the check-in was being locked');
    }
    if (!rooms.some((room) => room.id === sessionRows.rows[0].room_id)) {
      const retry = new Error('session room changed while it was being locked');
      retry.name = 'TransactionRetryError';
      throw retry;
    }
    const session = sessionRows.rows[0];
    if (caller.kind === 'coach' && caller.id !== session.coach_id) forbidden('only the teaching coach may reschedule this session');
    if (session.status !== 'scheduled') conflict('only scheduled sessions may be rescheduled');
    const now = await databaseNow(client);
    if (new Date(session.starts_at).getTime() <= now.getTime()) conflict('a session cannot be rescheduled after it starts');
    const window = requireParsedWindow({ ...input, sessionType: session.session_type }, now);
    const room = rooms.find((row) => row.id === input.roomId);
    const roomClash = await client.query(
      `select 1 from session
        where room_id = $1 and id <> $2 and status <> 'cancelled'
          and tstzrange(starts_at, ends_at, '[)') && tstzrange($3::timestamptz, $4::timestamptz, '[)')
        limit 1`,
      [input.roomId, sessionId, window.startsAt, window.endsAt]
    );
    if ((roomClash.rowCount ?? 0) > 0) conflict(`${room.name} is already booked for that time`);

    const people = await activePeopleForSession(client, sessionId, session.coach_id);
    await lockPeople(client, people);
    const activeCount = await activeParticipantCount(client, sessionId, session.coach_id);
    if (activeCount > Number(room.capacity)) conflict('the destination room cannot hold the existing participants');
    await checkCommitments(client, people, window.startsAt, window.endsAt, [sessionId]);
    const updated = await client.query(
      `update session
          set room_id = $1, starts_at = $2, ends_at = $3, change_version = change_version + 1
        where id = $4
        returning *`,
      [input.roomId, window.startsAt, window.endsAt, sessionId]
    );
    const coachAttendees = await client.query(
      `select e.person_id
         from enrolment e
         join person p on p.id = e.person_id
        where e.session_id = $1 and e.status = 'active' and p.kind = 'coach' and e.person_id <> $2`,
      [sessionId, session.coach_id]
    );
    await enqueuePeople(
      client,
      coachAttendees.rows.map((row) => Number(row.person_id)),
      `session-change:${sessionId}:${updated.rows[0].change_version}:coach.attendee.session_changed`,
      'coach.attendee.session_changed',
      'Session rescheduled',
      `A session you are attending has been rescheduled.

Session: ${session.discipline}
New time: ${formatCentreDateTime(updated.rows[0].starts_at)}
Room: ${room.name}

Please review your schedule in the Atrium app.`
    );
    return updated.rows[0];
  });
}

export async function reassignSession(sessionId: number, newCoachId: number, caller: Caller): Promise<any> {
  if (caller.kind !== 'admin') forbidden('only administrators may reassign a session');
  return withTransaction(async (client) => {
    const session = await lockSessionWithRoom(client, sessionId);
    if (session.status !== 'scheduled') conflict('only scheduled sessions may be reassigned');
    const now = await databaseNow(client);
    if (new Date(session.starts_at).getTime() <= now.getTime()) conflict('a session cannot be reassigned after it starts');
    if (session.coach_id === newCoachId) conflict('the session already belongs to that coach');

    const coaches = await lockPeople(client, [session.coach_id, newCoachId]);
    const newCoach = coaches.find((person) => Number(person.id) === newCoachId);
    if (!newCoach || newCoach.kind !== 'coach' || !newCoach.active) badRequest('no such active coach');
    const existingAttendance = await client.query(
      "select 1 from enrolment where session_id = $1 and person_id = $2 and status = 'active'",
      [sessionId, newCoachId]
    );
    if (existingAttendance.rowCount !== 0) conflict('the new coach is already enrolled in this session');
    await checkCommitments(client, [newCoachId], iso(session.starts_at), iso(session.ends_at), [sessionId]);

    const fee = Number(session.room_fee_credits);
    const debited = await client.query(
      'update person set credits = credits - $1 where id = $2 and credits >= $1 returning id',
      [fee, newCoachId]
    );
    if (debited.rowCount !== 1) conflict('the new coach does not have enough credits');
    await client.query('update person set credits = credits + $1 where id = $2', [fee, session.coach_id]);
    const updated = await client.query(
      `update session
          set coach_id = $1, change_version = change_version + 1
        where id = $2
        returning *`,
      [newCoachId, sessionId]
    );
    const coachAttendees = await client.query(
      `select e.person_id
         from enrolment e
         join person p on p.id = e.person_id
        where e.session_id = $1 and e.status = 'active' and p.kind = 'coach' and e.person_id <> $2`,
      [sessionId, newCoachId]
    );
    await enqueuePeople(
      client,
      coachAttendees.rows.map((row) => Number(row.person_id)),
      `session-change:${sessionId}:${updated.rows[0].change_version}:coach.attendee.session_changed`,
      'coach.attendee.session_changed',
      'Attended session changed',
      `Session ${sessionId} changed teaching coach.`
    );
    const oldCoach = await client.query('select email from person where id = $1', [session.coach_id]);
    if (oldCoach.rowCount === 1) {
      await enqueueEmail(
        client,
        `session-change:${sessionId}:${updated.rows[0].change_version}:coach.reassigned`,
        'coach.reassigned',
        oldCoach.rows[0].email,
        'Session reassigned',
        `Session ${sessionId} (${session.discipline}) is no longer assigned to you.

It was scheduled for ${formatCentreDateTime(session.starts_at)}. If you have any questions, please contact an administrator.`
      );
    }
    const newCoachRow = await client.query('select email from person where id = $1', [newCoachId]);
    if (newCoachRow.rowCount === 1) {
      await enqueueEmail(
        client,
        `session-change:${sessionId}:${updated.rows[0].change_version}:coach.assigned`,
        'coach.assigned',
        newCoachRow.rows[0].email,
        'Session assigned to you',
        `You have been assigned to teach ${session.discipline} (session ${sessionId}).

Time: ${formatCentreDateTime(session.starts_at)}

Please review your schedule in the Atrium app.`
      );
    }
    return updated.rows[0];
  });
}

export async function completeSession(sessionId: number, caller: Caller): Promise<any> {
  if (caller.kind !== 'coach' && caller.kind !== 'admin') forbidden('only coaches and administrators may complete sessions');
  return withTransaction(async (client) => {
    const session = await lockSessionWithRoom(client, sessionId);
    if (caller.kind === 'coach' && caller.id !== session.coach_id) forbidden('only the teaching coach may complete this session');
    if (session.status !== 'scheduled') conflict('only scheduled sessions may be completed');
    const now = await databaseNow(client);
    if (new Date(session.ends_at).getTime() > now.getTime()) conflict('a session cannot be completed before it ends');
    const updated = await client.query(
      `update session set status = 'completed', change_version = change_version + 1 where id = $1 returning *`,
      [sessionId]
    );
    return updated.rows[0];
  });
}

export async function checkIn(sessionId: number, enrolmentId: number, caller: Caller): Promise<any> {
  if (caller.kind !== 'coach' && caller.kind !== 'admin') forbidden('only coaches and administrators may check in attendees');
  return withTransaction(async (client) => {
    const metadata = await client.query(
      `select e.person_id, s.room_id
         from enrolment e join session s on s.id = e.session_id
        where e.id = $1 and e.session_id = $2`,
      [enrolmentId, sessionId]
    );
    if (metadata.rowCount === 0) notFound('no such enrolment for this session');
    await lockRooms(client, [metadata.rows[0].room_id]);
    const sessionRows = await client.query('select * from session where id = $1 for update', [sessionId]);
    if (sessionRows.rowCount === 0) notFound('no such session');
    const session = sessionRows.rows[0];
    if (caller.kind === 'coach' && caller.id !== session.coach_id) forbidden('only the teaching coach may check in attendees');
    if (session.status !== 'scheduled') conflict('check-in is closed for this session');
    await lockPeople(client, [Number(metadata.rows[0].person_id)]);
    const enrolment = await client.query('select * from enrolment where id = $1 for update', [enrolmentId]);
    if (enrolment.rowCount === 0 || enrolment.rows[0].status !== 'active') conflict('only active enrolments may be checked in');
    const now = await databaseNow(client);
    if (now.getTime() < new Date(session.starts_at).getTime()) conflict('check-in is not open yet');
    if (now.getTime() >= new Date(session.ends_at).getTime()) conflict('check-in is closed after the session ends');
    const existing = await client.query('select id from check_in where enrolment_id = $1', [enrolmentId]);
    if (existing.rowCount !== 0) conflict('this enrolment has already been checked in');
    const inserted = await client.query(
      'insert into check_in (enrolment_id, checked_in_at) values ($1, now()) returning *',
      [enrolmentId]
    );
    return inserted.rows[0];
  });
}
