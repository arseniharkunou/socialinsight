import { NextResponse } from "next/server";
import { after } from "next/server";
import { createDeepenAnalysisJob, runDeepenAnalysisJob, startDeepenAnalysisJob } from "@/lib/analysis-jobs";
import { hasSupabaseAnalysisStore } from "@/lib/supabase-analysis-store";
import { SUPPORTED_SOURCE_OPTIONS } from "@/lib/types";
import type { AnalyzeJobResponse, PainRadarReport, SupportedSource } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 600;

const DEFAULT_SUPPORTED_SOURCES = SUPPORTED_SOURCE_OPTIONS.map((source) => source.value);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      report?: PainRadarReport;
      sources?: SupportedSource[];
    };
    if (!body.report?.analyzedUrl) {
      return noStoreJson<AnalyzeJobResponse>({ ok: false, error: "A completed report is required before digging deeper." }, 400);
    }

    const sourceValues = new Set(DEFAULT_SUPPORTED_SOURCES);
    const sources = Array.isArray(body.sources)
      ? body.sources.filter((source): source is SupportedSource => sourceValues.has(source))
      : DEFAULT_SUPPORTED_SOURCES;
    const input = {
      report: body.report,
      sources: sources.length ? sources : DEFAULT_SUPPORTED_SOURCES,
    };

    if (process.env.VERCEL && hasSupabaseAnalysisStore()) {
      const job = await createDeepenAnalysisJob(input);
      after(async () => {
        await runDeepenAnalysisJob(job.id, input);
      });
      return noStoreJson<AnalyzeJobResponse>({ ok: true, job }, 202);
    }

    const job = await startDeepenAnalysisJob(input);
    return noStoreJson<AnalyzeJobResponse>({ ok: true, job }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected deep research error";
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
