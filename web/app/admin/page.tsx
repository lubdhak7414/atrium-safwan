'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RoleGuard } from '../../components/RoleGuard';
import { TitleBlock } from '../../components/TitleBlock';
import { fetchJson } from '../../lib/api';
import { startOfCentreWeek, toApiIso } from '../../lib/time';
import type { Person, Room, Session } from '../../lib/types';
import { PromotionManager } from '../../components/PromotionManager';

export default function AdminDashboard() {
  return (
    <RoleGuard roles={['admin']}>
      <AdminWorkspace />
    </RoleGuard>
  );
}

function AdminWorkspace() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const from = startOfCentreWeek();
    const to = from.plus({ weeks: 1 });
    Promise.all([
      fetchJson<Room[]>('/api/rooms', { signal: controller.signal }),
      fetchJson<Person[]>('/api/people', { signal: controller.signal }),
      fetchJson<Session[]>(`/api/sessions?from=${encodeURIComponent(toApiIso(from))}&to=${encodeURIComponent(toApiIso(to))}`, { signal: controller.signal })
    ])
      .then(([loadedRooms, loadedPeople, loadedSessions]) => {
        setRooms(loadedRooms);
        setPeople(loadedPeople);
        setSessions(loadedSessions);
        setState('ready');
      })
      .catch((cause: Error) => {
        if (controller.signal.aborted) return;
        setError(cause.message);
        setState('error');
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="page-shell">
      <TitleBlock title="Administrator dashboard" meta="CONTROL DESK / COMPLETE CENTRE VIEW" />
      {state === 'loading' && <p className="state-line">LOADING OPERATIONS...</p>}
      {state === 'error' && <p className="error-line">{error}</p>}
      {state === 'ready' && (
        <>
          <section className="summary-grid">
            <div className="metric-panel"><span className="eyebrow">ROOMS</span><strong className="metric-value mono">{rooms.length}</strong><span className="muted">Available rooms</span></div>
            <div className="metric-panel"><span className="eyebrow">SESSIONS / WEEK</span><strong className="metric-value mono">{sessions.length}</strong><span className="muted">Non-cancelled feed</span></div>
            <div className="metric-panel"><span className="eyebrow">PEOPLE</span><strong className="metric-value mono">{people.length}</strong><span className="muted">All directory records</span></div>
          </section>
          <section className="data-panel action-panel">
            <h2>OPERATIONS</h2>
            <p>Review the centre schedule, create sessions, and inspect the role-filtered operational feed.</p>
            <Link className="button-link" href="/admin/sessions">OPEN SESSION CALENDAR</Link>{' '}
            <Link className="button-link" href="/create">CREATE SESSION</Link>
          </section>
          <PromotionManager />
        </>
      )}
    </main>
  );
}
