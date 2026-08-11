'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { fetchJson } from '../lib/api';
import { useCurrentUser } from './CurrentUserProvider';

export function RoleNav() {
  const { user, status } = useCurrentUser();
  const pathname = usePathname();
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
        {user && <Link className={pathname === '/admin' || pathname === '/coach' || pathname === '/dashboard' ? 'nav-active' : ''} href={user.kind === 'admin' ? '/admin' : user.kind === 'coach' ? '/coach' : '/dashboard'}>Dashboard</Link>}
        <Link className={pathname === '/catalogue' ? 'nav-active' : ''} href="/catalogue">Catalogue</Link>
        <Link className={pathname === '/policies' ? 'nav-active' : ''} href="/policies">Policies</Link>
        <Link className={pathname === '/assistant' ? 'nav-active' : ''} href="/assistant">Assistant</Link>
        {status === 'loading' && !user && <span className="nav-loading" aria-live="polite">CHECKING...</span>}
        {status === 'error' && !user && <span className="nav-loading">UNAVAILABLE</span>}
        {status === 'ready' && !user && <Link href="/login">Log in</Link>}
         {user?.kind === 'coach' && <><Link className={pathname === '/create' ? 'nav-active' : ''} href="/create">Create</Link></>}
        {user?.kind === 'admin' && (
          <>
               <Link className={pathname === '/admin/sessions' ? 'nav-active' : ''} href="/admin/sessions">Calendar</Link>
               <Link className={pathname === '/create' ? 'nav-active' : ''} href="/create">Create</Link>
          </>
        )}
         {user && <button type="button" className="nav-signout" disabled={signingOut} onClick={signOut}>{signingOut ? 'Signing out...' : 'Sign out'}</button>}
      </div>
    </nav>
  );
}
