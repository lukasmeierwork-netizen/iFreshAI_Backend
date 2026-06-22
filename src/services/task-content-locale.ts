type TaskTextSample = {
  title: string;
  description: string;
};

/** Normalize app locale tags to the set we generate tasks for. */
export function normalizeAppLocale(raw: string | null | undefined): string {
  const trimmed = raw?.trim() || "en";
  if (trimmed === "zh-Hans" || trimmed.startsWith("zh")) return "zh-Hans";
  const base = trimmed.split("-")[0]?.toLowerCase() ?? "en";
  const supported = new Set(["en", "fr", "ko", "ja", "es", "de", "zh-Hans"]);
  if (supported.has(trimmed)) return trimmed;
  if (base === "zh") return "zh-Hans";
  if (supported.has(base)) return base;
  return "en";
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/**
 * Best-effort guess of which app locale existing task copy was written in.
 * Used when the `daily_tasks.locale` column is not available yet.
 */
export function detectTaskContentLocale(tasks: TaskTextSample[]): string {
  if (tasks.length === 0) return "en";

  const sample = tasks
    .slice(0, 4)
    .map((task) => `${task.title} ${task.description}`)
    .join(" ");

  const hangul = countMatches(sample, /[\uAC00-\uD7AF]/g);
  const kana = countMatches(sample, /[\u3040-\u30FF]/g);
  const han = countMatches(sample, /[\u4E00-\u9FFF]/g);
  const latin = countMatches(sample, /[A-Za-zÀ-ÖØ-öø-ÿ]/g);

  if (hangul > 0 && hangul >= latin) return "ko";
  if (kana > 0 && kana >= han) return "ja";
  if (han > 0 && han >= latin) return "zh-Hans";

  const lower = sample.toLowerCase();
  if (/[äöüß]/.test(lower)) return "de";
  if (/[àâçéèêëîïôùûüœæ]/.test(lower)) return "fr";
  if (/[áéíóúñ¿¡]/.test(lower)) return "es";

  return "en";
}

export function taskContentMatchesLocale(
  tasks: TaskTextSample[],
  requestedLocale: string,
): boolean {
  if (tasks.length === 0) return true;
  const expected = normalizeAppLocale(requestedLocale);
  const detected = normalizeAppLocale(detectTaskContentLocale(tasks));
  return detected === expected;
}
