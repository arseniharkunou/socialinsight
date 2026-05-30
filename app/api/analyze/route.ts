import { NextResponse } from "next/server";
import { startAnalysisJob } from "@/lib/analysis-jobs";
import { SEARCH_DEPTH_OPTIONS, SUPPORTED_SOURCE_OPTIONS, TIME_WINDOW_OPTIONS } from "@/lib/types";
import type { AnalysisMode, AnalyzeJobResponse, SearchDepth, SupportedSource, TimeWindow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

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
    const analysisMode = body.analysisMode === "category" ? "category" : "company";
    const timeWindow = TIME_WINDOW_OPTIONS.some((option) => option.value === body.timeWindow) ? body.timeWindow : "1y";
    const searchDepth = SEARCH_DEPTH_OPTIONS.some((option) => option.value === body.searchDepth) ? body.searchDepth : "fast";
    const sourceValues = new Set(DEFAULT_SUPPORTED_SOURCES);
    const sources = Array.isArray(body.sources)
      ? body.sources.filter((source): source is SupportedSource => sourceValues.has(source))
      : DEFAULT_SUPPORTED_SOURCES;
    if (!body.url) {
      return NextResponse.json<AnalyzeJobResponse>(
        { ok: false, error: analysisMode === "category" ? "Enter a product, company, category, or domain." : "Enter a product, company, or domain." },
        { status: 400 },
      );
    }

    const job = startAnalysisJob({ url: body.url, analysisMode, timeWindow, searchDepth, sources: sources.length ? sources : DEFAULT_SUPPORTED_SOURCES });
    return NextResponse.json<AnalyzeJobResponse>({ ok: true, job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected analysis error";
    return NextResponse.json<AnalyzeJobResponse>({ ok: false, error: message }, { status: 500 });
  }
}
