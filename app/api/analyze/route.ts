import { NextResponse } from "next/server";
import { after } from "next/server";
import { createAnalysisJob, runAnalysisJob, runAnalysisJobInline, startAnalysisJob } from "@/lib/analysis-jobs";
import { hasSupabaseAnalysisStore } from "@/lib/supabase-analysis-store";
import { SEARCH_DEPTH_OPTIONS, SUPPORTED_SOURCE_OPTIONS, TIME_WINDOW_OPTIONS } from "@/lib/types";
import type { AnalysisMode, AnalyzeJobResponse, SearchDepth, SupportedSource, TimeWindow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 600;

const DEFAULT_SUPPORTED_SOURCES = SUPPORTED_SOURCE_OPTIONS.map((source) => source.value);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      url?: string;
      analysisMode?: AnalysisMode;
      timeWindow?: TimeWindow;
      searchDepth?: SearchDepth;
      sources?: SupportedSource[];
    };
    const analysisMode: AnalysisMode = body.analysisMode === "category" ? "category" : "company";
    const timeWindow: TimeWindow = TIME_WINDOW_OPTIONS.some((option) => option.value === body.timeWindow) ? body.timeWindow as TimeWindow : "1y";
    const searchDepth: SearchDepth = SEARCH_DEPTH_OPTIONS.some((option) => option.value === body.searchDepth) ? body.searchDepth as SearchDepth : "fast";
    const sourceValues = new Set(DEFAULT_SUPPORTED_SOURCES);
    const sources = Array.isArray(body.sources)
      ? body.sources.filter((source): source is SupportedSource => sourceValues.has(source))
      : DEFAULT_SUPPORTED_SOURCES;
    if (!body.url) {
      return noStoreJson<AnalyzeJobResponse>(
        { ok: false, error: analysisMode === "category" ? "Enter a product, company, category, or domain." : "Enter a product, company, or domain." },
        400,
      );
    }

    const input: { url: string; analysisMode: AnalysisMode; timeWindow: TimeWindow; searchDepth: SearchDepth; sources: SupportedSource[] } = {
      url: body.url,
      analysisMode,
      timeWindow,
      searchDepth,
      sources: sources.length ? sources : DEFAULT_SUPPORTED_SOURCES,
    };
    if (process.env.VERCEL && hasSupabaseAnalysisStore()) {
      const job = await createAnalysisJob(input);
      after(async () => {
        await runAnalysisJob(job.id, input);
      });
      return noStoreJson<AnalyzeJobResponse>({ ok: true, job }, 202);
    }

    const job = process.env.VERCEL
      ? await runAnalysisJobInline(input, analysisDeadlineMs())
      : await startAnalysisJob(input);
    if (!job) {
      throw new Error("Analysis job could not be created.");
    }
    return noStoreJson<AnalyzeJobResponse>({ ok: true, job }, process.env.VERCEL ? 200 : 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected analysis error";
    return noStoreJson<AnalyzeJobResponse>({ ok: false, error: message }, 500);
  }
}

function noStoreJson<T>(payload: T, status: number) {
  return NextResponse.json<T>(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      Pragma: "no-cache",
    },
  });
}

function analysisDeadlineMs() {
  const configured = Number(process.env.ANALYSIS_FINAL_DEADLINE_MS || process.env.ANALYSIS_STREAM_DEADLINE_MS || 0);
  if (Number.isFinite(configured) && configured >= 1000) {
    return configured;
  }
  return process.env.VERCEL ? 7500 : 120000;
}
