# Social Insight

Social Insight is a hackathon-quality MVP that turns any public product, company, or domain into a market intelligence report:

`URL -> Market Detection -> Public Conversation Analysis -> Pain Point Report`

The app analyzes a public website or company/product name, builds local market-specific discovery queries, uses Bright Data to collect public web signals, and uses OpenAI to synthesize recurring pain points, frustrations, feature requests, workarounds, competitors, and product opportunities.

## Architecture

- **Frontend:** Next.js App Router, React, TypeScript, Tailwind CSS, lucide-react.
- **Backend:** Next.js route handlers at `app/api/analyze/route.ts` and `app/api/analyze/[jobId]/route.ts`.
- **Job execution:** Local in-memory analysis jobs with persisted snapshots in `output/reports`.
- **Website retrieval:** Bright Data Web Unlocker API when credentials are present, direct fetch fallback in demo mode.
- **Market discovery:** Bright Data SERP API via the REST `/request` endpoint, optional Bright Data remote MCP search/scrape/social tools, then Bright Data Reddit, X, LinkedIn, and YouTube Scraper APIs for social posts, videos, and comments found in search results.
- **Reasoning:** OpenAI Responses API with JSON Schema structured outputs.
- **Evidence layer:** Deterministic source scoring and quote extraction before OpenAI synthesis.
- **Persistence:** Local job/report JSON snapshots. This is intended for local MVP development, not multi-user production durability.

## Data Flow

1. User enters a product, company, public domain, or category.
2. `POST /api/analyze` creates a local analysis job and returns a job ID immediately.
3. The frontend polls `GET /api/analyze/:jobId` for progress and can stop the job with `DELETE /api/analyze/:jobId`.
4. Server retrieves website content when a URL/domain is provided.
5. Server builds a local market profile and evidence-seeking query templates.
6. Bright Data SERP API and/or Bright Data MCP gathers public search results for those queries.
7. Bright Data MCP optionally scrapes top source pages as Markdown for stronger quote evidence.
8. Reddit URLs are enriched with Bright Data Reddit Posts API records, with Reddit Comments API collection attempted as a short best-effort pass. X/Twitter status URLs are enriched with Bright Data X Posts API records; replies are treated as comment evidence when the structured record exposes parent reply metadata. LinkedIn post URLs are enriched with Bright Data LinkedIn Posts API records. YouTube video URLs are enriched with Bright Data YouTube Videos API records and a best-effort YouTube Comments API pass.
9. Server applies the selected time window, scores and normalizes source evidence, prioritizing direct pain/request/comparison language.
10. OpenAI synthesizes the final report with ranked pain points, citations, confidence, caveats, and next steps.
11. The completed job snapshot is saved to `output/reports/<jobId>.json` and rendered by the dashboard.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app runs without credentials in **demo mode** so the full UX can be reviewed locally. Add credentials for live collection and synthesis.

Check whether the configured providers are actually usable:

```bash
npm run check:integrations
```

## Required Environment Variables

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.2

BRIGHTDATA_API_KEY=...
BRIGHTDATA_SERP_ZONE=serp_api1
BRIGHTDATA_WEB_UNLOCKER_ZONE=web_unlocker1
BRIGHTDATA_COUNTRY=us
BRIGHTDATA_MCP_URL=https://mcp.brightdata.com/sse?token=<token>&groups=advanced_scraping,social
```

Only server-side variables are used. Do not expose these as `NEXT_PUBLIC_*`.

## Bright Data Integration Details

Social Insight uses Bright Data REST APIs directly from the Next.js server route.

### Web Unlocker

Used to fetch the target public website when `BRIGHTDATA_API_KEY` is configured:

```ts
POST https://api.brightdata.com/request
Authorization: Bearer <BRIGHTDATA_API_KEY>

{
  "zone": "<BRIGHTDATA_WEB_UNLOCKER_ZONE>",
  "url": "https://example.com",
  "format": "raw",
  "method": "GET",
  "country": "us",
  "data_format": "markdown"
}
```

### SERP API

Used to gather public market signals from local query templates. Social Insight appends `after:YYYY-MM-DD` to each query for the selected time window:

```ts
POST https://api.brightdata.com/request
Authorization: Bearer <BRIGHTDATA_API_KEY>

{
  "zone": "<BRIGHTDATA_SERP_ZONE>",
  "url": "https://www.google.com/search?q=<query>",
  "format": "json",
  "method": "GET",
  "country": "us"
}
```

### Reddit Scraper APIs

Used to enrich Reddit threads discovered by SERP with structured records:

```ts
POST https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_lvz8ah06191smkebj4&include_errors=true&format=json
Authorization: Bearer <BRIGHTDATA_API_KEY>

{
  "input": [{ "url": "https://www.reddit.com/r/example/comments/post_id/" }]
}
```

Social Insight also attempts the Reddit Comments API for the highest-ranked Reddit thread:

```ts
POST https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_lvzdpsdlw09j6t702&include_errors=true&format=json
Authorization: Bearer <BRIGHTDATA_API_KEY>

{
  "input": [{ "url": "https://www.reddit.com/r/example/comments/post_id/", "days_back": 1095 }]
}
```

Comments collection is intentionally best-effort because Bright Data can return a snapshot ID that remains pending for several minutes.

Timeline behavior:

- Last 30 days: Reddit discover uses `Past month`; comments use `days_back: 30`.
- Last 90 days: Reddit discover uses `Past year`, then Social Insight filters `date_posted` locally; comments use `days_back: 90`.
- Last 6 months: Reddit discover uses `Past year`, then Social Insight filters `date_posted` locally; comments use the computed day count for the last six calendar months.
- Last year: Reddit discover uses `Past year`; comments use the computed day count for the last calendar year.

### X Scraper API

Used to enrich X/Twitter statuses discovered by Bright Data SERP or MCP search with structured post records:

```ts
POST https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_lwxkxvnf1cynvib9co&include_errors=true&format=json
Authorization: Bearer <BRIGHTDATA_API_KEY>

{
  "input": [{ "url": "https://x.com/example/status/1234567890123456789" }]
}
```

Bright Data does not expose a separate X comments endpoint in the current Social Media Scraper API reference. Social Insight treats X replies as `x_comment` evidence when the X post record indicates parent or in-reply-to metadata; otherwise records are returned as `x_post`. X discovery uses date-filtered SERP queries first, then filters structured X records by `date_posted` when Bright Data returns it.

### LinkedIn Scraper API

Used to enrich LinkedIn posts and articles discovered by Bright Data SERP or MCP search:

```ts
POST https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_lyy3tktm25m4avu764&include_errors=true&format=json
Authorization: Bearer <BRIGHTDATA_API_KEY>

{
  "input": [{ "url": "https://www.linkedin.com/posts/example-activity-1234567890" }]
}
```

LinkedIn discovery uses date-filtered SERP queries scoped to `linkedin.com/posts`, `linkedin.com/feed/update`, and `linkedin.com/pulse`, then filters structured records by `date_posted` when Bright Data returns it.

### YouTube Scraper APIs

Used to enrich YouTube videos discovered by Bright Data SERP or MCP search:

```ts
POST https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_lk56epmy2i5g7lzu0k&include_errors=true&format=json
Authorization: Bearer <BRIGHTDATA_API_KEY>

{
  "input": [{ "url": "https://www.youtube.com/watch?v=abc123" }]
}
```

Social Insight also attempts the YouTube Comments API for the top YouTube videos:

```ts
POST https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_lk9q0ew71spt1mxywf&include_errors=true&format=json
Authorization: Bearer <BRIGHTDATA_API_KEY>

{
  "input": [{ "url": "https://www.youtube.com/watch?v=abc123" }]
}
```

YouTube discovery uses date-filtered SERP queries scoped to watch, short, and youtu.be URLs, then filters structured video and comment records by returned dates when available.

### Remote MCP

Optional. When `BRIGHTDATA_MCP_URL` is set, Social Insight connects to Bright Data's remote MCP server with the official Model Context Protocol TypeScript SDK and uses:

- `search_engine` for additional Google result discovery.
- `scrape_as_markdown` for deeper source snippets from high-ranked pages.
- `web_data_reddit_posts` for structured Reddit post enrichment when available.
- `web_data_x_posts` for structured X post and reply enrichment when available.

Keep the full MCP URL in `.env.local`; it contains a token and must not be exposed as `NEXT_PUBLIC_*`.

Official resources used:

- [Bright Data Authentication](https://docs.brightdata.com/api-reference/authentication)
- [SERP API](https://docs.brightdata.com/api-reference/rest-api/serp/serp-api)
- [SERP rate limit](https://docs.brightdata.com/general/usage-monitoring/serp-rate-limit)
- [Web Unlocker API](https://docs.brightdata.com/api-reference/rest-api/unlocker/unlock-website)
- [Asynchronous SERP and Unlocker requests](https://docs.brightdata.com/scraping-automation/serp-api/asynchronous-requests)
- [Reddit Posts API](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/reddit-posts-collect-by-url)
- [Reddit Comments API](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/reddit-comments-collect-by-url)
- [X Posts API](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/twitter-posts-collect-by-url)
- [LinkedIn Posts API](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/linkedin-posts-collect-by-url)
- [YouTube Videos API](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/youtube-videos-collect-by-url)
- [YouTube Comments API](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/youtube-comments-collect-by-url)
- [Bright Data MCP Server](https://docs.brightdata.com/ai/mcp-server/overview)
- [Bright Data MCP Tools](https://docs.brightdata.com/ai/mcp-server/tools)

## OpenAI Integration Details

Social Insight calls the OpenAI Responses API server-side and requests structured JSON output using `text.format.type = "json_schema"`.

One model call is used after deterministic evidence scoring:

1. **Report synthesis:** turns Bright Data evidence into the final decision-ready report.

Official resources used:

- [Responses API](https://platform.openai.com/docs/api-reference/responses/create)
- [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
- [Text generation](https://platform.openai.com/docs/guides/text)

## Known Limitations

- Demo mode uses representative seed signals when credentials are missing.
- SERP snippets are a lightweight signal source; MCP page scraping improves this when `BRIGHTDATA_MCP_URL` is configured.
- Reddit and YouTube Comments APIs can remain pending or return provider-side errors for some threads/videos, so the synchronous MVP treats comments as best-effort.
- Job state is in-memory while running. Completed snapshots are persisted locally, but production needs durable database-backed jobs.
- No user accounts, billing, collaboration features, or exports.
- Live runs are local background jobs optimized for small hackathon-sized requests.
- Public conversations can be noisy and biased toward vocal users.
- See [docs/ROADMAP.md](docs/ROADMAP.md) for the stability and quality backlog.

## Future Enhancements

- Move Reddit comments to a longer-running worker with snapshot polling and progressive report updates.
- Fetch and summarize top result pages with Web Unlocker for stronger evidence.
- Add production database-backed report history with shareable URLs.
- Add CSV/PDF export and customer-interview question generation.
- Add production queue infrastructure for larger query sets and async Bright Data polling.
