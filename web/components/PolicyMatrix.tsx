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

export function PolicyMatrix() {
  return (
    <section className="policy-matrix" aria-labelledby="policy-title">
      <h2 id="policy-title">POLICY &amp; FEES</h2>
      <div className="policy-row">
        <span className="policy-label">ROOM HOLD</span>
        <span className="policy-value">210 MIN FOR INTENSIVE (INCLUDES 30 MIN LUNCH)</span>
      </div>
      <div className="policy-row">
        <span className="policy-label">OPEN HOURS</span>
        <span className="policy-value">07:00–21:00, MON–SAT / SUNDAY CLOSED</span>
      </div>
      <div className="policy-row">
        <span className="policy-label">COACH DEADLINE</span>
        <span className="policy-value">BOOK OR RESCHEDULE AT LEAST 48 HOURS AHEAD</span>
      </div>
      <div className="policy-row">
        <span className="policy-label">COACH REFUNDS</span>
        <span className="policy-value">
          {COACH_REFUND_TIERS.map((tier, index) => (
            <span key={tier.minimumHours}>
              {index > 0 ? ' | ' : ''}
              {tierLabel(index, 'coach')} → {percent(tier.percent)}
            </span>
          ))}
        </span>
      </div>
      <div className="policy-row">
        <span className="policy-label">PARTICIPANT REFUNDS</span>
        <span className="policy-value">
          {PARTICIPANT_REFUND_TIERS.map((tier, index) => (
            <span key={tier.minimumHours}>
              {index > 0 ? ' | ' : ''}
              {tierLabel(index, 'participant')} → {percent(tier.percent)}
            </span>
          ))}
        </span>
      </div>
      <div className="policy-row">
        <span className="policy-label">NEW ACCOUNT CREDIT</span>
        <span className="policy-value">PARTICIPANT {INITIAL_CREDITS.participant} / COACH {INITIAL_CREDITS.coach}</span>
      </div>
      <div className="policy-row">
        <span className="policy-label">FEES / SESSION</span>
        <span className="policy-value">
          SHORT {SESSION_FEE_SCHEDULE.short.room}/{SESSION_FEE_SCHEDULE.short.seat} · STANDARD {SESSION_FEE_SCHEDULE.standard.room}/{SESSION_FEE_SCHEDULE.standard.seat} · INTENSIVE {SESSION_FEE_SCHEDULE.intensive.room}/{SESSION_FEE_SCHEDULE.intensive.seat}
        </span>
      </div>
    </section>
  );
}
