'use client';

import { useState } from 'react';
import Link from 'next/link';
import { fetchJson, ApiError } from '../../lib/api';
import { INITIAL_CREDITS } from '../../../api/src/credits';

export default function SignupPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !fullName.trim() || !email.trim()) return;
    setLoading(true);
    setError('');
    try {
      await fetchJson('/api/signup', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), full_name: fullName.trim() })
      });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not create the account. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell narrow-shell">
      <section className="form-panel">
        <p className="eyebrow">CREATE AN ACCOUNT</p>
        <h1>Join Atrium as a participant</h1>
        <p className="muted">New participant accounts start with {INITIAL_CREDITS.participant.toLocaleString()} credits. We&rsquo;ll email you a secure one-time link to set your password — it expires in 30 minutes and can only be used once.</p>
        {done ? (
          <>
            <p className="success-line" role="status">If this is a new address, we&rsquo;ve emailed a secure link to set your password.</p>
            <p className="muted">Set your password from the link, then sign in from the login page.</p>
            <p><Link href="/login">Go to sign in</Link> · <Link href="/assistant">Browse sessions with the assistant</Link></p>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <label>
              <span>Full name</span>
              <input required type="text" name="full_name" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>
            <label>
              <span>Email</span>
              <input required type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            {error && <p className="error-line" role="alert">{error}</p>}
            <button type="submit" disabled={loading || !fullName.trim() || !email.trim()}>{loading ? 'CREATING...' : 'CREATE ACCOUNT'}</button>
            <p className="muted">Coach accounts are issued by the centre — there is no coach self-sign-up.</p>
          </form>
        )}
      </section>
    </main>
  );
}
