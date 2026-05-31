"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Compass,
  ChevronDown,
  ExternalLink,
  FileDown,
  FileSearch,
  Gauge,
  Globe2,
  Lightbulb,
  Quote,
  MessageCircleMore,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { displayExecutiveSummary, reportTitle } from "@/lib/report-title";
import { buildSentimentTrend } from "@/lib/sentiment";
import { SEARCH_DEPTH_OPTIONS, SUPPORTED_SOURCE_OPTIONS, TIME_WINDOW_OPTIONS } from "@/lib/types";
import type { AnalysisMode, AnalyzeJobResponse, AnalyzeProgressStage, Evidence, LiveQuotePreview, PainPoint, PainRadarReport, SearchDepth, SupportedSource, TimeWindow } from "@/lib/types";

const progressSteps = [
  { stage: "website", label: "Target setup", icon: Globe2 },
  { stage: "market", label: "Market detection", icon: Compass },
  { stage: "queries", label: "Query generation", icon: Search },
  { stage: "brightdata", label: "Bright Data collection", icon: FileSearch },
  { stage: "evidence", label: "Evidence scoring", icon: Gauge },
  { stage: "synthesis", label: "AI synthesis", icon: Sparkles },
] satisfies Array<{
  stage: AnalyzeProgressStage;
  label: string;
  icon: typeof Globe2;
}>;

const progressStageIndexes = Object.fromEntries(
  progressSteps.map((step, index) => [step.stage, index]),
) as Record<AnalyzeProgressStage, number>;

const defaultSupportedSources = SUPPORTED_SOURCE_OPTIONS.map((source) => source.value);

const analysisLanes = [
  { y: 18, d: "-0.2s" },
  { y: 34, d: "-1.1s" },
  { y: 51, d: "-2.2s" },
  { y: 67, d: "-3.1s" },
  { y: 82, d: "-4s" },
];

const MIN_QUOTE_PREVIEW_MS = 2200;
const JOB_POLL_INTERVAL_MS = 1800;

export default function Home() {
  const [url, setUrl] = useState("");
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("company");
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("1y");
  const [searchDepth, setSearchDepth] = useState<SearchDepth>("fast");
  const [selectedSources, setSelectedSources] = useState<SupportedSource[]>(defaultSupportedSources);
  const [report, setReport] = useState<PainRadarReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [previewQuotes, setPreviewQuotes] = useState<LiveQuotePreview[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const previewQuotesShownAtRef = useRef<number | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAnalysis();
  }

  async function runAnalysis() {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoading(true);
    setError("");
    setReport(null);
    setProgressIndex(0);
    setPreviewQuotes([]);
    previewQuotesShownAtRef.current = null;

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, analysisMode, timeWindow, searchDepth, sources: selectedSources }),
        signal: controller.signal,
      });

      const startPayload = await readJobResponse(response);
      if (!startPayload.ok) {
        throw new Error(startPayload.error);
      }

      await pollAnalysisJob(startPayload.job.id, controller.signal, async (payload) => {
        if (!payload.ok) {
          throw new Error(payload.error);
        }

        const job = payload.job;
        setProgressIndex(job.status === "completed" ? progressSteps.length : progressStageIndexes[job.stage]);

        if (job.previewQuotes?.length) {
          setPreviewQuotes((currentQuotes) => mergePreviewQuotes(currentQuotes, job.previewQuotes || []));
          previewQuotesShownAtRef.current = previewQuotesShownAtRef.current ?? Date.now();
        }

        if (job.status === "completed" && job.report) {
          const shownAt = previewQuotesShownAtRef.current;
          const remainingPreviewMs = shownAt ? Math.max(0, MIN_QUOTE_PREVIEW_MS - (Date.now() - shownAt)) : 0;
          if (remainingPreviewMs > 0) {
            await delay(remainingPreviewMs, controller.signal);
          }
          setProgressIndex(progressSteps.length);
          setReport({
            ...job.report,
            analysisMode: job.report.analysisMode || job.analysisMode,
            searchDepth: job.report.searchDepth || job.searchDepth,
          });
          return true;
        }

        if (job.status === "failed" || job.status === "cancelled") {
          throw new Error(job.error || "Analysis failed.");
        }

        return false;
      });
    } catch (reason) {
      setError(describeAnalysisError(reason));
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen text-[var(--ink)]">
      <PageLogo />
      <section className="mx-auto min-h-screen w-full max-w-[1540px] px-4 pb-4 pt-20 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[rgba(255,255,255,0.74)] shadow-[0_24px_90px_rgba(32,39,32,0.11)] backdrop-blur">
          <div className="grid min-h-[calc(100vh-112px)] grid-cols-1">
            <div className={`signal-grid relative p-4 sm:p-6 ${loading ? "overflow-hidden" : ""}`}>
              {loading ? <ExplorationField progressIndex={progressIndex} /> : null}
              <div className="relative z-10">
                {loading || !report ? (
                  <EntryState
                    url={url}
                    setUrl={setUrl}
                    analysisMode={analysisMode}
                    setAnalysisMode={setAnalysisMode}
                    timeWindow={timeWindow}
                    setTimeWindow={setTimeWindow}
                    searchDepth={searchDepth}
                    setSearchDepth={setSearchDepth}
                    selectedSources={selectedSources}
                    setSelectedSources={setSelectedSources}
                    onSubmit={handleSubmit}
                    onAnalyze={runAnalysis}
                    loading={loading}
                    progressIndex={progressIndex}
                    previewQuotes={previewQuotes}
                    error={error}
                  />
                ) : (
                  <>
                    <HeroState report={report} error={error} />
                    <ReportDashboard report={report} />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function ExplorationField({ progressIndex }: { progressIndex: number }) {
  const activeStage = progressSteps[Math.min(progressIndex, progressSteps.length - 1)].stage;

  return (
    <div className="exploration-field" data-stage={activeStage} aria-hidden="true">
      <div className="analysis-lanes">
        {analysisLanes.map((lane) => (
          <span
            key={lane.y}
            className="analysis-lane"
            style={
              {
                "--lane-y": `${lane.y}%`,
                "--lane-delay": lane.d,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}

async function readJobResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as AnalyzeJobResponse | null;
  if (!response.ok || !payload) {
    if (payload?.ok === false) {
      throw new Error(`Analysis API returned ${response.status}: ${payload.error}`);
    }
    throw new Error(`Analysis API returned HTTP ${response.status}.`);
  }
  return payload;
}

async function pollAnalysisJob(
  jobId: string,
  signal: AbortSignal,
  onUpdate: (payload: AnalyzeJobResponse) => boolean | Promise<boolean>,
) {
  while (!signal.aborted) {
    const response = await fetch(`/api/analyze/${encodeURIComponent(jobId)}`, { signal });
    const done = await onUpdate(await readJobResponse(response));
    if (done) {
      return;
    }
    await delay(JOB_POLL_INTERVAL_MS, signal);
  }
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Analysis stopped.", "AbortError"));
      },
      { once: true },
    );
  });
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

function describeAnalysisError(reason: unknown) {
  if (reason instanceof DOMException && reason.name === "AbortError") {
    return "Analysis stopped.";
  }

  if (reason instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(reason.message)) {
    return "Could not reach the Social Insight API. The local dev server may have stopped or restarted. Start it on the same port as this page, then run the analysis again.";
  }

  if (reason instanceof SyntaxError) {
    return "The analysis API returned an invalid response. Check the dev server console for a route or build error.";
  }

  if (reason instanceof Error) {
    return reason.message;
  }

  return "Analysis failed. Check the dev server console for details.";
}

function PageLogo() {
  return (
    <Link
      href="/"
      aria-label="Go to starting point"
      className="absolute left-4 top-4 z-10 flex items-center gap-3 rounded-lg outline-none transition focus-visible:ring-4 focus-visible:ring-[rgba(var(--primary-rgb),0.16)] sm:left-6 lg:left-8"
    >
      <div className="flex size-11 items-center justify-center rounded-lg bg-[var(--ink)] text-white">
        <MessageCircleMore size={22} />
      </div>
      <div>
        <h1 className="text-xl font-semibold leading-tight tracking-normal [font-family:Arial,Helvetica,sans-serif]">Social Insight</h1>
        <p className="text-sm text-[var(--muted)]">Powered by BrightData</p>
      </div>
    </Link>
  );
}

function EntryState({
  url,
  setUrl,
  analysisMode,
  setAnalysisMode,
  timeWindow,
  setTimeWindow,
  searchDepth,
  setSearchDepth,
  selectedSources,
  setSelectedSources,
  onSubmit,
  onAnalyze,
  loading,
  progressIndex,
  previewQuotes,
  error,
}: {
  url: string;
  setUrl: (url: string) => void;
  analysisMode: AnalysisMode;
  setAnalysisMode: (analysisMode: AnalysisMode) => void;
  timeWindow: TimeWindow;
  setTimeWindow: (timeWindow: TimeWindow) => void;
  searchDepth: SearchDepth;
  setSearchDepth: (searchDepth: SearchDepth) => void;
  selectedSources: SupportedSource[];
  setSelectedSources: (sources: SupportedSource[]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAnalyze: () => void;
  loading: boolean;
  progressIndex: number;
  previewQuotes: LiveQuotePreview[];
  error: string;
}) {
  const [activeQuoteIndex, setActiveQuoteIndex] = useState(0);

  useEffect(() => {
    if (!previewQuotes.length) {
      return;
    }

    const interval = window.setInterval(() => {
      setActiveQuoteIndex((index) => (index + 1) % previewQuotes.length);
    }, 4200);
    return () => window.clearInterval(interval);
  }, [previewQuotes.length]);

  function toggleSource(source: SupportedSource) {
    if (selectedSources.includes(source)) {
      if (selectedSources.length === 1) {
        return;
      }
      setSelectedSources(selectedSources.filter((selectedSource) => selectedSource !== source));
      return;
    }
    setSelectedSources([...selectedSources, source]);
  }

  return (
    <div className="flex min-h-[calc(100vh-160px)] items-center justify-center px-0 py-10">
      <div className="w-full max-w-5xl">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--teal)]">Public conversation intelligence</p>
          <h2 className="title-serif mt-2 text-2xl font-semibold tracking-normal sm:text-4xl">
            Discover the customer pain hiding in public conversations
          </h2>
        </div>
        {loading ? (
          <div className="analysis-transition relative mx-auto w-full max-w-5xl py-16">
            <LiveQuoteRotator quotes={previewQuotes} activeIndex={activeQuoteIndex} />
            <div className="relative z-10 rounded-lg border border-[var(--border)] bg-white/80 p-4 shadow-sm backdrop-blur">
              <ProgressCard progressIndex={progressIndex} />
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="analysis-transition mx-auto grid w-full gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <label className="relative block min-w-0">
                <span className="sr-only">Product, company, or URL</span>
                <Globe2 className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={20} />
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  className="h-14 w-full rounded-lg border border-transparent bg-[var(--surface-muted)] pl-12 pr-4 text-base outline-none transition focus:border-[var(--teal)] focus:bg-white focus:ring-4 focus:ring-[rgba(var(--primary-rgb),0.16)] sm:h-16 sm:text-lg"
                  placeholder="Enter product, company, or URL"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => void onAnalyze()}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-lg bg-[var(--ink)] px-7 text-base font-semibold text-white transition hover:bg-black sm:h-16 sm:self-start"
            >
              Find insights
              <ArrowRight size={17} />
            </button>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <label className="relative inline-flex min-w-48 items-center">
                <span className="sr-only">Analysis mode</span>
                <select
                  value={analysisMode}
                  onChange={(event) => setAnalysisMode(event.target.value as AnalysisMode)}
                  className="h-9 w-full appearance-none rounded-lg border border-[var(--border)] bg-white py-0 pl-3 pr-9 text-sm font-semibold text-[var(--muted)] outline-none transition focus:border-[var(--teal)] focus:ring-4 focus:ring-[rgba(var(--primary-rgb),0.16)]"
                >
                  <option value="company">Company analysis</option>
                  <option value="category">Category analysis</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 text-[var(--muted)]" size={15} />
              </label>
              <label className="relative inline-flex min-w-40 items-center">
                <span className="sr-only">Time window</span>
                <select
                  value={timeWindow}
                  onChange={(event) => setTimeWindow(event.target.value as TimeWindow)}
                  className="h-9 w-full appearance-none rounded-lg border border-[var(--border)] bg-white py-0 pl-3 pr-9 text-sm font-semibold text-[var(--muted)] outline-none transition focus:border-[var(--teal)] focus:ring-4 focus:ring-[rgba(var(--primary-rgb),0.16)]"
                >
                  {TIME_WINDOW_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 text-[var(--muted)]" size={15} />
              </label>
              <label className="relative inline-flex min-w-36 items-center">
                <span className="sr-only">Search depth</span>
                <select
                  value={searchDepth}
                  onChange={(event) => setSearchDepth(event.target.value as SearchDepth)}
                  className="h-9 w-full appearance-none rounded-lg border border-[var(--border)] bg-white py-0 pl-3 pr-9 text-sm font-semibold text-[var(--muted)] outline-none transition focus:border-[var(--teal)] focus:ring-4 focus:ring-[rgba(var(--primary-rgb),0.16)]"
                >
                  {SEARCH_DEPTH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 text-[var(--muted)]" size={15} />
              </label>
              <fieldset className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2">
                <legend className="sr-only">Supported sources</legend>
                {SUPPORTED_SOURCE_OPTIONS.map((source) => (
                  <label key={source.value} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={selectedSources.includes(source.value)}
                      onChange={() => toggleSource(source.value)}
                      className="size-3.5 accent-[var(--teal)]"
                    />
                    <span>{source.label}</span>
                  </label>
                ))}
              </fieldset>
            </div>
          </form>
        )}
        {error ? (
          <div className="mx-auto mt-4 rounded-lg border border-[var(--crimson-soft)] bg-[var(--crimson-soft)] p-3 text-sm text-[var(--crimson)]">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ShareInsightsButton() {
  function exportPdf() {
    const details = Array.from(document.querySelectorAll("details"));
    const closedDetails = details.filter((detail) => !detail.open);
    closedDetails.forEach((detail) => {
      detail.open = true;
    });

    const restoreDetails = () => {
      closedDetails.forEach((detail) => {
        detail.open = false;
      });
      window.removeEventListener("afterprint", restoreDetails);
    };

    window.addEventListener("afterprint", restoreDetails, { once: true });
    window.setTimeout(() => {
      window.print();
    }, 50);
  }

  return (
    <button
      type="button"
      onClick={exportPdf}
      className="print:hidden inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--ink)] bg-transparent px-3 text-[11px] font-semibold text-[var(--ink)] transition hover:bg-[var(--ink)] hover:text-white"
    >
      Share insights
      <FileDown size={14} />
    </button>
  );
}

function HeroState({
  report,
  error,
}: {
  report: PainRadarReport | null;
  error: string;
}) {
  return (
    <section className="mb-5">
      <div className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--teal)]">Market intelligence report</p>
            <h2 className="title-serif mt-2 max-w-3xl text-2xl font-semibold tracking-normal sm:text-3xl">
              {report ? reportTitle(report) : "Discover the customer pain hiding in public conversations"}
            </h2>
          </div>
          {report ? <ShareInsightsButton /> : null}
        </div>
        {report ? <ReportMetricTabs report={report} /> : null}
        {error ? (
          <div className="rounded-lg border border-[var(--crimson-soft)] bg-[var(--crimson-soft)] p-3 text-sm text-[var(--crimson)]">
            {error}
          </div>
        ) : (
          <p className="max-w-5xl text-base leading-7 text-[var(--muted)]">
            {report
              ? displayExecutiveSummary(report.executiveSummary)
              : "Enter a product, company, or domain. Social Insight identifies the market, generates evidence-seeking searches, gathers public signals with Bright Data, scores the evidence, and synthesizes a decision-ready report with confidence and caveats."}
          </p>
        )}
      </div>
    </section>
  );
}

function ReportMetricTabs({ report }: { report: PainRadarReport }) {
  return (
    <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <Metric href="#pain-points" label="Pain points" value={report.topPainPoints.length.toString()} tone="teal" />
      <Metric href="#feature-requests" label="Feature requests" value={report.featureRequests.length.toString()} tone="teal" />
      <Metric href="#opportunities" label="Opportunities" value={report.opportunities.length.toString()} tone="teal" />
      <Metric href="#evidence-sources" label="Evidence sources" value={report.sources.length.toString()} tone="amber" />
      <Metric href="#competitors" label="Competitors" value={report.competitors.length.toString()} tone="crimson" />
    </div>
  );
}

function ProgressCard({ progressIndex }: { progressIndex: number }) {
  return (
    <div className="mx-auto w-full max-w-4xl overflow-x-auto px-1 py-2">
      <div className="flex min-w-[660px] items-start justify-center gap-4 sm:min-w-0">
        {progressSteps.map((step, index) => {
          const completed = index < progressIndex;
          const current = index === Math.min(progressIndex, progressSteps.length - 1);
          const active = completed || current;
          const Icon = step.icon;
          return (
            <div key={step.label} className="flex min-w-0 flex-1 flex-col items-center gap-3 text-center">
              <div className={`flex size-12 items-center justify-center rounded-lg ${active ? "bg-[var(--teal)] text-white" : "bg-white text-[var(--muted)] ring-1 ring-[var(--border)]"}`}>
                {current ? <CircleDashed className="animate-spin" size={20} /> : <Icon size={20} />}
              </div>
              <span className={`max-w-28 text-sm font-semibold leading-5 ${active ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LiveQuoteRotator({ quotes, activeIndex }: { quotes: LiveQuotePreview[]; activeIndex: number }) {
  if (!quotes.length) {
    return null;
  }

  const quote = quotes[activeIndex % quotes.length];
  const positions = [
    "sm:left-4 sm:top-0 sm:max-w-[420px] sm:text-left",
    "sm:right-6 sm:top-2 sm:max-w-[440px] sm:text-right",
    "sm:bottom-0 sm:left-1/2 sm:max-w-[520px] sm:-translate-x-1/2 sm:text-center",
    "sm:bottom-1 sm:right-8 sm:max-w-[430px] sm:text-right",
  ];

  return (
    <blockquote
      key={`${quote.sourceId}-${activeIndex}`}
      className={`live-quote-fade pointer-events-none relative z-20 mx-auto mb-5 line-clamp-2 max-w-[520px] text-balance px-2 text-center text-sm font-semibold leading-6 text-[rgba(17,22,17,0.58)] sm:absolute sm:m-0 ${positions[activeIndex % positions.length]}`}
    >
      <span className="sr-only">Live quote preview</span>
      &ldquo;{quote.quote}&rdquo;
    </blockquote>
  );
}

function ReportDashboard({ report }: { report: PainRadarReport }) {
  return (
    <section className="space-y-4">
      <SourceSummary sources={report.sources} />
      <WhatsWorkingPanel report={report} />
      <SentimentTrendPanel report={report} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <PainPointPanel pains={report.topPainPoints} sources={report.sources} />
        <OpportunityPanel report={report} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ClaimListPanel
          id="feature-requests"
          title="Feature requests"
          icon={Lightbulb}
          sources={report.sources}
          items={report.featureRequests.map((item) => ({
            title: item.request,
            body: item.rationale,
            evidenceIds: item.evidenceIds,
          }))}
        />
        <ClaimListPanel
          id="workarounds"
          title="Workarounds"
          icon={Workflow}
          sources={report.sources}
          items={report.workarounds.map((item) => ({
            title: item.workaround,
            body: item.tradeoff,
            evidenceIds: item.evidenceIds,
          }))}
        />
      </div>
      <NextStepsPanel report={report} />
      <SourcesPanel sources={report.sources} />
      <CaveatCard report={report} />
      <IntegrationPathFooter report={report} />
    </section>
  );
}

function WhatsWorkingPanel({ report }: { report: PainRadarReport }) {
  const items = report.whatsWorking || [];
  const sourceMap = useMemo(() => new Map(report.sources.map((source) => [source.sourceId, source])), [report.sources]);

  if (!items.length) {
    return null;
  }

  return (
    <section id="whats-working" className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]">
          <CheckCircle2 size={16} />
        </div>
        <h3 className="text-lg font-semibold">What&apos;s working</h3>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {items.slice(0, 5).map((item) => (
          <li key={item.title} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <div className="text-sm font-semibold leading-6">{item.title}</div>
            <div className="mt-1 text-xs font-semibold text-[var(--teal)]">
              Repeated in {item.evidenceIds.length} {pluralize("source", item.evidenceIds.length)}
            </div>
            <EvidenceSourceDisclosure ids={item.evidenceIds} sourceMap={sourceMap} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SourceSummary({ sources }: { sources: Evidence[] }) {
  const groups = useMemo(() => summarizeSources(sources), [sources]);
  const title = `${sources.length.toLocaleString()} ${pluralize("Source", sources.length)} analyzed`;

  return (
    <details className="group rounded-lg border border-[var(--border)] bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
        <h3 className="text-lg font-semibold">{title}</h3>
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
          Expand
          <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] px-5 pb-5 pt-4">
        {groups.map((group) => (
          <div key={group.label} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm font-semibold text-[var(--ink)]">
            <span>{group.label}: {group.count.toLocaleString()} {pluralize(group.itemName, group.count)}</span>
            {group.comments > 0 ? (
              <span className="text-[var(--muted)]"> | {group.comments.toLocaleString()} comments</span>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function summarizeSources(sources: Evidence[]) {
  const groups = new Map<string, { label: string; itemName: string; count: number; comments: number; directComments: number }>();

  for (const source of sources) {
    const label = sourceLabel(source.url);
    const itemName =
      label === "Reddit" || label === "X" || label === "LinkedIn"
        ? "post"
        : label === "YouTube"
          ? "video"
          : label === "Hacker News"
            ? "thread"
            : "page";
    const current = groups.get(label) || { label, itemName, count: 0, comments: 0, directComments: 0 };
    if (source.sourceType === "reddit_comment" || source.sourceType === "x_comment" || source.sourceType === "youtube_comment") {
      current.directComments += 1;
    } else {
      current.count += 1;
    }
    current.comments += extractCommentCount(`${source.title} ${source.snippet}`);
    groups.set(label, current);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      comments: Math.max(group.comments, group.directComments),
    }))
    .sort((a, b) => b.count - a.count || b.comments - a.comments || a.label.localeCompare(b.label));
}

function sourceLabel(url: string) {
  let domain = "";
  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    domain = "Unknown";
  }

  if (domain.includes("reddit.com")) return "Reddit";
  if (domain === "x.com" || domain === "twitter.com") return "X";
  if (domain.includes("news.ycombinator.com")) return "Hacker News";
  if (domain.includes("g2.com")) return "G2";
  if (domain.includes("producthunt.com")) return "Product Hunt";
  if (domain.includes("trustpilot.com")) return "Trustpilot";
  if (domain.includes("github.com")) return "GitHub";
  if (domain.includes("stackoverflow.com")) return "Stack Overflow";
  if (domain.includes("linkedin.com")) return "LinkedIn";
  if (domain.includes("youtube.com") || domain.includes("youtu.be")) return "YouTube";
  if (domain.includes("atlassian.com")) return "Atlassian";
  return domain || "Unknown";
}

function extractCommentCount(text: string) {
  const matches = text.matchAll(/([\d,]+)\+?\s+(?:comments?|replies|reply)/gi);
  let total = 0;
  for (const match of matches) {
    total += Number.parseInt(match[1].replace(/,/g, ""), 10) || 0;
  }
  return total;
}

function pluralize(word: string, count: number) {
  return count === 1 ? word : `${word}s`;
}

function SentimentTrendPanel({ report }: { report: PainRadarReport }) {
  const trend = useMemo(() => report.sentimentTrend || buildSentimentTrend(report.sources, report.timeWindow, report.generatedAt), [report]);
  const maxValue = Math.max(1, ...trend.buckets.flatMap((bucket) => [bucket.positive, bucket.negative]));
  const hasTrend = trend.positiveTotal + trend.negativeTotal > 0;
  const positivePath = chartPath(trend.buckets.map((bucket) => bucket.positive), maxValue);
  const negativePath = chartPath(trend.buckets.map((bucket) => bucket.negative), maxValue);
  const labelIndexes = xAxisLabelIndexes(trend.buckets.length);

  return (
    <section id="sentiment-trend" className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[var(--teal)]">
            <TrendingUp size={18} />
            <h3 className="text-lg font-semibold text-[var(--ink)]">Sentiment trend</h3>
          </div>
          <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Volume of dated public evidence classified as positive or negative across the selected timeline.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-lg bg-[var(--teal-soft)] px-3 py-2 text-[var(--teal)]">{trend.positiveTotal} positive</span>
          <span className="rounded-lg bg-[var(--crimson-soft)] px-3 py-2 text-[var(--crimson)]">{trend.negativeTotal} negative</span>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs font-semibold text-[var(--muted)]">
          <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-[var(--teal)]" />Positive</span>
          <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-[var(--crimson)]" />Negative</span>
          <span>{trend.datedCount} dated sources scanned</span>
        </div>
        {hasTrend ? (
          <svg viewBox="0 0 720 280" role="img" aria-label="Positive and negative sentiment volume over time" className="h-72 w-full overflow-visible">
            <line x1="16" x2="704" y1="196" y2="196" stroke="#d7e5d3" strokeWidth="1" />
            <path d={positivePath} fill="none" stroke="var(--teal)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d={negativePath} fill="none" stroke="var(--crimson)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {trend.buckets.map((bucket, index) => {
              const x = chartX(index, trend.buckets.length);
              return (
                <g key={`${bucket.label}-${index}`}>
                  {labelIndexes.has(index) ? (
                    <text x={x} y="254" textAnchor="middle" className="fill-[var(--muted)] text-[10px] font-semibold">
                      {bucket.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        ) : (
          <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-white p-6 text-center text-sm leading-6 text-[var(--muted)]">
            Not enough dated positive or negative evidence to draw a trend for this report yet.
          </div>
        )}
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
        Built from the broader dated evidence set when available, not just top pain points. Neutral, mixed, and undated sources are excluded from the line counts. {trend.excludedCount} {pluralize("source", trend.excludedCount)} excluded.
      </p>
    </section>
  );
}

function chartPath(values: number[], maxValue: number) {
  const points = values.map((value, index) => ({
    x: chartX(index, values.length),
    y: chartY(value, maxValue),
  }));
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  return points.reduce((path, point, index) => {
    if (index === 0) {
      return `M ${point.x} ${point.y}`;
    }
    const previous = points[index - 1];
    const controlX = (previous.x + point.x) / 2;
    return `${path} C ${controlX} ${previous.y}, ${controlX} ${point.y}, ${point.x} ${point.y}`;
  }, "");
}

function chartX(index: number, length: number) {
  if (length <= 1) {
    return 16;
  }
  return 16 + (index * 688) / (length - 1);
}

function chartY(value: number, maxValue: number) {
  return 196 - (Math.max(0, value) / maxValue) * 168;
}

function xAxisLabelIndexes(length: number) {
  const indexes = new Set<number>();
  const step = Math.max(1, Math.ceil(length / 6));
  for (let index = 0; index < length; index += step) {
    indexes.add(index);
  }
  indexes.add(length - 1);
  return indexes;
}

function Metric({ href, label, value }: { href: string; label: string; value: string; tone: "teal" | "amber" | "crimson" }) {
  return (
    <a
      href={href}
      className="group rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm outline-none transition hover:-translate-y-0.5 hover:border-[var(--teal)] hover:shadow-[0_12px_34px_rgba(32,39,32,0.12)] focus-visible:border-[var(--teal)] focus-visible:ring-4 focus-visible:ring-[rgba(var(--primary-rgb),0.16)]"
      aria-label={`Jump to ${label}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--muted)]">{label}</span>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-normal transition group-hover:text-[var(--teal)]">{value}</div>
    </a>
  );
}

function PainPointPanel({ pains, sources }: { pains: PainPoint[]; sources: Evidence[] }) {
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.sourceId, source])), [sources]);
  return (
    <div id="pain-points" className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Top pain points</h3>
        <span className="text-xs text-[var(--muted)]">ranked by severity, frequency, confidence</span>
      </div>
      <div className="space-y-4">
        {pains.map((pain, index) => (
          <details key={pain.title} className="group rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]">
            <summary className="cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-[var(--teal)]">#{index + 1} · {pain.affectedPersona}</div>
                  <h4 className="mt-1 text-xl font-semibold leading-tight">{pain.title}</h4>
                </div>
                <ChevronDown size={18} className="mt-1 shrink-0 text-[var(--muted)] transition-transform group-open:rotate-180" />
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{pain.summary}</p>
            </summary>
            <div className="border-t border-[var(--border)] px-4 pb-4 pt-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <Bar label="Severity" value={pain.severity} color="bg-[var(--crimson)]" />
                <Bar label="Frequency" value={pain.frequency} color="bg-[var(--amber)]" />
                <Bar label="Confidence" value={pain.confidence} color="bg-[var(--teal)]" />
              </div>
              <QuoteProofs quotes={pain.quoteProofs} sourceMap={sourceMap} />
              <div className="mt-4 rounded-lg bg-white p-3 text-sm">
                <span className="font-semibold">Implication:</span> <span className="text-[var(--muted)]">{pain.businessImplication}</span>
              </div>
              <div className="mt-3 rounded-lg bg-white p-3 text-sm">
                <span className="font-semibold">Validation:</span> <span className="text-[var(--muted)]">{pain.validationStep}</span>
              </div>
              <EvidenceSourceDisclosure ids={pain.evidenceIds} sourceMap={sourceMap} />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function EvidenceSourceDisclosure({ ids, sourceMap }: { ids: string[]; sourceMap: Map<string, Evidence> }) {
  const sources = ids
    .map((id) => sourceMap.get(id))
    .filter((source): source is Evidence => Boolean(source))
    .filter((source, index, all) => all.findIndex((item) => item.sourceId === source.sourceId) === index);

  if (!sources.length) {
    return null;
  }

  return (
    <details className="group mt-3">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--teal)] [&::-webkit-details-marker]:hidden">
        <ChevronDown size={15} className="-rotate-90 transition-transform group-open:rotate-0" />
        <span>{sources.length.toLocaleString()} {pluralize("Source", sources.length)}</span>
      </summary>
      <div className="mt-2 space-y-2">
        {sources.map((source) => (
          <a
            key={source.sourceId}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            title={source.url}
            className="flex items-start justify-between gap-3 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-sm transition hover:bg-white hover:text-[var(--teal)]"
          >
            <span className="line-clamp-2 font-medium leading-5">{source.title}</span>
            <ExternalLink size={13} className="mt-1 shrink-0 text-[var(--muted)]" />
          </a>
        ))}
      </div>
    </details>
  );
}

function QuoteProofs({
  quotes,
  sourceMap,
}: {
  quotes: PainPoint["quoteProofs"];
  sourceMap: Map<string, Evidence>;
}) {
  if (!quotes.length) {
    return null;
  }

  return (
    <div className="mt-4 space-y-2">
      {quotes.map((proof, index) => {
        const source = sourceMap.get(proof.sourceId);
        const sourceName = source ? sourceLabel(source.url) : "";
        return (
          <blockquote key={`${proof.sourceId}-${index}`} className="rounded-lg border border-[var(--border)] bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-[var(--teal)]">
              <Quote size={16} />
              {source ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  title={source.url}
                  className="inline-flex size-8 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-[var(--muted)] transition hover:bg-white hover:text-[var(--teal)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(var(--primary-rgb),0.16)]"
                  aria-label={`Open source: ${source.url}`}
                >
                  <ExternalLink size={14} />
                </a>
              ) : null}
            </div>
            <p className="text-sm font-medium leading-6 text-[var(--ink)]">
              &ldquo;{proof.quote}&rdquo;
              {sourceName ? <span className="text-[var(--muted)]"> - {sourceName}</span> : null}
            </p>
          </blockquote>
        );
      })}
    </div>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-[var(--muted)]">
        <span>{label}</span>
        <span>{Math.round(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#dfe5dc]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

function OpportunityPanel({ report }: { report: PainRadarReport }) {
  const sourceMap = useMemo(() => new Map(report.sources.map((source) => [source.sourceId, source])), [report.sources]);
  return (
    <div className="space-y-4">
      <div id="opportunities" className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold">Opportunities</h3>
        <div className="mt-4 space-y-3">
          {report.opportunities.map((opportunity) => (
            <div key={opportunity.title} className="rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]">
                  <Lightbulb size={16} />
                </div>
                <div>
                  <h4 className="text-xl font-semibold leading-tight">{opportunity.title}</h4>
                  <p className="mt-1 text-sm leading-5 text-[var(--muted)]">{opportunity.whyItMatters}</p>
                  <p className="mt-2 text-xs font-semibold text-[var(--amber)]">{opportunity.suggestedExperiment}</p>
                  <EvidenceSourceDisclosure ids={opportunity.evidenceIds} sourceMap={sourceMap} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div id="competitors" className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold">Key market players</h3>
        <div className="mt-4 space-y-2">
          {report.competitors.map((competitor) => (
            <div key={competitor.name} className="rounded-lg bg-[var(--surface-muted)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold leading-tight">{competitor.name}</div>
                  <div className="mt-1 text-sm leading-6 text-[var(--muted)]">{competitor.context}</div>
                </div>
                <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${sentimentTone(competitor.sentiment)}`}>{competitor.sentiment}</span>
              </div>
              <EvidenceSourceDisclosure ids={competitor.evidenceIds} sourceMap={sourceMap} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function sentimentTone(sentiment: PainRadarReport["competitors"][number]["sentiment"]) {
  if (sentiment === "positive") {
    return "bg-[var(--teal-soft)] text-[var(--teal)]";
  }
  if (sentiment === "negative") {
    return "bg-[var(--crimson-soft)] text-[var(--crimson)]";
  }
  if (sentiment === "mixed") {
    return "bg-[var(--amber-soft)] text-[var(--amber)]";
  }
  return "bg-white text-[var(--muted)]";
}

function ClaimListPanel({
  id,
  title,
  icon: Icon,
  items,
  sources,
}: {
  id: string;
  title: string;
  icon: typeof Lightbulb;
  items: Array<{ title: string; body: string; evidenceIds: string[] }>;
  sources: Evidence[];
}) {
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.sourceId, source])), [sources]);
  return (
    <div id={id} className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-[var(--teal)]">
          <Icon size={16} />
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <div className="space-y-3">
        {items.length ? (
          items.map((item) => (
            <div key={item.title} className="rounded-lg border border-[var(--border)] p-3">
              <div className="text-sm font-semibold">{item.title}</div>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{item.body}</p>
              <EvidenceSourceDisclosure ids={item.evidenceIds} sourceMap={sourceMap} />
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm font-semibold text-[var(--muted)]">
            N/A
          </div>
        )}
      </div>
    </div>
  );
}

function NextStepsPanel({ report }: { report: PainRadarReport }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-[var(--teal)]">
          <CheckCircle2 size={16} />
        </div>
        <h3 className="text-lg font-semibold">Recommended next steps</h3>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {report.recommendedNextSteps.map((step, index) => (
          <div key={step} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm leading-6 text-[var(--muted)]">
            <div className="mb-2 text-xs font-semibold text-[var(--teal)]">Step {index + 1}</div>
            {step}
          </div>
        ))}
      </div>
    </div>
  );
}

function CitationChips({
  ids,
  sourceMap,
  compact = false,
}: {
  ids: string[];
  sourceMap: Map<string, Evidence>;
  compact?: boolean;
}) {
  return (
    <>
      {ids.map((id, index) => {
        const source = sourceMap.get(id);
        return (
          <a
            key={`${id}-${index}`}
            href={source?.url || "#"}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!source}
            className={`inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-white font-semibold text-[var(--muted)] hover:text-[var(--teal)] ${
              compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs"
            }`}
          >
            {id}
            <ExternalLink size={compact ? 10 : 12} />
          </a>
        );
      })}
    </>
  );
}

function SourcesPanel({ sources }: { sources: Evidence[] }) {
  return (
    <details id="evidence-sources" className="group scroll-mt-24 rounded-lg border border-[var(--border)] bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
        <h3 className="text-lg font-semibold">Evidence trail</h3>
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
          {sources.length.toLocaleString()} source snippets and queries
          <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="grid gap-3 border-t border-[var(--border)] p-5 lg:grid-cols-2">
        {sources.map((source, index) => (
          <article
            key={`${source.sourceId}-${index}`}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 transition hover:border-[var(--teal)] hover:bg-white"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="rounded-lg bg-white px-2 py-1 text-xs font-semibold text-[var(--teal)]">
                {evidenceSourceLabel(source)}
              </span>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                title={source.url}
                aria-label={`Open source: ${source.url}`}
                className="inline-flex size-8 items-center justify-center rounded-lg bg-white text-[var(--muted)] transition hover:text-[var(--teal)]"
              >
                <ExternalLink size={14} />
              </a>
            </div>
            <h4 className="line-clamp-2 text-sm font-semibold">{source.title}</h4>
            <p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--muted)]">{source.snippet}</p>
          </article>
        ))}
      </div>
    </details>
  );
}

function evidenceSourceLabel(source: Evidence) {
  const labels: Partial<Record<Evidence["sourceType"], string>> = {
    article: "Article",
    demo: "Demo",
    forum: "Forum",
    linkedin_post: "LinkedIn",
    reddit_comment: "Reddit",
    reddit_post: "Reddit",
    review: "Review",
    serp: "Web",
    social: "Social",
    website: "Website",
    x_comment: "X",
    x_post: "X",
    youtube_comment: "YouTube",
    youtube_video: "YouTube",
  };

  return labels[source.sourceType] || sourceLabel(source.url);
}

function IntegrationPathFooter({ report }: { report: PainRadarReport }) {
  const items = [
    { label: "Website retrieval", body: report.integrationNotes.websiteRetrieval },
    { label: "Public signal collection", body: report.integrationNotes.marketDiscovery },
    { label: "AI synthesis", body: report.integrationNotes.synthesis },
  ];

  return (
    <footer className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck size={18} className="text-[var(--teal)]" />
        <h3 className="text-lg font-semibold">Integration path</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg bg-[var(--surface-muted)] p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--teal)]">
              {item.label}
            </div>
            <p className="text-xs leading-5 text-[var(--muted)]">{item.body}</p>
          </div>
        ))}
      </div>
    </footer>
  );
}

function CaveatCard({ report }: { report: PainRadarReport | null }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle size={18} className="text-[var(--crimson)]" />
        <h3 className="text-sm font-semibold">What not to trust yet</h3>
      </div>
      <div className="space-y-2">
        {(report?.whatNotToTrustYet || [
          "Frequency is directional until live evidence is collected.",
          "Public conversations may overrepresent frustrated users.",
          "Recommendations should be validated with interviews.",
        ]).map((item) => (
          <p key={item} className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">
            {item}
          </p>
        ))}
      </div>
    </div>
  );
}
