export type SourceType =
  | "serp"
  | "website"
  | "forum"
  | "review"
  | "social"
  | "reddit_post"
  | "reddit_comment"
  | "x_post"
  | "x_comment"
  | "linkedin_post"
  | "youtube_video"
  | "youtube_comment"
  | "article"
  | "demo";

export const TIME_WINDOW_OPTIONS = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "6m", label: "Last 6 months" },
  { value: "1y", label: "Last year" },
] as const;

export type TimeWindow = (typeof TIME_WINDOW_OPTIONS)[number]["value"];

export const SUPPORTED_SOURCE_OPTIONS = [
  { value: "web", label: "Web" },
  { value: "reddit", label: "Reddit" },
  { value: "x", label: "X" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "youtube", label: "YouTube" },
] as const;

export type SupportedSource = (typeof SUPPORTED_SOURCE_OPTIONS)[number]["value"];

export const SEARCH_DEPTH_OPTIONS = [
  { value: "fast", label: "Fast search" },
  { value: "deep", label: "Deep search" },
] as const;

export type SearchDepth = (typeof SEARCH_DEPTH_OPTIONS)[number]["value"];

export type Evidence = {
  sourceId: string;
  title: string;
  url: string;
  snippet: string;
  sourceType: SourceType;
  query?: string;
  publishedAt?: string;
  confidence: number;
};

export type MarketSignal = Evidence & {
  domain: string;
  position?: number;
};

export type AnalysisMode = "company" | "category";

export type MarketProfile = {
  productName: string;
  category: string;
  marketDescription: string;
  targetUsers: string[];
  jobsToBeDone: string[];
  searchQueries: string[];
  negativeKeywords: string[];
};

export type PainPoint = {
  title: string;
  affectedPersona: string;
  summary: string;
  severity: number;
  frequency: number;
  confidence: number;
  evidenceIds: string[];
  quoteProofs: Array<{
    quote: string;
    sourceId: string;
  }>;
  businessImplication: string;
  validationStep: string;
};

export type FeatureRequest = {
  request: string;
  rationale: string;
  evidenceIds: string[];
};

export type Workaround = {
  workaround: string;
  tradeoff: string;
  evidenceIds: string[];
};

export type CompetitorMention = {
  name: string;
  context: string;
  sentiment: "positive" | "negative" | "mixed" | "neutral";
  evidenceIds: string[];
};

export type ProductOpportunity = {
  title: string;
  whyItMatters: string;
  suggestedExperiment: string;
  confidence: number;
  evidenceIds: string[];
};

export type WorkingTheme = {
  title: string;
  evidenceIds: string[];
};

export type PainRadarReport = {
  analyzedUrl: string;
  generatedAt: string;
  analysisMode: AnalysisMode;
  timeWindow: TimeWindow;
  searchDepth: SearchDepth;
  mode: "live" | "demo";
  market: MarketProfile;
  executiveSummary: string;
  whatsWorking: WorkingTheme[];
  topPainPoints: PainPoint[];
  commonFrustrations: string[];
  featureRequests: FeatureRequest[];
  workarounds: Workaround[];
  competitors: CompetitorMention[];
  opportunities: ProductOpportunity[];
  whatNotToTrustYet: string[];
  recommendedNextSteps: string[];
  sources: Evidence[];
  integrationNotes: {
    websiteRetrieval: string;
    marketDiscovery: string;
    synthesis: string;
  };
};

export type LiveQuotePreview = {
  quote: string;
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceType: SourceType;
};

export type AnalyzeResponse =
  | {
      ok: true;
      report: PainRadarReport;
    }
  | {
      ok: false;
      error: string;
    };

export type AnalyzeProgressStage = "website" | "market" | "queries" | "brightdata" | "evidence" | "synthesis";

export type AnalyzeJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type AnalyzeJobSnapshot = {
  id: string;
  status: AnalyzeJobStatus;
  stage: AnalyzeProgressStage;
  analysisMode: AnalysisMode;
  timeWindow: TimeWindow;
  searchDepth: SearchDepth;
  supportedSources: SupportedSource[];
  target: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  previewQuotes?: LiveQuotePreview[];
  report?: PainRadarReport;
};

export type AnalyzeJobResponse =
  | {
      ok: true;
      job: AnalyzeJobSnapshot;
    }
  | {
      ok: false;
      error: string;
    };

export type AnalyzeStreamEvent =
  | {
      type: "progress";
      stage: AnalyzeProgressStage;
    }
  | {
      type: "preview_quotes";
      quotes: LiveQuotePreview[];
    }
  | {
      type: "complete";
      report: PainRadarReport;
    }
  | {
      type: "error";
      error: string;
    };
