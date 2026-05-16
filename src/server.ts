import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";

const log = logger.tagged("server");

app.listen(env.PORT, () => {
  log.info(`Backend listening on http://localhost:${env.PORT}`);
});
