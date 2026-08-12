import type { Metadata } from 'next';
import { PolicyMatrix } from '../../components/PolicyMatrix';

export const metadata: Metadata = {
  title: 'Pricing & policies',
  description: 'Atrium Coaching Centre fees, refund tiers and booking deadlines for coaches and participants.'
};

export default function PoliciesPage() {
  return (
    <main className="page-shell narrow-shell">
      <header className="policy-page-header">
        <h1>Policy &amp; fees</h1>
        <p>Quick reference for credits, booking limits, refunds, and centre hours.</p>
      </header>
      <div className="policy-page-grid">
        <PolicyMatrix />
        <details className="data-panel policy-detail" open>
          <summary>What your credits buy</summary>
          <div className="policy-detail-content">
            <p><strong>Short:</strong> 45 minutes of teaching.</p>
            <p><strong>Standard:</strong> 60 minutes of teaching.</p>
            <p><strong>Intensive:</strong> 180 minutes of teaching plus a 30-minute lunch break within the 210-minute room hold.</p>
          </div>
        </details>
        <details className="data-panel policy-detail" open>
          <summary>Cancellation notices</summary>
          <div className="policy-detail-content">
            <p>If your coach cancels, you are never left out of pocket. Every affected participant receives 100% of paid seat credits back, even if the coach's own room refund is lower.</p>
            <p>After a session starts, cancellation is not accepted. The API returns <span className="mono">409 Conflict</span> and no refund is issued.</p>
          </div>
        </details>
      </div>
    </main>
  );
}
