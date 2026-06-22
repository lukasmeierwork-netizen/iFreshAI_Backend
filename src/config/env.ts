import dotenv from "dotenv";

// Default `dotenv/config` only reads `.env`. Local dev often uses `.env.local` only (see Vercel/Next.js).
dotenv.config();
dotenv.config({ path: ".env.local" });

export type Env = {
  NODE_ENV: "development" | "test" | "production";
  PORT: number;
  CORS_ORIGIN: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_DB_URL: string;
};

function readNodeEnv(value: string | undefined): Env["NODE_ENV"] {
  if (value === "production" || value === "test" || value === "development") return value;
  return "development";
}

function readPort(value: string | undefined): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3001;
}

export const env: Env = Object.freeze({
  NODE_ENV: readNodeEnv(process.env.NODE_ENV),
  PORT: readPort(process.env.PORT),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "*",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  OPENAI_MODEL: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
  SUPABASE_URL: process.env.SUPABASE_URL ?? "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  SUPABASE_DB_URL: process.env.SUPABASE_DB_URL ?? "",
});

