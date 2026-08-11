import {
  formatCentreDate,
  formatCentreTime,
  nowInCentre,
  toApiIso
} from '../lib/time';

export const dynamic = 'force-dynamic';

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

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:4000';

export default async function PublicSessions() {
  const from = nowInCentre();
  const to = from.plus({ days: 14 });

  const res = await fetch(
    `${apiBaseUrl}/api/sessions?from=${toApiIso(from)}&to=${toApiIso(to)}`,
    { cache: 'no-store' }
  );
  const sessions: Session[] = await res.json();

  return (
    <main>
      <h1>Upcoming sessions</h1>
      <table>
        <thead>
          <tr>
            <th>Discipline</th>
            <th>Date</th>
            <th>Time</th>
            <th>Room</th>
            <th>Places remaining</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id}>
              <td>{session.discipline}</td>
              <td>{formatCentreDate(session.starts_at)}</td>
              <td>
                {formatCentreTime(session.starts_at)}
                {' – '}
                {formatCentreTime(session.ends_at)}
              </td>
              <td>{session.room_name}</td>
              <td>{session.places_remaining}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
