'use client';

import Link from 'next/link';
import { CalendarView } from '../../../components/CalendarView';
import { RoleGuard } from '../../../components/RoleGuard';
import { TitleBlock } from '../../../components/TitleBlock';

export default function AdminSessions() {
  return (
    <RoleGuard roles={['admin']}>
      <main className="page-shell">
        <TitleBlock title="Session calendar" meta="ADMINISTRATOR / CENTRE SCHEDULING" />
        <div className="page-actions"><Link className="button-link" href="/create">CREATE SESSION</Link></div>
        <CalendarView role="admin" />
      </main>
    </RoleGuard>
  );
}
