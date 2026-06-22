import { getOpenAI, OPENAI_MODEL } from "../config/openai";
import { HttpError } from "../errors/http-error";
import { logger } from "../config/logger";
import { normalizeAppLocale } from "./task-content-locale";
import { SUPPORTED_TASK_LOCALES } from "./supported-task-locales";

const log = logger.tagged("daily-tasks-translate");

export type TranslateTaskInput = {
  id: string;
  title: string;
  description: string;
};

export type TranslatedTaskCopy = {
  title: string;
  description: string;
};

const TRANSLATE_SYSTEM_PROMPT =
  "You translate eye-care daily routine task copy. Output ONLY minified JSON. Preserve meaning, steps, durations, reps, and humor tone. Do not add or remove instructions.";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

async function translateTasksWithOpenAI(input: {
  locale: string;
  tasks: TranslateTaskInput[];
}): Promise<Record<string, TranslatedTaskCopy>> {
  const openai = getOpenAI();
  const payload = input.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
  }));

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: 6000,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: TRANSLATE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Translate every task from English into locale "${input.locale}".`,
          "Output minified JSON exactly like:",
          '{"translations":{"<task-id>":{"title":"...","description":"..."}}}',
          "Include every input id. Keep the same instructional meaning and measurements.",
          `Source tasks: ${JSON.stringify(payload)}`,
        ].join("\n"),
      },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim(),
    );
  } catch {
    log.error(`Translation parse failed. locale=${input.locale} raw=${text.slice(0, 400)}`);
    throw new HttpError({
      status: 502,
      code: "TASK_TRANSLATION_PARSE_FAILED",
      message: "Could not parse translated task content",
    });
  }

  if (!isPlainObject(parsed)) {
    throw new HttpError({
      status: 502,
      code: "TASK_TRANSLATION_INVALID",
      message: "Translated task content was invalid",
    });
  }

  const rawMap = (parsed as { translations?: unknown }).translations;
  if (!isPlainObject(rawMap)) {
    throw new HttpError({
      status: 502,
      code: "TASK_TRANSLATION_INVALID",
      message: "Translated task content was missing translations map",
    });
  }

  const out: Record<string, TranslatedTaskCopy> = {};
  for (const task of input.tasks) {
    const entry = rawMap[task.id];
    if (!isPlainObject(entry)) continue;
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    const description =
      typeof entry.description === "string" ? entry.description.trim() : "";
    if (title && description) {
      out[task.id] = { title, description };
    }
  }

  if (Object.keys(out).length !== input.tasks.length) {
    throw new HttpError({
      status: 502,
      code: "TASK_TRANSLATION_INCOMPLETE",
      message: "Translation did not cover every task",
    });
  }

  return out;
}

export async function translateDailyTasks(input: {
  locale: string;
  tasks: TranslateTaskInput[];
}): Promise<Record<string, TranslatedTaskCopy>> {
  const locale = normalizeAppLocale(input.locale);
  if (locale === "en") {
    return Object.fromEntries(
      input.tasks.map((task) => [
        task.id,
        { title: task.title, description: task.description },
      ]),
    );
  }

  if (!SUPPORTED_TASK_LOCALES.includes(locale as (typeof SUPPORTED_TASK_LOCALES)[number])) {
    throw new HttpError({
      status: 400,
      code: "UNSUPPORTED_LOCALE",
      message: `Unsupported locale: ${locale}`,
    });
  }

  if (input.tasks.length === 0) return {};

  try {
    return await translateTasksWithOpenAI({ locale, tasks: input.tasks });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const message = err instanceof Error ? err.message : "Unknown translation error";
    log.error(`Translation failed. locale=${locale} message=${message}`);
    throw new HttpError({
      status: 502,
      code: "TASK_TRANSLATION_FAILED",
      message: `Task translation error: ${message}`,
    });
  }
}

export const dailyTasksTranslateService = {
  translateDailyTasks,
};
