import { demoSignals, fetchWebsiteContent, hasBrightDataCredentials, hasBrightDataMcpCredentials, searchPublicSignals } from "@/lib/brightdata";
import { extractEvidenceCards } from "@/lib/evidence";
import { auditReportAgainstEvidence, buildEntityRelevanceContext, buildEvidenceClusters, expandMarketQueriesForEntity, filterAndRankSignalsForRelevance } from "@/lib/insight-quality";
import { buildMarketProfile, inferMarketCategoryFromText, marketDefaultsForCategory } from "@/lib/market";
import { demoSynthesis, hasOpenAiCredentials, synthesizeReport } from "@/lib/openai";
import { categoryFromExecutiveSummary, displayExecutiveSummary } from "@/lib/report-title";
import { normalizeUrl } from "@/lib/utils";
import type { AnalysisMode, AnalyzeProgressStage, Evidence, LiveQuotePreview, MarketProfile, MarketSignal, PainRadarReport, SearchDepth, SupportedSource, TimeWindow } from "@/lib/types";

export type AnalysisTarget = {
  analysisMode: AnalysisMode;
  label: string;
  modelTarget: string;
  websiteUrl: string | null;
};

const EVIDENCE_LIMITS: Record<SearchDepth, number> = {
  fast: 60,
  deep: 180,
};

export async function runAnalysisForInput(
  input: { url: string; analysisMode?: AnalysisMode; timeWindow?: TimeWindow; searchDepth?: SearchDepth; sources?: SupportedSource[] },
  setStage: (stage: AnalyzeProgressStage) => void,
  setPreviewQuotes?: (quotes: LiveQuotePreview[]) => void,
  signal?: AbortSignal,
) {
  const analysisMode = input.analysisMode === "category" ? "category" : "company";
  const timeWindow = input.timeWindow || "1y";
  const searchDepth = input.searchDepth || "fast";
  const target = resolveAnalysisTarget(input.url, analysisMode);
  return runAnalysis(target, timeWindow, searchDepth, input.sources, setStage, setPreviewQuotes, signal);
}

export function resolveAnalysisTarget(input: string, analysisMode: AnalysisMode): AnalysisTarget {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    throw new Error(analysisMode === "category" ? "Enter a product, company, category, or domain." : "Enter a product, company, or domain.");
  }

  if (looksLikeUrl(trimmed)) {
    const websiteUrl = normalizeUrl(trimmed);
    return {
      analysisMode,
      label: websiteUrl,
      modelTarget: websiteUrl,
      websiteUrl,
    };
  }

  if (analysisMode === "category") {
    const label = cleanedCompanyName(trimmed);
    if (!label) {
      throw new Error("Enter a product, company, category, or domain.");
    }

    return {
      analysisMode,
      label,
      modelTarget: label,
      websiteUrl: null,
    };
  }

  const label = cleanedCompanyName(trimmed);
  if (!label) {
    throw new Error("Enter a product, company, or public domain.");
  }

  return {
    analysisMode,
    label,
    modelTarget: label,
    websiteUrl: null,
  };
}

async function runAnalysis(
  target: AnalysisTarget,
  timeWindow: TimeWindow,
  searchDepth: SearchDepth,
  sources: SupportedSource[] | undefined,
  setStage: (stage: AnalyzeProgressStage) => void,
  setPreviewQuotes?: (quotes: LiveQuotePreview[]) => void,
  signal?: AbortSignal,
) {
  const providerNotes: string[] = [];
  const stageNotes = {
    websiteRetrieval: target.websiteUrl
      ? target.analysisMode === "category"
        ? hasBrightDataCredentials()
          ? "Category mode selected; Bright Data Web Unlocker reads the target website to infer the surrounding category"
          : "Category mode selected; direct fetch reads the target website to infer the surrounding category"
        : hasBrightDataCredentials()
          ? "Bright Data Web Unlocker REST API"
          : "Direct fetch fallback because BRIGHTDATA_API_KEY is not set"
      : target.analysisMode === "category"
        ? "Category mode selected; skipping website retrieval and using category-wide market queries"
        : "No website URL provided; using the product, company, or domain name for local query construction",
    marketDiscovery: hasBrightDataCredentials() || hasBrightDataMcpCredentials()
      ? `${searchDepthLabel(searchDepth)} using local query templates plus selected Bright Data public sources (${sourceSelectionLabel(sources)}), constrained to ${timeWindowLabel(timeWindow)} where provider records expose dates; target evidence cap ${EVIDENCE_LIMITS[searchDepth]}`
      : "Seed demo market signals because no Bright Data REST or MCP credentials are set",
    synthesis: hasOpenAiCredentials()
      ? `OpenAI Responses API using ${process.env.OPENAI_MODEL || "gpt-5.2"}`
      : "Deterministic demo synthesis because OPENAI_API_KEY is not set",
  };

  throwIfAborted(signal);
  setStage("website");
  let websiteText: string;
  if (target.websiteUrl) {
    try {
      websiteText = await fetchWebsiteContent(target.websiteUrl);
    } catch (error) {
      const note = providerFailureNote("Website retrieval", error);
      providerNotes.push(note);
      stageNotes.websiteRetrieval = note;
      websiteText = `Website retrieval failed for ${target.websiteUrl}. Infer cautiously from the target URL, target label, and deterministic market queries. Target label: ${target.label}.`;
    }
  } else {
    websiteText = target.analysisMode === "category"
      ? `The user selected category analysis for: ${target.label}. Search across the category, identify competitors, and infer sentiment from public evidence.`
      : `No website URL was provided. The user entered this product, company, or domain name: ${target.label}. Infer cautiously from the target name and deterministic public-signal queries.`;
  }

  throwIfAborted(signal);
  setStage("market");
  let market = buildMarketProfile(target.modelTarget, websiteText, target.analysisMode);
  market = normalizeMarketIdentity(market, target);
  const relevanceContext = buildEntityRelevanceContext({
    targetLabel: target.label,
    websiteUrl: target.websiteUrl,
    market,
    websiteText,
    analysisMode: target.analysisMode,
  });
  market = {
    ...market,
    searchQueries: expandMarketQueriesForEntity(market, relevanceContext),
  };

  throwIfAborted(signal);
  setStage("queries");

  throwIfAborted(signal);
  setStage("brightdata");
  let rawSignals: MarketSignal[];
  const previewSignals = (signals: MarketSignal[]) => previewQuotesFromEvidence(filterAndRankSignalsForRelevance(signals, relevanceContext, { allowFallback: false }), market, target);
  try {
    rawSignals = await searchPublicSignals(market.searchQueries, timeWindow, sources, searchDepth, (signals) => setPreviewQuotes?.(previewSignals(signals)));
    setPreviewQuotes?.(previewSignals(rawSignals));
    if (searchDepth === "deep" && shouldRunSecondPass(rawSignals)) {
      const secondPassSignals = await searchPublicSignals(
        buildSecondPassQueries(market, target),
        timeWindow,
        sources,
        searchDepth,
        (signals) => setPreviewQuotes?.(previewSignals(signals)),
      );
      rawSignals = mergeSignals(rawSignals, secondPassSignals);
      stageNotes.marketDiscovery = `${stageNotes.marketDiscovery}; thin first-pass evidence triggered a broader second-pass customer-voice sweep`;
      setPreviewQuotes?.(previewSignals(rawSignals));
    }
  } catch (error) {
    const note = providerFailureNote("Bright Data public-signal collection", error);
    providerNotes.push(note);
    stageNotes.marketDiscovery = note;
    rawSignals = demoSignals(market.searchQueries);
    setPreviewQuotes?.(previewSignals(rawSignals));
  }
  const beforeRelevanceCount = rawSignals.length;
  rawSignals = filterAndRankSignalsForRelevance(rawSignals, relevanceContext);
  if (rawSignals.length < beforeRelevanceCount) {
    stageNotes.marketDiscovery = `${stageNotes.marketDiscovery}; relevance filter retained ${rawSignals.length} of ${beforeRelevanceCount} collected signals for the target entity/category`;
  }
  market = refineGenericMarketCategory(market, rawSignals);

  throwIfAborted(signal);
  setStage("evidence");
  const signals = extractEvidenceCards(rawSignals, market, { limit: EVIDENCE_LIMITS[searchDepth], diversify: searchDepth === "deep" });
  const evidenceClusters = buildEvidenceClusters(signals);
  setPreviewQuotes?.(previewQuotesFromEvidence(signals, market, target));

  throwIfAborted(signal);
  setStage("synthesis");
  let mode: "live" | "demo" = hasOpenAiCredentials() && (hasBrightDataCredentials() || hasBrightDataMcpCredentials()) && providerNotes.length === 0 ? "live" : "demo";
  let synthesized;
  try {
    synthesized = await synthesizeReport({ url: target.modelTarget, market, signals, evidenceClusters, mode, analysisMode: target.analysisMode, searchDepth });
  } catch (error) {
    const note = providerFailureNote("OpenAI report synthesis", error);
    providerNotes.push(note);
    stageNotes.synthesis = stageNotes.synthesis === note ? note : `${stageNotes.synthesis} ${note}`;
    mode = "demo";
    synthesized = demoSynthesis(market, signals);
  }
  synthesized = validateEvidenceIds(synthesized, signals);
  synthesized = auditReportAgainstEvidence(synthesized, signals, evidenceClusters);
  synthesized = {
    ...synthesized,
    executiveSummary: displayExecutiveSummary(synthesized.executiveSummary),
  };
  market = reconcileMarketCategoryFromSummary(market, synthesized.executiveSummary);

  return {
    analyzedUrl: target.modelTarget,
    generatedAt: new Date().toISOString(),
    analysisMode: target.analysisMode,
    timeWindow,
    searchDepth,
    mode,
    market,
    sources: signals,
    integrationNotes: {
      websiteRetrieval: stageNotes.websiteRetrieval,
      marketDiscovery: stageNotes.marketDiscovery,
      synthesis: providerNotes.length ? stageNotes.synthesis : stageNotes.synthesis,
    },
    ...synthesized,
  } satisfies PainRadarReport;
}

function reconcileMarketCategoryFromSummary(market: MarketProfile, executiveSummary: string): MarketProfile {
  const category = categoryFromExecutiveSummary(executiveSummary);
  if (!category || isGenericMarketCategory(category) || category.toLowerCase() === market.category.toLowerCase()) {
    return market;
  }

  return {
    ...market,
    category,
    ...marketDefaultsForCategory(category),
  };
}

function looksLikeUrl(input: string) {
  return /^https?:\/\//i.test(input) || /^www\./i.test(input) || /(?:^|[^\s@])\.[a-z]{2,}(?:[/:?#]|$)/i.test(input);
}

function cleanedCompanyName(input: string) {
  return input
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function normalizeMarketIdentity(market: MarketProfile, target: AnalysisTarget): MarketProfile {
  const fallbackName = productNameFromTarget(target);
  return {
    ...market,
    productName: isUnknownLabel(market.productName) ? fallbackName : market.productName.trim(),
    category: isUnknownLabel(market.category) ? "Market intelligence" : market.category.trim(),
  };
}

function refineGenericMarketCategory(market: MarketProfile, signals: Evidence[]): MarketProfile {
  if (!isGenericMarketCategory(market.category)) {
    return market;
  }

  const signalText = signals
    .slice(0, 40)
    .map((signal) => `${signal.title} ${signal.snippet}`)
    .join("\n")
    .toLowerCase();
  const inferredCategory = inferMarketCategoryFromText(signalText);
  if (isGenericMarketCategory(inferredCategory)) {
    return market;
  }

  return {
    ...market,
    category: inferredCategory,
  };
}

function shouldRunSecondPass(signals: MarketSignal[]) {
  if (signals.length < 90) {
    return true;
  }
  return signals.filter((signal) => isCustomerVoiceSignal(signal)).length < 24;
}

function isCustomerVoiceSignal(signal: MarketSignal) {
  return (
    signal.sourceType.startsWith("reddit") ||
    signal.sourceType.startsWith("x_") ||
    signal.sourceType.startsWith("youtube") ||
    signal.sourceType === "linkedin_post" ||
    /reddit\.com|x\.com|twitter\.com|linkedin\.com|youtube\.com|youtu\.be|g2\.com|trustpilot\.com|producthunt\.com|stackoverflow\.com|news\.ycombinator\.com/i.test(signal.url)
  );
}

function buildSecondPassQueries(market: MarketProfile, target: AnalysisTarget) {
  const category = market.category;
  const product = market.productName;
  const domain = domainFromAnalysisTarget(target.modelTarget);
  return uniqueStrings([
    ...market.searchQueries,
    `"${product}" customer complaints`,
    `"${product}" user feedback`,
    `"${product}" positive reviews`,
    `"${product}" recommended by users`,
    `"${product}" testimonials success stories`,
    `"${product}" works well helpful reliable`,
    `"${product}" reviews problems`,
    `"${product}" implementation adoption`,
    `"${product}" reimbursement trust adoption`,
    `"${product}" competitors alternatives`,
    ...(domain ? [`"${domain}" reviews`, `"${domain}" positive reviews`, `"${domain}" testimonials`, `"${domain}" complaints`] : []),
    `"${category}" customer pain points`,
    `"${category}" positive reviews`,
    `"${category}" customer success stories`,
    `"${category}" implementation complaints`,
    `"${category}" buyer concerns`,
    `"${category}" reimbursement complaints`,
    `"${category}" implementation problems`,
    `"${category}" alternatives comparison`,
  ]).slice(0, 24);
}

function domainFromAnalysisTarget(target: string) {
  try {
    return new URL(target).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function mergeSignals(first: MarketSignal[], second: MarketSignal[]) {
  const seen = new Set<string>();
  const merged: MarketSignal[] = [];
  for (const signal of [...first, ...second]) {
    const key = normalizedSignalKey(signal);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(signal);
  }
  return merged;
}

function normalizedSignalKey(signal: MarketSignal) {
  try {
    const url = new URL(signal.url);
    url.hash = "";
    for (const param of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      url.searchParams.delete(param);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return signal.sourceId;
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean)));
}

function productNameFromTarget(target: AnalysisTarget) {
  if (!target.websiteUrl) {
    return titleCaseName(target.label);
  }

  try {
    const hostname = new URL(target.websiteUrl).hostname.replace(/^www\./, "");
    return titleCaseName(hostname.split(".")[0] || target.label);
  } catch {
    return titleCaseName(target.label);
  }
}

function titleCaseName(value: string) {
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[/?#].*$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => (/[A-Z]/.test(word.slice(1)) ? word : word.replace(/^\w/, (c) => c.toUpperCase())))
    .join(" ") || "Target product";
}

function isUnknownLabel(value: string) {
  return !value.trim() || /^(unknown|n\/a|not available|null|undefined)$/i.test(value.trim());
}

function isGenericMarketCategory(value: string) {
  return /^(general product or company market|market intelligence|target product|product or company market)$/i.test(value.trim());
}

function providerFailureNote(label: string, error: unknown) {
  const detail = error instanceof Error ? error.message : "provider request failed";
  const quotaOrAuth = /quota|401|403|429|api key|billing/i.test(detail);
  return `${label} fell back to demo output${quotaOrAuth ? " because credentials, billing, or quota need attention." : "."}`;
}

function timeWindowLabel(timeWindow: TimeWindow) {
  switch (timeWindow) {
    case "30d":
      return "the last 30 days";
    case "90d":
      return "the last 90 days";
    case "6m":
      return "the last 6 months";
    case "1y":
      return "the last year";
  }
}

function sourceSelectionLabel(sources: SupportedSource[] | undefined) {
  if (!sources?.length) {
    return "Web, Reddit, X, LinkedIn, and YouTube";
  }

  const labels: Record<SupportedSource, string> = {
    web: "Web",
    reddit: "Reddit",
    x: "X",
    linkedin: "LinkedIn",
    youtube: "YouTube",
  };

  return sources.map((source) => labels[source]).filter(Boolean).join(", ");
}

function searchDepthLabel(searchDepth: SearchDepth) {
  return searchDepth === "deep" ? "Deep search" : "Fast search";
}

function validateEvidenceIds<
  T extends Omit<PainRadarReport, "analyzedUrl" | "generatedAt" | "analysisMode" | "timeWindow" | "searchDepth" | "mode" | "market" | "sources" | "integrationNotes">,
>(report: T, sources: Evidence[]): T {
  const allowed = new Set(sources.map((source) => source.sourceId));
  const fallback = sources.slice(0, 2).map((source) => source.sourceId);
  const clean = (ids: string[]) => {
    const valid = ids.filter((id) => allowed.has(id));
    return valid.length > 0 ? valid : fallback;
  };
  const cleanRepeated = (ids: string[]) => Array.from(new Set(ids.filter((id) => allowed.has(id))));
  const sourceMap = new Map(sources.map((source) => [source.sourceId, source]));
  const cleanQuotes = (quotes: Array<{ quote: string; sourceId: string }> | undefined, ids: string[], context: string) => {
    const validQuotes = (quotes || [])
      .filter((quote) => quote.quote && allowed.has(quote.sourceId))
      .map((quote) => ({
        ...quote,
        quote: cleanQuoteText(quote.quote),
      }))
      .filter((quote) => quote.quote && quoteQualityScore(quote.quote, context) >= 8)
      .sort((a, b) => quoteQualityScore(b.quote, context) - quoteQualityScore(a.quote, context))
      .slice(0, 3);
    if (validQuotes.length > 0) {
      return validQuotes;
    }
    const fallbackQuotes = clean(ids)
      .map((id) => {
        const source = sourceMap.get(id);
        return source
          ? {
              sourceId: id,
              quote: bestQuoteFromEvidence(source, context),
            }
          : null;
      })
      .filter((preview): preview is LiveQuotePreview => Boolean(preview))
      .filter((quote) => quote.quote && quoteQualityScore(quote.quote, context) >= 6)
      .sort((a, b) => quoteQualityScore(b.quote, context) - quoteQualityScore(a.quote, context))
      .slice(0, 2) as Array<{ quote: string; sourceId: string }>;

    return fallbackQuotes.length ? fallbackQuotes : [];
  };

  return {
    ...report,
    whatsWorking: report.whatsWorking
      .map((item) => ({
        ...item,
        evidenceIds: cleanRepeated(item.evidenceIds),
      }))
      .filter((item) => item.title.trim() && item.evidenceIds.length >= 2)
      .slice(0, 5),
    topPainPoints: report.topPainPoints.map((item) => ({
      ...item,
      evidenceIds: clean(item.evidenceIds),
      quoteProofs: cleanQuotes(item.quoteProofs, item.evidenceIds, `${item.title} ${item.summary} ${item.affectedPersona}`),
    })),
    featureRequests: report.featureRequests.map((item) => ({ ...item, evidenceIds: clean(item.evidenceIds) })),
    workarounds: report.workarounds.map((item) => ({ ...item, evidenceIds: clean(item.evidenceIds) })),
    competitors: report.competitors.map((item) => ({ ...item, evidenceIds: clean(item.evidenceIds) })),
    opportunities: report.opportunities.map((item) => ({ ...item, evidenceIds: clean(item.evidenceIds) })),
  };
}

function previewQuotesFromEvidence(sources: Evidence[], market: MarketProfile, target: AnalysisTarget): LiveQuotePreview[] {
  const preferredTypes = new Set([
    "reddit_comment",
    "reddit_post",
    "x_comment",
    "x_post",
    "linkedin_post",
    "youtube_comment",
    "serp",
    "article",
    "demo",
    "forum",
    "review",
    "social",
  ]);
  const seen = new Set<string>();
  const relevance = previewRelevanceContext(market, target);

  return sources
    .filter((source) => preferredTypes.has(source.sourceType))
    .filter((source) => isPreviewSourceRelevant(source, relevance))
    .map((source) => {
      const quote = quoteFromEvidenceSnippet(source);
      if (!quote) {
        return null;
      }
      return {
        quote,
        sourceId: source.sourceId,
        sourceTitle: source.title,
        sourceUrl: source.url,
        sourceType: source.sourceType,
      };
    })
    .filter((preview): preview is LiveQuotePreview => Boolean(preview))
    .filter((preview) => {
      const key = preview.quote.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function previewRelevanceContext(market: MarketProfile, target: AnalysisTarget) {
  const websiteHost = target.websiteUrl ? safeHostname(target.websiteUrl) : "";
  const domainToken = websiteHost.split(".")[0] || "";
  const phrases = [
    market.category,
    ...market.jobsToBeDone,
  ]
    .map(normalizePreviewText)
    .filter((phrase) => phrase.length >= 8 && !isGenericMarketCategory(phrase));
  const tokens = [
    market.category,
    market.marketDescription,
    ...market.targetUsers,
    ...market.jobsToBeDone,
  ]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 5 && !PREVIEW_STOP_WORDS.has(token) && token !== domainToken)
    .slice(0, 50);

  return {
    requireMarketContext: Boolean(target.websiteUrl),
    websiteHost,
    domainToken,
    phrases: Array.from(new Set(phrases)),
    tokens: Array.from(new Set(tokens)),
  };
}

const PREVIEW_STOP_WORDS = new Set([
  "about",
  "across",
  "adoption",
  "buyers",
  "category",
  "companies",
  "competing",
  "customer",
  "customers",
  "market",
  "product",
  "products",
  "public",
  "reviews",
  "signals",
  "software",
  "users",
]);

const PREVIEW_EXCLUDED_TERMS = ["hip hop", "rapper", "album", "lyrics", "concert", "mixtape", "spotify", "soundcloud", "bandcamp"];

function isPreviewSourceRelevant(
  source: Evidence,
  relevance: ReturnType<typeof previewRelevanceContext>,
) {
  if (!relevance.requireMarketContext) {
    return true;
  }

  const text = normalizePreviewText(`${source.title} ${source.snippet} ${source.url}`);
  if (relevance.websiteHost && text.includes(relevance.websiteHost)) {
    return true;
  }
  if (PREVIEW_EXCLUDED_TERMS.some((term) => text.includes(term))) {
    return false;
  }

  const phraseHit = relevance.phrases.some((phrase) => text.includes(phrase));
  if (phraseHit) {
    return true;
  }

  const tokenHits = relevance.tokens.filter((token) => text.includes(token)).length;
  const domainHit = Boolean(relevance.domainToken && text.includes(relevance.domainToken));
  return tokenHits >= 2 || (domainHit && tokenHits >= 1);
}

function normalizePreviewText(value: string) {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function quoteFromEvidenceSnippet(source: Evidence) {
  const match = source.snippet.match(/Quote:\s*"([^"]+)"/i);
  const quote = match?.[1] || bestQuoteFromEvidence(source);
  const cleaned = cleanQuoteText(quote);
  if (cleaned.length < 35 || cleaned.length > 240) {
    return "";
  }
  return cleaned;
}

function bestQuoteFromEvidence(source: Evidence, context = "") {
  const explicitQuote = source.snippet.match(/Quote:\s*"([^"]+)"/i)?.[1] || "";
  const text = `${source.title}. ${source.snippet}`
    .replace(/\bSignals?:\s*[^.]+?\.\s*/gi, "")
    .replace(/\bSource:\s*[^.]+(?:\.\s*)?/gi, "")
    .replace(/\bQuery:\s*[^.]+(?:\.\s*)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const candidates = [
    explicitQuote,
    ...text
      .split(/(?<=[.!?])\s+|[;•]\s+/)
      .map((part) => part.trim()),
  ]
    .map(cleanQuoteText)
    .filter((part) => part.length >= 35 && part.length <= 220);

  return candidates
    .map((quote) => ({ quote, score: quoteQualityScore(quote, context) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.quote || "";
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Analysis cancelled.", "AbortError");
  }
}

const QUOTE_IMPACT_TERMS = [
  "aggressive",
  "alternatives",
  "broken",
  "burden",
  "can't",
  "code-heavy",
  "complex",
  "complaint",
  "concern",
  "confusing",
  "difficult",
  "expensive",
  "failed",
  "friction",
  "hard",
  "issue",
  "less",
  "limitation",
  "manual",
  "missing",
  "pain",
  "pricing",
  "problem",
  "reliability",
  "risk",
  "setup",
  "simpler",
  "slow",
  "switch",
  "technical",
  "too",
  "trust",
  "unreliable",
  "workaround",
];

const GENERIC_QUOTE_PATTERNS = [
  /\bguide will help you pick\b/i,
  /\bi[’']?ve tried quite a few tools over time\b/i,
  /\btop\s+\d*\s*(?:best\s+)?(?:tools|alternatives|solutions)\b/i,
  /\bbest\s+(?:tools|alternatives|solutions)\b/i,
  /\bultimate guide\b/i,
  /\blearn how to\b/i,
  /\bposted on the topic\b/i,
  /\bnext frontier\b/i,
  /\bfrequently asked questions\b/i,
  /\bwe offer\b/i,
  /\brequest a demo\b/i,
  /\bread more\b/i,
];

function cleanQuoteText(value: string) {
  return value
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+-\s+(?:Reddit|LinkedIn|X|YouTube|Web|Article|Forum|Review|Social)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function quoteQualityScore(quote: string, context = "") {
  const cleaned = cleanQuoteText(quote);
  if (cleaned.length < 35 || cleaned.length > 220) {
    return -20;
  }
  if (/^(source|query|signals?):/i.test(cleaned) || GENERIC_QUOTE_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return -20;
  }

  const text = cleaned.toLowerCase();
  const impactMatches = QUOTE_IMPACT_TERMS.filter((term) => quoteTermMatches(text, term)).length;
  const firstPerson = /\b(?:i|we|our|my|users?|customers?|buyers?|prospects?)\b/i.test(cleaned) ? 2 : 0;
  const contextTokens = context
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((token) => token.length >= 5 && !QUOTE_CONTEXT_STOP_WORDS.has(token));
  const contextOverlap = Array.from(new Set(contextTokens)).filter((token) => text.includes(token)).length;
  const specificity = /\b(?:too|less|more|without|against|instead|cannot|can't|need|want|switch|compare|simpler)\b/i.test(cleaned) ? 3 : 0;

  return impactMatches * 5 + firstPerson + Math.min(contextOverlap, 4) * 2 + specificity;
}

const QUOTE_CONTEXT_STOP_WORDS = new Set([
  "about",
  "buyers",
  "customer",
  "customers",
  "evidence",
  "market",
  "multiple",
  "public",
  "signal",
  "signals",
  "source",
  "sources",
  "users",
]);

function quoteTermMatches(text: string, term: string) {
  return new RegExp(`(^|[^a-z0-9])${escapeQuoteRegExp(term).replace(/\s+/g, "\\s+")}([^a-z0-9]|$)`, "i").test(text);
}

function escapeQuoteRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
