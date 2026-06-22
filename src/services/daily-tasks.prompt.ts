import {
  buildTrendSnapshot,
  summarizeHistoryForPrompt,
  type TrendSnapshot,
} from "../lib/near-vision";
import type { NearVisionResultRow } from "./near-vision-results.service";
import {
  DAILY_TASK_CATEGORY_SUGGESTIONS,
  DAILY_TASK_PERIOD_VALUES,
  type DailyTaskCategory,
  type DailyTaskPeriod,
  type UserProfileContext,
} from "./daily-tasks.types";

const PERIOD_SET: ReadonlySet<DailyTaskPeriod> = new Set(
  DAILY_TASK_PERIOD_VALUES,
);

/**
 * Free-form `category` slugs are accepted from the model. We still apply a
 * mild kebab-case shape so the slug renders cleanly in the UI and remains
 * stable across days (used by `recentPlans` anti-repeat memory).
 */
const CATEGORY_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const TASKS_PER_PERIOD = 4;
export const REQUIRED_TASK_COUNT =
  TASKS_PER_PERIOD * DAILY_TASK_PERIOD_VALUES.length;
export const DESCRIPTION_MAX = 320;
export const DESCRIPTION_MIN = 85;
export const TITLE_MAX = 60;

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Vague filler the model must avoid (checked case-insensitively). */
const VAGUE_PHRASES: readonly string[] = [
  "take care of your eyes",
  "take care of your eye",
  "look after your eyes",
  "reduce screen time",
  "stay healthy",
  "rest your eyes",
  "be mindful",
  "eye health is important",
  "keep your eyes healthy",
  "don't forget to",
  "remember to take breaks",
  "take breaks when you can",
  "your eyes will thank you",
];

/**
 * Descriptions should include concrete duration/reps OR an imperative action verb.
 * Works across locales that use digits + sec/min or common English verbs.
 */
const ACTIONABLE_PATTERN =
  /(\d+\s*(sec|secs|second|seconds|min|mins|minute|minutes|times|reps|회|번|초|분|秒|分))|(\b(blink|look|hold|set|place|focus|follow|repeat|close|open|roll|shift|adjust|sit|stand|walk|move|trace|cover|press|breathe|dim|raise|lower|keep|maintain|practice|perform|complete|do)\b)/i;

/** Recurring interval cadence — tasks must be one-time bounded actions, not timers. */
const RECURRING_CADENCE_PATTERN =
  /\b(every|each|per|hourly)\s+(\d+|\bfew\b|\bcouple\b|\bseveral\b)?\s*(min|mins|minute|minutes|hour|hours|sec|second|seconds|분|시간|초|分钟|小时|秒)?/i;

export type TaskLocaleCopy = {
  title: string;
  description: string;
};

export type GeneratedTask = {
  period: DailyTaskPeriod;
  category: DailyTaskCategory;
  title: string;
  description: string;
};

export type RecentPlanEntry = {
  planDate: string;
  period: DailyTaskPeriod;
  category: string;
  title: string;
};

export type BuildPromptInput = {
  history: NearVisionResultRow[];
  planDate: string;
  recentPlans: RecentPlanEntry[];
  userProfile: UserProfileContext;
  /** When set, appended to the prompt to fix a failed quality pass. */
  qualityRetryNotes?: string;
};

export type ValidateGeneratedTasksInput = {
  historySampleCount: number;
};

export type ValidateGeneratedTasksResult = {
  ok: boolean;
  issues: string[];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function clampString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function normalizeCategory(v: unknown): DailyTaskCategory | null {
  if (typeof v !== "string") return null;
  const norm = v
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!norm) return null;
  if (!CATEGORY_SLUG_PATTERN.test(norm)) return null;
  return norm;
}

export function normalizePeriod(v: unknown): DailyTaskPeriod | null {
  if (typeof v !== "string") return null;
  const norm = v.trim().toLowerCase();
  return PERIOD_SET.has(norm as DailyTaskPeriod)
    ? (norm as DailyTaskPeriod)
    : null;
}

function countByPeriod(tasks: GeneratedTask[]): Map<DailyTaskPeriod, number> {
  const counts = new Map<DailyTaskPeriod, number>();
  for (const period of DAILY_TASK_PERIOD_VALUES) counts.set(period, 0);
  for (const task of tasks) {
    counts.set(task.period, (counts.get(task.period) ?? 0) + 1);
  }
  return counts;
}

function hasVaguePhrase(description: string): boolean {
  const lower = description.toLowerCase();
  return VAGUE_PHRASES.some((phrase) => lower.includes(phrase));
}

function isActionableDescription(description: string): boolean {
  return ACTIONABLE_PATTERN.test(description);
}

function hasRecurringCadence(description: string): boolean {
  return RECURRING_CADENCE_PATTERN.test(description);
}

/**
 * Post-generation quality gate: structure, depth, and anti-vague checks.
 * Used to trigger one strict retry before persisting a plan.
 */
export function validateGeneratedTasks(
  tasks: GeneratedTask[],
  input: ValidateGeneratedTasksInput,
): ValidateGeneratedTasksResult {
  const issues: string[] = [];

  if (tasks.length !== REQUIRED_TASK_COUNT) {
    issues.push(
      `Expected exactly ${REQUIRED_TASK_COUNT} tasks, got ${tasks.length}.`,
    );
  }

  const periodCounts = countByPeriod(tasks);
  for (const period of DAILY_TASK_PERIOD_VALUES) {
    const count = periodCounts.get(period) ?? 0;
    if (count !== TASKS_PER_PERIOD) {
      issues.push(
        `Period "${period}" must have exactly ${TASKS_PER_PERIOD} tasks, got ${count}.`,
      );
    }
  }

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    const label = `Task ${i + 1} (${task.period}/${task.category})`;

    if (task.description.length < DESCRIPTION_MIN) {
      issues.push(
        `${label}: description too short (${task.description.length} chars, min ${DESCRIPTION_MIN}).`,
      );
    }
    if (task.description.length > DESCRIPTION_MAX) {
      issues.push(`${label}: description exceeds ${DESCRIPTION_MAX} chars.`);
    }
    if (hasVaguePhrase(task.description)) {
      issues.push(`${label}: description uses vague filler phrasing.`);
    }
    if (!isActionableDescription(task.description)) {
      issues.push(
        `${label}: description lacks concrete steps (duration/reps) or action verbs.`,
      );
    }
    if (hasRecurringCadence(task.description)) {
      issues.push(
        `${label}: description uses recurring interval cadence (e.g. "every N minutes") — each task must be a one-time bounded action for this period.`,
      );
    }
  }

  if (input.historySampleCount >= 1) {
    const personalized = tasks.filter((task) => /\d/.test(task.description)).length;
    if (personalized < 6) {
      issues.push(
        `At least 6 descriptions should reference a concrete measurement or number from history when history exists; only ${personalized} did.`,
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

function summarizeProfileForPrompt(profile: UserProfileContext): Record<string, unknown> {
  return {
    screenTime: profile.screenTime,
    ageRange: profile.ageRange,
    wearsGlasses: profile.wearsGlasses,
    triedEyesightApp: profile.triedEyesightApp,
    calibrationPercent: profile.calibrationPercent,
    hasCameraMonitoring: profile.hasCameraMonitoring,
  };
}

/**
 * Builds the user-facing OpenAI prompt for one day's plan. Grounded in
 * near-vision history and onboarding profile so copy is personal and
 * coach-like — not generic wellness reminders.
 */
export function buildPrompt(input: BuildPromptInput): {
  prompt: string;
  trend: TrendSnapshot;
} {
  const trend = buildTrendSnapshot(input.history);
  const samples = summarizeHistoryForPrompt(input.history);
  const profile = summarizeProfileForPrompt(input.userProfile);

  const planDateObj = new Date(`${input.planDate}T00:00:00Z`);
  const weekday = Number.isFinite(planDateObj.getTime())
    ? WEEKDAY_NAMES[planDateObj.getUTCDay()]
    : "Unknown";

  const recentForPrompt = input.recentPlans.slice(0, 80).map((r) => ({
    d: r.planDate,
    p: r.period,
    c: r.category,
    t: r.title,
  }));

  const prompt = [
    "You are a warm, witty vision coach writing a daily LIFE ROUTINE for an at-home near-vision care app — like a friendly checklist that fits real days (morning rush, work blocks, evening wind-down, bedtime), not a clinical handout.",
    "Produce 16 distinct tasks. Each one is still a real eye-care action with clear steps — but the voice should feel human, lightly funny, and routine-shaped (think: small habits you'd actually do between coffee, meetings, and couch time).",
    "",
    "Tone & voice:",
    "- Sound like a supportive friend who knows optics — playful, never preachy, never cringe meme slang.",
    "- Sprinkle gentle humor in titles and descriptions (self-deprecating screen-time jokes, relatable dev/desk-worker moments, cozy bedtime bits). About 4–6 of the 16 tasks should have a clearly playful line; the rest can be warm but straight.",
    "- Tie tasks to everyday life moments: making coffee, opening the laptop, after lunch, walking the dog, brushing teeth, closing Netflix, etc.",
    "- Humor must NOT replace the actual instruction — the user must still know exactly what to do and for how long.",
    "",
    "Output MUST be minified JSON shaped exactly like:",
    '{"tasks":[{"period":"morning|afternoon|evening|night","category":"<kebab-case slug>","title":"...","description":"..."}]}',
    "Write all title and description fields in English. Other languages are translated later from this source copy.",
    "No code fences, no comments, no trailing prose, no extra keys.",
    "",
    "Life-routine framing by period:",
    "- morning (4 tasks): wake-up / getting-ready / first-screen moments — e.g. while coffee brews, before opening email.",
    "- afternoon (4 tasks): mid-day work or errands — e.g. after lunch, between meetings, desk reset (still one-time each).",
    "- evening (4 tasks): winding down — dinner, commute home, couch scroll, lights dimming.",
    "- night (4 tasks): pre-bed rituals — skincare, reading, lights out, tomorrow prep.",
    "",
    "Structure rules:",
    `1. Exactly ${REQUIRED_TASK_COUNT} tasks: ${TASKS_PER_PERIOD} per period (morning, afternoon, evening, night).`,
    "2. Each task is ONE specific technique woven into daily life — not a generic theme. `category` is a kebab-case slug (e.g. `coffee-gaze-break`, `blink-drill`, `window-daydream-reset`, `playlist-blink-party`).",
    `3. All ${REQUIRED_TASK_COUNT} \`category\` slugs in this plan MUST differ from each other.`,
    `4. None of the ${REQUIRED_TASK_COUNT} \`category\` slugs may match any slug in \`recentPlans\`. Titles must not paraphrase recent titles.`,
    "",
    "Cadence rule (CRITICAL):",
    "- Each task is ONE bounded action the user completes once for that time-of-day period — NOT a recurring timer.",
    "- NEVER instruct \"every N minutes/hours\", \"each hour\", \"throughout the day\", \"set a recurring reminder\", or similar interval cadence.",
    "- DO use a fixed duration or rep count for that single session (e.g. \"for 30 sec\", \"10 full blinks\", \"repeat 5 times\", \"for 2 min\").",
    "- Life triggers are great: \"while the kettle boils\", \"right after you close your lunch tab\", \"before you hit play on the next episode\" — one time only, not on repeat all day.",
    "",
    "Description format (CRITICAL — every description):",
    `- ${DESCRIPTION_MIN}–${DESCRIPTION_MAX} chars. Plain text, no markdown, no emoji.`,
    "- Sentence 1: Concrete HOW in a life-routine moment — one-time steps with fixed duration, reps, or distance. A light joke or relatable aside is welcome here or in sentence 2.",
    "- Sentence 2: Brief WHY — one non-obvious, evidence-aligned insight (keep it smart even if the tone is playful).",
    "- Optional: weave in user history numbers naturally when relevant.",
    "",
    "Title style:",
    `- <= ${TITLE_MAX} chars. Short, routine-friendly, sometimes witty (e.g. \"Coffee stare contest (you'll lose on purpose)\", \"Fridge triangulation drill\").`,
    "",
    "Personalization rules:",
    "- Use `userProfile` when fields are non-null: heavy screen time → one-time setup or recovery exercise (not recurring breaks); wearsGlasses → lens-friendly viewing distance where relevant; age 45+ → accommodative-relief in evening without ageist tone; triedEyesightApp never → foundational habits; calibrationPercent far from 100 → mention test accuracy when suggesting near-vision drills.",
    "- When `userProfile` fields are null, write universally accessible techniques — do not assume heavy screen use, glasses, or age.",
    "- When `historySamples.length >= 1`: at least 6 descriptions must reference a real nSize, date, or delta from `historySamples`. Never invent numbers.",
    "- When `historySamples.length === 0`: frame as a foundational coach plan using profile only; state plainly there is no scan history yet; never fabricate measurements.",
    "- Adapt to `trend.direction` (lower nSize = sharper): declining → one recovery exercise, posture setup, lighting adjustment, professional exam if deltaN >= 2; stable → maintenance drills; improving → acknowledge exact numbers then consolidation; insufficient → baseline habit-building.",
    "",
    "Quality bans — NEVER use vague filler or recurring timers:",
    "\"take care of your eyes\", \"rest your eyes\", \"reduce screen time\" (without a method), \"stay healthy\", \"be mindful\", \"every 20 minutes\", or empty reminders.",
    "Prefer vision-specific techniques over generic wellness (meals, vague hydration, device detox) unless trend is declining or history is empty.",
    "",
    `Title <= ${TITLE_MAX} chars. Write title AND description in English.`,
    "Safety: evidence-aligned at-home eye-care only. Never diagnose, never prescribe clinical doses.",
    "",
    `Plan date (ISO): ${input.planDate}`,
    `Weekday: ${weekday}`,
    `User profile: ${JSON.stringify(profile)}`,
    `Trend snapshot: ${JSON.stringify(trend)}`,
    `History samples (oldest -> newest, capturedAt + nSize per eye): ${JSON.stringify(samples)}`,
    `Recent plans to avoid repeating (last 14 days): ${JSON.stringify(recentForPrompt)}`,
    `Technique inspiration (NOT exhaustive): ${JSON.stringify(DAILY_TASK_CATEGORY_SUGGESTIONS)}`,
    input.qualityRetryNotes
      ? `\nQUALITY FIX REQUIRED — previous output failed validation:\n${input.qualityRetryNotes}\nRegenerate all ${REQUIRED_TASK_COUNT} tasks fixing every issue above.`
      : "",
  ].join("\n");

  return { prompt, trend };
}

function finalizeTaskBatch(raw: GeneratedTask[]): GeneratedTask[] {
  const byPeriod = new Map<DailyTaskPeriod, GeneratedTask[]>();
  for (const period of DAILY_TASK_PERIOD_VALUES) byPeriod.set(period, []);
  for (const task of raw) {
    const list = byPeriod.get(task.period);
    if (list && list.length < TASKS_PER_PERIOD) list.push(task);
  }
  const out: GeneratedTask[] = [];
  for (const period of DAILY_TASK_PERIOD_VALUES) {
    out.push(...(byPeriod.get(period) ?? []));
  }
  return out;
}

/**
 * Defensive parse of the raw OpenAI response. Strips accidental code fences,
 * drops malformed tasks, dedupes by slug + lowercase title, and normalizes
 * to up to REQUIRED_TASK_COUNT tasks with TASKS_PER_PERIOD per period.
 */
export function parseGeneratedTasks(raw: string): GeneratedTask[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!isPlainObject(parsed)) return [];
  const list = (parsed as { tasks?: unknown }).tasks;
  if (!Array.isArray(list)) return [];

  const out: GeneratedTask[] = [];
  const seenCategories = new Set<string>();
  const seenTitles = new Set<string>();

  for (const item of list) {
    if (!isPlainObject(item)) continue;
    const period = normalizePeriod(item.period);
    const category = normalizeCategory(item.category);
    if (!period || !category) continue;

    const title = clampString(item.title, TITLE_MAX);
    const description = clampString(item.description, DESCRIPTION_MAX);
    if (!title || !description) continue;

    if (seenCategories.has(category)) continue;
    const titleKey = title.toLowerCase();
    if (seenTitles.has(titleKey)) continue;

    seenCategories.add(category);
    seenTitles.add(titleKey);
    out.push({ period, category, title, description });
  }

  return finalizeTaskBatch(out);
}
