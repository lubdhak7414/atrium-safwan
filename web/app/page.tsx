import Link from 'next/link';
import { fetchJson } from '../lib/api';
import { nowInCentre, toApiIso } from '../lib/time';
import type { Session } from '../lib/types';
import { COACH_REFUND_TIERS, PARTICIPANT_REFUND_TIERS, SESSION_FEE_SCHEDULE } from '../../api/src/credits';
import { AccountOverview } from '../components/AccountOverview';
import { SessionCatalogue } from '../components/SessionCatalogue';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const from = nowInCentre();
  const to = from.plus({ days: 14 });
  let promoted: Session[] = [];
  let error = '';
  try {
    promoted = await fetchJson<Session[]>(
      `/api/sessions?from=${encodeURIComponent(toApiIso(from))}&to=${encodeURIComponent(toApiIso(to))}&promoted=true`,
      { cache: 'no-store' }
    );
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'Could not load promoted sessions';
  }

  return (
    <main className="page-shell home-shell">
      <div className="home-top-grid">
        <section className="hero-panel hero-panel-no-preview">
          <div className="hero-copy">
           <p className="eyebrow">ATRIUM COACHING CENTRE</p>
           <h1>Book coaching that fits your week.<br />Plan with confidence.</h1>
           <p>Compare upcoming sessions by time, room, price, and places remaining before you book. Coaches reserve rooms to teach; participants reserve places to learn.</p>
           <p>Open Monday to Saturday, 07:00–21:00 centre time.</p>
           <div className="hero-actions"><Link className="button-link" href="/catalogue">Browse sessions</Link><Link className="button-link secondary-button" href="/policies">See pricing &amp; policies</Link></div>
          </div>
        </section>
        <AccountOverview />
      </div>

       <section className="home-section featured-panel" aria-labelledby="promoted-title">
          <div className="card-heading"><div><h2 id="promoted-title">FEATURED COACHING SESSIONS</h2><p className="muted">Explore upcoming sessions and find your next place to learn.</p></div></div>
          {error && <p className="error-line">{error}</p>}
          {!error && promoted.length === 0 && <p className="featured-empty">No featured sessions right now. <Link href="/catalogue">Browse all upcoming sessions</Link> to find your next class.</p>}
          {!error && promoted.length > 0 && <SessionCatalogue initialSessions={promoted} title="FEATURED SESSIONS" showHeader={false} />}
        </section>

      <section className="dashboard-card home-section decision-panel" aria-labelledby="decision-title">
        <div className="decision-head">
          <div><h2 id="decision-title">BEFORE YOU BOOK</h2><p className="muted">Understand the costs and cancellation rules before you reserve a place.</p></div>
          <span className="decision-eyebrow">COSTS &amp; CANCELLATION</span>
        </div>
        <div className="decision-grid">
          <div className="decision-card money-card">
            <div className="decision-card-label">FEES</div>
            <div className="fee-list">
              <div className="fee-row"><span>Short</span><strong>{SESSION_FEE_SCHEDULE.short.room} room / {SESSION_FEE_SCHEDULE.short.seat} seat</strong></div>
              <div className="fee-row"><span>Standard</span><strong>{SESSION_FEE_SCHEDULE.standard.room} room / {SESSION_FEE_SCHEDULE.standard.seat} seat</strong></div>
              <div className="fee-row"><span>Intensive</span><strong>{SESSION_FEE_SCHEDULE.intensive.room} room / {SESSION_FEE_SCHEDULE.intensive.seat} seat</strong></div>
            </div>
            <p className="decision-muted">Room fee / seat fee, charged per session, not per hour.</p>
          </div>
          <div className="decision-card money-card">
            <div className="decision-card-label">PARTICIPANT CANCELLATION</div>
            <div className="tiers">
              <div className="tier-row"><span>≥24h notice</span><span className="pct full">{PARTICIPANT_REFUND_TIERS[0].percent * 100}%</span></div>
              <div className="tier-row"><span>12–23h notice</span><span className="pct half">{PARTICIPANT_REFUND_TIERS[1].percent * 100}%</span></div>
              <div className="tier-row"><span>&lt;12h notice</span><span className="pct zero">{PARTICIPANT_REFUND_TIERS[2].percent * 100}%</span></div>
            </div>
            <p className="decision-muted">Cancel earlier to keep more of your seat credits.</p>
          </div>
          <div className="decision-card money-card">
            <div className="decision-card-label">COACH CANCELLATION</div>
            <div className="tiers coach-tier-grid">
              {COACH_REFUND_TIERS.map((tier, index) => <div className="tier-row" key={tier.minimumHours}><span>{index === 0 ? '≥96h' : index === 1 ? '48–95h' : index === 2 ? '24–47h' : '<24h'} notice</span><span className={`pct ${tier.percent === 1 ? 'full' : tier.percent === 0 ? 'zero' : 'half'}`}>{tier.percent * 100}%</span></div>)}
            </div>
            <p className="decision-muted">Affected participants receive 100% back when a coach cancels.</p>
          </div>
          <div className="decision-card">
            <div className="decision-card-label">OPENING HOURS</div>
            <p><strong>07:00–21:00</strong>, Monday–Saturday.<br />Closed Sunday.</p>
            <p className="decision-muted">Intensive sessions hold the room for 210 minutes.</p>
          </div>
          <div className="decision-card critical-card">
            <div className="decision-card-label">IMPORTANT</div>
            <p>Coaches must book <strong>at least 48 hours</strong> ahead.</p>
            <p className="decision-example">After a session starts, cancellation returns <strong>409 Conflict</strong>. No refund is issued.</p>
          </div>
          <div className="decision-card">
            <div className="decision-card-label">ROUNDING</div>
            <p className="decision-muted">Partial refunds use <strong className="decision-ink">half-up rounding</strong>.</p>
            <p className="decision-example"><strong>Example:</strong> 25% of 30 credits is 7.5, which rounds up to 8 credits.</p>
          </div>
        </div>
        <Link className="card-link decision-footer" href="/policies">Read full policy</Link>
      </section>
    </main>
  );
}
