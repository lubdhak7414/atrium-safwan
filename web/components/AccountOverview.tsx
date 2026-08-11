'use client';

import Link from 'next/link';
import { INITIAL_CREDITS } from '../../api/src/credits';
import { useCurrentUser } from './CurrentUserProvider';

export function AccountOverview() {
  const { user, status } = useCurrentUser();

  return (
    <aside className="dashboard-card account-card" aria-labelledby="account-overview-title">
      <div className="card-heading">
        <h2 id="account-overview-title">{user || status === 'loading' ? 'YOUR ATRIUM ACCOUNT' : 'START WITH ATRIUM'}</h2>
      </div>
      {status === 'loading' ? (
        <p className="account-loading">Loading account...</p>
      ) : user ? (
        <>
          <div className="credit-card account-credit">
            <div><span className="credit-label">{user.kind === 'admin' ? 'ADMINISTRATOR' : 'YOUR CREDITS'}</span>{user.kind === 'admin' ? <strong>{user.full_name}</strong> : <strong>{user.credits} <small>credits</small></strong>}<span className="muted">{user.kind === 'admin' ? 'Full centre access' : user.full_name}</span></div>
          </div>
          {user.kind === 'admin' ? (
            <>
              <Link className="card-link primary-card-link" href="/admin">Open admin dashboard</Link>
              <Link className="card-link" href="/admin/sessions">Session calendar</Link>
              <Link className="card-link" href="/admin/people">People directory</Link>
            </>
          ) : (
            <Link className="card-link primary-card-link" href={user.kind === 'coach' ? '/coach' : '/catalogue'}>{user.kind === 'coach' ? 'Manage my sessions' : 'Book sessions'}</Link>
          )}
        </>
      ) : (
        <>
          <div className="credit-stack">
            <div className="credit-card"><div><span className="credit-label">PARTICIPANT STARTER CREDIT</span><strong>{INITIAL_CREDITS.participant} <small>credits</small></strong></div></div>
            <div className="credit-card"><div><span className="credit-label">COACH STARTER CREDIT</span><strong>{INITIAL_CREDITS.coach} <small>credits</small></strong></div></div>
          </div>
          <Link className="card-link primary-card-link" href="/login">Create an account or sign in</Link>
        </>
      )}
    </aside>
  );
}
