import type { RequestHandler } from "express";

import { getSupabase } from "../config/supabase";
import { HttpError } from "../errors/http-error";

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Verifies the Supabase access token in `Authorization: Bearer <jwt>` and
 * attaches `req.user = { id, email }`. Rejects with 401 when missing/invalid.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractBearerToken(req.header("authorization"));
    if (!token) {
      throw new HttpError({
        status: 401,
        code: "MISSING_AUTH_TOKEN",
        message: "Missing Authorization Bearer token",
      });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      throw new HttpError({
        status: 401,
        code: "INVALID_AUTH_TOKEN",
        message: error?.message ?? "Invalid or expired token",
      });
    }

    req.user = {
      id: data.user.id,
      email: data.user.email ?? null,
    };
    next();
  } catch (err) {
    next(err);
  }
};
