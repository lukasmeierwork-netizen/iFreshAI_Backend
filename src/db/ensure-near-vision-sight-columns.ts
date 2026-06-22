import { readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

import { env } from "../config/env";
import { logger } from "../config/logger";

const log = logger.tagged("db");

let ensured = false;

/**
 * Adds `average_distance_cm` and `sight_distance_status` when SUPABASE_DB_URL
 * is configured. Safe to call on every boot — uses IF NOT EXISTS DDL.
 */
export async function ensureNearVisionSightColumns(): Promise<void> {
  if (ensured) return;

  const dbUrl = env.SUPABASE_DB_URL?.trim();
  if (!dbUrl) {
    log.warn(
      "SUPABASE_DB_URL is not set — skipping near_vision_results sight-distance migration. " +
        "List/history still works; sight status is stored only after you run the SQL migration.",
    );
    ensured = true;
    return;
  }

  const migrationPath = join(
    process.cwd(),
    "supabase/migrations/20260528_near_vision_sight_distance.sql",
  );
  const sqlText = readFileSync(migrationPath, "utf8");
  const sql = postgres(dbUrl, { max: 1 });

  try {
    await sql.unsafe(sqlText);
    log.info("near_vision_results sight-distance columns are ready.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Could not apply sight-distance migration: ${message}`);
  } finally {
    await sql.end({ timeout: 5 });
    ensured = true;
  }
}
