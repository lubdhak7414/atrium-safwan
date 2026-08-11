'use client';

import { useCurrentUser } from '../../components/CurrentUserProvider';
import { CalendarView } from '../../components/CalendarView';
import { RoleGuard } from '../../components/RoleGuard';
import { TitleBlock } from '../../components/TitleBlock';

export default function ParticipantDashboard() {
  return (
    <RoleGuard roles={['participant']}>
      <ParticipantWorkspace />
    </RoleGuard>
  );
}

function ParticipantWorkspace() {
  const { user } = useCurrentUser();

  return (
    <main className="page-shell">
      <TitleBlock title="Participant dashboard" meta="PERSONAL LEDGER / CATALOGUE ACCESS" />
      <section className="summary-grid">
        <div className="metric-panel"><span className="eyebrow">ACCOUNT</span><strong>{user?.full_name ?? 'LOADING...'}</strong><span className="muted">{user?.email}</span></div>
        <div className="metric-panel"><span className="eyebrow">AVAILABLE CREDITS</span><strong className="metric-value mono">{user?.credits ?? '—'}</strong><span className="muted">Participant balance</span></div>
        <div className="metric-panel"><span className="eyebrow">ACCESS</span><strong>CATALOGUE</strong><span className="muted">Your bookings only</span></div>
      </section>
      <CalendarView role="participant" />
    </main>
  );
}
