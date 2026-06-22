import type { RequestHandler } from "express";

import {
  badRequest,
  isPlainObject,
  parseIsoDate,
  parseLocale,
  requireUserId,
} from "../lib/http";
import { dailyTasksService } from "../services/daily-tasks.service";
import { dailyTasksTranslateService } from "../services/daily-tasks-translate.service";

/**
 * GET /vision/daily-tasks?date=YYYY-MM-DD&today=YYYY-MM-DD
 *
 * Ensures one English-source task plan exists for `(userId, planDate)`.
 * Tasks are generated only when `date` equals `today` (client local calendar
 * day); past and future dates return stored rows without generation.
 * Localized copy is created lazily via POST /daily-tasks/translate.
 */
const getDailyTasks: RequestHandler = async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const planDate = parseIsoDate(req.query.date);
    const rawToday = req.query.today;
    const clientToday =
      typeof rawToday === "string" && rawToday.trim().length > 0
        ? parseIsoDate(rawToday, "today")
        : undefined;

    const tasks = await dailyTasksService.ensureForDate({
      userId,
      planDate,
      clientToday,
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

const translateDailyTasks: RequestHandler = async (req, res, next) => {
  try {
    requireUserId(req);
    const body = isPlainObject(req.body) ? req.body : {};
    const locale = parseLocale(body.locale);
    if (!locale) {
      throw badRequest("`locale` is required");
    }

    const rawTasks = body.tasks;
    if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
      throw badRequest("`tasks` must be a non-empty array");
    }

    const tasks = rawTasks
      .map((entry) => {
        if (!isPlainObject(entry)) return null;
        const id = typeof entry.id === "string" ? entry.id.trim() : "";
        const title = typeof entry.title === "string" ? entry.title.trim() : "";
        const description =
          typeof entry.description === "string" ? entry.description.trim() : "";
        if (!id || !title || !description) return null;
        return { id, title, description };
      })
      .filter((entry): entry is { id: string; title: string; description: string } => entry != null);

    if (tasks.length === 0) {
      throw badRequest("Each task needs id, title, and description");
    }

    const translations = await dailyTasksTranslateService.translateDailyTasks({
      locale,
      tasks,
    });

    res.status(200).json({ ok: true, data: translations });
  } catch (err) {
    next(err);
  }
};

export const dailyTasksController = {
  getDailyTasks,
  translateDailyTasks,
  updateDailyTask,
};
