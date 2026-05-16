import type { RequestHandler } from "express";

import {
  badRequest,
  isPlainObject,
  parseIsoDate,
  parseLocale,
  requireUserId,
} from "../lib/http";
import { dailyTasksService } from "../services/daily-tasks.service";

/**
 * GET /vision/daily-tasks?date=YYYY-MM-DD&locale=…
 *
 * Strict "create once per day" semantics: if there are no rows for
 * `(userId, planDate)` yet, the service runs OpenAI once and persists the
 * result. Every subsequent call for the same day simply re-reads the saved
 * rows — never regenerates.
 *
 * The query `locale` is just a hint used when `public.onboarding.language`
 * is `'system'` or missing; otherwise the onboarding value is authoritative.
 */
const getDailyTasks: RequestHandler = async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const planDate = parseIsoDate(req.query.date);
    const requestLocale = parseLocale(req.query.locale);

    const tasks = await dailyTasksService.ensureForDate({
      userId,
      planDate,
      ...(requestLocale ? { requestLocale } : {}),
    });

    res.status(200).json({ ok: true, data: tasks });
  } catch (err) {
    next(err);
  }
};

const updateDailyTask: RequestHandler = async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const rawTaskId = req.params["id"];
    const taskId = typeof rawTaskId === "string" ? rawTaskId : "";
    if (!taskId || taskId.length < 8) {
      throw badRequest("Task id is required");
    }

    const body = isPlainObject(req.body) ? req.body : {};
    const { completed } = body;
    if (typeof completed !== "boolean") {
      throw badRequest("`completed` must be a boolean");
    }

    const row = await dailyTasksService.setCompleted({
      userId,
      taskId,
      completed,
    });

    res.status(200).json({ ok: true, data: row });
  } catch (err) {
    next(err);
  }
};

export const dailyTasksController = {
  getDailyTasks,
  updateDailyTask,
};
