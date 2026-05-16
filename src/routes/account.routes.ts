import { Router } from "express";

import { accountController } from "../controllers/account.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const accountRouter = Router();

accountRouter.delete("/", requireAuth, accountController.deleteAccount);
