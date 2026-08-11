'use client';

import Link from 'next/link';
import { useState } from 'react';
import { fetchJson } from '../lib/api';
import { useCurrentUser } from './CurrentUserProvider';

export function RoleNav() {
  const { user, status } = useCurrentUser();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await fetchJson('/api/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/';
  }

  return (
    <nav className="site-nav" aria-label="Primary navigation">
      <div className="nav-brand"><Link href="/">ATRIUM / OPERATIONS</Link></div>
      <div className="nav-links">
        <Link href="/catalogue">Catalogue</Link>
        <Link href="/policies">Policies</Link>
        {status === 'loading' && !user && <span className="nav-loading" aria-live="polite">CHECKING...</span>}
        {status === 'error' && !user && <span className="nav-loading">UNAVAILABLE</span>}
        {status === 'ready' && !user && <Link href="/login">Log in</Link>}
        {user?.kind === 'participant' && <Link href="/dashboard">My dashboard</Link>}
        {user?.kind === 'coach' && <><Link href="/coach">Coach desk</Link><Link href="/create">Create</Link></>}
        {user?.kind === 'admin' && (
          <>
            <Link href="/admin">Dashboard</Link>
            <Link href="/admin/sessions">Calendar</Link>
            <Link href="/create">Create</Link>
          </>
        )}
        {user && <button type="button" className="nav-signout" disabled={signingOut} onClick={signOut}>{signingOut ? 'Signing out...' : 'Sign out'}</button>}
      </div>
    </nav>
  );
}
