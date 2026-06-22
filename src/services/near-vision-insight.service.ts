import { env } from "../config/env";
import { getOpenAI, OPENAI_MODEL } from "../config/openai";
import {
  pickApproxSnellen,
  sortRowsByCapturedAt,
} from "../lib/near-vision";
import {
  fallbackInsightCopy,
  normalizeInsightLocale,
} from "./near-vision-insight-fallbacks";
import type {
  NearVisionInsight,
  NearVisionResultRow,
} from "./near-vision-results.service";

type BuildNearVisionInsightInput = {
  rows: NearVisionResultRow[];
  periodDays: number;
  locale?: string;
};

function buildFallbackInsight(
  rows: NearVisionResultRow[],
  periodDays: number,
  locale?: string,
): NearVisionInsight {
  const resolvedLocale = normalizeInsightLocale(locale);
  const copy = fallbackInsightCopy(resolvedLocale);
  const generatedAt = new Date().toISOString();
  if (rows.length === 0) {
    return {
      title: copy.emptyTitle,
      body: copy.emptyBody(periodDays),
      sampleCount: 0,
      periodDays,
      generatedAt,
      locale: resolvedLocale,
    };
  }

  const sorted = sortRowsByCapturedAt(rows);
  const first = sorted[0]!;
  const latest = sorted[sorted.length - 1]!;
  const firstSnellen = pickApproxSnellen(first);
  const latestSnellen = pickApproxSnellen(latest);

  const firstN = first.both_result?.nSize ?? first.right_result?.nSize ?? first.left_result?.nSize ?? null;
  const latestN = latest.both_result?.nSize ?? latest.right_result?.nSize ?? latest.left_result?.nSize ?? null;
  const deltaN = firstN != null && latestN != null ? latestN - firstN : 0;

  const trend: "declined" | "improved" | "stable" =
    deltaN >= 2 ? "declined" : deltaN <= -2 ? "improved" : "stable";

  return {
    title: copy.trendTitle(periodDays, trend),
    body: copy.trendBody(sorted.length, latestSnellen, firstSnellen),
    sampleCount: sorted.length,
    periodDays,
    generatedAt,
    locale: resolvedLocale,
  };
}

function buildPrompt(input: BuildNearVisionInsightInput): string {
  const locale = input.locale?.trim() || "en";
  const rows = input.rows.map((row) => ({
    capturedAt: row.captured_at,
    both: row.both_result,
    right: row.right_result,
    left: row.left_result,
  }));

  return [
    "You are generating concise eye-test trend feedback for a mobile app.",
    'Respond ONLY as minified JSON with this exact shape: {"title":"...","body":"..."}.',
    "No markdown, no code fences, no extra keys.",
    "Write in the requested locale if possible.",
    "Safety constraints:",
    "- Educational guidance only; never diagnose or prescribe treatment.",
    "- If worsening trend appears, suggest considering a professional eye exam.",
    "- Keep title <= 80 chars and body <= 220 chars.",
    `Locale: ${locale}`,
    `Analysis window: ${input.periodDays} days`,
    `Rows JSON: ${JSON.stringify(rows)}`,
  ].join("\n");
}

async function buildNearVisionInsight(
  input: BuildNearVisionInsightInput,
): Promise<NearVisionInsight> {
  const resolvedLocale = normalizeInsightLocale(input.locale);

  if (input.rows.length === 0 || !env.OPENAI_API_KEY) {
    return buildFallbackInsight(input.rows, input.periodDays, resolvedLocale);
  }

  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You output ONLY minified JSON matching {"title":string,"body":string}. No prose, no code fences.',
        },
        { role: "user", content: buildPrompt(input) },
      ],
    });

    const text = (completion.choices[0]?.message?.content ?? "").trim();
    const parsed = JSON.parse(text) as { title?: unknown; body?: unknown };
    if (typeof parsed.title !== "string" || typeof parsed.body !== "string") {
      return buildFallbackInsight(input.rows, input.periodDays, resolvedLocale);
    }

    const title = parsed.title.trim();
    const body = parsed.body.trim();
    if (!title || !body) {
      return buildFallbackInsight(input.rows, input.periodDays, resolvedLocale);
    }

    return {
      title,
      body,
      sampleCount: input.rows.length,
      periodDays: input.periodDays,
      generatedAt: new Date().toISOString(),
      locale: resolvedLocale,
    };
  } catch {
    return buildFallbackInsight(input.rows, input.periodDays, resolvedLocale);
  }
}

export const nearVisionInsightService = {
  buildNearVisionInsight,
};
