import { SESSION_FEE_SCHEDULE } from '../../../api/src/credits';
import { PolicyMatrix } from '../../components/PolicyMatrix';
import { TitleBlock } from '../../components/TitleBlock';

export default function PoliciesPage() {
  return (
    <main className="page-shell narrow-shell">
      <TitleBlock title="Policies & fees" meta="CREDITS / CANCELLATION / OPERATING HOURS" />
      <div className="policy-page-grid">
        <PolicyMatrix />
        <section className="data-panel">
          <h2>WHAT YOUR CREDITS BUY</h2>
          <p><strong>Short:</strong> {SESSION_FEE_SCHEDULE.short.durationMinutes} minutes. Room {SESSION_FEE_SCHEDULE.short.room} credits and seat {SESSION_FEE_SCHEDULE.short.seat} credits.</p>
          <p><strong>Standard:</strong> {SESSION_FEE_SCHEDULE.standard.durationMinutes} minutes. Room {SESSION_FEE_SCHEDULE.standard.room} credits and seat {SESSION_FEE_SCHEDULE.standard.seat} credits.</p>
          <p><strong>Intensive:</strong> 180 minutes of teaching and a 210-minute room hold, including a 30-minute lunch interval. Room {SESSION_FEE_SCHEDULE.intensive.room} credits and seat {SESSION_FEE_SCHEDULE.intensive.seat} credits.</p>
        </section>
        <section className="data-panel">
          <h2>CANCELLATION NOTICES</h2>
          <p>Participant cancellations receive 100% at 24 hours or more, 50% at 12 to under 24 hours, and 0% under 12 hours.</p>
          <p>Coach cancellations refund the room fee at 100% with 96 hours or more notice, 50% at 48 to under 96 hours, 25% at 24 to under 48 hours, and 0% under 24 hours.</p>
          <p>When a coach cancels, every affected participant receives 100% of their paid seat credits back.</p>
          <p>Cancellation is accepted only before session start. After start, the API returns <span className="mono">409</span> and no refund is issued.</p>
          <p>All partial refunds use half-up rounding. The centre is open 07:00–21:00 Monday–Saturday and closed Sunday.</p>
        </section>
      </div>
    </main>
  );
}
