-- Daily eye-care tasks generated for a user from their near-vision history.
-- One row per task, grouped by `plan_date` + `period` (morning/afternoon/evening/night).
-- The task generator (Gemini) writes a fresh batch per `(user_id, plan_date)`; the
-- `completed` flag is then toggled from the client.

create extension if not exists "pgcrypto";

create table if not exists public.daily_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_date date not null,
  period text not null check (period in ('morning', 'afternoon', 'evening', 'night')),
  category text not null,
  title text not null,
  description text not null,
  position smallint not null default 0,
  completed boolean not null default false,
  completed_at timestamptz,
  source text not null default 'ai' check (source in ('ai', 'fallback', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists daily_tasks_user_date_idx
  on public.daily_tasks (user_id, plan_date);

create index if not exists daily_tasks_user_date_period_idx
  on public.daily_tasks (user_id, plan_date, period);

-- Keep `updated_at` fresh on every update.
create or replace function public.set_daily_tasks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists daily_tasks_set_updated_at on public.daily_tasks;
create trigger daily_tasks_set_updated_at
  before update on public.daily_tasks
  for each row execute function public.set_daily_tasks_updated_at();

-- Row-level security: each user can only access their own rows; the backend
-- service-role client bypasses RLS and reads/writes on behalf of users after
-- verifying the bearer token.
alter table public.daily_tasks enable row level security;

drop policy if exists "daily_tasks_owner_select" on public.daily_tasks;
create policy "daily_tasks_owner_select"
  on public.daily_tasks
  for select
  using (auth.uid() = user_id);

drop policy if exists "daily_tasks_owner_insert" on public.daily_tasks;
create policy "daily_tasks_owner_insert"
  on public.daily_tasks
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "daily_tasks_owner_update" on public.daily_tasks;
create policy "daily_tasks_owner_update"
  on public.daily_tasks
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "daily_tasks_owner_delete" on public.daily_tasks;
create policy "daily_tasks_owner_delete"
  on public.daily_tasks
  for delete
  using (auth.uid() = user_id);
