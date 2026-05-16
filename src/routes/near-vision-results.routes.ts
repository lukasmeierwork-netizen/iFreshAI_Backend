import { Router } from "express";
import { nearVisionResultsController } from "../controllers/near-vision-results.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const visionRouter = Router();

visionRouter.post(
  "/near-results",
  requireAuth,
  nearVisionResultsController.saveNearResults,
);

visionRouter.get(
  "/near-results",
  requireAuth,
  nearVisionResultsController.listNearResults,
);

visionRouter.get(
  "/near-results/insight",
  requireAuth,
  nearVisionResultsController.getNearResultsInsight,
);
