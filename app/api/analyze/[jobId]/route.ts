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
    return NextResponse.json<AnalyzeJobResponse>({ ok: false, error: "Analysis job not found." }, { status: 404 });
  }
  return NextResponse.json<AnalyzeJobResponse>({ ok: true, job });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = await cancelAnalysisJob(jobId);
  if (!job) {
    return NextResponse.json<AnalyzeJobResponse>({ ok: false, error: "Analysis job not found." }, { status: 404 });
  }
  return NextResponse.json<AnalyzeJobResponse>({ ok: true, job });
}
