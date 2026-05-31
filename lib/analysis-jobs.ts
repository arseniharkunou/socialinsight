import fs from "node:fs/promises";
import path from "node:path";
import { runAnalysisForInput, runAnalysisForInputWithDeadline, runDeepenAnalysisForReport, runDeepenPainPointForReport } from "@/lib/analysis";
import { appendSupabaseAnalysisEvent, getSupabaseAnalysisJob, hasSupabaseAnalysisStore, saveSupabaseAnalysisJob } from "@/lib/supabase-analysis-store";
import { SUPPORTED_SOURCE_OPTIONS } from "@/lib/types";
import type { AnalysisMode, AnalyzeJobSnapshot, LiveQuotePreview, PainRadarReport, SearchDepth, SupportedSource, TimeWindow } from "@/lib/types";

type InternalJob = AnalyzeJobSnapshot & {
  abortController: AbortController;
};

const REPORT_DIR = process.env.VERCEL
  ? path.join("/tmp", "social-insight", "reports")
  : path.join(process.cwd(), "output", "reports");
const jobs = globalThis as typeof globalThis & {
  __painRadarJobs?: Map<string, InternalJob>;
  __painRadarJobPersistQueues?: Map<string, Promise<void>>;
};

function jobMap() {
  if (!jobs.__painRadarJobs) {
    jobs.__painRadarJobs = new Map();
  }
  return jobs.__painRadarJobs;
}

function persistQueueMap() {
  if (!jobs.__painRadarJobPersistQueues) {
    jobs.__painRadarJobPersistQueues = new Map();
  }
  return jobs.__painRadarJobPersistQueues;
}

type AnalysisJobInput = { url: string; analysisMode?: AnalysisMode; timeWindow?: TimeWindow; searchDepth?: SearchDepth; sources?: SupportedSource[] };
type DeepenAnalysisJobInput = { report: PainRadarReport; sources?: SupportedSource[] };
type PainPointDeepenAnalysisJobInput = { report: PainRadarReport; painIndex: number; sources?: SupportedSource[] };

const DEFAULT_SUPPORTED_SOURCES = SUPPORTED_SOURCE_OPTIONS.map((source) => source.value);

export async function createAnalysisJob(input: AnalysisJobInput) {
  const job = createInternalJob(input);
  jobMap().set(job.id, job);
  await persistJob(job);
  return publicJob(job);
}

export async function startAnalysisJob(input: AnalysisJobInput) {
  const job = await createAnalysisJob(input);
  void runAnalysisJob(job.id, input);
  return job;
}

export async function createDeepenAnalysisJob(input: DeepenAnalysisJobInput) {
  const job = createInternalJob({
    url: input.report.analyzedUrl,
    analysisMode: input.report.analysisMode,
    timeWindow: input.report.timeWindow,
    searchDepth: "deep",
    sources: input.sources,
  });
  jobMap().set(job.id, job);
  await persistJob(job);
  return publicJob(job);
}

export async function startDeepenAnalysisJob(input: DeepenAnalysisJobInput) {
  const job = await createDeepenAnalysisJob(input);
  void runDeepenAnalysisJob(job.id, input);
  return job;
}

export async function createPainPointDeepenAnalysisJob(input: PainPointDeepenAnalysisJobInput) {
  const job = createInternalJob({
    url: input.report.analyzedUrl,
    analysisMode: input.report.analysisMode,
    timeWindow: input.report.timeWindow,
    searchDepth: "deep",
    sources: input.sources,
  });
  jobMap().set(job.id, job);
  await persistJob(job);
  return publicJob(job);
}

export async function startPainPointDeepenAnalysisJob(input: PainPointDeepenAnalysisJobInput) {
  const job = await createPainPointDeepenAnalysisJob(input);
  void runPainPointDeepenAnalysisJob(job.id, input);
  return job;
}

export async function runAnalysisJobInline(input: AnalysisJobInput, deadlineMs?: number) {
  const job = await createAnalysisJob(input);
  await runAnalysisJob(job.id, input, deadlineMs);
  return getAnalysisJob(job.id);
}

export async function runAnalysisJob(id: string, input: AnalysisJobInput, deadlineMs?: number) {
  const existing = await getAnalysisJob(id);
  if (!existing) {
    throw new Error("Analysis job not found.");
  }
  if (existing.status === "completed" || existing.status === "failed" || existing.status === "cancelled") {
    return existing;
  }

  const job = internalJobFromSnapshot(existing);
  jobMap().set(job.id, job);
  await runJob(job, input, deadlineMs);
  return getAnalysisJob(id);
}

export async function runDeepenAnalysisJob(id: string, input: DeepenAnalysisJobInput) {
  const existing = await getAnalysisJob(id);
  if (!existing) {
    throw new Error("Analysis job not found.");
  }
  if (existing.status === "completed" || existing.status === "failed" || existing.status === "cancelled") {
    return existing;
  }

  const job = internalJobFromSnapshot(existing);
  jobMap().set(job.id, job);
  await runDeepenJob(job, input);
  return getAnalysisJob(id);
}

export async function runPainPointDeepenAnalysisJob(id: string, input: PainPointDeepenAnalysisJobInput) {
  const existing = await getAnalysisJob(id);
  if (!existing) {
    throw new Error("Analysis job not found.");
  }
  if (existing.status === "completed" || existing.status === "failed" || existing.status === "cancelled") {
    return existing;
  }

  const job = internalJobFromSnapshot(existing);
  jobMap().set(job.id, job);
  await runPainPointDeepenJob(job, input);
  return getAnalysisJob(id);
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

function internalJobFromSnapshot(snapshot: AnalyzeJobSnapshot): InternalJob {
  return {
    ...snapshot,
    abortController: new AbortController(),
  };
}

export async function getAnalysisJob(id: string) {
  if (hasSupabaseAnalysisStore()) {
    return getSupabaseAnalysisJob(id);
  }
  const memoryJob = jobMap().get(id);
  if (memoryJob) {
    return publicJob(memoryJob);
  }
  return readPersistedJob(id);
}

export async function cancelAnalysisJob(id: string) {
  if (hasSupabaseAnalysisStore()) {
    const persisted = await getSupabaseAnalysisJob(id);
    if (!persisted) {
      return null;
    }
    const cancelled = {
      ...persisted,
      status: "cancelled" as const,
      error: persisted.error || "Analysis stopped.",
      completedAt: persisted.completedAt || new Date().toISOString(),
    };
    return saveSupabaseAnalysisJob(cancelled);
  }
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

async function runJob(job: InternalJob, input: AnalysisJobInput, deadlineMs?: number) {
  return runJobWithRunner(job, (setStage, setPreviewQuotes, signal) => (
    deadlineMs
      ? runAnalysisForInputWithDeadline(input, setStage, setPreviewQuotes, signal, deadlineMs)
      : runAnalysisForInput(input, setStage, setPreviewQuotes, signal)
  ));
}

async function runDeepenJob(job: InternalJob, input: DeepenAnalysisJobInput) {
  return runJobWithRunner(job, (setStage, setPreviewQuotes, signal) => runDeepenAnalysisForReport(input, setStage, setPreviewQuotes, signal));
}

async function runPainPointDeepenJob(job: InternalJob, input: PainPointDeepenAnalysisJobInput) {
  return runJobWithRunner(job, (setStage, setPreviewQuotes, signal) => runDeepenPainPointForReport(input, setStage, setPreviewQuotes, signal));
}

async function runJobWithRunner(
  job: InternalJob,
  runner: (
    setStage: (stage: AnalyzeJobSnapshot["stage"]) => void,
    setPreviewQuotes: (previewQuotes: LiveQuotePreview[]) => void,
    signal: AbortSignal,
  ) => Promise<PainRadarReport>,
) {
  await updateJob(job, { status: "running", stage: "website" });
  let acceptingAnalysisUpdates = true;
  const updateAnalysisStage = (stage: AnalyzeJobSnapshot["stage"]) => {
    if (acceptingAnalysisUpdates) {
      void updateJob(job, { status: "running", stage });
    }
  };
  const updateAnalysisQuotes = (previewQuotes: LiveQuotePreview[]) => {
    if (acceptingAnalysisUpdates) {
      updatePreviewQuotes(job, previewQuotes);
    }
  };
  try {
    const report = await runner(updateAnalysisStage, updateAnalysisQuotes, job.abortController.signal);
    acceptingAnalysisUpdates = false;

    const latestJob = hasSupabaseAnalysisStore() ? await getSupabaseAnalysisJob(job.id) : null;
    if (job.abortController.signal.aborted || job.status === "cancelled" || latestJob?.status === "cancelled") {
      await updateJob(job, { status: "cancelled", error: "Analysis stopped." });
      return;
    }

    await updateJob(job, {
      status: "completed",
      stage: "synthesis",
      completedAt: new Date().toISOString(),
      report,
    });
  } catch (error) {
    acceptingAnalysisUpdates = false;
    const aborted = error instanceof DOMException && error.name === "AbortError";
    await updateJob(job, {
      status: aborted ? "cancelled" : "failed",
      error: aborted ? "Analysis stopped." : error instanceof Error ? error.message : "Analysis failed",
      completedAt: new Date().toISOString(),
    });
  }
}

async function updateJob(job: InternalJob, patch: Partial<Omit<AnalyzeJobSnapshot, "id" | "createdAt">>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  jobMap().set(job.id, job);
  await queuePersistJob(job);
  if (patch.stage) {
    appendJobEvent(job.id, { eventType: "stage", stage: patch.stage }).catch(() => undefined);
  }
  if (patch.status === "completed" || patch.status === "failed" || patch.status === "cancelled") {
    appendJobEvent(job.id, { eventType: patch.status, message: patch.error }).catch(() => undefined);
  }
}

function updatePreviewQuotes(job: InternalJob, previewQuotes: LiveQuotePreview[]) {
  if (job.abortController.signal.aborted || job.status === "cancelled" || previewQuotes.length === 0) {
    return;
  }
  void updateJob(job, { previewQuotes: mergePreviewQuotes(job.previewQuotes || [], previewQuotes), status: "running" });
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
  await persistSnapshot(publicJob(job));
}

async function queuePersistJob(job: InternalJob) {
  const snapshot = publicJob(job);
  const queues = persistQueueMap();
  const previous = queues.get(job.id) || Promise.resolve();
  const next = previous.catch(() => undefined).then(() => persistSnapshot(snapshot));
  queues.set(job.id, next.catch(() => undefined));
  await next;
}

async function persistSnapshot(snapshot: AnalyzeJobSnapshot) {
  if (hasSupabaseAnalysisStore()) {
    await saveSupabaseAnalysisJob(snapshot);
    return;
  }
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(jobPath(snapshot.id), JSON.stringify(snapshot, null, 2));
}

async function readPersistedJob(id: string) {
  if (hasSupabaseAnalysisStore()) {
    return getSupabaseAnalysisJob(id);
  }
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

async function appendJobEvent(
  jobId: string,
  event: { eventType: string; stage?: AnalyzeJobSnapshot["stage"]; message?: string; payload?: Record<string, unknown> },
) {
  if (!hasSupabaseAnalysisStore()) {
    return;
  }
  await appendSupabaseAnalysisEvent(jobId, event);
}
