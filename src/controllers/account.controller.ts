import type { RequestHandler } from "express";

import { requireUserId } from "../lib/http";
import { accountService } from "../services/account.service";

const deleteAccount: RequestHandler = async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    await accountService.deleteUser(userId);
    res.status(200).json({ ok: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
};

export const accountController = { deleteAccount };
