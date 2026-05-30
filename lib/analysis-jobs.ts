import fs from "node:fs/promises";
import path from "node:path";
import { runAnalysisForInput } from "@/lib/analysis";
import { SUPPORTED_SOURCE_OPTIONS } from "@/lib/types";
import type { AnalysisMode, AnalyzeJobSnapshot, LiveQuotePreview, SearchDepth, SupportedSource, TimeWindow } from "@/lib/types";

type InternalJob = AnalyzeJobSnapshot & {
  abortController: AbortController;
};

const REPORT_DIR = process.env.VERCEL
  ? path.join("/tmp", "social-insight", "reports")
  : path.join(process.cwd(), "output", "reports");
const jobs = globalThis as typeof globalThis & {
  __painRadarJobs?: Map<string, InternalJob>;
};

function jobMap() {
  if (!jobs.__painRadarJobs) {
    jobs.__painRadarJobs = new Map();
  }
  return jobs.__painRadarJobs;
}

type AnalysisJobInput = { url: string; analysisMode?: AnalysisMode; timeWindow?: TimeWindow; searchDepth?: SearchDepth; sources?: SupportedSource[] };

const DEFAULT_SUPPORTED_SOURCES = SUPPORTED_SOURCE_OPTIONS.map((source) => source.value);

export function startAnalysisJob(input: AnalysisJobInput) {
  const job = createInternalJob(input);
  jobMap().set(job.id, job);
  persistJob(job).catch(() => undefined);
  void runJob(job, input);
  return publicJob(job);
}

export async function runAnalysisJobInline(input: AnalysisJobInput) {
  const job = createInternalJob(input);
  jobMap().set(job.id, job);
  persistJob(job).catch(() => undefined);
  await runJob(job, input);
  return publicJob(job);
}

function createInternalJob(input: AnalysisJobInput): InternalJob {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const abortController = new AbortController();
  const timeWindow = input.timeWindow || "1y";
  const searchDepth = input.searchDepth || "fast";
  const supportedSources = input.sources?.length ? input.sources : DEFAULT_SUPPORTED_SOURCES;
  const job: InternalJob = {
    id,
    status: "queued",
    stage: "website",
    analysisMode: input.analysisMode === "category" ? "category" : "company",
    timeWindow,
    searchDepth,
    supportedSources,
    target: input.url,
    createdAt: now,
    updatedAt: now,
    abortController,
  };
  return job;
}

export async function getAnalysisJob(id: string) {
  const memoryJob = jobMap().get(id);
  if (memoryJob) {
    return publicJob(memoryJob);
  }
  return readPersistedJob(id);
}

export async function cancelAnalysisJob(id: string) {
  const job = jobMap().get(id);
  if (!job) {
    const persisted = await readPersistedJob(id);
    return persisted || null;
  }
  job.abortController.abort();
  if (job.status !== "completed" && job.status !== "failed") {
    updateJob(job, { status: "cancelled", error: "Analysis stopped." });
  }
  return publicJob(job);
}

async function runJob(job: InternalJob, input: AnalysisJobInput) {
  updateJob(job, { status: "running", stage: "website" });
  try {
    const report = await runAnalysisForInput(
      input,
      (stage) => updateJob(job, { status: "running", stage }),
      (previewQuotes) => updatePreviewQuotes(job, previewQuotes),
      job.abortController.signal,
    );

    if (job.abortController.signal.aborted || job.status === "cancelled") {
      updateJob(job, { status: "cancelled", error: "Analysis stopped." });
      return;
    }

    updateJob(job, {
      status: "completed",
      stage: "synthesis",
      completedAt: new Date().toISOString(),
      report,
    });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    updateJob(job, {
      status: aborted ? "cancelled" : "failed",
      error: aborted ? "Analysis stopped." : error instanceof Error ? error.message : "Analysis failed",
      completedAt: new Date().toISOString(),
    });
  }
}

function updateJob(job: InternalJob, patch: Partial<Omit<AnalyzeJobSnapshot, "id" | "createdAt">>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  jobMap().set(job.id, job);
  persistJob(job).catch(() => undefined);
}

function updatePreviewQuotes(job: InternalJob, previewQuotes: LiveQuotePreview[]) {
  if (job.abortController.signal.aborted || job.status === "cancelled" || previewQuotes.length === 0) {
    return;
  }
  updateJob(job, { previewQuotes: mergePreviewQuotes(job.previewQuotes || [], previewQuotes), status: "running" });
}

function mergePreviewQuotes(currentQuotes: LiveQuotePreview[], nextQuotes: LiveQuotePreview[]) {
  const seen = new Set(currentQuotes.map((quote) => quote.sourceId));
  const merged = [...currentQuotes];
  for (const quote of nextQuotes) {
    if (seen.has(quote.sourceId)) {
      continue;
    }
    seen.add(quote.sourceId);
    merged.push(quote);
  }
  return merged.slice(0, 8);
}

function publicJob(job: InternalJob): AnalyzeJobSnapshot {
  const { abortController: _abortController, ...snapshot } = job;
  return snapshot;
}

async function persistJob(job: InternalJob) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const snapshot = publicJob(job);
  await fs.writeFile(jobPath(job.id), JSON.stringify(snapshot, null, 2));
}

async function readPersistedJob(id: string) {
  try {
    const text = await fs.readFile(jobPath(id), "utf8");
    return JSON.parse(text) as AnalyzeJobSnapshot;
  } catch {
    return null;
  }
}

function jobPath(id: string) {
  return path.join(REPORT_DIR, `${safeJobId(id)}.json`);
}

function safeJobId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}
