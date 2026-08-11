'use client';

import { useEffect, useState } from 'react';
import { startOfCentreWeek, toApiIso } from '../../lib/time';

type Room = { id: number; name: string; capacity: number };
type Person = { id: number; full_name: string; email: string; kind: string };
type Session = { id: number; starts_at: string; ends_at: string };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function AdminDashboard() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    const from = startOfCentreWeek();
    const to = from.plus({ weeks: 1 });

    fetch(`${apiBaseUrl}/api/rooms`, { credentials: 'include' })
      .then((res) => res.json())
      .then(setRooms);

    fetch(`${apiBaseUrl}/api/people`, { credentials: 'include' })
      .then((res) => res.json())
      .then(setPeople);

    fetch(
      `${apiBaseUrl}/api/sessions?from=${toApiIso(from)}&to=${toApiIso(to)}`,
      { credentials: 'include' }
    )
      .then((res) => res.json())
      .then(setSessions);
  }, []);

  return (
    <main>
      <h1>Dashboard</h1>
      <table className="counts">
        <thead>
          <tr>
            <th>Rooms</th>
            <th>Sessions this week</th>
            <th>People</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{rooms.length}</td>
            <td>{sessions.length}</td>
            <td>{people.length}</td>
          </tr>
        </tbody>
      </table>
      <p>
        <a href="/admin/sessions">Session calendar</a>
      </p>
    </main>
  );
}
