-- 016_automation_engine_hardening.sql
-- Adds canonical lifecycle metadata and event-source tracing to automation jobs.

alter table public.automation_jobs
  add column if not exists handler_key text,
  add column if not exists trigger_type text not null default 'schedule',
  add column if not exists lifecycle_status text not null default 'queued',
  add column if not exists source_type text,
  add column if not exists source_ref text,
  add column if not exists next_run_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_error_code text;

update public.automation_jobs
set
  handler_key = coalesce(handler_key, job_type),
  next_run_at = coalesce(next_run_at, run_at),
  retry_count = greatest(retry_count, attempts),
  lifecycle_status = case status
    when 'pending' then 'queued'
    when 'processing' then 'running'
    when 'completed' then 'succeeded'
    when 'failed' then 'failed'
    when 'canceled' then 'cancelled'
    else coalesce(lifecycle_status, 'queued')
  end
where
  handler_key is null
  or next_run_at is null
  or retry_count = 0
  or lifecycle_status is null
  or lifecycle_status not in ('queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled');

alter table public.automation_jobs
  alter column handler_key set not null,
  alter column next_run_at set not null;

alter table public.automation_jobs
  drop constraint if exists automation_jobs_trigger_type_check;
alter table public.automation_jobs
  add constraint automation_jobs_trigger_type_check
  check (trigger_type in ('schedule', 'event', 'manual'));

alter table public.automation_jobs
  drop constraint if exists automation_jobs_lifecycle_status_check;
alter table public.automation_jobs
  add constraint automation_jobs_lifecycle_status_check
  check (lifecycle_status in ('queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled'));

create index if not exists automation_jobs_lifecycle_next_run_idx
  on public.automation_jobs (lifecycle_status, next_run_at);

create index if not exists automation_jobs_handler_key_idx
  on public.automation_jobs (handler_key, created_at desc);

create index if not exists automation_jobs_source_ref_idx
  on public.automation_jobs (source_type, source_ref, created_at desc)
  where source_ref is not null;

alter table public.automation_runs
  drop constraint if exists automation_runs_status_check;
alter table public.automation_runs
  add constraint automation_runs_status_check
  check (status in ('success', 'failed', 'partial', 'skipped', 'cancelled'));
