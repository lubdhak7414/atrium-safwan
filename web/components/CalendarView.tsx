'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '../lib/api';
import { formatCentreDate, formatCentreTime, startOfCentreWeek, toApiIso } from '../lib/time';
import type { Role, Session } from '../lib/types';
import { ScheduleGrid } from './ScheduleGrid';
import { BookingActions, CoachSessionActions, CoachSessionDetail } from './SessionActions';

export function CalendarView({ role }: { role: Role }) {
  const [weekStart, setWeekStart] = useState(() => startOfCentreWeek());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const to = weekStart.plus({ weeks: 1 });
    setState('loading');
    fetchJson<Session[]>(`/api/sessions?from=${encodeURIComponent(toApiIso(weekStart))}&to=${encodeURIComponent(toApiIso(to))}`, { signal: controller.signal })
      .then((rows) => {
        if (!active) return;
        setSessions(rows);
        setState('ready');
      })
      .catch((cause: Error) => {
        if (!active || controller.signal.aborted) return;
        setError(cause.message);
        setState('error');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [refreshVersion, weekStart]);

  const ownBookings = sessions.filter((session) => session.my_enrolment);
  const catalogue = role === 'participant' ? sessions : [];
  const ownSessions = role === 'coach' ? sessions.filter((session) => session.visibility !== 'busy') : [];
  const busySessions = role === 'coach' ? sessions.filter((session) => session.visibility === 'busy') : [];

  return (
    <section className="calendar-section" aria-labelledby="calendar-title">
      <div className="section-heading">
        <div>
          <h2 id="calendar-title">MASTER SCHEDULE</h2>
          <p className="muted">One filtered calendar feed. All times are centre-local.</p>
        </div>
        <div className="calendar-controls">
          <button type="button" onClick={() => setWeekStart(weekStart.minus({ weeks: 1 }))}>← PREVIOUS</button>
          <button type="button" onClick={() => setWeekStart(weekStart.plus({ weeks: 1 }))}>NEXT →</button>
        </div>
      </div>
      {state === 'loading' && <p className="state-line">LOADING CALENDAR...</p>}
      {state === 'error' && <p className="error-line">{error}</p>}
      {state === 'ready' && sessions.length === 0 && <p className="empty-line">NO SESSIONS IN THIS WEEK.</p>}
      {state === 'ready' && <ScheduleGrid sessions={sessions} weekStart={weekStart} showCoach={role === 'admin'} />}
      {role === 'participant' && state === 'ready' && (
        <div className="calendar-lower-grid">
          <SessionTable title="MY BOOKINGS" sessions={ownBookings} allSessions={catalogue} actionRole="participant" onChanged={() => setRefreshVersion((version) => version + 1)} />
          <SessionTable title="PUBLIC CATALOGUE" sessions={catalogue} allSessions={catalogue} actionRole="participant" onChanged={() => setRefreshVersion((version) => version + 1)} />
        </div>
      )}
      {role === 'coach' && state === 'ready' && (
        <div className="calendar-lower-grid">
          <SessionTable title="MY SESSIONS" sessions={ownSessions} actionRole="coach" onChanged={() => setRefreshVersion((version) => version + 1)} />
          <SessionTable title="OTHER COACHES / BUSY" sessions={busySessions} />
        </div>
      )}
    </section>
  );
}

function SessionTable({ title, sessions, allSessions = sessions, actionRole, onChanged }: { title: string; sessions: Session[]; allSessions?: Session[]; actionRole?: 'participant' | 'coach'; onChanged?: () => void }) {
  return (
    <section className="data-panel">
      <h3>{title}</h3>
      {sessions.length === 0 ? <p className="muted">NONE RECORDED FOR THIS WEEK.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>SESSION</th><th>WHEN</th><th>ROOM</th><th>{actionRole === 'participant' ? 'FEE / PLACES' : 'STATUS'}</th>{actionRole && <th>ACTION</th>}</tr></thead>
            <tbody>{sessions.map((session) => (
              <tr key={session.id} className={session.visibility === 'busy' ? 'busy-row' : undefined}>
                <td><strong>{session.visibility === 'busy' ? 'OCCUPIED' : session.discipline}</strong><br /><span className="muted">#{session.id} · {session.session_type}</span></td>
                <td className="mono">{formatCentreDate(session.starts_at)}<br />{formatCentreTime(session.starts_at)}–{formatCentreTime(session.ends_at)}</td>
                <td>{session.room_name}</td>
                <td className="mono">{actionRole === 'participant' ? `${session.seat_fee_credits ?? 0} / ${session.places_remaining ?? 0}` : session.visibility === 'busy' ? 'OCCUPIED' : session.status.toUpperCase()}</td>
                {actionRole === 'participant' && <td><BookingActions session={session} sessions={allSessions} onChanged={onChanged ?? (() => undefined)} /></td>}
                {actionRole === 'coach' && <td><CoachSessionActions session={session} onChanged={onChanged ?? (() => undefined)} /><CoachSessionDetail sessionId={session.id} /></td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
