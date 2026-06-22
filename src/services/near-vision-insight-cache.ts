import type { NearVisionInsight } from "./near-vision-results.service";
import { normalizeInsightLocale } from "./near-vision-insight-fallbacks";

export const INSIGHT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

export type InsightCacheStore = {
  v: 2;
  insights: Record<string, NearVisionInsight>;
};

function isValidInsight(value: unknown): value is NearVisionInsight {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.title === "string" &&
    typeof row.body === "string" &&
    typeof row.sampleCount === "number" &&
    typeof row.periodDays === "number" &&
    typeof row.generatedAt === "string" &&
    Number.isFinite(Date.parse(String(row.generatedAt)))
  );
}

function normalizeStoredInsight(raw: Record<string, unknown>): NearVisionInsight {
  return {
    title: String(raw.title).trim(),
    body: String(raw.body).trim(),
    sampleCount: Number(raw.sampleCount),
    periodDays: Number(raw.periodDays),
    generatedAt: String(raw.generatedAt),
    locale: normalizeInsightLocale(
      typeof raw.locale === "string" ? raw.locale : undefined,
    ),
  };
}

/** Parse `ai_summary` — supports v2 multi-locale map and legacy single insight. */
export function readInsightCache(raw: string | null | undefined): InsightCacheStore {
  if (!raw?.trim()) {
    return { v: 2, insights: {} };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (parsed.v === 2 && parsed.insights && typeof parsed.insights === "object") {
      const insights: Record<string, NearVisionInsight> = {};
      for (const [key, value] of Object.entries(
        parsed.insights as Record<string, unknown>,
      )) {
        if (isValidInsight(value)) {
          const insight = normalizeStoredInsight(value as Record<string, unknown>);
          insights[normalizeInsightLocale(key)] = insight;
        }
      }
      return { v: 2, insights };
    }

    if (isValidInsight(parsed)) {
      const insight = normalizeStoredInsight(parsed);
      return {
        v: 2,
        insights: { [insight.locale]: insight },
      };
    }
  } catch {
    // ignore malformed cache
  }

  return { v: 2, insights: {} };
}

export function pickCachedInsight(
  store: InsightCacheStore,
  locale: string,
  periodDays: number,
  sampleCount: number,
): NearVisionInsight | null {
  const insight = store.insights[normalizeInsightLocale(locale)];
  if (!insight) return null;

  const isFresh =
    Date.now() - Date.parse(insight.generatedAt) < INSIGHT_REFRESH_MS;
  const dataMatches =
    insight.periodDays === periodDays && insight.sampleCount === sampleCount;

  if (!isFresh || !dataMatches) return null;
  return insight;
}

export function mergeInsightIntoCache(
  store: InsightCacheStore,
  insight: NearVisionInsight,
): InsightCacheStore {
  const locale = normalizeInsightLocale(insight.locale);
  return {
    v: 2,
    insights: {
      ...store.insights,
      [locale]: { ...insight, locale },
    },
  };
}

export function serializeInsightCache(store: InsightCacheStore): string {
  return JSON.stringify(store);
}
