'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson } from '../lib/api';
import { formatCentreDate, formatCentreTime, startOfCentreWeek, toApiIso } from '../lib/time';
import type { Role, Session } from '../lib/types';
import { sessionViewKind } from '../lib/session-view';
import { ScheduleGrid } from './ScheduleGrid';
import { BookingActions, CoachSessionActions, CoachSessionDetail } from './SessionActions';

export function CalendarView({ role }: { role: Role }) {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(() => startOfCentreWeek());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [showPublicSchedule, setShowPublicSchedule] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const to = weekStart.plus({ weeks: 1 });
    setState('loading');
    const catalogue = role !== 'admin' && showPublicSchedule ? '&catalogue=true' : '';
    fetchJson<Session[]>(`/api/sessions?from=${encodeURIComponent(toApiIso(weekStart))}&to=${encodeURIComponent(toApiIso(to))}${catalogue}`, { signal: controller.signal })
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
  }, [refreshVersion, role, showPublicSchedule, weekStart]);

  const personalSessions = sessions.filter((session) => {
    if (role === 'participant') return Boolean(session.my_enrolment);
    if (role === 'coach') return session.visibility !== 'busy' && Boolean(session.my_enrolment || session.is_own_session);
    return true;
  });
  const visibleSessions = role === 'admin' || showPublicSchedule ? sessions : personalSessions;
  const ownBookings = sessions.filter((session) => session.my_enrolment);
  const ownSessions = sessions.filter((session) => role === 'coach' && session.is_own_session);
  const joinedSessions = sessions.filter((session) => role === 'coach' && session.my_enrolment && !session.is_own_session);

  return (
    <section className="calendar-section" aria-labelledby="calendar-title">
      <div className="section-heading">
        <div>
          <h2 id="calendar-title">MASTER SCHEDULE</h2>
          <p className="muted">{role === 'admin' ? 'Complete centre schedule. All times are centre-local.' : showPublicSchedule ? 'Public availability and your sessions. All times are centre-local.' : 'Your bookings and sessions only. All times are centre-local.'}</p>
        </div>
        <div className="calendar-toolbar">
          {role !== 'admin' && <label className="calendar-toggle"><input type="checkbox" checked={showPublicSchedule} onChange={(event) => setShowPublicSchedule(event.target.checked)} /> <span>Show public schedule</span></label>}
          <div className="calendar-controls">
          <button type="button" onClick={() => setWeekStart(weekStart.minus({ weeks: 1 }))}>← PREVIOUS</button>
          <button type="button" onClick={() => setWeekStart(weekStart.plus({ weeks: 1 }))}>NEXT</button>
          </div>
        </div>
      </div>
      {state === 'loading' && <p className="state-line">LOADING CALENDAR...</p>}
      {state === 'error' && <p className="error-line">{error}</p>}
      {state === 'ready' && visibleSessions.length === 0 && <p className="empty-line">{showPublicSchedule ? 'NO SESSIONS IN THIS WEEK.' : 'NO PERSONAL SESSIONS IN THIS WEEK.'}</p>}
      {state === 'ready' && <ScheduleGrid sessions={visibleSessions} weekStart={weekStart} role={role} showCoach={role === 'admin'} onSelect={(session) => router.push(`/sessions/${session.id}`)} />}
      {role === 'participant' && state === 'ready' && (
        <div className="calendar-lower-grid">
          <SessionTable title="MY BOOKINGS" sessions={ownBookings} allSessions={sessions} actionRole="participant" onChanged={() => setRefreshVersion((version) => version + 1)} onOpen={(id) => router.push(`/sessions/${id}`)} />
          <SessionTable title="PUBLIC SCHEDULE" sessions={showPublicSchedule ? sessions : []} allSessions={sessions} actionRole="participant" onChanged={() => setRefreshVersion((version) => version + 1)} onOpen={(id) => router.push(`/sessions/${id}`)} />
        </div>
      )}
      {role === 'coach' && state === 'ready' && (
        <div className="calendar-lower-grid">
          <SessionTable title="MY SESSIONS" sessions={ownSessions} actionRole="coach" onChanged={() => setRefreshVersion((version) => version + 1)} onOpen={(id) => router.push(`/sessions/${id}`)} />
          <SessionTable title="SESSIONS I JOINED" sessions={joinedSessions} allSessions={sessions} actionRole="participant" onChanged={() => setRefreshVersion((version) => version + 1)} onOpen={(id) => router.push(`/sessions/${id}`)} />
        </div>
      )}
    </section>
  );
}

function SessionTable({ title, sessions, allSessions = sessions, actionRole, onChanged, onOpen }: { title: string; sessions: Session[]; allSessions?: Session[]; actionRole?: 'participant' | 'coach'; onChanged?: () => void; onOpen?: (sessionId: number) => void }) {
  return (
    <section className="data-panel">
      <h3>{title}</h3>
      {sessions.length === 0 ? <p className="muted">NONE RECORDED FOR THIS WEEK.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>SESSION</th><th>WHEN</th><th>ROOM</th><th>{actionRole === 'participant' ? 'FEE / PLACES' : 'STATUS'}</th>{actionRole && <th>ACTION</th>}</tr></thead>
            <tbody>{sessions.map((session) => (
               <tr key={session.id} className={`calendar-row calendar-row-${sessionViewKind(actionRole === 'coach' ? 'coach' : 'participant', session)}${onOpen ? ' clickable-row' : ''}`} onClick={onOpen ? () => onOpen(session.id) : undefined}>
                 <td><span className="session-kind-label">{session.visibility === 'busy' ? 'PUBLIC' : sessionViewKind(actionRole === 'coach' ? 'coach' : 'participant', session).toUpperCase()}</span><br /><strong>{session.visibility === 'busy' ? 'OCCUPIED' : session.discipline}</strong><br /><span className="muted">#{session.id} · {session.session_type}</span></td>
                <td className="mono">{formatCentreDate(session.starts_at)}<br />{formatCentreTime(session.starts_at)}–{formatCentreTime(session.ends_at)}</td>
                <td>{session.room_name}</td>
                <td className="mono">{actionRole === 'participant' ? `${session.seat_fee_credits ?? 0} / ${session.places_remaining ?? 0}` : session.visibility === 'busy' ? 'OCCUPIED' : session.status.toUpperCase()}</td>
                {actionRole === 'participant' && <td onClick={(event) => event.stopPropagation()}><BookingActions session={session} sessions={allSessions} onChanged={onChanged ?? (() => undefined)} /></td>}
                {actionRole === 'coach' && <td onClick={(event) => event.stopPropagation()}><CoachSessionActions session={session} onChanged={onChanged ?? (() => undefined)} /><CoachSessionDetail sessionId={session.id} /></td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
