import { formatCentreDate, formatCentreTime, inCentreTimezone } from '../lib/time';
import type { Role, Session } from '../lib/types';
import { sessionViewKind } from '../lib/session-view';
import { StatusMark } from './StatusMark';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hours = Array.from({ length: 14 }, (_, index) => index + 7);

export function ScheduleGrid({ sessions, weekStart, role, showCoach = false, onSelect }: { sessions: Session[]; weekStart: ReturnType<typeof inCentreTimezone>; role: Role; showCoach?: boolean; onSelect?: (session: Session) => void }) {
  function sessionsFor(dayIndex: number, hour: number) {
    return sessions.filter((session) => {
      const start = inCentreTimezone(session.starts_at);
      return start.weekday === dayIndex + 1 && start.hasSame(weekStart.plus({ days: dayIndex }), 'day') && start.hour === hour;
    });
  }

  return (
    <div className="table-scroll">
      <p className="table-note mono">WEEK OF {formatCentreDate(weekStart.toUTC().toISO()!)}, CENTRE TIMEZONE</p>
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
                      const kind = busy ? 'public' : sessionViewKind(role, session);
                      return (
                          <button type="button" className={`schedule-entry schedule-entry-${kind} ${busy ? 'schedule-entry-busy' : ''}`} key={session.id} onClick={() => onSelect?.(session)} disabled={!onSelect} aria-label={`Open ${busy ? 'public session' : session.discipline} at ${formatCentreTime(session.starts_at)}`}>
                          <StatusMark status={busy ? 'busy' : session.status === 'completed' ? 'completed' : 'scheduled'} />
                          <span className="schedule-kind">{kind.toUpperCase()}</span>
                          <strong>{busy ? 'OCCUPIED' : session.discipline}</strong>
                          <span className="mono">{formatCentreTime(session.starts_at)}–{formatCentreTime(session.ends_at)}</span>
                          <span>{session.room_name}</span>
                          {showCoach && session.coach_name && <span>{session.coach_name}</span>}
                          {!busy && session.places_remaining !== undefined && <span className="mono">{session.places_remaining} PLACES</span>}
                          </button>
                      );
                    })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
