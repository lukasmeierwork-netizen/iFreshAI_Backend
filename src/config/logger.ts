import chalk from "chalk";

/**
 * Tiny chalk-backed logger so console output is visually identifiable at a
 * glance:
 *
 *   [07:31:04] [openai]  AI generator returned no usable tasks ...
 *   ^ gray     ^ cyan    ^ red / yellow / cyan depending on level
 *
 * Two design choices worth noting:
 *
 *   1. We disable colors when stdout isn't a TTY (e.g. shipped logs on
 *      Vercel) so log aggregators don't see raw ANSI escape codes. Chalk
 *      already does this automatically via `chalk.supportsColor`, but
 *      collapsing it into `chalk.level` here makes the intent explicit.
 *   2. The logger writes through `console.*` so any environment-level
 *      redirection (vercel dev, pm2, supertest captures, …) still works.
 */

if (!process.stdout.isTTY) {
  chalk.level = 0;
}

type LogTag = string;

function timestamp(): string {
  return chalk.gray(`[${new Date().toISOString().slice(11, 19)}]`);
}

function fmtTag(tag: LogTag): string {
  return chalk.cyan(`[${tag}]`);
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack ?? a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

function info(tag: LogTag, ...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(
    `${timestamp()} ${fmtTag(tag)} ${chalk.blue("info")}  ${formatArgs(args)}`,
  );
}

function warn(tag: LogTag, ...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.warn(
    `${timestamp()} ${fmtTag(tag)} ${chalk.yellow("warn")}  ${formatArgs(args)}`,
  );
}

function error(tag: LogTag, ...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.error(
    `${timestamp()} ${fmtTag(tag)} ${chalk.red("error")} ${formatArgs(args)}`,
  );
}

function debug(tag: LogTag, ...args: unknown[]): void {
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line no-console
  console.debug(
    `${timestamp()} ${fmtTag(tag)} ${chalk.gray("debug")} ${formatArgs(args)}`,
  );
}

/**
 * Returns a logger bound to a fixed `tag`, so call sites stay tidy:
 *
 *   const log = logger.tagged("openai");
 *   log.error("call failed", err);
 */
function tagged(tag: LogTag) {
  return {
    info: (...args: unknown[]) => info(tag, ...args),
    warn: (...args: unknown[]) => warn(tag, ...args),
    error: (...args: unknown[]) => error(tag, ...args),
    debug: (...args: unknown[]) => debug(tag, ...args),
  };
}

export const logger = {
  info,
  warn,
  error,
  debug,
  tagged,
};

export type Logger = ReturnType<typeof tagged>;
