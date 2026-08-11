'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, fetchJson } from '../../lib/api';

function SetupPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [account, setAccount] = useState<{ email: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [tokenError, setTokenError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenError('This link is missing its token. Open the password reset email again.');
      setChecking(false);
      return;
    }
    let active = true;
    fetchJson<{ email: string }>(`/api/dev/setup-password?token=${encodeURIComponent(token)}`)
      .then((result) => {
        if (!active) return;
        setAccount(result);
        setChecking(false);
      })
      .catch((cause: Error) => {
        if (!active) return;
        setTokenError(cause instanceof ApiError ? cause.message : 'This link is invalid or expired.');
        setChecking(false);
      });
    return () => { active = false; };
  }, [token]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !password || !confirm) return;
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await fetchJson(`/api/dev/setup-password?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify({ password })
      });
      setMessage('PASSWORD SET');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not set the password. Try again.');
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return <p className="state-line">CHECKING LINK...</p>;
  }

  if (tokenError) {
    return (
      <section className="form-panel">
        <p className="eyebrow">PASSWORD SETUP</p>
        <h2>This link cannot be used</h2>
        <p className="error-line" role="alert">{tokenError}</p>
        <p className="muted">A setup link is valid for 30 minutes and can be used once. Ask an administrator for a new password reset email, or go back to the <Link className="text-link" href="/">public catalogue</Link>.</p>
      </section>
    );
  }

  if (message) {
    return (
      <section className="form-panel">
        <p className="eyebrow">PASSWORD SETUP</p>
        <h2>Password set</h2>
        <p className="success-line" role="status">Your password has been set for {account?.email}.</p>
        <p><Link className="button-link" href="/login">GO TO SIGN IN</Link>{' '}
        <button type="button" className="nav-signout" onClick={() => router.push('/')}>BACK TO CATALOGUE</button></p>
      </section>
    );
  }

  return (
    <section className="form-panel">
      <p className="eyebrow">PASSWORD SETUP</p>
      <h2>Set your Atrium password</h2>
      <p className="muted">Account: <strong>{account?.email}</strong></p>
      <p className="muted">This link is valid for 30 minutes and can be used once.</p>
      <form onSubmit={onSubmit}>
        <label>
          <span>New password</span>
          <input required type="password" name="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label>
          <span>Confirm password</span>
          <input required type="password" name="confirm" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </label>
        {error && <p className="error-line" role="alert">{error}</p>}
        <button type="submit" disabled={loading || !password || !confirm}>{loading ? 'SETTING...' : 'SET PASSWORD'}</button>
      </form>
    </section>
  );
}

export default function SetupPasswordPage() {
  return (
    <main className="page-shell narrow-shell">
      <header className="title-block">
        <div className="title-block-brand">ATRIUM COACHING CENTRE</div>
        <div className="title-block-main">
          <h1>Set your password</h1>
          <div className="title-block-meta">SECURE ACCOUNT SETUP / SINGLE USE</div>
        </div>
      </header>
      <Suspense fallback={<p className="state-line">LOADING...</p>}>
        <SetupPasswordForm />
      </Suspense>
    </main>
  );
}
