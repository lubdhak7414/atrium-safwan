import { formatCentreDate, formatCentreTime, inCentreTimezone } from '../lib/time';
import type { Session } from '../lib/types';
import { StatusMark } from './StatusMark';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hours = Array.from({ length: 14 }, (_, index) => index + 7);

export function ScheduleGrid({ sessions, weekStart, showCoach = false }: { sessions: Session[]; weekStart: ReturnType<typeof inCentreTimezone>; showCoach?: boolean }) {
  function sessionsFor(dayIndex: number, hour: number) {
    return sessions.filter((session) => {
      const start = inCentreTimezone(session.starts_at);
      return start.weekday === dayIndex + 1 && start.hasSame(weekStart.plus({ days: dayIndex }), 'day') && start.hour === hour;
    });
  }

  return (
    <div className="table-scroll">
      <table className="schedule-table">
        <caption className="sr-only">Weekly session calendar for the centre timezone</caption>
        <thead>
          <tr>
            <th className="time-column">CENTRE TIME</th>
            {days.map((day, index) => <th key={day} className={index === 6 ? 'schedule-sunday' : undefined}>{day}</th>)}
          </tr>
        </thead>
        <tbody>
          {hours.map((hour) => (
            <tr key={hour}>
              <th className="time-column mono">{String(hour).padStart(2, '0')}:00</th>
              {days.map((day, index) => {
                const entries = sessionsFor(index, hour);
                return (
                  <td key={day} className={index === 6 ? 'schedule-sunday' : undefined}>
                    {index === 6 ? <span className="closed-label">CLOSED</span> : entries.map((session) => {
                      const busy = session.visibility === 'busy';
                      return (
                        <article className={`schedule-entry ${busy ? 'schedule-entry-busy' : ''}`} key={session.id}>
                          <StatusMark status={busy ? 'busy' : session.status === 'completed' ? 'completed' : 'scheduled'} />
                          <strong>{busy ? 'OCCUPIED' : session.discipline}</strong>
                          <span className="mono">{formatCentreTime(session.starts_at)}–{formatCentreTime(session.ends_at)}</span>
                          <span>{session.room_name}</span>
                          {showCoach && session.coach_name && <span>{session.coach_name}</span>}
                          {!busy && session.places_remaining !== undefined && <span className="mono">{session.places_remaining} PLACES</span>}
                        </article>
                      );
                    })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="table-note mono">WEEK OF {formatCentreDate(weekStart.toUTC().toISO()!)}, CENTRE TIMEZONE</p>
    </div>
  );
}
