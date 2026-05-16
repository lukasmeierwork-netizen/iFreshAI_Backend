import express, { type Express } from "express";
import cors from "cors";

import { env } from "./config/env";
import { requestIdMiddleware } from "./middleware/request-id.middleware";
import { httpLoggerMiddleware } from "./middleware/http-logger.middleware";
import { notFoundMiddleware } from "./middleware/not-found.middleware";
import { errorMiddleware } from "./middleware/error.middleware";
import { apiRouter } from "./routes";

/**
 * Builds a fresh Express app. Kept as a factory (rather than only exporting a
 * module-level singleton) so tests / scripts can spin up isolated instances.
 */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    cors({
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "18mb" }));
  app.use(requestIdMiddleware);
  app.use(httpLoggerMiddleware);

  app.use("/", apiRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}

export const app = createApp();
