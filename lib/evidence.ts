import { hostFromUrl, truncate } from "@/lib/utils";
import type { MarketProfile, MarketSignal, SourceType } from "@/lib/types";

const PAIN_TERMS = [
  "annoying",
  "broken",
  "can't",
  "complaint",
  "confusing",
  "difficult",
  "expensive",
  "frustrating",
  "hard",
  "hate",
  "issue",
  "limitation",
  "manual",
  "missing",
  "pain",
  "problem",
  "slow",
  "switch",
  "workaround",
  "worse",
];

const REQUEST_TERMS = ["feature request", "wish", "need", "would like", "should add", "missing feature", "support for"];
const COMPARISON_TERMS = ["alternative", "competitor", "versus", " vs ", "switching from", "migrated from", "compared to"];

const SOURCE_WEIGHTS: Record<SourceType, number> = {
  reddit_comment: 42,
  reddit_post: 38,
  review: 28,
  forum: 25,
  social: 22,
  x_comment: 40,
  x_post: 36,
  linkedin_post: 34,
  youtube_comment: 36,
  youtube_video: 23,
  article: 10,
  serp: 7,
  website: 2,
  demo: 2,
};

export function extractEvidenceCards(signals: MarketSignal[], market: MarketProfile, options: { limit?: number; diversify?: boolean; socialFirst?: boolean } = {}) {
  const limit = options.limit || 60;
  const seen = new Set<string>();
  const rankedSignals = signals
    .map((signal, index) => {
      const score = evidenceScore(signal, market, index);
      const quote = strongestQuote(signal);
      const labels = evidenceLabels(signal);
      const fullText = preserveFullText(signal);
      return {
        ...signal,
        title: truncate(signal.title, 160),
        fullText,
        sourceContext: signal.sourceContext || sourceMetricText(signal),
        displayQuote: quote,
        snippet: buildEvidenceSnippet(signal, quote, labels),
        confidence: Math.max(signal.confidence, Math.min(96, Math.round(score))),
        position: index + 1,
        evidenceScore: score,
      };
    })
    .sort((a, b) => b.evidenceScore - a.evidenceScore)
    .filter((signal) => {
      const key = normalizedEvidenceKey(signal);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  return selectEvidenceByDiversity(rankedSignals, limit, Boolean(options.diversify || options.socialFirst), Boolean(options.socialFirst))
    .map(({ evidenceScore: _evidenceScore, ...signal }) => signal);
}

function selectEvidenceByDiversity<T extends MarketSignal & { evidenceScore: number }>(signals: T[], limit: number, diversify: boolean, socialFirst: boolean) {
  if (!diversify) {
    return signals.slice(0, limit);
  }

  const familyCaps = socialFirst
    ? {
        reddit: Math.ceil(limit * 0.36),
        linkedin: Math.ceil(limit * 0.24),
        x: Math.ceil(limit * 0.24),
        youtube: Math.ceil(limit * 0.12),
        web: Math.ceil(limit * 0.08),
        other: Math.ceil(limit * 0.08),
      }
    : {
        reddit: Math.ceil(limit * 0.28),
        linkedin: Math.ceil(limit * 0.2),
        x: Math.ceil(limit * 0.18),
        youtube: Math.ceil(limit * 0.16),
        web: Math.ceil(limit * 0.35),
        other: Math.ceil(limit * 0.12),
      };
  const counts: Record<keyof typeof familyCaps, number> = {
    reddit: 0,
    linkedin: 0,
    x: 0,
    youtube: 0,
    web: 0,
    other: 0,
  };
  const selected: T[] = [];
  const deferred: T[] = [];

  for (const signal of signals) {
    const family = sourceFamily(signal);
    if (counts[family] < familyCaps[family] && selected.length < limit) {
      selected.push(signal);
      counts[family] += 1;
    } else {
      deferred.push(signal);
    }
  }

  for (const signal of deferred) {
    if (selected.length >= limit) {
      break;
    }
    selected.push(signal);
  }

  return selected;
}

function sourceFamily(signal: MarketSignal): "reddit" | "linkedin" | "x" | "youtube" | "web" | "other" {
  if (signal.sourceType.startsWith("reddit") || signal.url.includes("reddit.com")) return "reddit";
  if (signal.sourceType === "linkedin_post" || signal.url.includes("linkedin.com")) return "linkedin";
  if (signal.sourceType.startsWith("x_") || /(?:^|\/\/)(?:x|twitter)\.com/i.test(signal.url)) return "x";
  if (signal.sourceType.startsWith("youtube") || /youtube\.com|youtu\.be/i.test(signal.url)) return "youtube";
  if (signal.sourceType === "serp" || signal.sourceType === "article" || signal.sourceType === "website") return "web";
  return "other";
}

function evidenceScore(signal: MarketSignal, market: MarketProfile, index: number) {
  const text = evidenceText(signal).toLowerCase();
  const sourceWeight = SOURCE_WEIGHTS[signal.sourceType] || 8;
  const painScore = countMatches(text, PAIN_TERMS) * 4;
  const requestScore = countMatches(text, REQUEST_TERMS) * 5;
  const comparisonScore = countMatches(text, COMPARISON_TERMS) * 4;
  const marketScore = marketTerms(market).filter((term) => text.includes(term)).length * 3;
  const quoteScore = strongestQuote(signal).length > 40 ? 8 : 0;
  const freshnessProxy = Math.max(0, 8 - Math.floor(index / 8));
  const publicDiscussionScore = isPublicDiscussion(signal) ? 10 : 0;

  return sourceWeight + painScore + requestScore + comparisonScore + marketScore + quoteScore + freshnessProxy + publicDiscussionScore;
}

function evidenceLabels(signal: MarketSignal) {
  const text = evidenceText(signal).toLowerCase();
  const labels: string[] = [];
  if (hasAny(text, PAIN_TERMS)) labels.push("pain signal");
  if (hasAny(text, REQUEST_TERMS)) labels.push("feature request");
  if (hasAny(text, COMPARISON_TERMS)) labels.push("competitive mention");
  if (
    signal.sourceType.startsWith("reddit") ||
    signal.sourceType.startsWith("x_") ||
    signal.sourceType.startsWith("linkedin") ||
    signal.sourceType.startsWith("youtube")
  ) {
    labels.push("public discussion");
  }
  return labels.slice(0, 3);
}

function strongestQuote(signal: MarketSignal) {
  const cleaned = evidenceText(signal)
    .replace(/\s+/g, " ")
    .replace(/\b(Read more|View full|Continue reading)\b/gi, "")
    .trim();
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 260);
  return sentences.find((sentence) => hasAny(sentence.toLowerCase(), [...PAIN_TERMS, ...REQUEST_TERMS, ...COMPARISON_TERMS])) || sentences[0] || truncate(cleaned, 220);
}

function buildEvidenceSnippet(signal: MarketSignal, quote: string, labels: string[]) {
  const labelText = labels.length ? `Signals: ${labels.join(", ")}. ` : "";
  const metricText = sourceMetricText(signal);
  return truncate(`${labelText}Quote: "${quote}"${metricText ? ` ${metricText}` : ""}`, 900);
}

function evidenceText(signal: MarketSignal) {
  return `${signal.title}. ${signal.fullText || signal.snippet} ${signal.sourceContext || ""}`;
}

function preserveFullText(signal: MarketSignal) {
  const sourceText = signal.fullText || signal.snippet;
  const limit = socialAnalysisTextLimit(signal.sourceType);
  return truncate(sourceText, limit);
}

function socialAnalysisTextLimit(sourceType: SourceType) {
  if (sourceType === "reddit_post" || sourceType === "reddit_comment") return 4000;
  if (sourceType === "linkedin_post") return 3500;
  if (sourceType.startsWith("x_")) return 2600;
  if (sourceType === "youtube_comment") return 2400;
  if (sourceType === "youtube_video") return 3000;
  if (sourceType === "forum" || sourceType === "review" || sourceType === "social") return 2600;
  return 1200;
}

function sourceMetricText(signal: MarketSignal) {
  const parts = [`Source: ${hostFromUrl(signal.url)}`];
  if (signal.query) {
    parts.push(`Query: ${signal.query}`);
  }
  return parts.join(". ");
}

function isPublicDiscussion(signal: MarketSignal) {
  return (
    signal.sourceType.startsWith("reddit") ||
    signal.sourceType.startsWith("x_") ||
    signal.sourceType === "linkedin_post" ||
    signal.sourceType.startsWith("youtube") ||
    /reddit\.com|x\.com|twitter\.com|linkedin\.com|youtube\.com|youtu\.be/i.test(signal.url)
  );
}

function marketTerms(market: MarketProfile) {
  return [
    market.productName,
    market.category,
    ...market.targetUsers,
    ...market.jobsToBeDone,
  ]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 4)
    .slice(0, 40);
}

function countMatches(text: string, terms: string[]) {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function normalizedEvidenceKey(signal: MarketSignal) {
  try {
    const parsed = new URL(signal.url);
    parsed.hash = "";
    for (const param of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      parsed.searchParams.delete(param);
    }
    return parsed.toString();
  } catch {
    return signal.sourceId;
  }
}
