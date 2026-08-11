'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../lib/api';
import { formatCentreDate, formatCentreTime, inCentreTimezone } from '../lib/time';
import type { Session } from '../lib/types';
import { useCurrentUser } from './CurrentUserProvider';

type BookingRole = 'participant' | 'coach';

export function SessionCatalogue({
  initialSessions = [],
  sourcePath,
  title = 'SESSION CATALOGUE',
  bookingRole,
  promotedOnly = false,
  showHeader = true,
  onOpen
}: {
  initialSessions?: Session[];
  sourcePath?: string;
  title?: string;
  bookingRole?: BookingRole;
  promotedOnly?: boolean;
  showHeader?: boolean;
  onOpen?: (sessionId: number) => void;
}) {
  const { user } = useCurrentUser();
  const effectiveBookingRole = bookingRole ?? (user?.kind === 'participant' || user?.kind === 'coach' ? user.kind : undefined);
  const [sessions, setSessions] = useState(initialSessions);
  const [state, setState] = useState<'ready' | 'loading' | 'error'>(sourcePath ? 'loading' : 'ready');
  const [error, setError] = useState('');
  const [discipline, setDiscipline] = useState('all');
  const [sessionType, setSessionType] = useState('all');
  const [date, setDate] = useState('');
  const [bookingState, setBookingState] = useState<'all' | 'booked' | 'unbooked'>('all');
  const [actionId, setActionId] = useState<number | null>(null);

  async function load() {
    if (!sourcePath) return;
    setState('loading');
    try {
      setSessions(await fetchJson<Session[]>(sourcePath));
      setState('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load sessions');
      setState('error');
    }
  }

  useEffect(() => { void load(); }, [sourcePath]);

  const filtered = useMemo(() => sessions.filter((session) => {
    const localDate = inCentreTimezone(session.starts_at).toISODate();
    return (discipline === 'all' || session.discipline === discipline)
      && (sessionType === 'all' || session.session_type === sessionType)
      && (!date || localDate === date)
      && (!effectiveBookingRole || bookingState === 'all' || (bookingState === 'booked' ? Boolean(session.my_enrolment) : !session.my_enrolment));
  }), [bookingState, date, discipline, effectiveBookingRole, sessionType, sessions]);

  const disciplines = [...new Set(sessions.map((session) => session.discipline))].sort();

  async function enrol(session: Session) {
    setActionId(session.id);
    setError('');
    try {
      await fetchJson(`/api/sessions/${session.id}/enrol`, { method: 'POST', body: JSON.stringify({}) });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not book this session');
    } finally {
      setActionId(null);
    }
  }

  async function cancel(session: Session) {
    if (!session.my_enrolment) return;
    setActionId(session.id);
    setError('');
    try {
      await fetchJson(`/api/enrolments/${session.my_enrolment.id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not cancel this booking');
    } finally {
      setActionId(null);
    }
  }

  return (
    <section className="data-panel" aria-labelledby={showHeader ? `${title.toLowerCase().replaceAll(' ', '-')}-title` : undefined} aria-label={!showHeader ? title : undefined}>
      {showHeader && <div className="section-heading"><div><h2 id={`${title.toLowerCase().replaceAll(' ', '-')}-title`}>{title}</h2><p className="muted">{filtered.length} of {sessions.length} sessions shown.</p></div></div>}
      <div className="filter-bar" aria-label="Catalogue filters">
        <label><span>Discipline</span><select value={discipline} onChange={(event) => setDiscipline(event.target.value)}><option value="all">All disciplines</option>{disciplines.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label><span>Type</span><select value={sessionType} onChange={(event) => setSessionType(event.target.value)}><option value="all">All types</option><option value="short">Short</option><option value="standard">Standard</option><option value="intensive">Intensive</option></select></label>
         <label><span>Centre date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
         {bookingRole && <label><span>Booking</span><select value={bookingState} onChange={(event) => setBookingState(event.target.value as 'all' | 'booked' | 'unbooked')}><option value="all">All sessions</option><option value="booked">Booked by me</option><option value="unbooked">Not booked by me</option></select></label>}
         <button type="button" className="filter-reset" onClick={() => { setDiscipline('all'); setSessionType('all'); setDate(''); setBookingState('all'); }}>CLEAR</button>
      </div>
      {state === 'loading' && <p className="state-line">LOADING SESSIONS...</p>}
      {state === 'error' && <p className="error-line">{error}</p>}
      {state === 'ready' && error && <p className="error-line" role="alert">{error}</p>}
      {state === 'ready' && filtered.length === 0 && <p className="empty-line">NO SESSIONS MATCH THESE FILTERS.</p>}
      {state === 'ready' && filtered.length > 0 && (
        <div className="table-scroll">
           <table>
             <thead><tr><th>ID / DISCIPLINE</th><th>TYPE</th><th>WHEN</th><th>ROOM</th><th>SEAT FEE</th><th>PLACES</th>{effectiveBookingRole && <th>ACTION</th>}</tr></thead>
            <tbody>{filtered.map((session) => {
              const booked = Boolean(session.my_enrolment);
              const full = (session.places_remaining ?? 0) <= 0;
              return (
                <tr key={session.id} className={onOpen ? 'clickable-row' : undefined} onClick={onOpen ? () => onOpen(session.id) : undefined}>
                  <td><strong>{session.discipline}</strong><br /><span className="muted mono">#{session.id}</span></td>
                  <td className="mono">{session.session_type.toUpperCase()}</td>
                  <td className="mono">{formatCentreDate(session.starts_at)}<br />{formatCentreTime(session.starts_at)}–{formatCentreTime(session.ends_at)}</td>
                  <td>{session.room_name}</td>
                  <td className="mono">{session.seat_fee_credits ?? 0}</td>
                  <td className="mono">{session.places_remaining ?? 0}</td>
                  {bookingRole && <td onClick={(event) => event.stopPropagation()}>{booked ? <button type="button" disabled={actionId === session.id} onClick={() => void cancel(session)}>CANCEL BOOKING</button> : <button type="button" disabled={full || actionId === session.id} onClick={() => void enrol(session)}>{full ? 'FULL' : 'BOOK SESSION'}</button>}</td>}
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        )}
      </section>
  );
}
