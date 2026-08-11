'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RoleGuard } from '../../../components/RoleGuard';
import { fetchJson } from '../../../lib/api';
import { useCurrentUser } from '../../../components/CurrentUserProvider';
import type { Person } from '../../../lib/types';

function PeopleWorkspace() {
  const { user } = useCurrentUser();
  const [people, setPeople] = useState<Person[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  async function load() {
    setState('loading');
    setError('');
    try {
      setPeople(await fetchJson<Person[]>('/api/people'));
      setState('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the people');
      setState('error');
    }
  }

  useEffect(() => { void load(); }, []);

  async function deactivate(person: Person) {
    setActionId(person.id);
    setError('');
    setMessage('');
    try {
      await fetchJson(`/api/people/${person.id}`, { method: 'DELETE' });
      setMessage(`${person.full_name} deactivated. They can no longer sign in.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not deactivate this person');
    } finally {
      setActionId(null);
    }
  }

  async function sendPasswordReset(person: Person) {
    setActionId(person.id);
    setError('');
    setMessage('');
    try {
      const result = await fetchJson<{ setup_url: string; expires_at: string }>(`/api/people/${person.id}/password-reset`, { method: 'POST', body: JSON.stringify({}) });
      setMessage(`Password reset email queued for ${person.email}. The setup link is valid until ${new Date(result.expires_at).toLocaleTimeString()}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send the password reset email');
    } finally {
      setActionId(null);
    }
  }

  return (
    <main className="page-shell">
      <header className="title-block">
        <div className="title-block-brand">ATRIUM COACHING CENTRE</div>
        <div className="title-block-main">
          <h1>People directory</h1>
          <div className="title-block-meta">ADMINISTRATOR / ACCOUNT MANAGEMENT</div>
        </div>
      </header>
      <p><Link className="text-link" href="/admin">← BACK TO DASHBOARD</Link></p>

      {state === 'loading' && <p className="state-line">LOADING DIRECTORY...</p>}
      {state === 'error' && <p className="error-line">{error}</p>}
      {state === 'ready' && (
        <section className="data-panel" aria-labelledby="directory-title">
          <div className="section-heading">
            <div>
              <h2 id="directory-title">ALL RECORDS</h2>
              <p className="muted">Deactivation blocks sign-in immediately. Password resets enqueue a single-use setup email to the account address.</p>
            </div>
            <span className="mono">{people.length} PEOPLE</span>
          </div>
          {error && <p className="error-line" role="alert">{error}</p>}
          {message && <p className="success-line" role="status">{message}</p>}
          {people.length === 0 && <p className="state-line">No people records are available.</p>}
          {people.length > 0 && <div className="table-scroll">
            <table>
              <thead><tr><th>ID</th><th>NAME</th><th>EMAIL</th><th>ROLE</th><th>CREDITS</th><th>ACTIVE</th><th>ACTIONS</th></tr></thead>
              <tbody>{people.map((person) => {
                const isSelf = user?.id === person.id;
                return (
                  <tr key={person.id} className={person.active === false ? 'busy-row' : undefined}>
                    <td className="mono">#{person.id}</td>
                    <td>{person.full_name}{isSelf ? ' (you)' : ''}</td>
                    <td className="mono">{person.email}</td>
                    <td className="mono">{person.kind.toUpperCase()}</td>
                    <td className="mono">{person.credits ?? 0}</td>
                    <td className="mono">{person.active === false ? 'NO' : 'YES'}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" disabled={actionId === person.id || person.active === false} onClick={() => void sendPasswordReset(person)}>RESET PASSWORD</button>
                        <button type="button" disabled={actionId === person.id || isSelf || person.active === false} onClick={() => void deactivate(person)}>DEACTIVATE</button>
                      </div>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>}
        </section>
      )}
    </main>
  );
}

export default function PeoplePage() {
  return (
    <RoleGuard roles={['admin']}>
      <PeopleWorkspace />
    </RoleGuard>
  );
}
