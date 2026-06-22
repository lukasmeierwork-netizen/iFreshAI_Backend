import { getSupabase } from "../config/supabase";
import { HttpError } from "../errors/http-error";

export type NearVisionEyeResult = {
  approxSnellen: string;
  decimalAcuity: number;
  eye: "left" | "right" | "both";
  nSize: number;
};

export type SightDistanceStatus = "shortSighted" | "longSighted" | "normal";

export type SaveNearVisionResultsInput = {
  userId: string;
  capturedAt: string;
  right: NearVisionEyeResult;
  left: NearVisionEyeResult;
  both: NearVisionEyeResult;
  averageDistanceCm?: number | null;
  sightDistanceStatus?: SightDistanceStatus | null;
};

export type NearVisionResultRow = {
  id: string;
  user_id: string;
  captured_at: string;
  right_result: NearVisionEyeResult;
  left_result: NearVisionEyeResult;
  both_result: NearVisionEyeResult;
  average_distance_cm: number | null;
  sight_distance_status: SightDistanceStatus | null;
  ai_summary: string | null;
  created_at: string;
};

export type NearVisionInsight = {
  title: string;
  body: string;
  sampleCount: number;
  periodDays: number;
  generatedAt: string;
  /** BCP-47-style locale the insight was generated for. */
  locale: string;
};

const TABLE = "near_vision_results";

function isMissingSightDistanceColumnError(error: { message?: string } | null): boolean {
  const message = error?.message ?? "";
  return (
    message.includes("average_distance_cm") ||
    message.includes("sight_distance_status")
  );
}

function normalizeRow(raw: Record<string, unknown>): NearVisionResultRow {
  const sightStatus = raw.sight_distance_status;
  const allowedSightStatuses = new Set<SightDistanceStatus>([
    "shortSighted",
    "longSighted",
    "normal",
  ]);

  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    captured_at: String(raw.captured_at),
    right_result: raw.right_result as NearVisionEyeResult,
    left_result: raw.left_result as NearVisionEyeResult,
    both_result: raw.both_result as NearVisionEyeResult,
    average_distance_cm:
      typeof raw.average_distance_cm === "number" &&
      Number.isFinite(raw.average_distance_cm)
        ? raw.average_distance_cm
        : null,
    sight_distance_status:
      typeof sightStatus === "string" &&
      allowedSightStatuses.has(sightStatus as SightDistanceStatus)
        ? (sightStatus as SightDistanceStatus)
        : null,
    ai_summary:
      typeof raw.ai_summary === "string" ? raw.ai_summary : null,
    created_at: String(raw.created_at),
  };
}

async function save(input: SaveNearVisionResultsInput): Promise<NearVisionResultRow> {
  const supabase = getSupabase();

  const baseInsert = {
    user_id: input.userId,
    captured_at: input.capturedAt,
    right_result: input.right,
    left_result: input.left,
    both_result: input.both,
  };

  const hasSightMetrics =
    input.averageDistanceCm != null && input.sightDistanceStatus != null;

  const fullInsert = hasSightMetrics
    ? {
        ...baseInsert,
        average_distance_cm: input.averageDistanceCm,
        sight_distance_status: input.sightDistanceStatus,
      }
    : baseInsert;

  let response = await supabase.from(TABLE).insert(fullInsert).select("*").single();

  if (response.error && isMissingSightDistanceColumnError(response.error)) {
    response = await supabase.from(TABLE).insert(baseInsert).select("*").single();
  }

  if (response.error || !response.data) {
    throw new HttpError({
      status: 500,
      code: "NEAR_VISION_RESULTS_INSERT_FAILED",
      message: response.error?.message ?? "Failed to save near vision results",
    });
  }

  return normalizeRow(response.data as Record<string, unknown>);
}

async function listByUser(
  userId: string,
  limit = 120,
): Promise<NearVisionResultRow[]> {
  const supabase = getSupabase();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("captured_at", { ascending: true })
    .limit(safeLimit);

  if (error || !data) {
    throw new HttpError({
      status: 500,
      code: "NEAR_VISION_RESULTS_LIST_FAILED",
      message: error?.message ?? "Failed to load near vision results",
    });
  }

  return data.map((row) => normalizeRow(row as Record<string, unknown>));
}

async function listByUserSince(
  userId: string,
  sinceIso: string,
  limit = 180,
): Promise<NearVisionResultRow[]> {
  const supabase = getSupabase();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .gte("captured_at", sinceIso)
    .order("captured_at", { ascending: true })
    .limit(safeLimit);

  if (error || !data) {
    throw new HttpError({
      status: 500,
      code: "NEAR_VISION_RESULTS_LIST_FAILED",
      message: error?.message ?? "Failed to load near vision results",
    });
  }

  return data.map((row) => normalizeRow(row as Record<string, unknown>));
}

async function updateAiSummaryById(
  id: string,
  aiSummary: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from(TABLE)
    .update({ ai_summary: aiSummary })
    .eq("id", id);

  if (error) {
    throw new HttpError({
      status: 500,
      code: "NEAR_VISION_RESULTS_UPDATE_FAILED",
      message: error.message ?? "Failed to update near vision summary",
    });
  }
}

export const nearVisionResultsService = {
  save,
  listByUser,
  listByUserSince,
  updateAiSummaryById,
};
