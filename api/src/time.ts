import { DateTime } from 'luxon';
import { SESSION_FEE_SCHEDULE } from './credits';

export const CENTRE_TIMEZONE = process.env.CENTRE_TIMEZONE || 'America/New_York';

export const BOOKING_NOTICE_MS = 48 * 60 * 60 * 1000;

export type LocalDayWindow = {
  localDate: string;
  from: string;
  to: string;
  hours: number;
};

function centreDateTime(value: Date | string): DateTime {
  const dateTime = value instanceof Date
    ? DateTime.fromJSDate(value, { zone: CENTRE_TIMEZONE })
    : DateTime.fromISO(value, { zone: CENTRE_TIMEZONE });
  if (!dateTime.isValid) throw new Error(`invalid centre-local date: ${value}`);
  return dateTime;
}

export function localDateForInstant(value: Date = new Date()): string {
  return centreDateTime(value).toISODate()!;
}

export function addLocalDays(localDate: string, days: number): string {
  const value = DateTime.fromISO(localDate, { zone: CENTRE_TIMEZONE }).startOf('day');
  if (!value.isValid || value.toISODate() !== localDate) throw new Error(`invalid local date: ${localDate}`);
  return value.plus({ days }).toISODate()!;
}

export function localDayWindow(localDate: string): LocalDayWindow {
  const start = DateTime.fromISO(localDate, { zone: CENTRE_TIMEZONE }).startOf('day');
  if (!start.isValid || start.toISODate() !== localDate) throw new Error(`invalid local date: ${localDate}`);
  const end = start.plus({ days: 1 });
  return {
    localDate,
    from: start.toUTC().toISO()!,
    to: end.toUTC().toISO()!,
    hours: end.diff(start, 'hours').hours
  };
}

export function formatCentreDateTime(value: Date | string): string {
  return centreDateTime(value).toFormat('ccc, LLL d, yyyy h:mm a');
}

export function formatCentreTime(value: Date | string): string {
  return centreDateTime(value).toFormat('h:mm a');
}

const DURATION_MINUTES: Record<string, number> = Object.fromEntries(
  Object.entries(SESSION_FEE_SCHEDULE).map(([sessionType, schedule]) => [sessionType, schedule.durationMinutes])
);

export type LocalSessionInput = {
  localDate: string;
  localStartTime: string;
  localEndTime: string;
  sessionType: string;
};

export type ParsedSessionWindow = {
  startsAt: string;
  endsAt: string;
};

function localDateTime(date: string, time: string): DateTime | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const value = DateTime.fromObject({
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2])
  }, { zone: CENTRE_TIMEZONE });

  if (!value.isValid || value.toFormat('yyyy-MM-dd HH:mm') !== `${date} ${time}`) return null;
  if (value.getPossibleOffsets().length !== 1) return null;
  return value;
}

export function parseLocalSessionWindow(
  input: LocalSessionInput,
  now: Date = new Date()
): ParsedSessionWindow | string {
  const starts = localDateTime(input.localDate, input.localStartTime);
  const ends = localDateTime(input.localDate, input.localEndTime);
  if (!starts || !ends) return 'session times must be valid, unambiguous centre-local times';

  const expectedMinutes = DURATION_MINUTES[input.sessionType];
  if (!expectedMinutes) return 'session type is invalid';
  if (ends.toMillis() <= starts.toMillis()) return 'end time must be after start time';
  if (ends.diff(starts, 'minutes').minutes !== expectedMinutes) {
    return `${input.sessionType} sessions must last ${expectedMinutes} minutes`;
  }
  if (starts.toMillis() < now.getTime() + BOOKING_NOTICE_MS) {
    return 'sessions must start at least 48 hours from now';
  }
  if (starts.weekday === 7 || ends.weekday === 7) return 'the centre is closed on Sundays';

  const opening = 7 * 60;
  const closing = 21 * 60;
  const startMinutes = starts.hour * 60 + starts.minute;
  const endMinutes = ends.hour * 60 + ends.minute;
  if (startMinutes < opening || endMinutes > closing) {
    return 'sessions must fit within 07:00-21:00 centre-local time';
  }

  return {
    startsAt: starts.toUTC().toISO()!,
    endsAt: ends.toUTC().toISO()!
  };
}

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
  if (starts.toMillis() < now.getTime() + BOOKING_NOTICE_MS) {
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
