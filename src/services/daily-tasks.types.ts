/** Shared type primitives for the daily-tasks feature. */

export type DailyTaskPeriod = "morning" | "afternoon" | "evening" | "night";

/**
 * Free-form category slug. The LLM picks the specific technique per task
 * (e.g. `blink-drill`, `near-far-focus`, `accommodative-relief`). We
 * deliberately do NOT constrain this to a closed enum so day-to-day plans
 * don't collapse into the same 8 canonical recommendations.
 */
export type DailyTaskCategory = string;

export const DAILY_TASK_PERIOD_VALUES: readonly DailyTaskPeriod[] = [
  "morning",
  "afternoon",
  "evening",
  "night",
];

/**
 * Vision-specific technique pool surfaced to the model. Prefer these over
 * generic wellness advice; the model may invent a more specific slug when
 * the user's history or profile calls for it.
 */
export const DAILY_TASK_CATEGORY_SUGGESTIONS: readonly string[] = [
  "distance-focus-reset",
  "blink-drill",
  "tear-film-reset",
  "near-far-focus",
  "accommodative-relief",
  "vergence-pencil-push",
  "saccade-drill",
  "convergence-exercise",
  "palming",
  "warm-compress",
  "figure-eight",
  "focus-shift",
  "reading-distance",
  "screen-position",
  "anti-glare",
  "ambient-lighting",
  "screen-brightness",
  "ergonomic-posture",
  "outdoor-time",
  "humidify",
  "blue-light-reduction",
  "wind-down",
  "peripheral-awareness",
  "coffee-gaze-break",
  "window-daydream-reset",
  "shower-steam-refresh",
  "walk-and-focus",
  "playlist-blink-party",
  "fridge-triangulation",
  "pet-across-the-room",
];

/** Onboarding fields used to personalize daily task copy. */
export type UserProfileContext = {
  screenTime: string | null;
  ageRange: string | null;
  wearsGlasses: boolean | null;
  triedEyesightApp: string | null;
  calibrationPercent: number | null;
  hasCameraMonitoring: boolean | null;
};
