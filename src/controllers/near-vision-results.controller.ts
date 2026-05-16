import type { RequestHandler } from "express";

import {
  badRequest,
  isPlainObject,
  parseIsoDateTime,
  parseLocale,
  parsePositiveInt,
  requireUserId,
} from "../lib/http";
import {
  nearVisionResultsService,
  type NearVisionEyeResult,
  type NearVisionInsight,
  type NearVisionResultRow,
} from "../services/near-vision-results.service";
import { nearVisionInsightService } from "../services/near-vision-insight.service";

const ALLOWED_EYES = new Set(["left", "right", "both"] as const);

const INSIGHT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_LIST_LIMIT = 120;
const MAX_LIST_LIMIT = 500;
const DEFAULT_INSIGHT_DAYS = 30;
const MAX_INSIGHT_DAYS = 365;

function parseEyeResult(
  label: "left" | "right" | "both",
  raw: unknown,
): NearVisionEyeResult {
  if (!isPlainObject(raw)) {
    throw badRequest(`${label} must be an object`);
  }
  const { approxSnellen, decimalAcuity, eye, nSize } = raw;

  if (typeof approxSnellen !== "string" || !approxSnellen.trim()) {
    throw badRequest(`${label}.approxSnellen must be a non-empty string`);
  }
  if (typeof decimalAcuity !== "number" || !Number.isFinite(decimalAcuity)) {
    throw badRequest(`${label}.decimalAcuity must be a finite number`);
  }
  if (
    typeof eye !== "string" ||
    !ALLOWED_EYES.has(eye as "left" | "right" | "both")
  ) {
    throw badRequest(`${label}.eye must be one of left, right, both`);
  }
  if (eye !== label) {
    throw badRequest(`${label}.eye must equal "${label}"`);
  }
  if (typeof nSize !== "number" || !Number.isFinite(nSize) || nSize <= 0) {
    throw badRequest(`${label}.nSize must be a positive number`);
  }

  return {
    approxSnellen: approxSnellen.trim(),
    decimalAcuity,
    eye: eye as "left" | "right" | "both",
    nSize,
  };
}

function parseStoredInsight(
  raw: string | null | undefined,
): NearVisionInsight | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.body !== "string" ||
      typeof parsed.sampleCount !== "number" ||
      typeof parsed.periodDays !== "number" ||
      typeof parsed.generatedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.generatedAt))
    ) {
      return null;
    }
    return {
      title: parsed.title.trim(),
      body: parsed.body.trim(),
      sampleCount: parsed.sampleCount,
      periodDays: parsed.periodDays,
      generatedAt: parsed.generatedAt,
    };
  } catch {
    return null;
  }
}

function pickLatestRow(rows: NearVisionResultRow[]): NearVisionResultRow | null {
  if (rows.length === 0) return null;
  // Service returns ascending by captured_at; last element is the newest.
  return rows[rows.length - 1] ?? null;
}

const saveNearResults: RequestHandler = async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const body = isPlainObject(req.body) ? req.body : {};

    const capturedAt = parseIsoDateTime(body.capturedAt);
    const right = parseEyeResult("right", body.right);
    const left = parseEyeResult("left", body.left);
    const both = parseEyeResult("both", body.both);

    const row = await nearVisionResultsService.save({
      userId,
      capturedAt,
      right,
      left,
      both,
    });

    res.status(201).json({ ok: true, data: row });
  } catch (err) {
    next(err);
  }
};

const listNearResults: RequestHandler = async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const limit = parsePositiveInt(req.query.limit, {
      label: "limit",
      defaultValue: DEFAULT_LIST_LIMIT,
      max: MAX_LIST_LIMIT,
    });
    const rows = await nearVisionResultsService.listByUser(userId, limit);
    res.status(200).json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

const getNearResultsInsight: RequestHandler = async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const days = parsePositiveInt(req.query.days, {
      label: "days",
      defaultValue: DEFAULT_INSIGHT_DAYS,
      max: MAX_INSIGHT_DAYS,
    });
    const locale = parseLocale(req.query.locale);
    const sinceIso = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const rows = await nearVisionResultsService.listByUserSince(
      userId,
      sinceIso,
      240,
    );
    const latestRow = pickLatestRow(rows);

    const cached = parseStoredInsight(latestRow?.ai_summary);
    const isFreshCache =
      cached != null &&
      Date.now() - Date.parse(cached.generatedAt) < INSIGHT_REFRESH_MS;

    if (isFreshCache) {
      res.status(200).json({ ok: true, data: cached });
      return;
    }

    const insight = await nearVisionInsightService.buildNearVisionInsight({
      rows,
      periodDays: days,
      ...(locale ? { locale } : {}),
    });

    if (latestRow) {
      await nearVisionResultsService.updateAiSummaryById(
        latestRow.id,
        JSON.stringify(insight),
      );
    }

    res.status(200).json({ ok: true, data: insight });
  } catch (err) {
    next(err);
  }
};

export const nearVisionResultsController = {
  saveNearResults,
  listNearResults,
  getNearResultsInsight,
};
