import type { EvidenceCluster } from "@/lib/insight-quality";
import type { AnalysisMode, MarketProfile, PainRadarReport, MarketSignal, SearchDepth } from "@/lib/types";
import { truncate } from "@/lib/utils";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
type ReportSynthesis = Omit<PainRadarReport, "analyzedUrl" | "generatedAt" | "analysisMode" | "timeWindow" | "searchDepth" | "mode" | "market" | "sources" | "integrationNotes">;

const reportSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "executiveSummary",
    "whatsWorking",
    "topPainPoints",
    "commonFrustrations",
    "featureRequests",
    "workarounds",
    "competitors",
    "opportunities",
    "whatNotToTrustYet",
    "recommendedNextSteps",
  ],
  properties: {
    executiveSummary: { type: "string" },
    whatsWorking: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "evidenceIds"],
        properties: {
          title: { type: "string", description: "Short positive theme, written as a concise bullet." },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    topPainPoints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "affectedPersona",
          "summary",
          "severity",
          "frequency",
          "confidence",
          "evidenceIds",
          "quoteProofs",
          "businessImplication",
          "validationStep",
        ],
        properties: {
          title: { type: "string" },
          affectedPersona: { type: "string" },
          summary: { type: "string" },
          severity: { type: "number", description: "0-100 impact score. 80+ means the pain blocks adoption, causes churn, creates major time loss, or creates business/customer risk." },
          frequency: { type: "number", description: "0-100 recurrence score. 80+ means the same pain appears across many independent sources or communities." },
          confidence: { type: "number", description: "0-100 evidence confidence score. 80+ requires direct, consistent evidence from multiple independent sources." },
          evidenceIds: { type: "array", items: { type: "string" } },
          quoteProofs: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["quote", "sourceId"],
              properties: {
                quote: { type: "string" },
                sourceId: { type: "string" },
              },
            },
          },
          businessImplication: { type: "string" },
          validationStep: { type: "string" },
        },
      },
    },
    commonFrustrations: { type: "array", items: { type: "string" } },
    featureRequests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["request", "rationale", "evidenceIds"],
        properties: {
          request: { type: "string" },
          rationale: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    workarounds: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["workaround", "tradeoff", "evidenceIds"],
        properties: {
          workaround: { type: "string" },
          tradeoff: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    competitors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "context", "sentiment", "evidenceIds"],
        properties: {
          name: { type: "string" },
          context: { type: "string" },
          sentiment: { type: "string", enum: ["positive", "negative", "mixed", "neutral"] },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    opportunities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "whyItMatters", "suggestedExperiment", "confidence", "evidenceIds"],
        properties: {
          title: { type: "string" },
          whyItMatters: { type: "string" },
          suggestedExperiment: { type: "string" },
          confidence: { type: "number", description: "0-100 evidence confidence score. 80+ requires direct, consistent evidence from multiple independent sources." },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    whatNotToTrustYet: { type: "array", items: { type: "string" } },
    recommendedNextSteps: { type: "array", items: { type: "string" } },
  },
};

export function hasOpenAiCredentials() {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function structuredResponse<T>(name: string, schema: Record<string, unknown>, prompt: string): Promise<T> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || (process.env.VERCEL ? 18000 : 45000));
  const response = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.2",
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name,
          strict: true,
          schema,
        },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${truncate(message, 320)}`);
  }

  const payload = (await response.json()) as { output_text?: string; output?: unknown };
  const text = payload.output_text || extractOutputText(payload.output);
  if (!text) {
    throw new Error("OpenAI returned no text output");
  }
  return JSON.parse(text) as T;
}

function extractOutputText(output: unknown) {
  const items = Array.isArray(output) ? output : [];
  for (const item of items as Array<Record<string, unknown>>) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content as Array<Record<string, unknown>>) {
      if (typeof part.text === "string") {
        return part.text;
      }
    }
  }
  return "";
}

export async function synthesizeReport(input: {
  url: string;
  market: MarketProfile;
  signals: MarketSignal[];
  evidenceClusters?: EvidenceCluster[];
  mode: "live" | "demo";
  analysisMode?: AnalysisMode;
  searchDepth?: SearchDepth;
}): Promise<ReportSynthesis> {
  if (!hasOpenAiCredentials()) {
    return demoSynthesis(input.market, input.signals, input.analysisMode);
  }

  const signalLimit = input.searchDepth === "deep" ? 100 : 40;
  const report = await structuredResponse<ReportSynthesis>(
    "painfinder_report",
    reportSchema,
    `You are PainFinder, a rigorous product intelligence analyst.

Goal: identify recurring customer pain points, positive themes, frustrations, feature requests, workarounds, competitor mentions, and product opportunities from public web signals.

Rules:
- Distinguish evidence from inference.
- The target may be any company, product, service, nonprofit, healthcare provider, device, marketplace, app, or domain. Do not assume any specific category, business model, buyer, or use case unless the provided website text or public signals directly support it.
- If the market profile category conflicts with the public signals, correct course silently in the report content. Never write "not [category]" or "rather than [category]" in the executive summary; summarize only the supported category and put category uncertainty in whatNotToTrustYet.
- Prefer specific customer, buyer, patient, operator, or end-user pains over generic "better UX" claims.
- Rank pain points by severity, frequency, and confidence.
- Use a 0-100 scoring scale, never 0-10.
- Severity: 80-100 means the issue blocks adoption, causes churn, wastes major time, creates revenue/customer risk, or forces ugly workarounds; 60-79 means materially costly but workable; 40-59 means noticeable friction; below 40 means weak inconvenience.
- Frequency: 80-100 means repeated across many independent sources, threads, comments, reviews, or communities; 60-79 means several independent sources; 40-59 means more than once but limited spread; below 40 means isolated evidence.
- Confidence: 80-100 requires direct quotes, multiple independent sources, recent evidence, and consistent wording; 60-79 means solid but incomplete evidence; 40-59 means plausible but snippet-limited; below 40 means mostly inference.
- Every pain point, request, workaround, competitor, and opportunity must cite one or more evidenceIds from the provided sources.
- whatsWorking should contain 3-5 short positive themes only when similar praise, outcomes, recommendations, or value signals repeat across at least 2 evidenceIds. Omit one-off praise. If there is not enough overlapping positive evidence, return an empty array.
- Every pain point must include 1-3 quoteProofs: short direct phrases or sentences extracted from the source title/snippet text, paired with the sourceId. Use only words present in the provided source signal; do not invent quotes.
- If evidence is weak or demo-like, say so in whatNotToTrustYet.
- Do not invent source IDs.
- If analysis mode is "category", search the evidence for competing products and vendors in the category. In competitors, include identified competitors with sentiment derived from the cited source evidence: positive means users praise or prefer it, negative means users complain or switch away, mixed means both positive and negative signals appear, neutral means it is only mentioned or compared without clear sentiment.
- Use the evidence clusters as the primary guide for recurring themes. Prefer pain points supported by clusters with multiple sources, customer-voice evidence, and representative quotes.
- Separate validated target-specific pains from broader category-level hypotheses. If a pain is category-level rather than target-specific, say so clearly and lower confidence.

Analysis mode: ${input.analysisMode || "company"}
Search depth: ${input.searchDepth || "fast"}
Target: ${input.url}
Market profile:
${JSON.stringify(input.market, null, 2)}

Evidence clusters:
${JSON.stringify(input.evidenceClusters || [], null, 2)}

Public signals:
${JSON.stringify(input.signals.slice(0, signalLimit), null, 2)}

Produce concise but decision-ready JSON.`,
  );
  return normalizeReportScores(report);
}

export function demoSynthesis(
  market: MarketProfile,
  signals: MarketSignal[],
  analysisMode: AnalysisMode = "company",
): ReportSynthesis {
  const ids = signals.map((signal) => signal.sourceId);
  const users = market.targetUsers.length ? market.targetUsers : ["Customers", "Users", "Buyers"];
  const primaryUsers = users.slice(0, 2).join(" and ");
  const competitors = analysisMode === "category" ? demoCategoryCompetitors(market.category, ids) : demoCompanyCompetitors(ids);
  return {
    executiveSummary: `${market.productName} is best evaluated as ${market.category.toLowerCase()}. The strongest directional opportunities are clarifying proof of value, reducing adoption friction, and making the product easier for ${primaryUsers.toLowerCase()} to trust, compare, and operationalize.`,
    whatsWorking: [
      {
        title: "Customers see value when outcomes are concrete and easy to verify",
        evidenceIds: ids.slice(0, 2),
      },
      {
        title: "Clear comparisons help buyers understand where the product fits",
        evidenceIds: ids.slice(1, 3),
      },
      {
        title: "Trust signals and support paths can make adoption feel lower risk",
        evidenceIds: ids.slice(2, 4),
      },
    ].filter((item) => item.evidenceIds.length >= 2),
    topPainPoints: [
      {
        title: "Proof of value is hard to evaluate from public information",
        affectedPersona: users[0] || "Prospective customers",
        summary:
          "Prospective customers need clear evidence that the product delivers its promised outcome, but public snippets often leave important adoption, outcome, or risk questions unanswered.",
        severity: 78,
        frequency: 68,
        confidence: 48,
        evidenceIds: ids.slice(0, 3),
        quoteProofs: quoteProofsFromSignals(signals, ids.slice(0, 3)),
        businessImplication:
          "Clearer proof, case studies, validation data, and transparent limitations can reduce buyer hesitation.",
        validationStep:
          "Interview target buyers about what evidence they would need before shortlisting or recommending this product.",
      },
      {
        title: "Adoption effort and implementation risk are unclear",
        affectedPersona: users[1] || "Implementation owners",
        summary:
          "Users and buyers often want to understand onboarding steps, operational changes, integrations, training needs, and failure modes before committing.",
        severity: 74,
        frequency: 64,
        confidence: 44,
        evidenceIds: ids.slice(1, 4),
        quoteProofs: quoteProofsFromSignals(signals, ids.slice(1, 4)),
        businessImplication:
          "Reducing perceived implementation risk can improve conversion and shorten evaluation cycles.",
        validationStep:
          "Ask recent evaluators which adoption questions slowed or blocked their decision.",
      },
      {
        title: "Alternatives and status quo may feel safer",
        affectedPersona: users[2] || "Economic buyers",
        summary:
          "When public evidence is thin, customers compare the product against familiar alternatives, manual processes, incumbent vendors, or doing nothing.",
        severity: 70,
        frequency: 61,
        confidence: 43,
        evidenceIds: ids.slice(2, 4),
        quoteProofs: quoteProofsFromSignals(signals, ids.slice(2, 4)),
        businessImplication:
          "Positioning should make the switching trigger, cost of inaction, and differentiated value concrete.",
        validationStep:
          "Map the top alternatives customers mention and test which comparison points change their preference.",
      },
      {
        title: "Support, reliability, and trust concerns can outweigh feature value",
        affectedPersona: users[0] || "End users",
        summary:
          "Customers frequently treat support quality, reliability, transparency, and trust signals as part of the product experience, especially in high-stakes categories.",
        severity: 72,
        frequency: 58,
        confidence: 42,
        evidenceIds: ids.slice(4, 7),
        quoteProofs: quoteProofsFromSignals(signals, ids.slice(4, 7)),
        businessImplication:
          "Investing in trust-building content, responsive support paths, and reliability proof can protect adoption.",
        validationStep:
          "Review lost opportunities or skeptical comments for trust, support, compliance, or reliability objections.",
      },
      {
        title: "Public feedback is fragmented across channels",
        affectedPersona: "Product and go-to-market teams",
        summary:
          "Useful market signals may be split across reviews, forums, social posts, support conversations, regulatory documents, and competitor pages.",
        severity: 66,
        frequency: 55,
        confidence: 40,
        evidenceIds: ids.slice(5, 8),
        quoteProofs: quoteProofsFromSignals(signals, ids.slice(5, 8)),
        businessImplication:
          "A repeatable evidence-gathering process can reveal clearer positioning and product opportunities.",
        validationStep:
          "Collect a broader source set and tag each signal by persona, objection, alternative, and buying trigger.",
      },
    ],
    commonFrustrations: [
      "Value claims are hard to verify from limited public evidence",
      "Adoption effort, switching cost, or operational fit may be unclear",
      "Customers compare against familiar alternatives and status quo",
      "Support, reliability, trust, or proof concerns can slow decisions",
    ],
    featureRequests: [
      {
        request: "Clearer evidence of outcomes, limitations, and best-fit customers",
        rationale: "Would help buyers understand when the product is credible and worth evaluating.",
        evidenceIds: ids.slice(0, 2),
      },
      {
        request: "More transparent implementation, support, and comparison guidance",
        rationale: "Customers need to understand adoption effort and tradeoffs versus alternatives.",
        evidenceIds: ids.slice(1, 3),
      },
    ],
    workarounds: [
      {
        workaround: "Manual research across reviews, forums, search results, and competitor pages",
        tradeoff: "Can uncover objections, but it is slow, incomplete, and easy to bias toward loud voices.",
        evidenceIds: ids.slice(2, 4),
      },
      {
        workaround: "Relying on sales calls or demos to answer trust and fit questions",
        tradeoff: "Helpful for engaged prospects, but weaker for self-serve evaluation and early discovery.",
        evidenceIds: ids.slice(0, 4),
      },
    ],
    competitors,
    opportunities: [
      {
        title: "Evidence-backed positioning brief",
        whyItMatters:
          "Buyers need a fast way to understand the product's credible category, strongest use cases, and practical limits.",
        suggestedExperiment:
          "Create a short page or sales asset that links claims to evidence, customer examples, limitations, and comparison points.",
        confidence: 52,
        evidenceIds: ids.slice(0, 4),
      },
      {
        title: "Adoption-risk checklist",
        whyItMatters:
          "Implementation uncertainty can block otherwise interested buyers.",
        suggestedExperiment:
          "Test an onboarding checklist that answers setup effort, data requirements, integrations, training, support, and success criteria.",
        confidence: 47,
        evidenceIds: ids.slice(0, 3),
      },
    ],
    whatNotToTrustYet: [
      "Demo mode uses representative seed signals, not live Bright Data results.",
      "Public conversations overrepresent vocal and technical users.",
      "Frequency scores should be treated as directional until more sources are collected.",
    ],
    recommendedNextSteps: [
      "Run with Bright Data credentials to gather live SERP evidence.",
      "Validate the top three pains in five customer interviews.",
      "Compare opportunity language against landing page tests for each persona.",
    ],
  };
}

function demoCompanyCompetitors(ids: string[]) {
  return [
    {
      name: "Status quo",
      context: "Customers may keep existing tools, vendors, or manual processes if differentiation is not obvious.",
      sentiment: "neutral" as const,
      evidenceIds: ids.slice(1, 3),
    },
    {
      name: "Better-known alternatives",
      context: "Public comparisons often favor products with stronger brand awareness, clearer proof, or lower perceived risk.",
      sentiment: "neutral" as const,
      evidenceIds: ids.slice(2, 3),
    },
    {
      name: "Manual workarounds",
      context: "Users may combine spreadsheets, documents, search, peer references, or internal review steps instead of adopting a new solution.",
      sentiment: "mixed" as const,
      evidenceIds: ids.slice(3, 4),
    },
  ];
}

function demoCategoryCompetitors(category: string, ids: string[]) {
  const names = competitorNamesForCategory(category);
  return names.map((name, index) => ({
    name,
    context: "Demo-mode category analysis treats this as a representative competitor to compare for sentiment, switching triggers, and unmet needs.",
    sentiment: (index === 0 ? "mixed" : index === 1 ? "neutral" : "positive") as "mixed" | "neutral" | "positive",
    evidenceIds: ids.slice(index, index + 2),
  }));
}

function competitorNamesForCategory(category: string) {
  const lower = category.toLowerCase();
  if (lower.includes("sales") || lower.includes("crm")) return ["Salesforce", "HubSpot", "Pipedrive"];
  if (lower.includes("support")) return ["Zendesk", "Intercom", "Freshdesk"];
  if (lower.includes("developer") || lower.includes("api")) return ["GitHub", "Postman", "Vercel"];
  if (lower.includes("commerce")) return ["Shopify", "WooCommerce", "BigCommerce"];
  if (lower.includes("healthcare") || lower.includes("medical")) return ["Cleerly", "GE HealthCare", "Aidoc"];
  return ["Category incumbent", "Low-cost alternative", "Specialized competitor"];
}

function normalizeReportScores(report: ReportSynthesis): ReportSynthesis {
  const painScores = report.topPainPoints.flatMap((pain) => [pain.severity, pain.frequency, pain.confidence]);
  const opportunityScores = report.opportunities.map((opportunity) => opportunity.confidence);
  const scores = [...painScores, ...opportunityScores].filter((score) => Number.isFinite(score));
  const reportLooksTenPoint = scores.length > 0 && scores.every((score) => score >= 0 && score <= 10);

  return {
    ...report,
    topPainPoints: report.topPainPoints.map((pain) => {
      const painLooksTenPoint = [pain.severity, pain.frequency, pain.confidence].every((score) => Number.isFinite(score) && score >= 0 && score <= 10);
      const multiplier = reportLooksTenPoint || painLooksTenPoint ? 10 : 1;
      return {
        ...pain,
        severity: normalizeScore(pain.severity, multiplier),
        frequency: normalizeScore(pain.frequency, multiplier),
        confidence: normalizeScore(pain.confidence, multiplier),
      };
    }),
    opportunities: report.opportunities.map((opportunity) => ({
      ...opportunity,
      confidence: normalizeScore(opportunity.confidence, reportLooksTenPoint || (opportunity.confidence >= 0 && opportunity.confidence <= 10) ? 10 : 1),
    })),
  };
}

function normalizeScore(value: number, multiplier: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value * multiplier)));
}

function quoteProofsFromSignals(signals: MarketSignal[], ids: string[]) {
  return ids
    .map((id) => {
      const source = signals.find((signal) => signal.sourceId === id);
      if (!source) {
        return null;
      }
      return {
        sourceId: id,
        quote: bestQuoteFromText(`${source.title}. ${source.snippet}`),
      };
    })
    .filter(Boolean)
    .slice(0, 2) as Array<{ sourceId: string; quote: string }>;
}

function bestQuoteFromText(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const sentence = cleaned
    .split(/(?<=[.!?])\s+/)
    .find((part) => part.length >= 35 && part.length <= 220);
  return (sentence || cleaned).slice(0, 220);
}
