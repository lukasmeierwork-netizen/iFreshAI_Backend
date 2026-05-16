import type { RequestHandler } from "express";
import { healthService } from "../services/health.service";

const getHealth: RequestHandler = async (req, res) => {
  const result = await healthService.getHealth();
  res.json(result);
};

export const healthController = {
  getHealth,
};

