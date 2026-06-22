/** App locales that every generated daily task must include. */
export const SUPPORTED_TASK_LOCALES = [
  "en",
  "fr",
  "ko",
  "ja",
  "es",
  "de",
  "zh-Hans",
] as const;

export type SupportedTaskLocale = (typeof SUPPORTED_TASK_LOCALES)[number];

const SUPPORTED_SET = new Set<string>(SUPPORTED_TASK_LOCALES);

export function isSupportedTaskLocale(value: string): value is SupportedTaskLocale {
  return SUPPORTED_SET.has(value);
}
