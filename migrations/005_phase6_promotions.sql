alter table session
  add column is_promoted boolean not null default false;

create index session_promoted_starts_at_idx
  on session (starts_at)
  where is_promoted = true and status <> 'cancelled';
