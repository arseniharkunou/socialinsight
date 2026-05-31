create table if not exists public.analysis_jobs (
  id uuid primary key,
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  stage text not null check (stage in ('website', 'market', 'queries', 'brightdata', 'evidence', 'synthesis')),
  analysis_mode text not null check (analysis_mode in ('company', 'category')),
  time_window text not null check (time_window in ('30d', '90d', '6m', '1y')),
  search_depth text not null check (search_depth in ('fast', 'deep')),
  supported_sources text[] not null default '{}',
  target text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  preview_quotes jsonb not null default '[]'::jsonb,
  report jsonb
);

create index if not exists analysis_jobs_created_at_idx on public.analysis_jobs (created_at desc);
create index if not exists analysis_jobs_status_idx on public.analysis_jobs (status);

alter table public.analysis_jobs enable row level security;

create table if not exists public.analysis_events (
  id bigserial primary key,
  job_id uuid not null references public.analysis_jobs(id) on delete cascade,
  event_type text not null,
  stage text,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analysis_events_job_created_idx on public.analysis_events (job_id, created_at asc);

alter table public.analysis_events enable row level security;

create or replace function public.set_analysis_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists analysis_jobs_set_updated_at on public.analysis_jobs;
create trigger analysis_jobs_set_updated_at
before update on public.analysis_jobs
for each row
execute function public.set_analysis_jobs_updated_at();
