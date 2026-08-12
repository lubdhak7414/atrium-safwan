-- Schema hardening
--  integer credits, constraints, exclusion constraint for room conflicts, indexes, outbox/job_run/setup-token tables.
alter table person
  alter column credits type integer using round(credits)::integer,
  alter column email set not null,
  alter column full_name set not null,
  alter column kind set not null,
  alter column credits set not null,
  alter column active set not null,
  alter column created_at set not null;

alter table room
  alter column name set not null,
  alter column capacity set not null,
  add constraint room_capacity_positive check (capacity > 0);

alter table session
  alter column room_fee_credits type integer using round(room_fee_credits)::integer,
  alter column seat_fee_credits type integer using round(seat_fee_credits)::integer,
  alter column room_id set not null,
  alter column coach_id set not null,
  alter column discipline set not null,
  alter column session_type set not null,
  alter column status set not null,
  alter column starts_at set not null,
  alter column ends_at set not null,
  alter column room_fee_credits set not null,
  alter column seat_fee_credits set not null,
  alter column created_at set not null,
  add column change_version integer not null default 0,
  add constraint session_status_allowed check (status in ('scheduled', 'completed', 'cancelled')),
  add constraint session_type_allowed check (session_type in ('short', 'standard', 'intensive')),
  add constraint session_time_order check (ends_at > starts_at),
  add constraint session_duration_exact check (
    (session_type = 'short' and ends_at - starts_at = interval '45 minutes')
    or (session_type = 'standard' and ends_at - starts_at = interval '60 minutes')
    or (session_type = 'intensive' and ends_at - starts_at = interval '210 minutes')
  ),
  add constraint session_fees_non_negative check (room_fee_credits >= 0 and seat_fee_credits >= 0),
  add constraint session_change_version_non_negative check (change_version >= 0);

alter table enrolment
  alter column credits_charged type integer using round(credits_charged)::integer,
  alter column credits_refunded type integer using round(credits_refunded)::integer,
  alter column session_id set not null,
  alter column person_id set not null,
  alter column status set not null,
  alter column credits_charged set not null,
  alter column credits_refunded set not null,
  alter column enrolled_at set not null,
  add column booking_change_version integer not null default 0,
  add constraint enrolment_status_allowed check (status in ('active', 'cancelled')),
  add constraint enrolment_credits_non_negative check (credits_charged >= 0 and credits_refunded >= 0),
  add constraint enrolment_change_version_non_negative check (booking_change_version >= 0);

update check_in
set legacy_seed_defect = false
where legacy_seed_defect is null;

alter table check_in
  alter column enrolment_id set not null,
  alter column checked_in_at set not null,
  alter column legacy_seed_defect set default false,
  alter column legacy_seed_defect set not null;

alter table person
  add constraint person_kind_allowed check (kind in ('admin', 'coach', 'participant')),
  add constraint person_credits_non_negative check (credits >= 0);

alter table person
  add constraint person_email_unique unique (email);

create unique index enrolment_active_person_session_unique
  on enrolment (session_id, person_id)
  where status = 'active';

create unique index check_in_current_enrolment_unique
  on check_in (enrolment_id)
  where legacy_seed_defect = false;

create index session_starts_at_idx on session (starts_at);
create index session_room_starts_at_idx on session (room_id, starts_at);
create index enrolment_session_id_idx on enrolment (session_id);
create index enrolment_person_id_idx on enrolment (person_id);

create extension if not exists btree_gist;

alter table session
  add constraint session_room_time_exclusion
  exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled');

create table email_outbox (
  id             bigserial primary key,
  event_key      text not null,
  event_type     text not null,
  recipient      text not null,
  subject        text not null,
  body           text not null,
  status         text not null default 'pending',
  attempt_count  integer not null default 0,
  available_at   timestamptz not null default now(),
  lease_until    timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,
  constraint email_outbox_status_allowed
    check (status in ('pending', 'processing', 'sent', 'failed')),
  constraint email_outbox_attempts_non_negative check (attempt_count >= 0),
  constraint email_outbox_event_recipient_unique unique (event_key, recipient)
);

create index email_outbox_due_idx
  on email_outbox (status, available_at);

create table job_run (
  id             bigserial primary key,
  job_name       text not null,
  local_day      date not null,
  status         text not null default 'pending',
  attempts       integer not null default 0,
  available_at   timestamptz not null default now(),
  lease_until    timestamptz,
  last_error     text,
  reason         text,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  constraint job_run_status_allowed
    check (status in ('pending', 'processing', 'completed', 'failed', 'skipped')),
  constraint job_run_attempts_non_negative check (attempts >= 0),
  constraint job_run_job_day_unique unique (job_name, local_day)
);

create index job_run_due_idx on job_run (status, available_at);

create table scheduler_state (
  job_name                    text primary key,
  activation_day              date not null,
  last_processed_report_date  date not null,
  last_observed_at             timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create table password_setup_token (
  token_hash  text primary key,
  person_id   integer not null references person(id),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index password_setup_token_person_expiry_idx
  on password_setup_token (person_id, expires_at);
