'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson } from '../lib/api';
import { useCurrentUser } from './CurrentUserProvider';
import { nowInCentre } from '../lib/time';
import { DISCIPLINES, SESSION_FEE_SCHEDULE } from '../../api/src/credits';
import type { Person, Room } from '../lib/types';

const sessionTypes = ['short', 'standard', 'intensive'] as const;
const OPEN_MINUTES = 7 * 60;
const CLOSE_MINUTES = 21 * 60;
const SLOT_STEP = 15;

function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour}:${String(minutes).padStart(2, '0')} ${period}`;
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekday = weekdays[new Date(year, month - 1, day).getDay()];
  return `${weekday}, ${months[month - 1]} ${day}, ${year}`;
}

function addMinutesToTime(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number);
  const total = hours * 60 + mins + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function timeSlots(openMinutes: number, closeMinutes: number, step: number): string[] {
  const slots: string[] = [];
  for (let minutes = openMinutes; minutes <= closeMinutes; minutes += step) {
    slots.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  return slots;
}

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
  const [discipline, setDiscipline] = useState<string>(DISCIPLINES[0]);
  const [sessionType, setSessionType] = useState<string>(sessionTypes[1]);
  const [roomId, setRoomId] = useState('');
  const [coachId, setCoachId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const creatingRef = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const schedule = SESSION_FEE_SCHEDULE[sessionType as keyof typeof SESSION_FEE_SCHEDULE];
  const durationMinutes = schedule.durationMinutes;
  const startSlots = timeSlots(OPEN_MINUTES, CLOSE_MINUTES - durationMinutes, SLOT_STEP);
  const endTime = startTime ? addMinutesToTime(startTime, durationMinutes) : '';
  const room = rooms.find((candidate) => candidate.id === Number(roomId));
  const coach = coaches.find((candidate) => candidate.id === Number(coachId));

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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeConfirm();
        return;
      }
      if (event.key === 'Tab') {
        const modal = modalRef.current;
        if (!modal) return;
        const focusables = Array.from(modal.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )).filter((element) => !element.hasAttribute('disabled'));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    if (confirmOpen) {
      window.addEventListener('keydown', onKeyDown);
      confirmButtonRef.current?.focus();
    }
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmOpen]);

  function closeConfirm() {
    if (creatingRef.current) return;
    setConfirmOpen(false);
    requestAnimationFrame(() => reviewButtonRef.current?.focus());
  }

  function changeSessionType(value: string) {
    setSessionType(value);
    const minutes = SESSION_FEE_SCHEDULE[value as keyof typeof SESSION_FEE_SCHEDULE].durationMinutes;
    const slots = timeSlots(OPEN_MINUTES, CLOSE_MINUTES - minutes, SLOT_STEP);
    if (startTime && !slots.includes(startTime)) setStartTime('');
  }

  function buildBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      room_id: Number(roomId),
      discipline,
      session_type: sessionType,
      local_date: date,
      local_start_time: startTime,
      local_end_time: endTime
    };
    if (user?.kind === 'admin') body.coach_id = Number(coachId);
    return body;
  }

  function onReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canReview) return;
    setError('');
    setMessage('');
    setConfirmOpen(true);
  }

  async function confirmCreate() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      await fetchJson('/api/sessions', { method: 'POST', signal: controller.signal, body: JSON.stringify(buildBody()) });
      setConfirmOpen(false);
      setMessage('SESSION CREATED.');
      window.setTimeout(() => router.push(user?.kind === 'admin' ? '/admin/sessions' : '/coach'), 300);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Could not create the session');
      setConfirmOpen(false);
      requestAnimationFrame(() => reviewButtonRef.current?.focus());
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      creatingRef.current = false;
      setCreating(false);
    }
  }

  const canReview = Boolean(user && date && startTime && roomId && (user.kind !== 'admin' || coachId));

  return (
    <section className="form-panel" aria-labelledby="create-session-title">
      <p className="eyebrow">SCHEDULE A ROOM</p>
      <h1 id="create-session-title">Create a session</h1>
      <p className="muted">All times are centre-local. Pick a start slot and the end time is set for you by the session type. The API validates the 48-hour deadline, opening hours, conflicts, capacity, and credits.</p>
      {state === 'loading' && <p className="state-line">LOADING ROOMS...</p>}
      {state === 'error' && <p className="error-line">{error}</p>}
      {state === 'ready' && (
        <form onSubmit={onReview} className="form-grid">
          <label><span>Date</span><input required type="date" min={nowInCentre().toISODate() ?? undefined} value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label><span>Starts</span>
            <select required value={startTime} onChange={(event) => setStartTime(event.target.value)}>
              <option value="">Select start</option>
              {startSlots.map((slot) => <option key={slot} value={slot}>{formatTime(slot)}</option>)}
            </select>
          </label>
          <label><span>Ends (auto)</span>
            <output className="form-readonly" aria-label="End time (derived)">{startTime ? formatTime(endTime) : '—'}</output>
          </label>
          <label><span>Discipline</span><select required value={discipline} onChange={(event) => setDiscipline(event.target.value)}>{DISCIPLINES.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Type</span>
            <select value={sessionType} onChange={(event) => changeSessionType(event.target.value)}>
              {sessionTypes.map((value) => <option key={value} value={value}>{value} · {SESSION_FEE_SCHEDULE[value].durationMinutes} min</option>)}
            </select>
          </label>
          <label><span>Room</span><select required value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">Select room</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name} / {room.capacity}</option>)}</select></label>
          {user?.kind === 'admin' && <label><span>Coach</span><select required value={coachId} onChange={(event) => setCoachId(event.target.value)}><option value="">Select coach</option>{coaches.map((coach) => <option key={coach.id} value={coach.id}>{coach.full_name}</option>)}</select></label>}
          <div className="form-actions">
            <p className="muted mono session-fee-note">Room fee {schedule.room} credits · seat {schedule.seat} credits · {durationMinutes} min</p>
            <button type="submit" ref={reviewButtonRef} disabled={!canReview}>REVIEW &amp; CREATE</button>
          </div>
        </form>
      )}
      {error && state === 'ready' && <p className="error-line" role="alert">{error}</p>}
      {message && <p className="success-line" role="status">{message}</p>}

      {confirmOpen && (
        <div className="modal-backdrop" role="presentation" onClick={closeConfirm}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-session-title" ref={modalRef} onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">CONFIRM SESSION</p>
            <h2 id="confirm-session-title">Review before scheduling</h2>
            <dl className="confirm-list">
              <div><dt>Date</dt><dd>{formatDate(date)}</dd></div>
              <div><dt>Time</dt><dd>{formatTime(startTime)}–{formatTime(endTime)}</dd></div>
              <div><dt>Duration</dt><dd>{durationMinutes} min</dd></div>
              <div><dt>Discipline</dt><dd>{discipline}</dd></div>
              <div><dt>Type</dt><dd>{sessionType}</dd></div>
              <div><dt>Room</dt><dd>{room ? `${room.name} · capacity ${room.capacity}` : '—'}</dd></div>
              {user?.kind === 'admin' && <div><dt>Coach</dt><dd>{coach ? coach.full_name : '—'}</dd></div>}
              <div><dt>Room fee</dt><dd>{schedule.room} credits</dd></div>
            </dl>
            <p className="muted">The centre enforces the 48-hour booking deadline, opening hours, conflicts and capacity. Confirm to schedule.</p>
            <div className="modal-actions">
              <button type="button" className="secondary-button" disabled={creating} onClick={closeConfirm}>BACK</button>
              <button type="button" ref={confirmButtonRef} disabled={creating} onClick={() => void confirmCreate()}>{creating ? 'CREATING...' : 'CONFIRM & CREATE'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
