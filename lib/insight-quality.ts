import type { AnalysisMode, Evidence, MarketProfile, MarketSignal, PainRadarReport } from "@/lib/types";

export type EntityRelevanceContext = {
  targetLabel: string;
  productName: string;
  domain: string;
  domainToken: string;
  category: string;
  categoryTerms: string[];
  positiveTerms: string[];
  excludedTerms: string[];
  ambiguousTarget: boolean;
};

export type EvidenceCluster = {
  id: string;
  theme: string;
  signalCount: number;
  customerVoiceCount: number;
  avgConfidence: number;
  evidenceIds: string[];
  representativeQuotes: Array<{
    quote: string;
    sourceId: string;
  }>;
};

const BASE_EXCLUDED_TERMS = [
  "lyrics",
  "album",
  "song",
  "tour",
  "concert",
  "hip hop",
  "rapper",
  "mixtape",
  "discography",
  "spotify",
  "soundcloud",
  "bandcamp",
  "facebook login",
  "instagram reel",
  "tiktok",
  "coupon",
  "careers",
  "job opening",
  "press release distribution",
];

const CUSTOMER_VOICE_DOMAINS = [
  "reddit.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "youtube.com",
  "youtu.be",
  "g2.com",
  "trustpilot.com",
  "producthunt.com",
  "stackoverflow.com",
  "news.ycombinator.com",
];

const CLUSTER_THEMES = [
  {
    id: "trust-validation",
    theme: "Trust, validation, and proof of outcomes",
    terms: ["trust", "validation", "validated", "evidence", "accuracy", "proof", "clinical", "outcome", "study", "fda", "risk", "confidence"],
  },
  {
    id: "positive-value",
    theme: "Positive value, recommendations, and customer wins",
    terms: ["love", "recommend", "recommended", "helpful", "useful", "valuable", "excellent", "great", "best", "success", "saves", "saved", "improved", "works well"],
  },
  {
    id: "positive-ease-reliability",
    theme: "Ease of use, reliability, and smooth experience",
    terms: ["easy", "simple", "fast", "reliable", "smooth", "intuitive", "accurate", "efficient", "stable", "responsive"],
  },
  {
    id: "workflow-adoption",
    theme: "Implementation fit and adoption burden",
    terms: ["workflow", "implementation", "adoption", "training", "manual", "integration", "integrate", "onboarding", "process", "deployment"],
  },
  {
    id: "cost-reimbursement",
    theme: "Cost, pricing, and reimbursement friction",
    terms: ["price", "pricing", "expensive", "cost", "reimbursement", "billing", "budget", "roi", "value", "payment"],
  },
  {
    id: "missing-capability",
    theme: "Missing capability and feature gaps",
    terms: ["missing", "feature", "wish", "need", "limitation", "support", "request", "can't", "cannot", "doesn't"],
  },
  {
    id: "reliability-performance",
    theme: "Reliability, speed, and performance issues",
    terms: ["slow", "broken", "bug", "reliable", "unreliable", "latency", "crash", "error", "failed", "failure"],
  },
  {
    id: "switching-competition",
    theme: "Switching, alternatives, and competitor pressure",
    terms: ["alternative", "competitor", "versus", " vs ", "switch", "migrated", "replace", "comparison", "better than"],
  },
  {
    id: "usability-complexity",
    theme: "Usability and complexity complaints",
    terms: ["confusing", "difficult", "hard", "complex", "ux", "ui", "usability", "learn", "frustrating", "annoying"],
  },
];

export function buildEntityRelevanceContext(input: {
  targetLabel: string;
  websiteUrl: string | null;
  market: MarketProfile;
  websiteText: string;
  analysisMode: AnalysisMode;
}): EntityRelevanceContext {
  const domain = input.websiteUrl ? safeHostname(input.websiteUrl) : safeHostname(input.targetLabel);
  const domainToken = domain.split(".")[0] || "";
  const productName = input.market.productName || input.targetLabel;
  const categoryTerms = importantTerms(`${input.market.category} ${input.market.marketDescription} ${input.market.jobsToBeDone.join(" ")}`);
  const productTerms = importantTerms(`${productName} ${domainToken}`);
  const positiveTerms = Array.from(new Set([...productTerms, ...categoryTerms])).slice(0, 50);
  const excludedTerms = categoryExclusions(input.market.category, input.websiteText);

  return {
    targetLabel: input.targetLabel,
    productName,
    domain,
    domainToken,
    category: input.market.category,
    categoryTerms,
    positiveTerms,
    excludedTerms,
    ambiguousTarget: Boolean(domainToken && domainToken.length <= 7) || importantTerms(productName).length <= 1,
  };
}

export function expandMarketQueriesForEntity(market: MarketProfile, context: EntityRelevanceContext) {
  const product = market.productName;
  const category = market.category;
  const domain = context.domain;
  const domainToken = context.domainToken;
  return uniqueStrings([
    ...market.searchQueries,
    ...(domain ? [`"${domain}" customer complaints`, `"${domain}" positive reviews`, `"${domain}" testimonials`, `"${domain}" reviews problems`, `"${domain}" alternatives`] : []),
    ...(domainToken ? [`"${domainToken}" "${category}" complaints`, `"${domainToken}" "${category}" recommendations`, `"${domainToken}" "${category}" reviews`] : []),
    `"${product}" "${category}" complaints`,
    `"${product}" "${category}" customer feedback`,
    `"${product}" "${category}" positive reviews`,
    `"${product}" "${category}" recommended by users`,
    `"${product}" "${category}" customer success`,
    `"${product}" "${category}" implementation problems`,
    `"${product}" "${category}" pricing reimbursement`,
    `"${product}" "${category}" alternatives competitors`,
    `"${category}" customer pain points`,
    `"${category}" positive customer feedback`,
    `"${category}" recommended products`,
    `"${category}" user complaints`,
    `"${category}" implementation problems`,
  ]).slice(0, 42);
}

export function filterAndRankSignalsForRelevance(signals: MarketSignal[], context: EntityRelevanceContext, options: { allowFallback?: boolean } = {}) {
  const allowFallback = options.allowFallback !== false;
  const scored = signals
    .map((signal, index) => {
      const relevanceScore = scoreSignalRelevance(signal, context, index);
      return { signal, relevanceScore };
    })
    .filter(({ relevanceScore }) => relevanceScore >= relevanceThreshold(context))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .map(({ signal, relevanceScore }, index) => ({
      ...signal,
      confidence: Math.max(1, Math.min(96, Math.round(signal.confidence + relevanceScore / 8 - 5))),
      position: index + 1,
    }));

  if (context.ambiguousTarget && scored.length > 0) {
    return scored;
  }
  if (!allowFallback) {
    return scored;
  }
  return scored.length >= Math.min(12, signals.length) ? scored : signals.slice(0, Math.max(12, scored.length));
}

export function buildEvidenceClusters(sources: Evidence[]): EvidenceCluster[] {
  const clusters = CLUSTER_THEMES.map((theme) => {
    const matching = sources.filter((source) => {
      const text = normalizedText(`${source.title} ${source.snippet}`);
      return theme.terms.some((term) => text.includes(term));
    });
    return clusterFromEvidence(theme.id, theme.theme, matching);
  }).filter((cluster) => cluster.signalCount > 0);

  const assignedIds = new Set(clusters.flatMap((cluster) => cluster.evidenceIds));
  const other = sources.filter((source) => !assignedIds.has(source.sourceId)).slice(0, 24);
  if (other.length) {
    clusters.push(clusterFromEvidence("other-market-signals", "Other recurring market signals", other));
  }

  return clusters
    .sort((a, b) => b.customerVoiceCount - a.customerVoiceCount || b.signalCount - a.signalCount || b.avgConfidence - a.avgConfidence)
    .slice(0, 8);
}

export function auditReportAgainstEvidence<T extends Pick<PainRadarReport, "topPainPoints" | "opportunities" | "whatNotToTrustYet">>(
  report: T,
  sources: Evidence[],
  clusters: EvidenceCluster[],
): T {
  const sourceMap = new Map(sources.map((source) => [source.sourceId, source]));
  const clusterIds = new Set(clusters.flatMap((cluster) => cluster.evidenceIds));
  const caveats = new Set(report.whatNotToTrustYet);

  const auditedPainPoints = report.topPainPoints.map((pain) => {
    const citedSources = pain.evidenceIds.map((id) => sourceMap.get(id)).filter((source): source is Evidence => Boolean(source));
    const distinctDomains = new Set(citedSources.map((source) => safeHostname(source.url))).size;
    const customerVoiceCount = citedSources.filter(isCustomerVoiceEvidence).length;
    const clusterSupport = citedSources.some((source) => clusterIds.has(source.sourceId));
    let confidence = pain.confidence;
    let frequency = pain.frequency;

    if (citedSources.length < 2 || distinctDomains < 2) {
      confidence = Math.min(confidence, 58);
      frequency = Math.min(frequency, 52);
      caveats.add(`"${pain.title}" has limited independent-source support and should be treated as directional.`);
    }
    if (customerVoiceCount === 0) {
      confidence = Math.min(confidence, 48);
      caveats.add(`"${pain.title}" is not yet backed by direct customer-voice evidence.`);
    }
    if (!clusterSupport) {
      confidence = Math.min(confidence, 62);
    }

    return {
      ...pain,
      confidence,
      frequency,
    };
  });

  const auditedOpportunities = report.opportunities.map((opportunity) => {
    const citedSources = opportunity.evidenceIds.map((id) => sourceMap.get(id)).filter((source): source is Evidence => Boolean(source));
    const customerVoiceCount = citedSources.filter(isCustomerVoiceEvidence).length;
    return {
      ...opportunity,
      confidence: customerVoiceCount > 0 ? opportunity.confidence : Math.min(opportunity.confidence, 55),
    };
  });

  return {
    ...report,
    topPainPoints: auditedPainPoints,
    opportunities: auditedOpportunities,
    whatNotToTrustYet: Array.from(caveats).slice(0, 8),
  };
}

function scoreSignalRelevance(signal: MarketSignal, context: EntityRelevanceContext, index: number) {
  const text = normalizedText(`${signal.title} ${signal.snippet} ${signal.url} ${signal.query || ""}`);
  const urlHost = safeHostname(signal.url);
  const excludedHits = context.excludedTerms.filter((term) => text.includes(term)).length;
  const productHit = Boolean(context.domainToken && text.includes(context.domainToken)) || normalizedText(context.productName).split(" ").some((term) => term.length > 3 && text.includes(term));
  const domainHit = Boolean(context.domain && urlHost.includes(context.domain));
  const categoryHits = context.categoryTerms.filter((term) => text.includes(term)).length;
  if (excludedHits > 0 && !domainHit && categoryHits === 0) {
    return -100;
  }
  const positiveHits = context.positiveTerms.filter((term) => text.includes(term)).length;
  const customerVoice = isCustomerVoiceEvidence(signal);
  const companyAuthored = domainHit || urlHost.includes(context.domainToken);
  let score = 30;

  if (domainHit) score += 42;
  if (productHit) score += context.ambiguousTarget ? 14 : 22;
  score += Math.min(30, categoryHits * 9);
  score += Math.min(18, positiveHits * 3);
  if (customerVoice) score += 14;
  if (companyAuthored) score -= 6;
  if (context.ambiguousTarget && productHit && categoryHits === 0 && !domainHit) score -= 34;
  score -= excludedHits * 28;
  score -= Math.min(12, Math.floor(index / 20));

  return score;
}

function relevanceThreshold(context: EntityRelevanceContext) {
  return context.ambiguousTarget ? 34 : 28;
}

function categoryExclusions(category: string, websiteText: string) {
  const categoryText = normalizedText(`${category} ${websiteText}`);
  const exclusions = new Set(BASE_EXCLUDED_TERMS);
  if (/cardio|clinical|health|medical|patient|diagnostic|imaging|radiology/.test(categoryText)) {
    ["music", "vinyl", "rapper", "hip hop", "album", "lyrics", "concert"].forEach((term) => exclusions.add(term));
  }
  if (/developer|api|software|platform|analytics|health|medical/.test(categoryText)) {
    ["movie", "tv show", "game walkthrough", "fan art"].forEach((term) => exclusions.add(term));
  }
  return Array.from(exclusions);
}

function clusterFromEvidence(id: string, theme: string, evidence: Evidence[]): EvidenceCluster {
  const selected = evidence.slice(0, 24);
  const confidenceSum = selected.reduce((sum, source) => sum + source.confidence, 0);
  return {
    id,
    theme,
    signalCount: evidence.length,
    customerVoiceCount: evidence.filter(isCustomerVoiceEvidence).length,
    avgConfidence: selected.length ? Math.round(confidenceSum / selected.length) : 0,
    evidenceIds: selected.map((source) => source.sourceId),
    representativeQuotes: selected
      .map((source) => ({
        sourceId: source.sourceId,
        quote: quoteFromEvidence(source),
      }))
      .filter((quote) => quote.quote.length >= 35)
      .slice(0, 3),
  };
}

function quoteFromEvidence(source: Evidence) {
  const match = source.snippet.match(/Quote:\s*"([^"]+)"/i);
  if (match?.[1]) return match[1];
  return `${source.title}. ${source.snippet}`.replace(/\s+/g, " ").slice(0, 220);
}

function isCustomerVoiceEvidence(source: Pick<Evidence, "sourceType" | "url">) {
  return (
    source.sourceType.startsWith("reddit") ||
    source.sourceType.startsWith("x_") ||
    source.sourceType.startsWith("youtube") ||
    source.sourceType === "linkedin_post" ||
    CUSTOMER_VOICE_DOMAINS.some((domain) => source.url.includes(domain))
  );
}

function importantTerms(value: string) {
  return normalizedText(value)
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4 && !STOP_WORDS.has(term))
    .slice(0, 60);
}

function normalizedText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function safeHostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean)));
}

const STOP_WORDS = new Set([
  "about",
  "across",
  "after",
  "against",
  "alternatives",
  "analysis",
  "before",
  "business",
  "buyer",
  "buyers",
  "category",
  "company",
  "complaints",
  "customer",
  "customers",
  "feedback",
  "market",
  "platform",
  "product",
  "products",
  "reviews",
  "signals",
  "software",
  "their",
  "users",
  "using",
  "with",
  "workflow",
]);
