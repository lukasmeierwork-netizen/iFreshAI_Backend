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

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

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
  locale: string;
  recentPlans: RecentPlanEntry[];
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

/**
 * Builds the user-facing OpenAI prompt for one day's plan. Grounded in the
 * caller's near-vision history (numbers + trend) so the model can't fall
 * back to generic eye-care boilerplate.
 */
export function buildPrompt(input: BuildPromptInput): {
  prompt: string;
  trend: TrendSnapshot;
} {
  const trend = buildTrendSnapshot(input.history);
  const samples = summarizeHistoryForPrompt(input.history);

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
    "You are the planner for an at-home near-vision care app.",
    "Your job is to produce one day's plan of 8 fully-distinct eye-care techniques, grounded in the user's actual near-vision history (their `nSize` per measurement) — NOT generic boilerplate.",
    "",
    "Output MUST be minified JSON shaped exactly like:",
    '{"tasks":[{"period":"morning|afternoon|evening|night","category":"<kebab-case slug>","title":"...","description":"..."}]}',
    "No code fences, no comments, no trailing prose, no extra keys.",
    "",
    "Hard rules:",
    "1. Exactly 8 tasks: two per period (morning, afternoon, evening, night).",
    "2. Each task MUST be a SPECIFIC technique (not a generic theme). `category` is a free-form kebab-case slug naming that technique (e.g. `blink-drill`, `near-far-focus`, `warm-compress`, `palming`, `20-20-20`, `outdoor-time`, `anti-glare`, `reading-distance`, `humidify`, `saccade-drill`, `lutein-rich-meal`, `screen-brightness`, `wind-down`, `figure-eight`, …). Invent a more specific slug whenever it better matches the user's situation.",
    "3. All 8 `category` slugs in this plan MUST be different from one another.",
    "4. None of the 8 `category` slugs may match a slug already in `recentPlans` below. If a useful technique appears in `recentPlans`, pick a different technique or a meaningfully different variation with a different slug.",
    '5. Titles in this plan must not paraphrase any title in `recentPlans` (no "20-20-20 규칙" three days in a row, no rotating synonyms of the same advice). Pick genuinely different techniques.',
    "6. When `historySamples.length >= 1`, every `description` MUST cite at least one concrete number or date from `historySamples` (an `nSize`, a `capturedAt` date, or a delta between two of them). Never invent numbers not present in `historySamples`.",
    "7. When `historySamples.length === 0`, frame the day as an onboarding plan and say so plainly — do not fabricate prior measurements.",
    "8. Adapt to the trend (lower nSize = sharper vision):",
    "   - declining (latestNSize > firstNSize): emphasize rest, posture, screen breaks, lighting, hydration; recommend booking a professional eye exam if `deltaN >= 2`.",
    "   - stable: reinforce specific maintenance techniques.",
    "   - improving: briefly acknowledge the improvement using the exact numbers, then push consolidation techniques.",
    "   - insufficient: focus on building a baseline of healthy habits.",
    "9. Title <= 60 chars. Description <= 220 chars. Plain text, no markdown, no emoji, no surrounding quotes.",
    "10. Write BOTH title and description fully in the requested locale (translate every word, including the technique name in the title).",
    "11. Safety: only evidence-aligned at-home eye-care suggestions. Never diagnose conditions, never prescribe medication or supplements at clinical doses.",
    "",
    `Locale (BCP-47): ${input.locale}`,
    `Plan date (ISO): ${input.planDate}`,
    `Weekday: ${weekday}`,
    `Trend snapshot: ${JSON.stringify(trend)}`,
    `History samples (oldest -> newest, capturedAt + nSize per eye): ${JSON.stringify(samples)}`,
    `Recent plans to avoid repeating (last 14 days, newest first): ${JSON.stringify(recentForPrompt)}`,
    `Inspiration pool (NOT exhaustive — invent better slugs when appropriate): ${JSON.stringify(DAILY_TASK_CATEGORY_SUGGESTIONS)}`,
  ].join("\n");

  return { prompt, trend };
}

/**
 * Defensive parse of the raw OpenAI response. Strips accidental code fences,
 * drops malformed tasks, and dedupes by slug + lowercase title.
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
    const title = clampString(item.title, 80);
    const description = clampString(item.description, 260);
    if (!period || !category || !title || !description) continue;

    if (seenCategories.has(category)) continue;
    const titleKey = title.toLowerCase();
    if (seenTitles.has(titleKey)) continue;

    seenCategories.add(category);
    seenTitles.add(titleKey);
    out.push({ period, category, title, description });
    if (out.length >= 12) break;
  }
  return out;
}
