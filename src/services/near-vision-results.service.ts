import { getSupabase } from "../config/supabase";
import { HttpError } from "../errors/http-error";

export type NearVisionEyeResult = {
  approxSnellen: string;
  decimalAcuity: number;
  eye: "left" | "right" | "both";
  nSize: number;
};

export type SaveNearVisionResultsInput = {
  userId: string;
  capturedAt: string;
  right: NearVisionEyeResult;
  left: NearVisionEyeResult;
  both: NearVisionEyeResult;
};

export type NearVisionResultRow = {
  id: string;
  user_id: string;
  captured_at: string;
  right_result: NearVisionEyeResult;
  left_result: NearVisionEyeResult;
  both_result: NearVisionEyeResult;
  ai_summary: string | null;
  created_at: string;
};

export type NearVisionInsight = {
  title: string;
  body: string;
  sampleCount: number;
  periodDays: number;
  generatedAt: string;
};

const TABLE = "near_vision_results";

async function save(input: SaveNearVisionResultsInput): Promise<NearVisionResultRow> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      user_id: input.userId,
      captured_at: input.capturedAt,
      right_result: input.right,
      left_result: input.left,
      both_result: input.both,
    })
    .select("id, user_id, captured_at, right_result, left_result, both_result, ai_summary, created_at")
    .single();

  if (error || !data) {
    throw new HttpError({
      status: 500,
      code: "NEAR_VISION_RESULTS_INSERT_FAILED",
      message: error?.message ?? "Failed to save near vision results",
    });
  }

  return data as NearVisionResultRow;
}

async function listByUser(
  userId: string,
  limit = 120,
): Promise<NearVisionResultRow[]> {
  const supabase = getSupabase();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));

  const { data, error } = await supabase
    .from(TABLE)
    .select("id, user_id, captured_at, right_result, left_result, both_result, ai_summary, created_at")
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

  return data as NearVisionResultRow[];
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
    .select("id, user_id, captured_at, right_result, left_result, both_result, ai_summary, created_at")
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

  return data as NearVisionResultRow[];
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
