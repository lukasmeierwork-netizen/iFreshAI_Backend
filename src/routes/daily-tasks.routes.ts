import { Router } from "express";

import { dailyTasksController } from "../controllers/daily-tasks.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const dailyTasksRouter = Router();

dailyTasksRouter.get(
  "/daily-tasks",
  requireAuth,
  dailyTasksController.getDailyTasks,
);

dailyTasksRouter.patch(
  "/daily-tasks/:id",
  requireAuth,
  dailyTasksController.updateDailyTask,
);
