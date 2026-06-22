-- Session viewing-distance metrics derived from the near-vision test camera tracker.
-- average_distance_cm: mean stabilized distance across the full test (all eyes).
-- sight_distance_status: shortSighted | longSighted | normal vs the focus band.

alter table public.near_vision_results
  add column if not exists average_distance_cm double precision,
  add column if not exists sight_distance_status text
    check (
      sight_distance_status is null
      or sight_distance_status in ('shortSighted', 'longSighted', 'normal')
    );
