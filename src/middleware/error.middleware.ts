import type { ErrorRequestHandler } from "express";

import { logger } from "../config/logger";
import { HttpError } from "../errors/http-error";

const log = logger.tagged("http");

export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.requestId ?? "-";

  if (err instanceof HttpError) {
    if (err.status >= 500) {
      log.error({
        requestId,
        code: err.code,
        status: err.status,
        message: err.message,
      });
    }
    res.status(err.status).json({
      ok: false,
      error: { code: err.code, message: err.message, requestId },
    });
    return;
  }

  log.error({
    requestId,
    message: err instanceof Error ? err.message : "Unknown error",
    stack: err instanceof Error ? err.stack : undefined,
  });

  res.status(500).json({
    ok: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected error",
      requestId,
    },
  });
};
