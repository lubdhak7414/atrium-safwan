-- Phase 5 hardening
--  outbox lease columns and scheduler job tables.
alter table email_outbox
  add column lease_token uuid,
  add column failed_at timestamptz;

alter table job_run
  add column lease_token uuid;

create index email_outbox_processing_lease_idx
  on email_outbox (lease_until)
  where status = 'processing';

create index job_run_processing_lease_idx
  on job_run (lease_until)
  where status = 'processing';
