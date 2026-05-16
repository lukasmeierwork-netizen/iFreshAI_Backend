import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import { HttpError } from "../errors/http-error";

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError({
      status: 500,
      code: "SUPABASE_NOT_CONFIGURED",
      message: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  cached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
