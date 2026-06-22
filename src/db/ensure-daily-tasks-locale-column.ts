import { readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

import { env } from "../config/env";
import { logger } from "../config/logger";

const log = logger.tagged("db");

let ensured = false;

/**
 * Adds `daily_tasks.locale` when SUPABASE_DB_URL is configured.
 * Safe to call on every boot — uses IF NOT EXISTS DDL.
 */
export async function ensureDailyTasksLocaleColumn(): Promise<void> {
  if (ensured) return;

  const dbUrl = env.SUPABASE_DB_URL?.trim();
  if (!dbUrl) {
    log.warn(
      "SUPABASE_DB_URL is not set — skipping daily_tasks locale migration. " +
        "Tasks still load via legacy schema; locale-based regeneration requires the migration.",
    );
    ensured = true;
    return;
  }

  const migrationPath = join(
    process.cwd(),
    "supabase/migrations/20260607_daily_tasks_locale.sql",
  );
  const sqlText = readFileSync(migrationPath, "utf8");
  const sql = postgres(dbUrl, { max: 1 });

  try {
    await sql.unsafe(sqlText);
    log.info("daily_tasks locale column is ready.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Could not apply daily_tasks locale migration: ${message}`);
  } finally {
    await sql.end({ timeout: 5 });
    ensured = true;
  }
}
