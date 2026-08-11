'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson } from '../lib/api';
import { useCurrentUser } from './CurrentUserProvider';
import { DISCIPLINES } from '../../api/src/credits';
import type { Person, Room } from '../lib/types';

const sessionTypes = ['short', 'standard', 'intensive'];

export function CreateSessionForm() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [coaches, setCoaches] = useState<Person[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [discipline, setDiscipline] = useState<string>(DISCIPLINES[0]);
  const [sessionType, setSessionType] = useState(sessionTypes[1]);
  const [roomId, setRoomId] = useState('');
  const [coachId, setCoachId] = useState('');
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const peopleRequest = user?.kind === 'admin' ? fetchJson<Person[]>('/api/people?kind=coach', { signal: controller.signal }) : Promise.resolve([]);
    Promise.all([fetchJson<Room[]>('/api/rooms', { signal: controller.signal }), peopleRequest])
      .then(([loadedRooms, loadedCoaches]) => {
        setRooms(loadedRooms);
        setCoaches(loadedCoaches);
        setState('ready');
      })
      .catch((cause: Error) => {
        if (controller.signal.aborted) return;
        setError(cause.message);
        setState('error');
      });
    return () => controller.abort();
  }, [user?.kind]);

  useEffect(() => () => requestRef.current?.abort(), []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setError('');
    setMessage('');
    const controller = new AbortController();
    requestRef.current = controller;
    const body: Record<string, unknown> = {
      room_id: Number(roomId),
      discipline,
      session_type: sessionType,
      local_date: date,
      local_start_time: startTime,
      local_end_time: endTime
    };
    if (user.kind === 'admin') body.coach_id = Number(coachId);
    try {
      await fetchJson('/api/sessions', { method: 'POST', signal: controller.signal, body: JSON.stringify(body) });
      setMessage('SESSION CREATED.');
      window.setTimeout(() => router.push(user.kind === 'admin' ? '/admin/sessions' : '/coach'), 300);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Could not create the session');
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  return (
    <section className="form-panel" aria-labelledby="create-session-title">
      <p className="eyebrow">SCHEDULE A ROOM</p>
      <h2 id="create-session-title">Create a session</h2>
      <p className="muted">All times are centre-local. The API validates the 48-hour deadline, opening hours, duration, conflicts, capacity, and credits.</p>
      {state === 'loading' && <p className="state-line">LOADING ROOMS...</p>}
      {state === 'error' && <p className="error-line">{error}</p>}
      {state === 'ready' && (
        <form onSubmit={onSubmit} className="form-grid">
          <label><span>Date</span><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label><span>Starts</span><input required type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
          <label><span>Ends</span><input required type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
          <label><span>Discipline</span><select required value={discipline} onChange={(event) => setDiscipline(event.target.value)}>{DISCIPLINES.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Type</span><select value={sessionType} onChange={(event) => setSessionType(event.target.value)}>{sessionTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Room</span><select required value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">Select room</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name} / {room.capacity}</option>)}</select></label>
          {user?.kind === 'admin' && <label><span>Coach</span><select required value={coachId} onChange={(event) => setCoachId(event.target.value)}><option value="">Select coach</option>{coaches.map((coach) => <option key={coach.id} value={coach.id}>{coach.full_name}</option>)}</select></label>}
          <div className="form-actions"><button type="submit">CREATE SESSION</button></div>
        </form>
      )}
      {error && state === 'ready' && <p className="error-line" role="alert">{error}</p>}
      {message && <p className="success-line" role="status">{message}</p>}
    </section>
  );
}
