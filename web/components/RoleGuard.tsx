'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from './CurrentUserProvider';
import type { Role } from '../lib/types';

export function RoleGuard({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const router = useRouter();
  const { user, status } = useCurrentUser();
  const roleKey = roles.join('|');

  useEffect(() => {
    if (status === 'loading') return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!roles.includes(user.kind)) {
      router.replace(user.kind === 'participant' ? '/dashboard' : user.kind === 'coach' ? '/coach' : '/admin');
    }
  }, [roleKey, router, status, user]);

  if (status === 'loading' && !user) return <main className="state-panel"><p>LOADING ACCOUNT...</p></main>;
  if (!user) return <main className="state-panel"><p>REDIRECTING TO SIGN IN...</p></main>;
  if (!roles.includes(user.kind)) return <main className="state-panel"><p>REDIRECTING TO YOUR WORKSPACE...</p></main>;
  return children;
}
