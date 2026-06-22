-- Track which locale daily tasks were generated in so plans can be regenerated
-- when the user changes their app language.

alter table public.daily_tasks
  add column if not exists locale text;

create index if not exists daily_tasks_user_date_locale_idx
  on public.daily_tasks (user_id, plan_date, locale);
