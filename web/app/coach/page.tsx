'use client';

import { useCurrentUser } from '../../components/CurrentUserProvider';
import { CalendarView } from '../../components/CalendarView';
import { RoleGuard } from '../../components/RoleGuard';
import { SessionCatalogue } from '../../components/SessionCatalogue';
import { nowInCentre, toApiIso } from '../../lib/time';

export default function CoachDashboard() {
  return (
    <RoleGuard roles={['coach']}>
      <CoachWorkspace />
    </RoleGuard>
  );
}

function CoachWorkspace() {
  const { user } = useCurrentUser();
  const from = nowInCentre();
  const to = from.plus({ days: 30 });
  const cataloguePath = `/api/sessions?from=${encodeURIComponent(toApiIso(from))}&to=${encodeURIComponent(toApiIso(to))}&catalogue=true`;

  return (
    <main className="page-shell">
      <section className="summary-grid">
        <div className="metric-panel"><span className="eyebrow">COACH</span><strong>{user?.full_name ?? 'LOADING...'}</strong><span className="muted">{user?.email}</span></div>
        <div className="metric-panel"><span className="eyebrow">ROOM CREDITS</span><strong className="metric-value mono">{user?.credits ?? '—'}</strong><span className="muted">Available balance</span></div>
        <div className="metric-panel"><span className="eyebrow">BUSY SLOTS</span><strong>ANONYMOUS</strong><span className="muted">Schedule availability</span></div>
      </section>
      <CalendarView role="coach" />
      <SessionCatalogue sourcePath={cataloguePath} title="BOOK AS AN ATTENDEE" bookingRole="coach" />
    </main>
  );
}
