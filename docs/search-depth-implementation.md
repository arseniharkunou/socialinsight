# Search Depth Implementation Plan

## Goal

Make discovery more thorough without forcing every run to become slow or expensive. The app should keep a fast default path, add an explicit deep-search path, broaden source discovery, preserve source diversity, and give synthesis enough evidence to produce better-supported reports.

## Phase 1: Search Depth Control And Plumbing

Implementation:
- Add a typed `SearchDepth` option with `Fast` and `Deep`.
- Add a `Search depth` selector beside query type, timeline, and source controls.
- Send depth through `/api/analyze`, analysis jobs, analysis execution, Bright Data collection, and report synthesis.
- Persist depth on job snapshots and final reports.

Acceptance criteria:
- New analyses default to `Fast`.
- User can select `Deep` before starting an analysis.
- API accepts only known depth values and falls back to `Fast`.
- Job snapshots and report JSON include the selected depth.
- Existing fast behavior remains available.

## Phase 2: Collection Budgets

Implementation:
- Centralize collection budgets by depth.
- Keep current-ish limits for `Fast`.
- Raise query, URL enrichment, parser, final source, and synthesis evidence limits for `Deep`.
- Update integration notes to identify selected depth and target source limits.

Acceptance criteria:
- Fast collection keeps a roughly 60-source final cap.
- Deep collection can retain roughly 180 sources before evidence ranking.
- Deep sends more than 40 evidence records to synthesis.
- Budget values live in one config structure, not scattered magic numbers.

## Phase 3: Broader Discovery

Implementation:
- Expand query generation at collection time with company, domain, category, pain, pricing, workflow, adoption, comparison, and competitor-intent variants.
- Increase source-specific SERP discovery for Reddit, X, LinkedIn, and YouTube in Deep mode.
- Increase Reddit native keyword discovery from one low-volume query to multiple keyword queries in Deep mode.
- Increase structured enrichment URL limits for Reddit, X, LinkedIn, and YouTube in Deep mode.

Acceptance criteria:
- Deep mode uses more base and source-specific discovery queries than Fast.
- Reddit keyword discovery uses multiple queries and a higher posts-per-query budget in Deep mode.
- Deep mode enriches more discovered social URLs than Fast mode.
- Collection still respects selected source checkboxes.

## Phase 4: Thin-Evidence Second Pass

Implementation:
- Detect thin evidence after first collection.
- In Deep mode, automatically run a broader fallback pass when source volume or customer-voice volume is low.
- Use broader category/customer-voice queries for the second pass.
- Merge and dedupe first-pass and second-pass results.

Acceptance criteria:
- Second pass only runs when evidence is thin and live search is available.
- Second-pass signals are merged without duplicating URLs.
- Reports that trigger second pass mention this in integration notes.
- Fast mode does not silently incur deep second-pass cost.

## Phase 5: Source Diversity And Synthesis Context

Implementation:
- Keep more evidence for report display in Deep mode.
- Apply source-family budgets so generic web pages do not crowd out customer-voice sources.
- Send a larger evidence set to OpenAI in Deep mode.

Acceptance criteria:
- Deep reports can show significantly more than 60 sources when available.
- Reddit, LinkedIn, X, YouTube, and web sources each have independent room in the final evidence set.
- OpenAI prompt includes a larger source sample for Deep mode.
- Evidence IDs remain valid after diversity filtering.

## Verification

Required checks after each implementation slice:
- `npm run lint`
- `npm run build`

Final browser verification:
- Confirm the search depth selector is visible and defaults to `Fast`.
- Confirm selecting `Deep` sends `searchDepth: "deep"` in the request path.
- Confirm a deep run can produce and display more than the old source caps when providers return enough data.
