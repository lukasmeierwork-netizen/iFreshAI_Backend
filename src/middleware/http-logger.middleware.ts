import type { RequestHandler } from "express";

import { logger } from "../config/logger";

const log = logger.tagged("http");

export const httpLoggerMiddleware: RequestHandler = (req, res, next) => {
  const start = performance.now();

  res.on("finish", () => {
    const ms = Math.round(performance.now() - start);
    log.info({
      requestId: req.requestId ?? "-",
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms,
    });
  });

  next();
};
