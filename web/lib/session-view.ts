import type { Role, Session } from './types';

export type SessionViewKind = 'booked' | 'own' | 'public';

export function sessionViewKind(role: Role, session: Session): SessionViewKind {
  if (session.my_enrolment) return 'booked';
  if (role === 'coach' && session.is_own_session) return 'own';
  return 'public';
}
