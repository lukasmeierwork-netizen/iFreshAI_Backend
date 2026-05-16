import { Router } from "express";
import { accountRouter } from "./account.routes";
import { healthRouter } from "./health.routes";
import { visionRouter } from "./near-vision-results.routes";
import { dailyTasksRouter } from "./daily-tasks.routes";

export const apiRouter = Router();

// Silence default browser favicon requests in API-only backend
apiRouter.get("/favicon.ico", (_req, res) => res.status(204).end());
apiRouter.get("/favicon.png", (_req, res) => res.status(204).end());

apiRouter.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "EyeFresh.ai backend is working",
  });
});

apiRouter.use("/health", healthRouter);
apiRouter.use("/vision", visionRouter);
apiRouter.use("/vision", dailyTasksRouter);
apiRouter.use("/account", accountRouter);

