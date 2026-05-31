# Grounded Report Acceptance Criteria

Social Insight reports must prioritize public customer and market commentary over company-authored content. These criteria define when report content is acceptable for pain points, opportunities, feature requests, competitors, positive sentiment, and failure states.

## Evidence Collection

- Fast search should collect broad social evidence across Reddit, X, LinkedIn, YouTube, and web results when those sources are selected and available.
- Deep search should materially expand source discovery and parse budgets across Reddit, X, LinkedIn, and YouTube; it should not only add more company website pages.
- Company-owned websites, official docs, investor pages, press releases, and sales pages are context sources. They should not be the primary support for pains or opportunities unless public commentary is unavailable and the report lowers confidence.
- Every run must use a fresh nonce/cache-busting path for provider requests so repeated reports are not reused accidentally across targets.

## Pain Points

- Return every materially distinct recurring pain point that is supported by evidence. Do not enforce an arbitrary cap of 5 or 10 pain points.
- Each pain point must include at least one valid `evidenceId`; high-confidence pain points should cite multiple independent sources.
- Each pain point must include quote proofs using words present in the cited source title or snippet.
- Pain points should be specific to the target company/product or explicitly marked as broader category-level hypotheses.
- Generic canned pain titles are not acceptable in live reports, including:
  - "Proof of value is hard to evaluate from public information"
  - "Value claims are hard to verify"
  - "Adoption friction concentrates around workflow change"
  - "Buyers need clearer comparison points"
- Two unrelated targets should not produce the same top pain point unless the cited evidence independently supports the same category pain for both targets.

## Opportunities And Requests

- Each opportunity, feature request, workaround, and competitor claim must cite valid evidence IDs.
- Opportunities must be derived from observed complaints, workarounds, objections, praise gaps, or competitor comparisons, not generic product advice.
- Positive sentiment can include more source volume than the top pain list because the sentiment trend should represent broader public discourse, not only selected pain points.

## Failure States

- If OpenAI synthesis fails because API credits, quota, billing, rate limits, authentication, or API key configuration need attention, the app must show a clear failure message.
- Configured OpenAI credentials plus failed OpenAI synthesis must not produce a deterministic demo report.
- Deterministic demo reports are acceptable only when OpenAI credentials are not configured or when explicitly returning a deadline fallback; they must be labeled as demo/fallback output.

## UI

- The pain point panel should render all returned pain points.
- Source summaries should make social source volume visible so the user can see whether the report is grounded in Reddit, X, LinkedIn, YouTube, or mostly non-social web sources.
- Dig deeper should keep the original report visible while the enrichment pass runs and should highlight materially new or updated findings.
