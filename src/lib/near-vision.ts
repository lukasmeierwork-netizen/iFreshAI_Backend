import type {
  NearVisionEyeResult,
  NearVisionResultRow,
} from "../services/near-vision-results.service";

/**
 * Most representative `nSize` for a row, falling back across `both` → `right`
 * → `left`. Higher nSize means a larger letter was required to read, i.e.
 * worse near acuity.
 */
export function pickNSize(row: NearVisionResultRow): number | null {
  const candidates: Array<NearVisionEyeResult | null | undefined> = [
    row.both_result,
    row.right_result,
    row.left_result,
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate.nSize === "number" &&
      Number.isFinite(candidate.nSize)
    ) {
      return candidate.nSize;
    }
  }
  return null;
}

/** First non-empty `approxSnellen` across both → right → left, else `"—"`. */
export function pickApproxSnellen(row: NearVisionResultRow): string {
  const candidates = [row.both_result, row.right_result, row.left_result];
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate.approxSnellen === "string" &&
      candidate.approxSnellen.trim()
    ) {
      return candidate.approxSnellen.trim();
    }
  }
  return "—";
}

/** Sort a copy of `rows` ascending by `captured_at`. */
export function sortRowsByCapturedAt(
  rows: NearVisionResultRow[],
): NearVisionResultRow[] {
  return [...rows].sort(
    (a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at),
  );
}

export type TrendSnapshot = {
  sampleCount: number;
  firstCapturedAt: string | null;
  latestCapturedAt: string | null;
  firstNSize: number | null;
  latestNSize: number | null;
  averageNSize: number | null;
  deltaN: number | null;
  /** Lower nSize is sharper; positive deltaN = worsening. */
  direction: "improving" | "stable" | "declining" | "insufficient";
};

/** Build a structured trend snapshot used by both AI prompts and fallbacks. */
export function buildTrendSnapshot(rows: NearVisionResultRow[]): TrendSnapshot {
  if (rows.length === 0) {
    return {
      sampleCount: 0,
      firstCapturedAt: null,
      latestCapturedAt: null,
      firstNSize: null,
      latestNSize: null,
      averageNSize: null,
      deltaN: null,
      direction: "insufficient",
    };
  }

  const sorted = sortRowsByCapturedAt(rows);
  const nSizes = sorted.map(pickNSize).filter((n): n is number => n != null);
  const firstNSize = nSizes[0] ?? null;
  const latestNSize = nSizes[nSizes.length - 1] ?? null;
  const averageNSize =
    nSizes.length > 0
      ? Number(
          (nSizes.reduce((sum, n) => sum + n, 0) / nSizes.length).toFixed(2),
        )
      : null;
  const deltaN =
    firstNSize != null && latestNSize != null
      ? latestNSize - firstNSize
      : null;
  const direction: TrendSnapshot["direction"] =
    deltaN == null || nSizes.length < 2
      ? "insufficient"
      : deltaN >= 1
        ? "declining"
        : deltaN <= -1
          ? "improving"
          : "stable";

  return {
    sampleCount: sorted.length,
    firstCapturedAt: sorted[0]?.captured_at ?? null,
    latestCapturedAt: sorted[sorted.length - 1]?.captured_at ?? null,
    firstNSize,
    latestNSize,
    averageNSize,
    deltaN,
    direction,
  };
}

/**
 * Compact per-row summary used as `historySamples` in OpenAI prompts. Keeps
 * the prompt focused on the most recent `limit` measurements.
 */
export function summarizeHistoryForPrompt(
  rows: NearVisionResultRow[],
  limit = 12,
) {
  return sortRowsByCapturedAt(rows)
    .slice(-limit)
    .map((row) => ({
      capturedAt: row.captured_at,
      nSize: pickNSize(row),
      both: row.both_result?.nSize ?? null,
      right: row.right_result?.nSize ?? null,
      left: row.left_result?.nSize ?? null,
    }));
}
