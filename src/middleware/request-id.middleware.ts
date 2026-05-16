import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.headers["x-request-id"];
  const requestId =
    typeof incoming === "string" && incoming.trim() ? incoming.trim() : randomUUID();
  res.setHeader("x-request-id", requestId);
  req.requestId = requestId;
  next();
};
