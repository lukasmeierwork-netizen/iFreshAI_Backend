-- Single task record with multilingual copy stored in JSONB.
-- One plan per (user_id, plan_date); locale column is legacy only.

alter table public.daily_tasks
  add column if not exists translations jsonb;

-- Backfill translations from legacy title/description rows.
update public.daily_tasks
set translations = jsonb_build_object(
  coalesce(nullif(locale, ''), 'en'),
  jsonb_build_object('title', title, 'description', description)
)
where translations is null
  and title is not null
  and description is not null;

-- Remove legacy per-locale duplicates before enforcing one row per slot.
delete from public.daily_tasks a
using public.daily_tasks b
where a.user_id = b.user_id
  and a.plan_date = b.plan_date
  and a.position = b.position
  and a.id < b.id;

create unique index if not exists daily_tasks_user_date_position_uidx
  on public.daily_tasks (user_id, plan_date, position);
