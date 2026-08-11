'use client';

import { RoleGuard } from '../../components/RoleGuard';
import { CreateSessionForm } from '../../components/CreateSessionForm';

export default function CreatePage() {
  return (
      <RoleGuard roles={['admin', 'coach']}>
      <main className="page-shell narrow-shell">
        <CreateSessionForm />
      </main>
    </RoleGuard>
  );
}
