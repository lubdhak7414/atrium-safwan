'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ApiError, fetchJson } from '../lib/api';
import type { CurrentUser } from '../lib/types';

type CurrentUserState = {
  user: CurrentUser | null;
  status: 'loading' | 'ready' | 'error';
};

const CurrentUserContext = createContext<CurrentUserState | undefined>(undefined);

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<CurrentUserState['status']>('loading');
  const requestRef = useRef<{ pathname: string; promise: Promise<CurrentUser> } | null>(null);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    if (!requestRef.current || requestRef.current.pathname !== pathname) {
      requestRef.current = { pathname, promise: fetchJson<CurrentUser>('/api/me') };
    }
    requestRef.current.promise
      .then((nextUser) => {
        if (!active) return;
        setUser(nextUser);
        setStatus('ready');
      })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setUser(null);
          setStatus('ready');
          return;
        }
        setStatus('error');
      });

    return () => { active = false; };
  }, [pathname]);

  return <CurrentUserContext.Provider value={{ user, status }}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUserState {
  const value = useContext(CurrentUserContext);
  if (!value) throw new Error('useCurrentUser must be used inside CurrentUserProvider');
  return value;
}
