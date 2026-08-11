'use client';

import { nowInCentre, toApiIso } from '../../lib/time';
import { SessionCatalogue } from '../../components/SessionCatalogue';
import { TitleBlock } from '../../components/TitleBlock';
import { useCurrentUser } from '../../components/CurrentUserProvider';

export default function CataloguePage() {
  const { user } = useCurrentUser();
  const from = nowInCentre();
  const to = from.plus({ days: 30 });
  const sourcePath = `/api/sessions?from=${encodeURIComponent(toApiIso(from))}&to=${encodeURIComponent(toApiIso(to))}&catalogue=true`;
  return (
    <main className="page-shell">
      <TitleBlock title="Session catalogue" meta="PUBLIC AVAILABILITY / 30 CENTRE-LOCAL DAYS" />
      <SessionCatalogue sourcePath={sourcePath} title="ALL AVAILABLE SESSIONS" bookingRole={user?.kind === 'participant' || user?.kind === 'coach' ? user.kind : undefined} />
    </main>
  );
}
