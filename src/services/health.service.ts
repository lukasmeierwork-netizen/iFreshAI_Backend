import { env } from "../config/env";

async function getHealth() {
  return {
    ok: true,
    service: "eyefresh-backend",
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  };
}

export const healthService = {
  getHealth,
};

