import { DateTime } from 'luxon';

export const CENTRE_TIMEZONE =
  process.env.NEXT_PUBLIC_CENTRE_TIMEZONE ||
  process.env.CENTRE_TIMEZONE ||
  'America/New_York';

export function nowInCentre() {
  return DateTime.now().setZone(CENTRE_TIMEZONE);
}

export function startOfCentreWeek(value = nowInCentre()) {
  const day = value.setZone(CENTRE_TIMEZONE).startOf('day');
  return day.minus({ days: day.weekday - 1 });
}

export function toApiIso(value: DateTime) {
  return value.toUTC().toISO()!;
}

export function inCentreTimezone(iso: string) {
  return DateTime.fromISO(iso, { setZone: true }).setZone(CENTRE_TIMEZONE);
}

export function formatCentreDate(iso: string) {
  return inCentreTimezone(iso).toFormat('M/d/yyyy');
}

export function formatCentreShortDate(iso: string) {
  return inCentreTimezone(iso).toFormat('MMM d');
}

export function formatCentreTime(iso: string) {
  return inCentreTimezone(iso).toFormat('h:mm a');
}
