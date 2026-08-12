'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ApiError, fetchJson } from '../../../lib/api';
import { formatCentreDate, formatCentreTime, nowInCentre, toApiIso } from '../../../lib/time';
import { useCurrentUser } from '../../../components/CurrentUserProvider';
import { AdminSessionActions, AttendeesPanel, BookingActions, CoachSessionActions } from '../../../components/SessionActions';
import type { Session } from '../../../lib/types';

function normalize(raw: Record<string, unknown>): Session {
  const room = (typeof raw.room === 'object' && raw.room !== null ? raw.room : {}) as Record<string, unknown>;
  const enrolment = (typeof raw.enrolment === 'object' && raw.enrolment !== null ? raw.enrolment : null) as { id: number; status: string; credits_charged: number } | null;
  return {
    id: Number(raw.id),
    discipline: String(raw.discipline),
    session_type: String(raw.session_type),
    status: String(raw.status),
    starts_at: String(raw.starts_at),
    ends_at: String(raw.ends_at),
    room_id: Number(raw.room_id ?? room.id),
    room_name: String(raw.room_name ?? room.name ?? ''),
    room_fee_credits: typeof raw.room_fee_credits === 'number' ? raw.room_fee_credits : undefined,
    seat_fee_credits: typeof raw.seat_fee_credits === 'number' ? raw.seat_fee_credits : undefined,
    visibility: raw.visibility === 'busy' ? 'busy' : undefined,
    coach_name: typeof raw.coach_name === 'string' ? raw.coach_name : undefined,
    my_enrolment: raw.my_enrolment
      ? raw.my_enrolment as Session['my_enrolment']
      : enrolment
        ? { id: enrolment.id, status: enrolment.status, credits_charged: enrolment.credits_charged }
        : null
  };
}

export default function SessionDetailPage() {
  const params = useParams();
  const sessionId = Number(params.id);
  const { user, status: userStatus } = useCurrentUser();
  const [session, setSession] = useState<Session | null>(null);
  const [feed, setFeed] = useState<Session[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const role = user?.kind;

  useEffect(() => {
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      setError('No such session.');
      setState('error');
      return;
    }
    if (userStatus !== 'ready') return;
    if (!role) {
      setState('ready');
      return;
    }
    let active = true;
    const controller = new AbortController();
    setState('loading');
    setError('');
    const from = nowInCentre();
    const to = from.plus({ days: 30 });
    const feedPath = `/api/sessions?from=${encodeURIComponent(toApiIso(from))}&to=${encodeURIComponent(toApiIso(to))}${role && role !== 'admin' ? '&catalogue=true' : ''}`;
    Promise.all([
      fetchJson<Record<string, unknown>>(`/api/sessions/${sessionId}`, { signal: controller.signal }),
      fetchJson<Session[]>(feedPath, { signal: controller.signal })
    ])
      .then(([raw, rows]) => {
        if (!active) return;
        setFeed(rows);
        const merged = rows.find((row) => row.id === sessionId) ?? {};
        setSession({ ...normalize(raw), ...merged });
        setState('ready');
      })
      .catch((cause: Error) => {
        if (!active || controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setSession(null);
          setState('ready');
          return;
        }
        setError(cause.message);
        setState('error');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [role, sessionId, userStatus, version]);

  if (userStatus === 'loading') {
    return <main className="page-shell narrow-shell state-panel"><p>LOADING ACCOUNT...</p></main>;
  }

  const backHref = !role ? '/catalogue' : role === 'admin' ? '/admin/sessions' : role === 'coach' ? '/coach' : '/dashboard';
  const backLabel = !role ? 'CATALOGUE' : role === 'admin' ? 'ADMIN CALENDAR' : role === 'coach' ? 'COACH DESK' : 'MY DASHBOARD';

  return (
    <main className="page-shell narrow-shell">
      <header className="title-block">
        <div className="title-block-main">
          <h1>Session #{sessionId}</h1>
          <div className="title-block-meta">{role ? role.toUpperCase() : 'SIGNED OUT'} / SESSION DETAIL</div>
        </div>
      </header>
      <p><Link className="text-link" href={backHref}>← BACK TO {backLabel}</Link></p>

      {!role && (
        <section className="data-panel">
          <p className="eyebrow">SIGN IN REQUIRED</p>
          <h2>Session details need an account</h2>
          <p className="muted">The public catalogue is open, but booking and session detail require a signed-in participant, coach, or administrator.</p>
          <Link className="button-link" href="/login">GO TO SIGN IN</Link>
        </section>
      )}

      {role && state === 'loading' && <p className="state-line">LOADING SESSION...</p>}
      {role && state === 'error' && <p className="error-line">{error}</p>}

      {role && state === 'ready' && !session && <p className="empty-line">NO SESSION DETAIL IS AVAILABLE FOR THIS ACCOUNT.</p>}

      {role && state === 'ready' && session && (
        <>
          <section className="data-panel" aria-labelledby="session-detail-title">
            <div className="section-heading">
              <div>
                <h2 id="session-detail-title">{session.visibility === 'busy' ? 'OCCUPIED PERIOD' : session.discipline.toUpperCase()}</h2>
                <p className="muted">{session.session_type.toUpperCase()} · {formatCentreDate(session.starts_at)} {formatCentreTime(session.starts_at)}–{formatCentreTime(session.ends_at)}</p>
              </div>
              <span className="mono">{session.visibility === 'busy' ? 'OTHER COACH' : session.status.toUpperCase()}</span>
            </div>
            <div className="session-detail-grid">
              <div className="metric-panel"><span className="eyebrow">ROOM</span><strong>{session.room_name || '—'}</strong></div>
              {session.coach_name && <div className="metric-panel"><span className="eyebrow">COACH</span><strong>{session.coach_name}</strong></div>}
              {!session.visibility && <div className="metric-panel"><span className="eyebrow">SEAT FEE</span><strong className="mono">{session.seat_fee_credits ?? '—'}</strong></div>}
              {!session.visibility && <div className="metric-panel"><span className="eyebrow">PLACES LEFT</span><strong className="mono">{session.places_remaining ?? '—'}</strong></div>}
              {role === 'admin' && session.room_fee_credits !== undefined && <div className="metric-panel"><span className="eyebrow">ROOM FEE</span><strong className="mono">{session.room_fee_credits}</strong></div>}
            </div>
            {session.visibility === 'busy' && (
              <p className="muted">This session is taught by another coach. You may book a place from the <Link className="text-link" href="/catalogue">public catalogue</Link>.</p>
            )}
          </section>

          {session.visibility !== 'busy' && (
            <section className="data-panel action-panel" aria-labelledby="session-actions-title">
              <p className="eyebrow">OPERATIONS</p>
              <h2 id="session-actions-title">Actions for this session</h2>
              {role === 'participant' && <BookingActions session={session} sessions={feed} onChanged={() => setVersion((value) => value + 1)} />}
              {role === 'coach' && (session.is_own_session ? <CoachSessionActions session={session} onChanged={() => setVersion((value) => value + 1)} /> : <BookingActions session={session} sessions={feed} onChanged={() => setVersion((value) => value + 1)} />)}
              {role === 'admin' && <AdminSessionActions session={session} onChanged={() => setVersion((value) => value + 1)} />}
            </section>
          )}

          {role !== 'participant' && session.visibility !== 'busy' && (
            <AttendeesPanel sessionId={sessionId} refreshKey={version} />
          )}
        </>
      )}
    </main>
  );
}
