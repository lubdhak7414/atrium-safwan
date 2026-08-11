import {
  COACH_REFUND_TIERS,
  INITIAL_CREDITS,
  PARTICIPANT_REFUND_TIERS,
  SESSION_FEE_SCHEDULE
} from '../../api/src/credits';

function percent(value: number): string {
  return `${value * 100}%`;
}

function tierLabel(index: number, kind: 'coach' | 'participant'): string {
  if (kind === 'coach') {
    return index === 0 ? '≥96H' : index === 1 ? '48–95H' : index === 2 ? '24–47H' : '<24H';
  }
  return index === 0 ? '≥24H' : index === 1 ? '12–23H' : '<12H';
}

function pillClass(percentValue: number): string {
  if (percentValue === 1) return 'full';
  if (percentValue === 0) return 'zero';
  return 'partial';
}

function RefundTiers({ tiers, kind }: { tiers: readonly { minimumHours: number; percent: number }[]; kind: 'coach' | 'participant' }) {
  return (
    <div className="policy-tier-list">
      {tiers.map((tier, index) => (
        <div className="policy-tier" key={tier.minimumHours}>
          <span>{tierLabel(index, kind)} notice</span>
          <strong className={`policy-pill ${pillClass(tier.percent)}`}>{percent(tier.percent)}</strong>
        </div>
      ))}
    </div>
  );
}

export function PolicyMatrix() {
  return (
    <section className="policy-matrix" aria-labelledby="policy-title">
      <h2 id="policy-title">POLICY &amp; FEES</h2>
      <div className="policy-row">
        <span className="policy-label">ROOM HOLD</span>
        <span className="policy-value">INTENSIVE: 210 MINUTES</span>
      </div>
      <div className="policy-row">
        <span className="policy-label">OPEN HOURS</span>
        <span className="policy-value">07:00–21:00, MON–SAT / SUNDAY CLOSED</span>
      </div>
      <div className="policy-row">
        <span className="policy-label">COACH DEADLINE</span>
        <span className="policy-value">BOOK OR RESCHEDULE AT LEAST 48 HOURS AHEAD</span>
      </div>
      <div className="policy-row money-rule">
        <span className="policy-label">COACH REFUNDS</span>
        <RefundTiers tiers={COACH_REFUND_TIERS} kind="coach" />
      </div>
      <div className="policy-row money-rule">
        <span className="policy-label">PARTICIPANT REFUNDS</span>
        <RefundTiers tiers={PARTICIPANT_REFUND_TIERS} kind="participant" />
      </div>
      <div className="policy-row">
        <span className="policy-label">NEW ACCOUNT CREDIT</span>
        <span className="policy-value">PARTICIPANT {INITIAL_CREDITS.participant} / COACH {INITIAL_CREDITS.coach}</span>
      </div>
      <div className="policy-row">
        <span className="policy-label">FEES / SESSION</span>
        <div className="policy-fee-list">
          <span>SHORT <strong>{SESSION_FEE_SCHEDULE.short.room} / {SESSION_FEE_SCHEDULE.short.seat}</strong></span>
          <span>STANDARD <strong>{SESSION_FEE_SCHEDULE.standard.room} / {SESSION_FEE_SCHEDULE.standard.seat}</strong></span>
          <span>INTENSIVE <strong>{SESSION_FEE_SCHEDULE.intensive.room} / {SESSION_FEE_SCHEDULE.intensive.seat}</strong></span>
          <small>ROOM / SEAT CREDITS</small>
        </div>
      </div>
      <div className="policy-row">
        <span className="policy-label">REFUND ROUNDING</span>
        <span className="policy-value">HALF-UP: 25% OF 30 CREDITS BECOMES 8</span>
      </div>
    </section>
  );
}
