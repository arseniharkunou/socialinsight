import { NextResponse } from "next/server";
import { cancelAnalysisJob, getAnalysisJob } from "@/lib/analysis-jobs";
import type { AnalyzeJobResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = await getAnalysisJob(jobId);
  if (!job) {
    return noStoreJson<AnalyzeJobResponse>({ ok: false, error: "Analysis job not found." }, 404);
  }
  return noStoreJson<AnalyzeJobResponse>({ ok: true, job }, 200);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = await cancelAnalysisJob(jobId);
  if (!job) {
    return noStoreJson<AnalyzeJobResponse>({ ok: false, error: "Analysis job not found." }, 404);
  }
  return noStoreJson<AnalyzeJobResponse>({ ok: true, job }, 200);
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
