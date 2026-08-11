export const SESSION_FEE_SCHEDULE = {
  short: { room: 30, seat: 15, durationMinutes: 45 },
  standard: { room: 40, seat: 20, durationMinutes: 60 },
  intensive: { room: 120, seat: 60, durationMinutes: 210 }
} as const;

export const COACH_REFUND_TIERS = [
  { minimumHours: 96, percent: 1 },
  { minimumHours: 48, percent: 0.5 },
  { minimumHours: 24, percent: 0.25 },
  { minimumHours: 0, percent: 0 }
] as const;

export const PARTICIPANT_REFUND_TIERS = [
  { minimumHours: 24, percent: 1 },
  { minimumHours: 12, percent: 0.5 },
  { minimumHours: 0, percent: 0 }
] as const;

export const INITIAL_CREDITS = {
  participant: 4000,
  coach: 2000,
  admin: 0
} as const;

export function roomFee(sessionType: string): number {
  return SESSION_FEE_SCHEDULE[sessionType as keyof typeof SESSION_FEE_SCHEDULE]?.room || 0;
}

export function seatFee(sessionType: string): number {
  return SESSION_FEE_SCHEDULE[sessionType as keyof typeof SESSION_FEE_SCHEDULE]?.seat || 0;
}

export function hoursOfNotice(cancelledAt: Date, startsAt: Date): number {
  return Math.max(0, startsAt.getTime() - cancelledAt.getTime()) / (1000 * 60 * 60);
}

export function refundPercent(hoursNotice: number): number {
  return COACH_REFUND_TIERS.find((tier) => hoursNotice >= tier.minimumHours)?.percent ?? 0;
}

export function participantRefundPercent(hoursNotice: number): number {
  return PARTICIPANT_REFUND_TIERS.find((tier) => hoursNotice >= tier.minimumHours)?.percent ?? 0;
}

export function refundAmount(fee: number, percent: number): number {
  return Math.round(fee * percent);
}
