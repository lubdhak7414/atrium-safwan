'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson, ApiError } from '../../lib/api';
import type { Role } from '../../lib/types';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !email.trim() || !password) return;
    setError('');
    setLoading(true);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const user = await fetchJson<{ kind: Role }>('/api/login', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ email, password })
      });
      const destination = user.kind === 'participant' ? '/dashboard' : user.kind === 'coach' ? '/coach' : '/admin';
      setLoading(false);
      router.push(destination);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof ApiError ? cause.message : 'Could not sign in. Try again.');
      setLoading(false);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  return (
    <main className="page-shell narrow-shell">
      <section className="form-panel">
        <p className="eyebrow">ACCOUNT ACCESS</p>
        <h2>Sign in to the operational desk</h2>
        <p className="muted">The same form is used by participants, coaches, and administrators. Your account role determines the workspace you enter.</p>
        <form onSubmit={onSubmit}>
          <label>
            <span>Email</span>
            <input required type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            <span>Password</span>
            <input required type="password" name="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <p className="error-line" role="alert">{error}</p>}
          <button type="submit" disabled={loading || !email.trim() || !password}>{loading ? 'CHECKING...' : 'SIGN IN'}</button>
        </form>
      </section>
    </main>
  );
}
