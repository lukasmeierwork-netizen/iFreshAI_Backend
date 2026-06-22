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
  type NearVisionResultRow,
  type SightDistanceStatus,
} from "../services/near-vision-results.service";
import {
  mergeInsightIntoCache,
  pickCachedInsight,
  readInsightCache,
  serializeInsightCache,
} from "../services/near-vision-insight-cache";
import { nearVisionInsightService } from "../services/near-vision-insight.service";
import { normalizeInsightLocale } from "../services/near-vision-insight-fallbacks";

const ALLOWED_EYES = new Set(["left", "right", "both"] as const);
const ALLOWED_SIGHT_STATUSES = new Set<SightDistanceStatus>([
  "shortSighted",
  "longSighted",
  "normal",
]);

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

function parseAverageDistanceCm(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw badRequest("averageDistanceCm must be a positive number when provided");
  }
  return raw;
}

function parseSightDistanceStatus(raw: unknown): SightDistanceStatus | null {
  if (raw == null) return null;
  if (typeof raw !== "string" || !ALLOWED_SIGHT_STATUSES.has(raw as SightDistanceStatus)) {
    throw badRequest(
      'sightDistanceStatus must be one of "shortSighted", "longSighted", or "normal" when provided',
    );
  }
  return raw as SightDistanceStatus;
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
    const averageDistanceCm = parseAverageDistanceCm(body.averageDistanceCm);
    const sightDistanceStatus = parseSightDistanceStatus(body.sightDistanceStatus);

    if (
      (averageDistanceCm == null) !== (sightDistanceStatus == null)
    ) {
      throw badRequest(
        "averageDistanceCm and sightDistanceStatus must both be provided or both omitted",
      );
    }

    const row = await nearVisionResultsService.save({
      userId,
      capturedAt,
      right,
      left,
      both,
      averageDistanceCm,
      sightDistanceStatus,
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
    const requestLocale = normalizeInsightLocale(locale);
    const sinceIso = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const rows = await nearVisionResultsService.listByUserSince(
      userId,
      sinceIso,
      240,
    );
    const latestRow = pickLatestRow(rows);
    const sampleCount = rows.length;
    const cache = readInsightCache(latestRow?.ai_summary);
    const cached = pickCachedInsight(
      cache,
      requestLocale,
      days,
      sampleCount,
    );

    if (cached) {
      res.status(200).json({ ok: true, data: cached });
      return;
    }

    const insight = await nearVisionInsightService.buildNearVisionInsight({
      rows,
      periodDays: days,
      locale: requestLocale,
    });

    if (latestRow) {
      const nextCache = mergeInsightIntoCache(cache, insight);
      await nearVisionResultsService.updateAiSummaryById(
        latestRow.id,
        serializeInsightCache(nextCache),
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
