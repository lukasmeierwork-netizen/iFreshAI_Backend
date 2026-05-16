import { logger } from "../config/logger";
import { getOpenAI, OPENAI_MODEL } from "../config/openai";
import { getSupabase } from "../config/supabase";
import { HttpError } from "../errors/http-error";

import {
  DAILY_TASK_PERIOD_VALUES,
  type DailyTaskCategory,
  type DailyTaskPeriod,
} from "./daily-tasks.types";
import {
  buildPrompt,
  normalizePeriod,
  parseGeneratedTasks,
  type GeneratedTask,
  type RecentPlanEntry,
} from "./daily-tasks.prompt";
import { nearVisionResultsService } from "./near-vision-results.service";

export type { DailyTaskCategory, DailyTaskPeriod } from "./daily-tasks.types";

const log = logger.tagged("daily-tasks");
const TABLE = "daily_tasks";

const TASK_COLUMNS =
  "id, user_id, plan_date, period, category, title, description, position, completed, completed_at, source, created_at, updated_at";

const HISTORY_WINDOW_DAYS = 60;
const HISTORY_MAX_ROWS = 180;
const RECENT_PLAN_WINDOW_DAYS = 14;
const RECENT_PLAN_LIMIT = 200;

export type DailyTaskRow = {
  id: string;
  user_id: string;
  plan_date: string;
  period: DailyTaskPeriod;
  category: DailyTaskCategory;
  title: string;
  description: string;
  position: number;
  completed: boolean;
  completed_at: string | null;
  source: "ai" | "fallback" | "manual";
  created_at: string;
  updated_at: string;
};

function periodIndex(period: DailyTaskPeriod): number {
  return DAILY_TASK_PERIOD_VALUES.indexOf(period);
}

function sortTasks(tasks: DailyTaskRow[]): DailyTaskRow[] {
  return [...tasks].sort((a, b) => {
    const pa = periodIndex(a.period);
    const pb = periodIndex(b.period);
    if (pa !== pb) return pa - pb;
    if (a.position !== b.position) return a.position - b.position;
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  });
}

async function listForDate(
  userId: string,
  planDate: string,
): Promise<DailyTaskRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select(TASK_COLUMNS)
    .eq("user_id", userId)
    .eq("plan_date", planDate);

  if (error) {
    throw new HttpError({
      status: 500,
      code: "DAILY_TASKS_LIST_FAILED",
      message: error.message ?? "Failed to load daily tasks",
    });
  }

  return sortTasks((data ?? []) as DailyTaskRow[]);
}

/**
 * Last `RECENT_PLAN_WINDOW_DAYS` of saved tasks for `userId`, EXCLUDING
 * `excludePlanDate`. Fed back into the prompt so the model can avoid
 * repeating techniques (or their wording) day-over-day.
 */
async function listRecentPlans(
  userId: string,
  excludePlanDate: string,
): Promise<RecentPlanEntry[]> {
  const supabase = getSupabase();
  const excludeMs = Date.parse(`${excludePlanDate}T00:00:00Z`);
  if (Number.isNaN(excludeMs)) return [];

  const sinceDate = new Date(
    excludeMs - RECENT_PLAN_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from(TABLE)
    .select("plan_date, period, category, title")
    .eq("user_id", userId)
    .neq("plan_date", excludePlanDate)
    .gte("plan_date", sinceDate)
    .lte("plan_date", excludePlanDate)
    .order("plan_date", { ascending: false })
    .limit(RECENT_PLAN_LIMIT);

  if (error || !data) return [];

  const out: RecentPlanEntry[] = [];
  for (const row of data as Array<{
    plan_date: string;
    period: string;
    category: string;
    title: string;
  }>) {
    const period = normalizePeriod(row.period);
    if (!period) continue;
    out.push({
      planDate: row.plan_date,
      period,
      category: typeof row.category === "string" ? row.category : "",
      title: typeof row.title === "string" ? row.title : "",
    });
  }
  return out;
}

async function resolveLocale(
  userId: string,
  requestLocale: string | undefined,
): Promise<string> {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from("onboarding")
      .select("language")
      .eq("user_id", userId)
      .maybeSingle<{ language: string | null }>();
    if (!error && data?.language && data.language !== "system") {
      const lang = data.language.trim();
      if (lang) return lang;
    }
  } catch {
    // Onboarding row may not exist yet (early dev / skip-onboarding). Fall
    // through to the request-supplied locale (device-resolved by the client).
  }
  return requestLocale?.trim() || "en";
}

async function generateTasksWithOpenAI(input: {
  prompt: string;
  planDate: string;
  locale: string;
}): Promise<GeneratedTask[]> {
  // `getOpenAI()` throws a 503 HttpError when the API key is missing — no
  // separate guard needed here.
  const openai = getOpenAI();

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      // Generous temperature so day-to-day requests with similar inputs still
      // produce visibly different wording. Still constrained to JSON output.
      temperature: 1.1,
      top_p: 0.95,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You output ONLY minified JSON that strictly matches the schema described in the user message. No prose, no code fences.",
        },
        { role: "user", content: input.prompt },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const tasks = parseGeneratedTasks(text);

    if (tasks.length === 0) {
      log.error(
        `OpenAI returned no usable tasks. model=${OPENAI_MODEL} planDate=${input.planDate} locale=${input.locale} raw=${text.slice(0, 600)}`,
      );
      throw new HttpError({
        status: 502,
        code: "OPENAI_EMPTY_RESPONSE",
        message: "AI generator returned no usable tasks for the day",
      });
    }
    return tasks;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const message = err instanceof Error ? err.message : "Unknown OpenAI error";
    log.error(
      `OpenAI call failed. model=${OPENAI_MODEL} planDate=${input.planDate} locale=${input.locale} message=${message}`,
    );
    throw new HttpError({
      status: 502,
      code: "OPENAI_GENERATION_FAILED",
      message: `AI generator error: ${message}`,
    });
  }
}

async function insertTasks(
  userId: string,
  planDate: string,
  generated: GeneratedTask[],
): Promise<DailyTaskRow[]> {
  if (generated.length === 0) return [];

  const supabase = getSupabase();
  const rows = generated.map((task, idx) => ({
    user_id: userId,
    plan_date: planDate,
    period: task.period,
    category: task.category,
    title: task.title,
    description: task.description,
    position: idx,
    source: "ai" as const,
  }));

  const { data, error } = await supabase
    .from(TABLE)
    .insert(rows)
    .select(TASK_COLUMNS);

  if (error) {
    throw new HttpError({
      status: 500,
      code: "DAILY_TASKS_INSERT_FAILED",
      message: error.message ?? "Failed to save generated daily tasks",
    });
  }

  return sortTasks((data ?? []) as DailyTaskRow[]);
}

/**
 * "Create once per day" semantics: if any rows already exist for
 * `(userId, planDate)`, return them as-is. Only the very first request for
 * a given day generates a plan via OpenAI, using the user's
 * `near_vision_results` history as the only seed for content.
 *
 * Locale is resolved server-side from `public.onboarding.language` — the
 * client-supplied `requestLocale` is only used when onboarding is `'system'`
 * or absent (so the device language can still leak through for new users).
 *
 * If OpenAI is unavailable or returns nothing parseable, the call surfaces
 * a 502/503 error so the client can show a clear retry state — there is no
 * static fallback content; daily-tasks copy is always history-driven.
 */
async function ensureForDate(input: {
  userId: string;
  planDate: string;
  requestLocale?: string;
}): Promise<DailyTaskRow[]> {
  const existing = await listForDate(input.userId, input.planDate);
  if (existing.length > 0) return existing;

  const sinceIso = new Date(
    Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [locale, history, recentPlans] = await Promise.all([
    resolveLocale(input.userId, input.requestLocale),
    nearVisionResultsService.listByUserSince(
      input.userId,
      sinceIso,
      HISTORY_MAX_ROWS,
    ),
    listRecentPlans(input.userId, input.planDate),
  ]);

  const { prompt } = buildPrompt({
    history,
    planDate: input.planDate,
    locale,
    recentPlans,
  });

  const generated = await generateTasksWithOpenAI({
    prompt,
    planDate: input.planDate,
    locale,
  });

  // Re-check inside the insert path to avoid a duplicate batch if two
  // requests for the same `(user, day)` race: the second one will hit the
  // existing rows and return them instead of inserting again.
  const fresh = await listForDate(input.userId, input.planDate);
  if (fresh.length > 0) return fresh;

  return insertTasks(input.userId, input.planDate, generated);
}

async function setCompleted(input: {
  userId: string;
  taskId: string;
  completed: boolean;
}): Promise<DailyTaskRow> {
  const supabase = getSupabase();
  const completedAt = input.completed ? new Date().toISOString() : null;

  const { data, error } = await supabase
    .from(TABLE)
    .update({ completed: input.completed, completed_at: completedAt })
    .eq("id", input.taskId)
    .eq("user_id", input.userId)
    .select(TASK_COLUMNS)
    .single();

  if (error || !data) {
    throw new HttpError({
      status: 404,
      code: "DAILY_TASK_UPDATE_FAILED",
      message: error?.message ?? "Daily task not found or update rejected",
    });
  }

  return data as DailyTaskRow;
}

export const dailyTasksService = {
  ensureForDate,
  setCompleted,
};
