'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { fetchJson } from '../lib/api';
import { useCurrentUser } from './CurrentUserProvider';

export function RoleNav() {
  const { user, status } = useCurrentUser();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
  }

  async function signOut() {
    setSigningOut(true);
    await fetchJson('/api/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/';
  }

  return (
    <nav ref={navRef} className={`site-nav${open ? ' nav-open' : ''}`} aria-label="Primary navigation">
      <div className="nav-topline">
        <div className="nav-brand"><Link href="/" onClick={close}>ATRIUM / OPERATIONS</Link></div>
        <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="site-nav-links" onClick={() => setOpen((current) => !current)}>
          <span className="nav-toggle-icon" aria-hidden="true">{open ? '✕' : '☰'}</span>
          <span className="nav-toggle-label">{open ? 'Close' : 'Menu'}</span>
        </button>
      </div>
      <div id="site-nav-links" className="nav-links" onClick={close}>
        {user && <Link className={pathname === '/admin' || pathname === '/coach' || pathname === '/dashboard' ? 'nav-active' : undefined} aria-current={pathname === '/admin' || pathname === '/coach' || pathname === '/dashboard' ? 'page' : undefined} href={user.kind === 'admin' ? '/admin' : user.kind === 'coach' ? '/coach' : '/dashboard'}>Dashboard</Link>}
        <Link className={pathname === '/catalogue' ? 'nav-active' : undefined} aria-current={pathname === '/catalogue' ? 'page' : undefined} href="/catalogue">Catalogue</Link>
        <Link className={pathname === '/policies' ? 'nav-active' : undefined} aria-current={pathname === '/policies' ? 'page' : undefined} href="/policies">Policies</Link>
        <Link className={pathname === '/assistant' ? 'nav-active' : undefined} aria-current={pathname === '/assistant' ? 'page' : undefined} href="/assistant">Assistant</Link>
        {status === 'loading' && !user && <span className="nav-loading" aria-live="polite">CHECKING...</span>}
        {status === 'error' && !user && <span className="nav-loading">UNAVAILABLE</span>}
        {status === 'ready' && !user && <Link href="/login">Log in</Link>}
        {user?.kind === 'coach' && <Link className={pathname === '/create' ? 'nav-active' : undefined} aria-current={pathname === '/create' ? 'page' : undefined} href="/create">Create</Link>}
        {user?.kind === 'admin' && (
          <>
            <Link className={pathname === '/admin/sessions' ? 'nav-active' : undefined} aria-current={pathname === '/admin/sessions' ? 'page' : undefined} href="/admin/sessions">Calendar</Link>
            <Link className={pathname === '/create' ? 'nav-active' : undefined} aria-current={pathname === '/create' ? 'page' : undefined} href="/create">Create</Link>
          </>
        )}
        {user && <button type="button" className="nav-signout" disabled={signingOut} onClick={signOut}>{signingOut ? 'Signing out...' : 'Sign out'}</button>}
      </div>
    </nav>
  );
}
