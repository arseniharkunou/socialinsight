import { NextResponse } from "next/server";
import { runAnalysisForInputWithDeadline } from "@/lib/analysis";
import { SEARCH_DEPTH_OPTIONS, SUPPORTED_SOURCE_OPTIONS, TIME_WINDOW_OPTIONS } from "@/lib/types";
import type { AnalysisMode, AnalyzeProgressStage, AnalyzeStreamEvent, LiveQuotePreview, SearchDepth, SupportedSource, TimeWindow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const DEFAULT_SUPPORTED_SOURCES = SUPPORTED_SOURCE_OPTIONS.map((source) => source.value);

export async function POST(request: Request) {
  const encoder = new TextEncoder();

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
      return NextResponse.json(
        { ok: false, error: analysisMode === "category" ? "Enter a product, company, category, or domain." : "Enter a product, company, or domain." },
        { status: 400 },
      );
    }
    const targetUrl = body.url;

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: AnalyzeStreamEvent) => {
          if (closed) {
            return;
          }
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            closed = true;
          }
        };
        let closed = false;

        const heartbeat = setInterval(() => {
          if (closed) {
            return;
          }
          try {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch {
            closed = true;
          }
        }, 3000);

        try {
          send({ type: "progress", stage: "website" });
          const report = await runAnalysisForInputWithDeadline(
            {
              url: targetUrl,
              analysisMode,
              timeWindow,
              searchDepth,
              sources: sources.length ? sources : DEFAULT_SUPPORTED_SOURCES,
            },
            (stage: AnalyzeProgressStage) => send({ type: "progress", stage }),
            (quotes: LiveQuotePreview[]) => send({ type: "preview_quotes", quotes }),
            request.signal,
            analysisDeadlineMs(),
          );
          send({ type: "complete", report });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Analysis failed";
          send({ type: "error", error: message });
        } finally {
          closed = true;
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // Stream may already be closed by the platform or client.
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected analysis error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function analysisDeadlineMs() {
  const configured = Number(process.env.ANALYSIS_FINAL_DEADLINE_MS || process.env.ANALYSIS_STREAM_DEADLINE_MS || 0);
  if (Number.isFinite(configured) && configured >= 1000) {
    return configured;
  }
  return process.env.VERCEL ? 7500 : 120000;
}
