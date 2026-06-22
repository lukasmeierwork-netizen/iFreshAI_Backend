import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { ensureDailyTasksLocaleColumn } from "./db/ensure-daily-tasks-locale-column";
import { ensureDailyTasksTranslationsColumn } from "./db/ensure-daily-tasks-translations-column";
import { ensureNearVisionSightColumns } from "./db/ensure-near-vision-sight-columns";

const log = logger.tagged("server");

void Promise.all([
  ensureNearVisionSightColumns(),
  ensureDailyTasksLocaleColumn(),
  ensureDailyTasksTranslationsColumn(),
]).finally(() => {
  app.listen(env.PORT, () => {
    log.info(`Backend listening on http://localhost:${env.PORT}`);
  });
});
