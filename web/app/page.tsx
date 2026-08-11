import Link from 'next/link';
import { fetchJson } from '../lib/api';
import { formatCentreDate, formatCentreTime, nowInCentre, toApiIso } from '../lib/time';
import type { Session } from '../lib/types';
import { COACH_REFUND_TIERS, INITIAL_CREDITS, PARTICIPANT_REFUND_TIERS, SESSION_FEE_SCHEDULE } from '../../api/src/credits';
import { SessionCatalogue } from '../components/SessionCatalogue';
import { TitleBlock } from '../components/TitleBlock';

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
    <main className="page-shell">
      <TitleBlock title="Atrium Coaching Centre" meta="ROOMS / SESSIONS / CREDITS" />
      <section className="hero-panel">
        <div>
          <p className="eyebrow">CENTRE-LOCAL SCHEDULING</p>
          <h2>Defined coaching sessions. Clear credit rules.</h2>
          <p>Find a session, check the cost and remaining places, then sign in to book. Sessions run Monday to Saturday between 07:00 and 21:00 in the centre timezone.</p>
          <div className="hero-actions"><Link className="button-link" href="/catalogue">BROWSE CATALOGUE</Link><Link className="text-link" href="/policies">VIEW POLICIES &amp; FEES</Link></div>
        </div>
        <div className="hero-credit"><span className="eyebrow">NEW ACCOUNT CREDIT</span><strong className="mono">{INITIAL_CREDITS.participant}</strong><span>PARTICIPANT CREDITS</span><strong className="mono">{INITIAL_CREDITS.coach}</strong><span>COACH CREDITS</span></div>
      </section>

      <section className="home-section" aria-labelledby="promoted-title">
        <div className="section-heading"><div><h2 id="promoted-title">FEATURED SESSIONS</h2><p className="muted">Selected by the centre administrator.</p></div><Link className="text-link" href="/catalogue">VIEW ALL SESSIONS →</Link></div>
        {error && <p className="error-line">{error}</p>}
        {!error && promoted.length === 0 && <p className="empty-line">NO FEATURED SESSIONS ARE CURRENTLY PUBLISHED.</p>}
        {!error && promoted.length > 0 && <SessionCatalogue initialSessions={promoted} title="FEATURED SESSIONS" promotedOnly />}
      </section>

      <section className="home-section decision-panel" aria-labelledby="decision-title">
        <div><p className="eyebrow">BEFORE YOU BOOK</p><h2 id="decision-title">The rules that affect your credits</h2></div>
        <div className="decision-grid">
          <div><strong>FEES</strong><p className="mono">SHORT {SESSION_FEE_SCHEDULE.short.room}/{SESSION_FEE_SCHEDULE.short.seat} · STANDARD {SESSION_FEE_SCHEDULE.standard.room}/{SESSION_FEE_SCHEDULE.standard.seat} · INTENSIVE {SESSION_FEE_SCHEDULE.intensive.room}/{SESSION_FEE_SCHEDULE.intensive.seat}</p><p>Room fee / seat fee, per session, not per hour.</p></div>
          <div><strong>OPENING HOURS</strong><p>07:00–21:00 Monday–Saturday. Sunday is closed. Intensive sessions hold the room for 210 minutes.</p></div>
          <div><strong>PARTICIPANT CANCELLATION</strong><p className="mono">≥24H {PARTICIPANT_REFUND_TIERS[0].percent * 100}% · 12–23H {PARTICIPANT_REFUND_TIERS[1].percent * 100}% · &lt;12H {PARTICIPANT_REFUND_TIERS[2].percent * 100}%</p></div>
          <div><strong>COACH CANCELLATION</strong><p className="mono">≥96H {COACH_REFUND_TIERS[0].percent * 100}% · 48–95H {COACH_REFUND_TIERS[1].percent * 100}% · 24–47H {COACH_REFUND_TIERS[2].percent * 100}% · &lt;24H {COACH_REFUND_TIERS[3].percent * 100}%</p></div>
          <div><strong>IMPORTANT</strong><p>Coaches must book at least 48 hours ahead. A coach cancellation refunds affected participants 100%. After session start, cancellation returns 409 and no refund is issued.</p></div>
          <div><strong>ROUNDING</strong><p>Partial refunds use half-up rounding: 25% of 30 credits becomes 8 credits.</p></div>
        </div>
        <Link className="button-link" href="/policies">READ FULL POLICY</Link>
      </section>
    </main>
  );
}
