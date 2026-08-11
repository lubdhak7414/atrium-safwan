import { DateTime } from 'luxon';

export const CENTRE_TIMEZONE = process.env.CENTRE_TIMEZONE || 'America/New_York';

const DURATION_MINUTES: Record<string, number> = {
  short: 45,
  standard: 60,
  intensive: 210
};

export function validateSessionWindow(
  startsAt: string,
  endsAt: string,
  sessionType: string,
  now: Date = new Date()
): string | null {
  const starts = DateTime.fromISO(startsAt, { setZone: true });
  const ends = DateTime.fromISO(endsAt, { setZone: true });
  if (!starts.isValid || !ends.isValid) return 'session times must be valid instants';
  if (ends.toMillis() <= starts.toMillis()) return 'ends_at must be after starts_at';

  const expectedMinutes = DURATION_MINUTES[sessionType];
  if (!expectedMinutes || ends.diff(starts, 'minutes').minutes !== expectedMinutes) {
    return `${sessionType} sessions must last ${expectedMinutes ?? 'the configured'} minutes`;
  }
  if (starts.toMillis() < now.getTime() + 48 * 60 * 60 * 1000) {
    return 'sessions must start at least 48 hours from now';
  }

  const localStart = starts.setZone(CENTRE_TIMEZONE);
  const localEnd = ends.setZone(CENTRE_TIMEZONE);
  if (localStart.toISODate() !== localEnd.toISODate()) {
    return 'sessions must start and end on the same centre-local day';
  }
  if (localStart.weekday === 7 || localEnd.weekday === 7) {
    return 'the centre is closed on Sundays';
  }

  const openingMinutes = 7 * 60;
  const closingMinutes = 21 * 60;
  const startMinutes = localStart.hour * 60 + localStart.minute + localStart.second / 60;
  const endMinutes = localEnd.hour * 60 + localEnd.minute + localEnd.second / 60;
  if (startMinutes < openingMinutes || endMinutes > closingMinutes) {
    return 'sessions must fit within 07:00-21:00 centre-local time';
  }
  return null;
}
