import { query } from './db';

export type Role = 'admin' | 'coach' | 'participant';

export type Caller = {
  id: number;
  email: string;
  full_name: string;
  kind: Role;
  credits: number;
  active: boolean;
};

type SessionFeedRow = {
  id: number;
  room_id: number;
  coach_id: number;
  discipline: string;
  session_type: string;
  status: string;
  starts_at: string;
  ends_at: string;
  room_fee_credits: number;
  seat_fee_credits: number;
  room_name: string;
  room_capacity: number;
  coach_name: string;
  enrolled_count: number;
  own_enrolment_id: number | null;
  own_enrolment_status: string | null;
  own_credits_charged: number | null;
};

function publicSession(row: SessionFeedRow): Record<string, unknown> {
  return {
    id: row.id,
    discipline: row.discipline,
    session_type: row.session_type,
    status: row.status,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    room_id: row.room_id,
    room_name: row.room_name,
    room_capacity: row.room_capacity,
    room_fee_credits: row.room_fee_credits,
    seat_fee_credits: row.seat_fee_credits,
    enrolled_count: row.enrolled_count,
    places_remaining: row.room_capacity - row.enrolled_count
  };
}

function busySession(row: SessionFeedRow): Record<string, unknown> {
  return {
    id: row.id,
    visibility: 'busy',
    discipline: row.discipline,
    session_type: row.session_type,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    room_id: row.room_id,
    room_name: row.room_name
  };
}

export async function listSessionsForCaller(
  caller: Caller | undefined,
  from: string,
  to: string | undefined
): Promise<Record<string, unknown>[]> {
  const params: unknown[] = [from];
  let range = 's.starts_at >= $1';
  if (to) {
    params.push(to);
    range += ` and s.starts_at < $${params.length}`;
  }

  if (caller?.kind === 'participant') {
    params.push(caller.id);
  }

  const ownEnrolmentJoin = caller?.kind === 'participant'
    ? `left join enrolment own_e on own_e.session_id = s.id and own_e.person_id = $${params.length} and own_e.status = 'active'`
    : 'left join enrolment own_e on false';

  const rows = await query<SessionFeedRow>(
    `select s.id, s.room_id, s.coach_id, s.discipline, s.session_type, s.status,
            s.starts_at, s.ends_at, s.room_fee_credits, s.seat_fee_credits,
            r.name as room_name, r.capacity as room_capacity,
            coach.full_name as coach_name,
            count(active_e.id) filter (where active_e.person_id <> s.coach_id)::int as enrolled_count,
            own_e.id as own_enrolment_id, own_e.status as own_enrolment_status,
            own_e.credits_charged as own_credits_charged
       from session s
       join room r on r.id = s.room_id
       join person coach on coach.id = s.coach_id
       left join enrolment active_e on active_e.session_id = s.id and active_e.status = 'active'
       ${ownEnrolmentJoin}
      where ${range}
        and s.status <> 'cancelled'
      group by s.id, r.id, coach.id, own_e.id
      order by s.starts_at`,
    params
  );

  return rows.map((row) => {
    if (!caller || caller.kind === 'participant') {
      const result = publicSession(row);
      if (caller?.kind === 'participant') {
        result.my_enrolment = row.own_enrolment_id
          ? {
              id: row.own_enrolment_id,
              status: row.own_enrolment_status,
              credits_charged: row.own_credits_charged
            }
          : null;
      }
      return result;
    }

    if (caller.kind === 'coach' && row.coach_id !== caller.id) {
      return busySession(row);
    }

    return {
      ...publicSession(row),
      coach_id: row.coach_id,
      coach_name: row.coach_name
    };
  });
}

export async function getSessionForCaller(sessionId: number, caller: Caller): Promise<Record<string, unknown> | null> {
  const sessions = await query<any>(
    `select s.*, r.id as room_id_ref, r.name as room_name, r.capacity as room_capacity,
            coach.id as coach_id_ref, coach.full_name as coach_full_name, coach.email as coach_email
       from session s
       join room r on r.id = s.room_id
       join person coach on coach.id = s.coach_id
      where s.id = $1`,
    [sessionId]
  );
  const session = sessions[0];
  if (!session) return null;

  if (caller.kind === 'coach' && session.coach_id !== caller.id) {
    if (session.status === 'cancelled') return null;
    return {
      id: session.id,
      visibility: 'busy',
      discipline: session.discipline,
      session_type: session.session_type,
      starts_at: session.starts_at,
      ends_at: session.ends_at,
      room_id: session.room_id,
      room_name: session.room_name
    };
  }

  const rooms = {
    id: session.room_id,
    name: session.room_name,
    capacity: session.room_capacity
  };

  if (caller.kind === 'participant') {
    const enrolments = await query(
      `select id, status, credits_charged, credits_refunded, enrolled_at, cancelled_at
         from enrolment
        where session_id = $1 and person_id = $2
        order by id desc
        limit 1`,
      [sessionId, caller.id]
    );
    if (session.status === 'cancelled' && !enrolments[0]) return null;
    return {
      id: session.id,
      discipline: session.discipline,
      session_type: session.session_type,
      status: session.status,
      starts_at: session.starts_at,
      ends_at: session.ends_at,
      room: rooms,
      room_fee_credits: session.room_fee_credits,
      seat_fee_credits: session.seat_fee_credits,
      enrolment: enrolments[0] ?? null
    };
  }

  const attendees = await query(
    `select e.id, e.status, e.credits_charged, e.credits_refunded, e.enrolled_at, e.cancelled_at,
             e.cancelled_by_person_id, p.id as person_id, p.full_name, p.email,
             count(ci.id)::int as check_in_count,
             array_remove(array_agg(ci.checked_in_at order by ci.checked_in_at), null) as check_in_times,
             (
               select count(ci2.id)::int
                 from check_in ci2
                 join enrolment e2 on e2.id = ci2.enrolment_id
                 join session s2 on s2.id = e2.session_id
                where e2.person_id = e.person_id
                  and s2.coach_id = $2
             ) as coach_attendance_count
       from enrolment e
       join person p on p.id = e.person_id
       left join check_in ci on ci.enrolment_id = e.id
      where e.session_id = $1
      group by e.id, p.id
      order by e.id`,
      [sessionId, session.coach_id]
  );

  const result: Record<string, unknown> = {
    ...session,
    room: rooms,
    coach: {
      id: session.coach_id_ref,
      full_name: session.coach_full_name,
      email: session.coach_email
    },
    attendees
  };
  delete result.room_id_ref;
  delete result.room_name;
  delete result.room_capacity;
  delete result.coach_id_ref;
  delete result.coach_full_name;
  delete result.coach_email;
  return result;
}

export async function listPeopleForCaller(caller: Caller, kind?: Role): Promise<Record<string, unknown>[]> {
  if (caller.kind !== 'admin') {
    return [{
      id: caller.id,
      email: caller.email,
      full_name: caller.full_name,
      kind: caller.kind,
      credits: caller.credits,
      active: caller.active
    }];
  }

  const params: unknown[] = [];
  let filter = '';
  if (kind) {
    params.push(kind);
    filter = ` where kind = $${params.length}`;
  }
  return query(
    `select id, email, full_name, kind, credits, active
       from person${filter}
      order by full_name`,
    params
  );
}
