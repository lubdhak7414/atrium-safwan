'use client';

import { useCurrentUser } from '../../components/CurrentUserProvider';
import { CalendarView } from '../../components/CalendarView';
import { RoleGuard } from '../../components/RoleGuard';

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
      <header className="title-block"><div className="title-block-main"><h1>My dashboard</h1></div></header>
      <section className="summary-grid">
        <div className="metric-panel"><span className="eyebrow">ACCOUNT</span><strong>{user?.full_name ?? 'LOADING...'}</strong><span className="muted">{user?.email}</span></div>
        <div className="metric-panel"><span className="eyebrow">AVAILABLE CREDITS</span><strong className="metric-value mono">{user?.credits ?? '—'}</strong><span className="muted">Participant balance</span></div>
        <div className="metric-panel"><span className="eyebrow">CATALOGUE</span><strong>PUBLIC</strong><span className="muted">Browse and book a place</span></div>
      </section>
      <CalendarView role="participant" />
    </main>
  );
}
