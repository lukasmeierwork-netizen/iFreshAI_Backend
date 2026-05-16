import type { Request } from "express";

import { HttpError } from "../errors/http-error";

/** Type guard for `Record<string, unknown>` (rejects arrays and null). */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** 400 INVALID_PAYLOAD helper for controllers. */
export function badRequest(message: string): HttpError {
  return new HttpError({ status: 400, code: "INVALID_PAYLOAD", message });
}

/** 401 UNAUTHENTICATED helper. */
export function unauthorized(message = "Authentication required"): HttpError {
  return new HttpError({ status: 401, code: "UNAUTHENTICATED", message });
}

/**
 * Asserts that `requireAuth` middleware has populated `req.user.id` and
 * returns it. Use this from controllers behind authenticated routes so the
 * 401 path is in one place instead of inlined everywhere.
 */
export function requireUserId(req: Request): string {
  const userId = req.user?.id;
  if (!userId) throw unauthorized();
  return userId;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a `YYYY-MM-DD` string; throws 400 if shape/value is invalid. */
export function parseIsoDate(raw: unknown, label = "date"): string {
  if (typeof raw !== "string" || !ISO_DATE_RE.test(raw.trim())) {
    throw badRequest(`${label} must be in YYYY-MM-DD format`);
  }
  const trimmed = raw.trim();
  if (!Number.isFinite(Date.parse(`${trimmed}T00:00:00Z`))) {
    throw badRequest(`${label} is not a valid calendar date`);
  }
  return trimmed;
}

/** Parse a non-empty ISO-8601 datetime string; throws 400 on bad input. */
export function parseIsoDateTime(raw: unknown, label = "capturedAt"): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw badRequest(`${label} must be an ISO 8601 string`);
  }
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) {
    throw badRequest(`${label} is not a valid date`);
  }
  return new Date(ts).toISOString();
}

/** Returns a trimmed, length-bounded locale string or `undefined`. */
export function parseLocale(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 16) return undefined;
  return trimmed;
}

/**
 * Parse a positive integer query string. Falls back to `defaultValue` when
 * the value is missing/empty. Throws 400 for other invalid inputs.
 */
export function parsePositiveInt(
  raw: unknown,
  options: { label: string; defaultValue: number; max?: number; min?: number },
): number {
  if (raw == null || raw === "") return options.defaultValue;
  if (typeof raw !== "string") {
    throw badRequest(`${options.label} must be a positive integer`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${options.label} must be a positive integer`);
  }
  const min = options.min ?? 1;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  return Math.max(min, Math.min(max, parsed));
}
