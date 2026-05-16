import type { RequestHandler } from "express";

export const notFoundMiddleware: RequestHandler = (req, res) => {
  res.status(404).json({
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
      path: req.originalUrl,
    },
  });
};

