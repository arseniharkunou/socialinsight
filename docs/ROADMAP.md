# Social Insight Stability And Quality Roadmap

This backlog captures the remaining recommendations after the local job pipeline and deterministic evidence scoring layer.

## Next Stability Work

1. **Durable job store**
   - Replace in-memory running jobs with SQLite locally or Postgres/Supabase in production.
   - Store provider logs, source counts, raw provider errors, and stage timings per job.

2. **Worker-backed execution**
   - Move long Bright Data snapshot polling into a worker process.
   - Keep the Next.js API focused on starting jobs, polling status, and reading completed reports.

3. **Provider observability**
   - Log provider, query, duration, source count, error reason, fallback status, and cost-sensitive metadata.
   - Show a compact provider diagnostics panel in the report for debugging low-quality runs.

## Next Quality Work

1. **AI evidence-card extraction**
   - Add a first OpenAI pass that converts each source into structured evidence cards:
     pain, request, workaround, competitor, quote, persona, severity hint, and confidence.
   - Feed those normalized cards into final synthesis instead of raw snippets.

2. **Source quality controls**
   - Add source recency parsing, source-type weights, domain caps, duplicate cluster handling, and configurable time windows.
   - Prefer direct discussions and reviews over generic articles unless the article contains strong quoted evidence.

3. **Long-running Reddit comments**
   - Move Reddit Comments API to async polling.
   - Merge ready comment snapshots into the report as an evidence update rather than blocking the first report.

4. **Report history**
   - Add saved report list, rerun controls, shareable report URLs, and comparison between runs.

5. **Exports**
   - Add CSV export for sources and PDF/Markdown export for reports.
   - Add interview-question generation from the top validated pains.

## Deployment Notes

- Local MVP can keep using filesystem snapshots in `output/reports`.
- Production should use Postgres/Supabase plus a worker/queue because serverless request lifetimes are not a good fit for long Bright Data snapshots.
- Vercel is a good frontend/API host if the analysis worker is delegated to durable infrastructure.
