import { env } from "../config/env";
import { getOpenAI, OPENAI_MODEL } from "../config/openai";
import {
  pickApproxSnellen,
  sortRowsByCapturedAt,
} from "../lib/near-vision";
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
): NearVisionInsight {
  const generatedAt = new Date().toISOString();
  if (rows.length === 0) {
    return {
      title: "Not enough data yet",
      body: `Complete a few more near vision tests over the next ${periodDays} days to unlock a personalized trend analysis.`,
      sampleCount: 0,
      periodDays,
      generatedAt,
    };
  }

  const sorted = sortRowsByCapturedAt(rows);
  const first = sorted[0]!;
  const latest = sorted[sorted.length - 1]!;
  const firstSnellen = pickApproxSnellen(first);
  const latestSnellen = pickApproxSnellen(latest);

  // Use nSize for delta if available; fall back to sample-count framing only.
  const firstN = first.both_result?.nSize ?? first.right_result?.nSize ?? first.left_result?.nSize ?? null;
  const latestN = latest.both_result?.nSize ?? latest.right_result?.nSize ?? latest.left_result?.nSize ?? null;
  const deltaN = firstN != null && latestN != null ? latestN - firstN : 0;

  const trendLabel =
    deltaN >= 2 ? "declined" : deltaN <= -2 ? "improved" : "stayed relatively stable";

  return {
    title: `Last ${periodDays} days: your near vision ${trendLabel}`,
    body: `We analyzed ${sorted.length} test result(s). Your latest value is ${latestSnellen} (first: ${firstSnellen}). Keep test conditions consistent and repeat checks every few days for a more reliable trend.`,
    sampleCount: sorted.length,
    periodDays,
    generatedAt,
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
  // Skip the AI call entirely when there's nothing to summarize or the API
  // key isn't configured — fall back to the deterministic template instead
  // of surfacing a 503 here (this endpoint is best-effort, not blocking).
  if (input.rows.length === 0 || !env.OPENAI_API_KEY) {
    return buildFallbackInsight(input.rows, input.periodDays);
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
      return buildFallbackInsight(input.rows, input.periodDays);
    }

    const title = parsed.title.trim();
    const body = parsed.body.trim();
    if (!title || !body) {
      return buildFallbackInsight(input.rows, input.periodDays);
    }

    return {
      title,
      body,
      sampleCount: input.rows.length,
      periodDays: input.periodDays,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return buildFallbackInsight(input.rows, input.periodDays);
  }
}

export const nearVisionInsightService = {
  buildNearVisionInsight,
};
