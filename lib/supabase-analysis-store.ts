import type { AnalyzeJobSnapshot, LiveQuotePreview } from "@/lib/types";

export const ALLOWED_SUPABASE_PROJECT_REF = "dathibrsfkfanuvatquv";
export const ALLOWED_SUPABASE_URL = `https://${ALLOWED_SUPABASE_PROJECT_REF}.supabase.co`;

type AnalysisJobRow = {
  id: string;
  status: AnalyzeJobSnapshot["status"];
  stage: AnalyzeJobSnapshot["stage"];
  analysis_mode: AnalyzeJobSnapshot["analysisMode"];
  time_window: AnalyzeJobSnapshot["timeWindow"];
  search_depth: AnalyzeJobSnapshot["searchDepth"];
  supported_sources: AnalyzeJobSnapshot["supportedSources"];
  target: string;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  error?: string | null;
  preview_quotes?: LiveQuotePreview[] | null;
  report?: AnalyzeJobSnapshot["report"] | null;
};

export function hasSupabaseAnalysisStore() {
  assertAllowedSupabaseUrl();
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function saveSupabaseAnalysisJob(job: AnalyzeJobSnapshot) {
  const rows = await supabaseRequest<AnalysisJobRow[]>(
    "/analysis_jobs?on_conflict=id",
    {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(toRow(job)),
    },
  );
  return fromRow(rows[0]);
}

export async function getSupabaseAnalysisJob(id: string) {
  const rows = await supabaseRequest<AnalysisJobRow[]>(
    `/analysis_jobs?id=eq.${encodeURIComponent(id)}&select=*`,
    { method: "GET" },
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function appendSupabaseAnalysisEvent(
  jobId: string,
  event: { eventType: string; stage?: AnalyzeJobSnapshot["stage"]; message?: string; payload?: Record<string, unknown> },
) {
  await supabaseRequest(
    "/analysis_events",
    {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        job_id: jobId,
        event_type: event.eventType,
        stage: event.stage,
        message: event.message,
        payload: event.payload || {},
      }),
    },
  );
}

async function supabaseRequest<T = unknown>(path: string, init: RequestInit) {
  const url = allowedSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase analysis store is not configured.");
  }

  const response = await fetch(`${url}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase analysis store failed (${response.status}): ${message.slice(0, 260)}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

function allowedSupabaseUrl() {
  assertAllowedSupabaseUrl();
  return process.env.SUPABASE_URL?.replace(/\/+$/, "");
}

function assertAllowedSupabaseUrl() {
  const configured = process.env.SUPABASE_URL;
  if (!configured) {
    return;
  }

  let origin: string;
  try {
    origin = new URL(configured).origin;
  } catch {
    throw new Error(`Invalid SUPABASE_URL. This project must use ${ALLOWED_SUPABASE_URL}.`);
  }

  if (origin !== ALLOWED_SUPABASE_URL) {
    throw new Error(`Refusing to use Supabase project ${origin}. This project is hard-wired to ${ALLOWED_SUPABASE_URL}.`);
  }
}

function toRow(job: AnalyzeJobSnapshot): AnalysisJobRow {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    analysis_mode: job.analysisMode,
    time_window: job.timeWindow,
    search_depth: job.searchDepth,
    supported_sources: job.supportedSources,
    target: job.target,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    completed_at: job.completedAt || null,
    error: job.error || null,
    preview_quotes: job.previewQuotes || [],
    report: job.report || null,
  };
}

function fromRow(row: AnalysisJobRow): AnalyzeJobSnapshot {
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    analysisMode: row.analysis_mode,
    timeWindow: row.time_window,
    searchDepth: row.search_depth,
    supportedSources: row.supported_sources,
    target: row.target,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined,
    error: row.error || undefined,
    previewQuotes: row.preview_quotes || [],
    report: row.report || undefined,
  };
}
