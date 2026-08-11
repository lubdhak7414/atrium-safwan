export type Role = 'admin' | 'coach' | 'participant';

export type CurrentUser = {
  id: number;
  email: string;
  full_name: string;
  kind: Role;
  credits: number;
  active: boolean;
};

export type Session = {
  id: number;
  discipline: string;
  session_type: string;
  status: string;
  starts_at: string;
  ends_at: string;
  room_id: number;
  room_name: string;
  room_capacity?: number;
  room_fee_credits?: number;
  seat_fee_credits?: number;
  enrolled_count?: number;
  places_remaining?: number;
  visibility?: 'busy';
  is_own_session?: boolean;
  coach_id?: number;
  coach_name?: string;
  is_promoted?: boolean;
  my_enrolment?: {
    id: number;
    status: string;
    credits_charged: number;
  } | null;
};

export type Room = { id: number; name: string; capacity: number };
export type Person = { id: number; full_name: string; email: string; kind: Role; credits?: number; active?: boolean };
