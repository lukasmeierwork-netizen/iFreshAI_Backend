import { logger } from "../config/logger";
import { getOpenAI, OPENAI_MODEL } from "../config/openai";
import { getSupabase } from "../config/supabase";
import { HttpError } from "../errors/http-error";

import {
  DAILY_TASK_PERIOD_VALUES,
  type DailyTaskCategory,
  type DailyTaskPeriod,
  type UserProfileContext,
} from "./daily-tasks.types";
import {
  buildPrompt,
  normalizePeriod,
  parseGeneratedTasks,
  REQUIRED_TASK_COUNT,
  validateGeneratedTasks,
  type GeneratedTask,
  type RecentPlanEntry,
  type TaskLocaleCopy,
} from "./daily-tasks.prompt";
import { nearVisionResultsService } from "./near-vision-results.service";
import {
  SUPPORTED_TASK_LOCALES,
  type SupportedTaskLocale,
} from "./supported-task-locales";
import {
  detectTaskContentLocale,
  normalizeAppLocale,
} from "./task-content-locale";

export type { DailyTaskCategory, DailyTaskPeriod } from "./daily-tasks.types";

const log = logger.tagged("daily-tasks");
const TABLE = "daily_tasks";

const TASK_COLUMNS =
  "id, user_id, plan_date, period, category, title, description, position, completed, completed_at, source, translations, created_at, updated_at";

const TASK_COLUMNS_LEGACY =
  "id, user_id, plan_date, period, category, title, description, position, completed, completed_at, source, created_at, updated_at";

/** `null` = not yet probed; `false` = DB migration not applied yet. */
let translationsColumnSupported: boolean | null = null;

function useTranslationsColumn(): boolean {
  return translationsColumnSupported !== false;
}

function selectTaskColumns(): string {
  return useTranslationsColumn() ? TASK_COLUMNS : TASK_COLUMNS_LEGACY;
}

function isMissingTranslationsColumnError(
  error: { message?: string } | null,
): boolean {
  const message = error?.message ?? "";
  return (
    message.includes("daily_tasks.translations") ||
    message.includes("column translations") ||
    message.includes("daily_tasks.locale") ||
    message.includes("column locale")
  );
}

export type TaskTranslations = Partial<
  Record<SupportedTaskLocale, TaskLocaleCopy>
>;

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
  locale: string | null;
  translations: TaskTranslations;
  created_at: string;
  updated_at: string;
};

type UserContext = {
  profile: UserProfileContext;
};

function todayUtcIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveReferenceToday(clientToday?: string): string {
  return clientToday ?? todayUtcIsoDate();
}

const HISTORY_WINDOW_DAYS = 60;
const HISTORY_MAX_ROWS = 180;
const RECENT_PLAN_WINDOW_DAYS = 14;
const RECENT_PLAN_LIMIT = 200;

const GENERATION_TEMPERATURE = 0.72;
const GENERATION_TOP_P = 0.92;

const SYSTEM_PROMPT =
  "You output ONLY minified JSON that strictly matches the schema described in the user message. No prose, no code fences. Tasks read like a warm daily life routine with light humor — still medically grounded. Write all copy in English.";

const STRICT_RETRY_SYSTEM_PROMPT =
  "You output ONLY minified JSON. Every task is a ONE-TIME bounded life-routine action (fixed duration or reps) for that time-of-day — NEVER recurring timers. Keep the voice warm and lightly funny where appropriate. Include concrete steps and a brief why-it-works insight. Fix all validation issues in the user message.";

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

function parseTranslationsField(raw: unknown): TaskTranslations {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: TaskTranslations = {};
  for (const locale of SUPPORTED_TASK_LOCALES) {
    const entry = (raw as Record<string, unknown>)[locale];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const title =
      typeof (entry as { title?: unknown }).title === "string"
        ? (entry as { title: string }).title.trim()
        : "";
    const description =
      typeof (entry as { description?: unknown }).description === "string"
        ? (entry as { description: string }).description.trim()
        : "";
    if (title && description) {
      out[locale] = { title, description };
    }
  }
  return out;
}

function buildTranslationsFromLegacy(row: {
  title: string;
  description: string;
  locale: string | null;
}): TaskTranslations {
  const locale = normalizeAppLocale(
    row.locale ?? detectTaskContentLocale([row]),
  ) as SupportedTaskLocale;
  const copy = { title: row.title, description: row.description };
  return { [locale]: copy };
}

function normalizeTaskRow(raw: Record<string, unknown>): DailyTaskRow {
  const period = raw.period;
  const title = String(raw.title ?? "");
  const description = String(raw.description ?? "");
  const locale =
    useTranslationsColumn() && typeof raw.locale === "string"
      ? raw.locale
      : null;

  let translations = useTranslationsColumn()
    ? parseTranslationsField(raw.translations)
    : {};

  if (Object.keys(translations).length === 0 && title && description) {
    translations = buildTranslationsFromLegacy({ title, description, locale });
  }

  const firstTranslation = Object.values(translations).find(
    (copy) => copy?.title && copy?.description,
  );
  const display = translations.en ?? firstTranslation ?? { title, description };

  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    plan_date: String(raw.plan_date),
    period: period as DailyTaskPeriod,
    category: String(raw.category),
    title: display.title,
    description: display.description,
    position: typeof raw.position === "number" ? raw.position : 0,
    completed: raw.completed === true,
    completed_at:
      typeof raw.completed_at === "string" ? raw.completed_at : null,
    source:
      raw.source === "fallback" || raw.source === "manual" ? raw.source : "ai",
    locale,
    translations,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  };
}

function pickCanonicalRow(rows: DailyTaskRow[]): DailyTaskRow {
  const withTranslations = rows.find(
    (row) => Object.keys(row.translations).length >= SUPPORTED_TASK_LOCALES.length,
  );
  if (withTranslations) return withTranslations;

  const english = rows.find((row) => row.locale === "en");
  if (english) return english;

  const completed = rows.find((row) => row.completed);
  if (completed) return completed;

  return rows[0]!;
}

function mergeRowsAtPosition(rows: DailyTaskRow[]): DailyTaskRow {
  const canonical = pickCanonicalRow(rows);
  const mergedTranslations: TaskTranslations = { ...canonical.translations };

  for (const row of rows) {
    if (row.translations) {
      for (const locale of SUPPORTED_TASK_LOCALES) {
        const copy = row.translations[locale];
        if (copy && !mergedTranslations[locale]) {
          mergedTranslations[locale] = copy;
        }
      }
    }
    const legacyLocale = normalizeAppLocale(
      row.locale ?? detectTaskContentLocale([row]),
    ) as SupportedTaskLocale;
    if (!mergedTranslations[legacyLocale]) {
      mergedTranslations[legacyLocale] = {
        title: row.title,
        description: row.description,
      };
    }
    if (row.completed && !canonical.completed) {
      canonical.completed = true;
      canonical.completed_at = row.completed_at;
    }
  }

  const translations = mergedTranslations;
  const firstTranslation = Object.values(translations).find(
    (copy) => copy?.title && copy?.description,
  );
  const display =
    translations.en ??
    firstTranslation ??
    { title: canonical.title, description: canonical.description };

  return {
    ...canonical,
    title: display.title,
    description: display.description,
    translations,
    locale: null,
  };
}

function collapseLegacyBatches(rows: DailyTaskRow[]): DailyTaskRow[] {
  if (rows.length <= REQUIRED_TASK_COUNT) {
    return sortTasks(rows);
  }

  const byPosition = new Map<number, DailyTaskRow[]>();
  for (const row of rows) {
    const list = byPosition.get(row.position) ?? [];
    list.push(row);
    byPosition.set(row.position, list);
  }

  const merged: DailyTaskRow[] = [];
  for (const [, candidates] of byPosition) {
    if (candidates.length === 1) {
      merged.push(candidates[0]!);
      continue;
    }
    merged.push(mergeRowsAtPosition(candidates));
  }

  return sortTasks(merged);
}

async function listForDate(
  userId: string,
  planDate: string,
): Promise<DailyTaskRow[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(TABLE)
    .select(selectTaskColumns())
    .eq("user_id", userId)
    .eq("plan_date", planDate);

  if (error && isMissingTranslationsColumnError(error) && useTranslationsColumn()) {
    translationsColumnSupported = false;
    log.warn(
      "daily_tasks.translations column missing — run migration 20260609_daily_tasks_translations.sql. Falling back to legacy schema.",
    );
    return listForDate(userId, planDate);
  }

  if (error) {
    throw new HttpError({
      status: 500,
      code: "DAILY_TASKS_LIST_FAILED",
      message: error.message ?? "Failed to load daily tasks",
    });
  }

  if (useTranslationsColumn()) {
    translationsColumnSupported = true;
  }

  const rows = (data ?? []).map((row) =>
    normalizeTaskRow(row as unknown as Record<string, unknown>),
  );

  return collapseLegacyBatches(rows);
}

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

async function loadUserContext(userId: string): Promise<UserContext> {
  const emptyProfile: UserProfileContext = {
    screenTime: null,
    ageRange: null,
    wearsGlasses: null,
    triedEyesightApp: null,
    calibrationPercent: null,
    hasCameraMonitoring: null,
  };

  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from("onboarding")
      .select(
        "screen_time, age, wears_glasses, tried_eyesight_app, calibrate, camera_permission_granted",
      )
      .eq("user_id", userId)
      .maybeSingle<{
        screen_time: string | null;
        age: string | null;
        wears_glasses: boolean | null;
        tried_eyesight_app: string | null;
        calibrate: number | null;
        camera_permission_granted: boolean | null;
      }>();

    if (error || !data) {
      return { profile: emptyProfile };
    }

    return {
      profile: {
        screenTime: data.screen_time ?? null,
        ageRange: data.age ?? null,
        wearsGlasses: data.wears_glasses ?? null,
        triedEyesightApp: data.tried_eyesight_app ?? null,
        calibrationPercent:
          typeof data.calibrate === "number" ? data.calibrate : null,
        hasCameraMonitoring: data.camera_permission_granted ?? null,
      },
    };
  } catch {
    return { profile: emptyProfile };
  }
}

async function callOpenAI(input: {
  prompt: string;
  planDate: string;
  strictRetry: boolean;
}): Promise<string> {
  const openai = getOpenAI();

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: 8000,
    temperature: input.strictRetry
      ? GENERATION_TEMPERATURE * 0.85
      : GENERATION_TEMPERATURE,
    top_p: GENERATION_TOP_P,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: input.strictRetry ? STRICT_RETRY_SYSTEM_PROMPT : SYSTEM_PROMPT,
      },
      { role: "user", content: input.prompt },
    ],
  });

  return completion.choices[0]?.message?.content ?? "";
}

async function generateTasksWithOpenAI(input: {
  historySampleCount: number;
  planDate: string;
  userProfile: UserProfileContext;
  history: Awaited<
    ReturnType<typeof nearVisionResultsService.listByUserSince>
  >;
  recentPlans: RecentPlanEntry[];
}): Promise<GeneratedTask[]> {
  const { prompt } = buildPrompt({
    history: input.history,
    planDate: input.planDate,
    recentPlans: input.recentPlans,
    userProfile: input.userProfile,
  });

  try {
    let text = await callOpenAI({
      prompt,
      planDate: input.planDate,
      strictRetry: false,
    });

    let tasks = parseGeneratedTasks(text);
    let validation = validateGeneratedTasks(tasks, {
      historySampleCount: input.historySampleCount,
    });

    if (!validation.ok) {
      log.warn(
        `Task quality check failed (attempt 1). planDate=${input.planDate} issues=${validation.issues.join(" | ")}`,
      );

      const retryPrompt = buildPrompt({
        history: input.history,
        planDate: input.planDate,
        recentPlans: input.recentPlans,
        userProfile: input.userProfile,
        qualityRetryNotes: validation.issues.join("\n"),
      }).prompt;

      text = await callOpenAI({
        prompt: retryPrompt,
        planDate: input.planDate,
        strictRetry: true,
      });

      tasks = parseGeneratedTasks(text);
      validation = validateGeneratedTasks(tasks, {
        historySampleCount: input.historySampleCount,
      });

      if (!validation.ok) {
        log.warn(
          `Task quality check failed (attempt 2). planDate=${input.planDate} accepting best effort if count=${tasks.length}. issues=${validation.issues.join(" | ")}`,
        );
      }
    }

    if (tasks.length === 0) {
      log.error(
        `OpenAI returned no usable tasks. model=${OPENAI_MODEL} planDate=${input.planDate} raw=${text.slice(0, 600)}`,
      );
      throw new HttpError({
        status: 502,
        code: "OPENAI_EMPTY_RESPONSE",
        message: "AI generator returned no usable tasks for the day",
      });
    }

    if (tasks.length < REQUIRED_TASK_COUNT) {
      log.error(
        `OpenAI returned incomplete plan (${tasks.length}/${REQUIRED_TASK_COUNT}). planDate=${input.planDate} raw=${text.slice(0, 600)}`,
      );
      throw new HttpError({
        status: 502,
        code: "OPENAI_INCOMPLETE_RESPONSE",
        message: "AI generator returned an incomplete daily plan",
      });
    }

    return tasks;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const message = err instanceof Error ? err.message : "Unknown OpenAI error";
    log.error(
      `OpenAI call failed. model=${OPENAI_MODEL} planDate=${input.planDate} message=${message}`,
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
    ...(useTranslationsColumn()
      ? {
          translations: {
            en: { title: task.title, description: task.description },
          },
        }
      : {}),
  }));

  const { data, error } = await supabase
    .from(TABLE)
    .insert(rows)
    .select(selectTaskColumns());

  if (error && isMissingTranslationsColumnError(error) && useTranslationsColumn()) {
    translationsColumnSupported = false;
    return insertTasks(userId, planDate, generated);
  }

  if (error) {
    throw new HttpError({
      status: 500,
      code: "DAILY_TASKS_INSERT_FAILED",
      message: error.message ?? "Failed to save generated daily tasks",
    });
  }

  if (useTranslationsColumn()) {
    translationsColumnSupported = true;
  }

  return sortTasks(
    (data ?? []).map((row) =>
      normalizeTaskRow(row as unknown as Record<string, unknown>),
    ),
  );
}

/**
 * Ensures a multilingual plan exists for `(userId, planDate)`. One canonical
 * task set is generated once per day; language switching reads stored
 * translations instead of creating duplicate rows.
 *
 * Generation runs only when `planDate` matches the client's current calendar
 * day (or UTC today when `clientToday` is omitted).
 */
async function ensureForDate(input: {
  userId: string;
  planDate: string;
  clientToday?: string;
}): Promise<DailyTaskRow[]> {
  const existing = await listForDate(input.userId, input.planDate);
  if (existing.length >= REQUIRED_TASK_COUNT) {
    return existing;
  }

  const today = resolveReferenceToday(input.clientToday);
  if (input.planDate !== today) {
    log.info(
      `Skipping task generation for non-current date. planDate=${input.planDate} today=${today}`,
    );
    return existing;
  }

  log.info(`Generating daily tasks. planDate=${input.planDate}`);

  const userContext = await loadUserContext(input.userId);

  const sinceIso = new Date(
    Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [history, recentPlans] = await Promise.all([
    nearVisionResultsService.listByUserSince(
      input.userId,
      sinceIso,
      HISTORY_MAX_ROWS,
    ),
    listRecentPlans(input.userId, input.planDate),
  ]);

  const historySampleCount = history.length;

  const generated = await generateTasksWithOpenAI({
    historySampleCount,
    planDate: input.planDate,
    userProfile: userContext.profile,
    history,
    recentPlans,
  });

  const fresh = await listForDate(input.userId, input.planDate);
  if (fresh.length >= REQUIRED_TASK_COUNT) return fresh;

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
    .select(selectTaskColumns())
    .single();

  if (error && isMissingTranslationsColumnError(error) && useTranslationsColumn()) {
    translationsColumnSupported = false;
    return setCompleted(input);
  }

  if (error || !data) {
    throw new HttpError({
      status: 404,
      code: "DAILY_TASK_UPDATE_FAILED",
      message: error?.message ?? "Daily task not found or update rejected",
    });
  }

  return normalizeTaskRow(data as unknown as Record<string, unknown>);
}

export const dailyTasksService = {
  ensureForDate,
  listForDate,
  setCompleted,
};
