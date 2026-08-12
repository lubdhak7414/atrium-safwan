'use client';

import { useRouter } from 'next/navigation';
import { nowInCentre, toApiIso } from '../../lib/time';
import { SessionCatalogue } from '../../components/SessionCatalogue';
import { useCurrentUser } from '../../components/CurrentUserProvider';

export default function CataloguePage() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const from = nowInCentre();
  const to = from.plus({ days: 30 });
  const sourcePath = `/api/sessions?from=${encodeURIComponent(toApiIso(from))}&to=${encodeURIComponent(toApiIso(to))}&catalogue=true`;
  const signedIn = Boolean(user);
  return (
    <main className="page-shell">
      <header className="title-block">
        <div className="title-block-main">
          <h1>Session catalogue</h1>
        </div>
      </header>
      <SessionCatalogue sourcePath={sourcePath} title="ALL AVAILABLE SESSIONS" bookingRole={user?.kind === 'participant' || user?.kind === 'coach' ? user.kind : undefined} onOpen={signedIn ? (id) => router.push(`/sessions/${id}`) : undefined} />
    </main>
  );
}
