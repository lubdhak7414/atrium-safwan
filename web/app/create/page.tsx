'use client';

import { RoleGuard } from '../../components/RoleGuard';
import { CreateSessionForm } from '../../components/CreateSessionForm';
import { TitleBlock } from '../../components/TitleBlock';

export default function CreatePage() {
  return (
    <RoleGuard roles={['admin', 'coach']}>
      <main className="page-shell narrow-shell">
        <TitleBlock title="Create session" meta="ROOM BOOKING / CENTRE-LOCAL TIME" />
        <CreateSessionForm />
      </main>
    </RoleGuard>
  );
}
