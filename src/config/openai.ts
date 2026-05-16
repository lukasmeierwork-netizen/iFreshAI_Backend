import OpenAI from "openai";

import { env } from "./env";
import { HttpError } from "../errors/http-error";

let cached: OpenAI | null = null;

/**
 * Returns a process-wide singleton `OpenAI` client. We deliberately avoid
 * constructing the client at module load so the rest of the app can still
 * boot (health checks, Supabase routes, etc.) when `OPENAI_API_KEY` is
 * missing — the throw only happens the first time an AI-powered code path
 * actually asks for the client.
 */
export function getOpenAI(): OpenAI {
  if (cached) return cached;

  if (!env.OPENAI_API_KEY) {
    throw new HttpError({
      status: 503,
      code: "OPENAI_NOT_CONFIGURED",
      message: "OPENAI_API_KEY is not configured on the server",
    });
  }

  cached = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return cached;
}

/** Default chat-completions model, overridable via `OPENAI_MODEL`. */
export const OPENAI_MODEL = env.OPENAI_MODEL;
