import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const bannedGenericPainTitles = [
  "Proof of value is hard to evaluate from public information",
  "Value claims are hard to verify",
  "Adoption friction concentrates around workflow change",
  "Buyers need clearer comparison points",
];

const customerVoiceTypes = new Set([
  "reddit_comment",
  "reddit_post",
  "x_comment",
  "x_post",
  "linkedin_post",
  "youtube_comment",
  "forum",
  "review",
  "social",
]);

function assertGroundedReport(report) {
  const sourceMap = new Map(report.sources.map((source) => [source.sourceId, source]));

  for (const pain of report.topPainPoints) {
    assert.ok(pain.title?.trim(), "pain point must have a title");
    assert.ok(!bannedGenericPainTitles.includes(pain.title), `banned generic pain title: ${pain.title}`);
    assert.ok(pain.evidenceIds.length > 0, `pain point "${pain.title}" must cite evidence`);
    assert.ok(pain.evidenceIds.every((id) => sourceMap.has(id)), `pain point "${pain.title}" cites unknown evidence`);
    assert.ok(pain.quoteProofs.length > 0, `pain point "${pain.title}" must include quote proofs`);

    const citedSources = pain.evidenceIds.map((id) => sourceMap.get(id)).filter(Boolean);
    assert.ok(
      citedSources.some((source) => customerVoiceTypes.has(source.sourceType)),
      `pain point "${pain.title}" must be backed by at least one customer/social source`,
    );

    for (const proof of pain.quoteProofs) {
      const source = sourceMap.get(proof.sourceId);
      assert.ok(source, `quote proof for "${pain.title}" cites unknown source`);
      const sourceText = `${source.title} ${source.snippet}`.toLowerCase();
      const proofWords = proof.quote.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
      assert.ok(
        proofWords.some((word) => sourceText.includes(word)),
        `quote proof for "${pain.title}" must use words present in source text`,
      );
    }
  }

  for (const collectionName of ["featureRequests", "workarounds", "competitors", "opportunities"]) {
    for (const item of report[collectionName]) {
      assert.ok(item.evidenceIds.length > 0, `${collectionName} item must cite evidence`);
      assert.ok(item.evidenceIds.every((id) => sourceMap.has(id)), `${collectionName} item cites unknown evidence`);
    }
  }
}

function assertSourceGuardrails() {
  const analysis = read("lib/analysis.ts");
  const openAiCatchIndex = analysis.indexOf("const note = openAiSynthesisFailureNote(error)");
  assert.notEqual(openAiCatchIndex, -1, "OpenAI synthesis errors must use the explicit failure note");
  const catchBlock = analysis.slice(openAiCatchIndex, analysis.indexOf("synthesized = validateEvidenceIds", openAiCatchIndex));
  assert.ok(catchBlock.includes("throw new Error(note)"), "live OpenAI synthesis failures must throw instead of returning demo content");
  assert.ok(!catchBlock.includes("providerFailureNote(\"OpenAI report synthesis\""), "OpenAI synthesis failures must not use generic fallback copy");

  const appPage = read("app/page.tsx");
  const painPanelIndex = appPage.indexOf("function PainPointPanel");
  const painPanel = appPage.slice(painPanelIndex, appPage.indexOf("function EvidenceSourceDisclosure", painPanelIndex));
  assert.ok(painPanel.includes("pains.map("), "PainPointPanel must render all pain points");
  assert.ok(!/pains\.slice\(\s*0\s*,/.test(painPanel), "PainPointPanel must not cap pain points");
  assert.ok(appPage.includes("/api/analyze/deepen"), "Dig deeper must call the deepen analysis route");
  assert.ok(appPage.includes("function DeepenProgressBar"), "Dig deeper must keep progress visible while the original report remains rendered");
  assert.ok(appPage.includes("/api/analyze/deepen-pain"), "Pain point Dig deeper must call the focused pain deepen route");
  assert.ok(appPage.includes("function PainPointProgressBar"), "Pain point Dig deeper must show progress inside the pain card");
  assert.ok(appPage.includes("deepenNote"), "Pain point Dig deeper must support a dismissible no-new-info note");

  const deepenRoute = read("app/api/analyze/deepen/route.ts");
  assert.ok(deepenRoute.includes("runDeepenAnalysisJob"), "Deepen route must run a deepen job");
  assert.ok(deepenRoute.includes("sources: sources.length ? sources"), "Deepen route must preserve selected source filters");

  const painDeepenRoute = read("app/api/analyze/deepen-pain/route.ts");
  assert.ok(painDeepenRoute.includes("runPainPointDeepenAnalysisJob"), "Focused pain deepen route must run a pain point deepen job");
  assert.ok(painDeepenRoute.includes("painIndex"), "Focused pain deepen route must target a specific pain point");

  const openai = read("lib/openai.ts");
  assert.ok(openai.includes("Return every materially distinct recurring pain point"), "OpenAI prompt must avoid fixed pain point caps");
}

const validReport = {
  sources: [
    {
      sourceId: "reddit-1",
      sourceType: "reddit_post",
      title: "HeartFlow reimbursement friction discussion",
      snippet: "Clinicians said reimbursement is hard and adoption stalls when economics are unclear.",
      url: "https://reddit.com/r/cardiology/comments/1",
    },
    {
      sourceId: "linkedin-1",
      sourceType: "linkedin_post",
      title: "Operators discuss workflow integration burden",
      snippet: "Teams praised CT analysis but said workflow integration takes coordination across radiology and cardiology.",
      url: "https://linkedin.com/posts/example",
    },
  ],
  topPainPoints: [
    {
      title: "Reimbursement uncertainty slows adoption",
      affectedPersona: "Cardiology administrators",
      summary: "Buyers need economic proof before expanding usage.",
      severity: 78,
      frequency: 70,
      confidence: 72,
      evidenceIds: ["reddit-1"],
      quoteProofs: [{ quote: "reimbursement is hard", sourceId: "reddit-1" }],
      businessImplication: "Sales cycles need stronger economic validation.",
      validationStep: "Interview administrators about payment blockers.",
    },
  ],
  featureRequests: [{ request: "ROI calculator", rationale: "Economic proof is missing.", evidenceIds: ["reddit-1"] }],
  workarounds: [{ workaround: "Manual workflow coordination", tradeoff: "Creates adoption overhead.", evidenceIds: ["linkedin-1"] }],
  competitors: [{ name: "Cleerly", context: "Compared in cardiac CT analysis discussions.", sentiment: "mixed", evidenceIds: ["reddit-1"] }],
  opportunities: [{ title: "Package reimbursement proof", whyItMatters: "Reduces adoption risk.", suggestedExperiment: "Test payer proof assets.", confidence: 72, evidenceIds: ["reddit-1"] }],
};

const genericReport = structuredClone(validReport);
genericReport.topPainPoints = [
  {
    ...validReport.topPainPoints[0],
    title: "Proof of value is hard to evaluate from public information",
  },
];

const ungroundedOpportunityReport = structuredClone(validReport);
ungroundedOpportunityReport.opportunities = [
  {
    title: "Improve onboarding",
    whyItMatters: "Generic advice.",
    suggestedExperiment: "Add a checklist.",
    confidence: 80,
    evidenceIds: [],
  },
];

assertSourceGuardrails();
assert.doesNotThrow(() => assertGroundedReport(validReport), "valid grounded report should pass");
assert.throws(() => assertGroundedReport(genericReport), /banned generic pain title/, "generic fallback pain titles should fail");
assert.throws(() => assertGroundedReport(ungroundedOpportunityReport), /opportunities item must cite evidence/, "ungrounded opportunities should fail");

console.log("Report quality guardrails passed.");
