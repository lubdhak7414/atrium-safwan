'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '../lib/api';
import { formatCentreDate, formatCentreTime, nowInCentre, toApiIso } from '../lib/time';
import type { Session } from '../lib/types';

export function PromotionManager() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<number | null>(null);
  const from = nowInCentre();
  const to = from.plus({ days: 30 });
  const sourcePath = `/api/sessions?from=${encodeURIComponent(toApiIso(from))}&to=${encodeURIComponent(toApiIso(to))}`;

  async function load() {
    try {
      setSessions(await fetchJson<Session[]>(sourcePath));
      setState('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load promotion options');
      setState('error');
    }
  }

  useEffect(() => { void load(); }, []);

  async function toggle(session: Session) {
    setActionId(session.id);
    try {
      await fetchJson(`/api/sessions/${session.id}/promotion`, { method: 'POST', body: JSON.stringify({ promoted: !session.is_promoted }) });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update promotion');
    } finally {
      setActionId(null);
    }
  }

  return (
    <section className="data-panel action-panel">
      <div className="section-heading"><div><h2>FEATURED SESSION SELECTION</h2><p className="muted">Choose sessions shown on the public homepage.</p></div></div>
      {state === 'loading' && <p className="state-line">LOADING PROMOTION OPTIONS...</p>}
      {state === 'error' && <p className="error-line">{error}</p>}
      {state === 'ready' && sessions.length === 0 && <p className="empty-line">NO UPCOMING SESSIONS.</p>}
      {state === 'ready' && sessions.length > 0 && <div className="table-scroll"><table><thead><tr><th>SESSION</th><th>WHEN</th><th>ROOM</th><th>PUBLIC STATUS</th><th>ACTION</th></tr></thead><tbody>{sessions.map((session) => <tr key={session.id}><td><strong>{session.discipline}</strong><br /><span className="muted mono">#{session.id} · {session.session_type}</span></td><td className="mono">{formatCentreDate(session.starts_at)}<br />{formatCentreTime(session.starts_at)}–{formatCentreTime(session.ends_at)}</td><td>{session.room_name}</td><td className="mono">{session.is_promoted ? 'FEATURED' : 'STANDARD'}</td><td><button type="button" disabled={actionId === session.id} onClick={() => void toggle(session)}>{session.is_promoted ? 'REMOVE' : 'FEATURE'}</button></td></tr>)}</tbody></table></div>}
    </section>
  );
}
