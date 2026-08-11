'use client';

import { useEffect, useState } from 'react';
import {
  inCentreTimezone,
  startOfCentreWeek,
  toApiIso
} from '../../../lib/time';

type Room = { id: number; name: string; capacity: number };
type Person = { id: number; full_name: string; email: string; kind: string };
type Session = {
  id: number;
  discipline: string;
  session_type: string;
  status: string;
  starts_at: string;
  ends_at: string;
  room_name: string;
  room_capacity: number;
  coach_name: string;
  enrolled_count: number;
  places_remaining: number;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

const dayNames = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];

const disciplines = [
  'fitness',
  'lifestyle',
  'financial',
  'nutrition',
  'career',
  'mindfulness'
];

const sessionTypes = ['short', 'standard', 'intensive'];

const hours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

export default function AdminSessions() {
  const [weekStart, setWeekStart] = useState(() => startOfCentreWeek());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [discipline, setDiscipline] = useState(disciplines[0]);
  const [sessionType, setSessionType] = useState(sessionTypes[1]);
  const [roomId, setRoomId] = useState('');
  const [coachId, setCoachId] = useState('');

  const days = [0, 1, 2, 3, 4, 5, 6].map(
    (offset) => weekStart.plus({ days: offset })
  );

  function loadSessions() {
    const to = weekStart.plus({ weeks: 1 });

    fetch(
      `${apiBaseUrl}/api/sessions?from=${toApiIso(weekStart)}&to=${toApiIso(to)}`,
      { credentials: 'include' }
    )
      .then((res) => res.json())
      .then(setSessions);
  }

  useEffect(() => {
    loadSessions();
  }, [weekStart]);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/rooms`, { credentials: 'include' })
      .then((res) => res.json())
      .then(setRooms);

    fetch(`${apiBaseUrl}/api/people`, { credentials: 'include' })
      .then((res) => res.json())
      .then(setPeople);
  }, []);

  function sessionsFor(day: (typeof days)[number], hour: number) {
    return sessions.filter((session) => {
      const starts = inCentreTimezone(session.starts_at);
      return starts.hasSame(day, 'day') && starts.hour === hour;
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await fetch(`${apiBaseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        room_id: Number(roomId),
        coach_id: Number(coachId),
        discipline,
        session_type: sessionType,
        local_date: date,
        local_start_time: startTime,
        local_end_time: endTime
      })
    });

    loadSessions();
  }

  return (
    <main>
      <h1>Session calendar</h1>

      <p>
        <button onClick={() => setWeekStart(weekStart.minus({ weeks: 1 }))}>
          Previous week
        </button>{' '}
        <button onClick={() => setWeekStart(weekStart.plus({ weeks: 1 }))}>
          Next week
        </button>
      </p>

      <table className="calendar">
        <thead>
          <tr>
            <th className="hour"></th>
            {days.map((day, index) => (
              <th key={index}>
                {dayNames[index]} {day.day}/{day.month}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hours.map((hour) => (
            <tr key={hour}>
              <th className="hour">{hour}:00</th>
              {days.map((day, index) => (
                <td key={index}>
                  {sessionsFor(day, hour).map((session) => (
                    <div className="entry" key={session.id}>
                      {session.discipline} — {session.room_name} ({session.enrolled_count}/
                      {session.room_capacity})
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Create a session</h2>
      <form onSubmit={onSubmit}>
        <label>
          <span>Date</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          <span>Starts</span>
          <input
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </label>
        <label>
          <span>Ends</span>
          <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        </label>
        <label>
          <span>Discipline</span>
          <select value={discipline} onChange={(event) => setDiscipline(event.target.value)}>
            {disciplines.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Type</span>
          <select value={sessionType} onChange={(event) => setSessionType(event.target.value)}>
            {sessionTypes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Room</span>
          <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
            <option value=""></option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Coach</span>
          <select value={coachId} onChange={(event) => setCoachId(event.target.value)}>
            <option value=""></option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Create</button>
      </form>
    </main>
  );
}
