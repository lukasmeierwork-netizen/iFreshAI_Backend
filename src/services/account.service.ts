import { logger } from "../config/logger";
import { getSupabase } from "../config/supabase";
import { HttpError } from "../errors/http-error";

const log = logger.tagged("account");

/**
 * Tables we explicitly clear before deleting the auth user. `daily_tasks`
 * already cascades via FK, but listing it here is a safety net in case
 * cascade rules change. `near_vision_results` has no migration in this repo
 * so we MUST clean it explicitly.
 */
const OWNED_TABLES = ["daily_tasks", "near_vision_results"] as const;

async function deleteUser(userId: string): Promise<void> {
  const supabase = getSupabase();

  const cleanups = await Promise.allSettled(
    OWNED_TABLES.map((table) =>
      supabase.from(table).delete().eq("user_id", userId),
    ),
  );
  cleanups.forEach((result, idx) => {
    const table = OWNED_TABLES[idx];
    if (result.status === "fulfilled" && result.value.error) {
      log.error({
        userId,
        table,
        code: "ACCOUNT_DELETE_CLEANUP_FAILED",
        message: result.value.error.message,
      });
    } else if (result.status === "rejected") {
      log.error({
        userId,
        table,
        code: "ACCOUNT_DELETE_CLEANUP_THREW",
        message: String(result.reason),
      });
    }
  });

  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    throw new HttpError({
      status: 500,
      code: "ACCOUNT_DELETE_FAILED",
      message: error.message ?? "Failed to delete user",
    });
  }
}

export const accountService = { deleteUser };
