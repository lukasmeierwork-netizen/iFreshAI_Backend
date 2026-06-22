/**
 * Applies the near_vision_results sight-distance migration using a direct Postgres URL.
 *
 * Usage:
 *   SUPABASE_DB_URL="postgresql://postgres.[ref]:[password]@...supabase.com:5432/postgres" \
 *     npx tsx scripts/apply-sight-distance-migration.ts
 *
 * Find the connection string in Supabase → Project Settings → Database → URI.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config();
dotenv.config({ path: ".env.local" });

const dbUrl = process.env.SUPABASE_DB_URL?.trim();
if (!dbUrl) {
  console.error(
    "Missing SUPABASE_DB_URL. Add your Supabase Postgres URI to .env or .env.local, then rerun.",
  );
  process.exit(1);
}

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260528_near_vision_sight_distance.sql",
);
const sqlText = readFileSync(migrationPath, "utf8");

async function main() {
  const sql = postgres(dbUrl, { max: 1 });
  try {
    await sql.unsafe(sqlText);
    console.log("Applied near-vision sight-distance migration successfully.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Migration failed: ${message}`);
  process.exit(1);
});
