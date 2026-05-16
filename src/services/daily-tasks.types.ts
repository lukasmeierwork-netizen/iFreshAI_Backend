/** Shared type primitives for the daily-tasks feature. */

export type DailyTaskPeriod = "morning" | "afternoon" | "evening" | "night";

/**
 * Free-form category slug. The LLM picks the specific technique per task
 * (e.g. `blink-drill`, `near-far-focus`, `warm-compress`, `palming`,
 * `20-20-20`, `outdoor-time`, `anti-glare`, `reading-distance`,
 * `humidify`, `saccade-drill`, `lutein-rich-meal`, …). We deliberately do
 * NOT constrain this to a closed enum so day-to-day plans don't collapse
 * into the same 8 canonical recommendations.
 */
export type DailyTaskCategory = string;

export const DAILY_TASK_PERIOD_VALUES: readonly DailyTaskPeriod[] = [
  "morning",
  "afternoon",
  "evening",
  "night",
];

/**
 * Optional inspirational pool surfaced to the model (and exposed for any
 * UI that wants to bias visuals). Not enforced — the model is free to
 * invent a more specific slug when the user's history calls for it.
 */
export const DAILY_TASK_CATEGORY_SUGGESTIONS: readonly string[] = [
  "20-20-20",
  "blink-drill",
  "near-far-focus",
  "saccade-drill",
  "convergence-exercise",
  "palming",
  "warm-compress",
  "cold-compress",
  "outdoor-time",
  "anti-glare",
  "reading-distance",
  "screen-position",
  "ergonomic-posture",
  "hydration",
  "humidify",
  "lutein-rich-meal",
  "omega-3-meal",
  "vitamin-a-meal",
  "sleep-hygiene",
  "wind-down",
  "blue-light-reduction",
  "ambient-lighting",
  "screen-brightness",
  "eye-rolls",
  "figure-eight",
  "focus-shift",
  "stretch-break",
  "device-detox",
];
