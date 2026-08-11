'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '../lib/api';
import type { Room, Session } from '../lib/types';

export function BookingActions({ session, sessions, onChanged }: { session: Session; sessions: Session[]; onChanged: () => void }) {
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alternatives = sessions.filter((candidate) => candidate.id !== session.id && (candidate.places_remaining ?? 0) > 0);

  async function run(path: string) {
    setBusy(true);
    setError('');
    try {
      await fetchJson(path, { method: 'POST', body: JSON.stringify({}) });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Booking action failed');
    } finally {
      setBusy(false);
    }
  }

  async function change() {
    if (!session.my_enrolment || !destination) return;
    setBusy(true);
    setError('');
    try {
      await fetchJson(`/api/enrolments/${session.my_enrolment.id}/change`, { method: 'POST', body: JSON.stringify({ destination_session_id: Number(destination) }) });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change this booking');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row-actions">
      {session.my_enrolment ? <>
        <button type="button" disabled={busy} onClick={() => void run(`/api/enrolments/${session.my_enrolment!.id}/cancel`)}>CANCEL</button>
        {alternatives.length > 0 && <><select aria-label={`Move booking ${session.id}`} value={destination} onChange={(event) => setDestination(event.target.value)}><option value="">Move to...</option>{alternatives.map((candidate) => <option key={candidate.id} value={candidate.id}>#{candidate.id} {candidate.discipline}</option>)}</select><button type="button" disabled={busy || !destination} onClick={() => void change()}>MOVE</button></>}
      </> : <button type="button" disabled={busy || (session.places_remaining ?? 0) <= 0} onClick={() => void run(`/api/sessions/${session.id}/enrol`)}>{(session.places_remaining ?? 0) <= 0 ? 'FULL' : 'BOOK'}</button>}
      {error && <span className="action-error" role="alert">{error}</span>}
    </div>
  );
}

export function CoachSessionActions({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const [showReschedule, setShowReschedule] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState(String(session.room_id));
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!showReschedule || rooms.length > 0) return;
    fetchJson<Room[]>('/api/rooms').then(setRooms).catch((cause: Error) => setError(cause.message));
  }, [rooms.length, showReschedule]);

  async function request(path: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setError('');
    try {
      await fetchJson(path, { method: 'POST', body: JSON.stringify(body) });
      onChanged();
      setShowReschedule(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Session action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row-actions">
      <button type="button" disabled={busy} onClick={() => void request(`/api/sessions/${session.id}/cancel`)}>CANCEL SESSION</button>
      <button type="button" disabled={busy} onClick={() => void request(`/api/sessions/${session.id}/complete`)}>COMPLETE</button>
      <button type="button" disabled={busy} onClick={() => setShowReschedule((value) => !value)}>RESCHEDULE</button>
      {showReschedule && <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void request(`/api/sessions/${session.id}/reschedule`, { room_id: Number(roomId), local_date: date, local_start_time: startTime, local_end_time: endTime }); }}><select required value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">Room</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /><input required type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /><input required type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /><button type="submit" disabled={busy}>SAVE</button></form>}
      {error && <span className="action-error" role="alert">{error}</span>}
    </div>
  );
}

export function CoachSessionDetail({ sessionId }: { sessionId: number }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<{ attendees?: Array<{ id: number; full_name: string; status: string; check_in_count: number }> } | null>(null);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<number | null>(null);

  async function load() {
    try {
      setDetail(await fetchJson(`/api/sessions/${sessionId}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load attendees');
    }
  }

  async function checkIn(enrolmentId: number) {
    setActionId(enrolmentId);
    setError('');
    try {
      await fetchJson(`/api/sessions/${sessionId}/check-ins`, { method: 'POST', body: JSON.stringify({ enrolment_id: enrolmentId }) });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not check in attendee');
    } finally {
      setActionId(null);
    }
  }

  return (
    <section className="detail-toggle">
      <button type="button" onClick={() => { setOpen((value) => !value); if (!open) void load(); }}>{open ? 'HIDE ATTENDEES' : 'ATTENDEES'}</button>
      {open && <div className="detail-panel">{error && <p className="error-line">{error}</p>}{!detail && !error && <p className="state-line">LOADING ATTENDEES...</p>}{detail?.attendees?.length === 0 && <p className="empty-line">NO ATTENDEES.</p>}{detail?.attendees && detail.attendees.length > 0 && <div className="table-scroll"><table><thead><tr><th>ATTENDEE</th><th>STATUS</th><th>CHECK-INS</th><th>ACTION</th></tr></thead><tbody>{detail.attendees.map((attendee) => <tr key={attendee.id}><td>{attendee.full_name}</td><td>{attendee.status}</td><td className="mono">{attendee.check_in_count}</td><td><button type="button" disabled={attendee.status !== 'active' || actionId === attendee.id} onClick={() => void checkIn(attendee.id)}>CHECK IN</button></td></tr>)}</tbody></table></div>}</div>}
    </section>
  );
}
