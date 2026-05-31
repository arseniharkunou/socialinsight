import dns from "node:dns/promises";
import { createHash } from "node:crypto";
import { hostFromUrl, isPrivateIpAddress, stripHtml, truncate } from "@/lib/utils";
import { SUPPORTED_SOURCE_OPTIONS } from "@/lib/types";
import type { MarketSignal, SearchDepth, SupportedSource, TimeWindow } from "@/lib/types";
import type { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";

type BrightDataConfig = {
  apiKey?: string;
  serpZone?: string;
  webUnlockerZone?: string;
  country: string;
};

const REQUEST_ENDPOINT = "https://api.brightdata.com/request";
const SCRAPER_SCRAPE_ENDPOINT = "https://api.brightdata.com/datasets/v3/scrape";
const SCRAPER_PROGRESS_ENDPOINT = "https://api.brightdata.com/datasets/v3/progress";
const SCRAPER_SNAPSHOT_ENDPOINT = "https://api.brightdata.com/datasets/v3/snapshot";
const REDDIT_POSTS_DATASET_ID = "gd_lvz8ah06191smkebj4";
const REDDIT_COMMENTS_DATASET_ID = "gd_lvzdpsdlw09j6t702";
const X_POSTS_DATASET_ID = "gd_lwxkxvnf1cynvib9co";
const LINKEDIN_POSTS_DATASET_ID = "gd_lyy3tktm25m4avu764";
const YOUTUBE_VIDEOS_DATASET_ID = "gd_lk56epmy2i5g7lzu0k";
const YOUTUBE_COMMENTS_DATASET_ID = "gd_lk9q0ew71spt1mxywf";
const MAX_WEBSITE_BYTES = 900_000;
const IS_VERCEL = Boolean(process.env.VERCEL);
const HAS_DURABLE_ANALYSIS_JOBS = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

type TimeWindowConfig = {
  timeWindow: TimeWindow;
  cutoff: Date;
  daysBack: number;
  googleAfter: string;
  redditDate: "Past month" | "Past year";
};

type SourceSelection = Set<SupportedSource>;

const DEFAULT_SUPPORTED_SOURCES = SUPPORTED_SOURCE_OPTIONS.map((source) => source.value);

type SearchBudget = {
  finalSignals: number;
  earlyPreviewSignals: number;
  restQueries: {
    base: number;
    reddit: number;
    x: number;
    linkedin: number;
    youtube: number;
  };
  mcpQueries: {
    base: number;
    reddit: number;
    x: number;
    linkedin: number;
    youtube: number;
  };
  serpResultsPerQuery: number;
  mcpScrapeUrls: number;
  redditUrls: number;
  redditCommentUrls: number;
  redditKeywordQueries: number;
  redditPostsPerQuery: number;
  redditPostParseLimit: number;
  redditCommentParseLimit: number;
  xUrls: number;
  xParseLimit: number;
  linkedinUrls: number;
  linkedinParseLimit: number;
  youtubeUrls: number;
  youtubeCommentUrls: number;
  youtubeVideoParseLimit: number;
  youtubeCommentParseLimit: number;
};

const SEARCH_BUDGETS: Record<SearchDepth, SearchBudget> = {
  fast: {
    finalSignals: 90,
    earlyPreviewSignals: 16,
    restQueries: { base: 5, reddit: 5, x: 6, linkedin: 5, youtube: 3 },
    mcpQueries: { base: 2, reddit: 2, x: 3, linkedin: 3, youtube: 2 },
    serpResultsPerQuery: 10,
    mcpScrapeUrls: 3,
    redditUrls: 6,
    redditCommentUrls: 3,
    redditKeywordQueries: 3,
    redditPostsPerQuery: 10,
    redditPostParseLimit: 28,
    redditCommentParseLimit: 60,
    xUrls: 12,
    xParseLimit: 48,
    linkedinUrls: 12,
    linkedinParseLimit: 42,
    youtubeUrls: 5,
    youtubeCommentUrls: 2,
    youtubeVideoParseLimit: 12,
    youtubeCommentParseLimit: 30,
  },
  deep: {
    finalSignals: 320,
    earlyPreviewSignals: 32,
    restQueries: { base: 8, reddit: 18, x: 18, linkedin: 18, youtube: 6 },
    mcpQueries: { base: 4, reddit: 6, x: 6, linkedin: 6, youtube: 3 },
    serpResultsPerQuery: 15,
    mcpScrapeUrls: 8,
    redditUrls: 24,
    redditCommentUrls: 16,
    redditKeywordQueries: 16,
    redditPostsPerQuery: 25,
    redditPostParseLimit: 120,
    redditCommentParseLimit: 240,
    xUrls: 40,
    xParseLimit: 160,
    linkedinUrls: 40,
    linkedinParseLimit: 140,
    youtubeUrls: 12,
    youtubeCommentUrls: 6,
    youtubeVideoParseLimit: 36,
    youtubeCommentParseLimit: 80,
  },
};

function config(): BrightDataConfig {
  return {
    apiKey: process.env.BRIGHTDATA_API_KEY,
    serpZone: process.env.BRIGHTDATA_SERP_ZONE || "serp_api1",
    webUnlockerZone: process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE || "web_unlocker1",
    country: process.env.BRIGHTDATA_COUNTRY || "us",
  };
}

export function hasBrightDataCredentials() {
  return Boolean(process.env.BRIGHTDATA_API_KEY);
}

export function hasBrightDataMcpCredentials() {
  return Boolean(process.env.BRIGHTDATA_MCP_URL);
}

async function brightDataRequest(body: Record<string, unknown>) {
  const cfg = config();
  if (!cfg.apiKey) {
    throw new Error("Missing BRIGHTDATA_API_KEY");
  }

  const response = await fetch(REQUEST_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(IS_VERCEL ? 10000 : 25000),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Bright Data request failed (${response.status}): ${truncate(message, 260)}`);
  }

  const text = await readLimitedText(response, MAX_WEBSITE_BYTES);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

type BrightDataScraperOptions = {
  requestTimeoutMs?: number;
  pollTimeoutMs?: number;
  query?: Record<string, string | number | boolean>;
};

type McpToolClient = Pick<McpClient, "callTool">;

async function brightDataScraperRequest(datasetId: string, input: Array<Record<string, unknown>>, options: BrightDataScraperOptions = {}) {
  const cfg = config();
  if (!cfg.apiKey) {
    throw new Error("Missing BRIGHTDATA_API_KEY");
  }

  const params = new URLSearchParams({
    dataset_id: datasetId,
    include_errors: "true",
    format: "json",
  });
  for (const [key, value] of Object.entries(options.query || {})) {
    params.set(key, String(value));
  }

  const response = await fetch(`${SCRAPER_SCRAPE_ENDPOINT}?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(providerTimeout(options.requestTimeoutMs ?? 65000, 10000)),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Bright Data scraper request failed (${response.status}): ${truncate(text, 260)}`);
  }

  const payload = parseJsonOrText(text);
  if (Array.isArray(payload)) {
    return payload;
  }

  const snapshotId = payload && typeof payload === "object" ? String((payload as { snapshot_id?: string }).snapshot_id || "") : "";
  if (!snapshotId) {
    return payload;
  }

  const status = await waitForSnapshot(snapshotId, cfg.apiKey, providerTimeout(options.pollTimeoutMs ?? 30000, 4000));
  if (status !== "ready") {
    throw new Error(`Bright Data scraper snapshot ${snapshotId} is still ${status}.`);
  }

  return downloadSnapshot(snapshotId, cfg.apiKey);
}

async function waitForSnapshot(snapshotId: string, apiKey: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(IS_VERCEL ? 1500 : 3000);
    const response = await fetch(`${SCRAPER_PROGRESS_ENDPOINT}/${snapshotId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      continue;
    }
    const progress = (await response.json()) as { status?: string };
    if (progress.status === "ready" || progress.status === "failed") {
      return progress.status;
    }
  }
  return "running";
}

function providerTimeout(requestedMs: number, vercelMaxMs: number) {
  return IS_VERCEL ? Math.min(requestedMs, vercelMaxMs) : requestedMs;
}

async function downloadSnapshot(snapshotId: string, apiKey: string) {
  const response = await fetch(`${SCRAPER_SNAPSHOT_ENDPOINT}/${snapshotId}?format=json`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(12000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Bright Data snapshot download failed (${response.status}): ${truncate(text, 260)}`);
  }
  return parseJsonOrText(text);
}

function parseJsonOrText(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function fetchWebsiteContent(url: string) {
  if (!hasBrightDataCredentials()) {
    await assertHostnameDoesNotResolvePrivately(url);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Social Insight market analysis bot",
      },
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      throw new Error(`Website fetch failed (${response.status})`);
    }
    const html = await readLimitedText(response, MAX_WEBSITE_BYTES);
    return truncate(stripHtml(html), 8000);
  }

  const cfg = config();
  const result = await brightDataRequest({
    zone: cfg.webUnlockerZone,
    url,
    format: "raw",
    method: "GET",
    country: cfg.country,
    data_format: "markdown",
  });

  return truncate(typeof result === "string" ? stripHtml(result) : JSON.stringify(result), 10000);
}

async function assertHostnameDoesNotResolvePrivately(url: string) {
  const hostname = new URL(url).hostname;
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.some((record) => isPrivateIpAddress(record.address))) {
    throw new Error("URL resolves to a private network address.");
  }
}

function extractOrganicItems(payload: unknown) {
  const record = payload as Record<string, unknown>;
  const candidates = [
    record.organic,
    record.organic_results,
    record.results,
    record.search_results,
    Array.isArray(record) ? record : null,
  ];
  return candidates.find(Array.isArray) as Array<Record<string, unknown>> | undefined;
}

function normalizeSourceSelection(sources?: SupportedSource[]): SourceSelection {
  const allowedSources = new Set(DEFAULT_SUPPORTED_SOURCES);
  const selectedSources = sources?.filter((source) => allowedSources.has(source));
  return new Set(selectedSources?.length ? selectedSources : DEFAULT_SUPPORTED_SOURCES);
}

function buildDiscoveryQueries(
  queries: string[],
  sources: SourceSelection,
  limits: { base: number; reddit: number; x: number; linkedin: number; youtube: number },
) {
  return [
    ...(sources.has("web") ? buildBaseDiscoveryQueries(queries).slice(0, limits.base) : []),
    ...(sources.has("reddit") ? buildRedditSearchQueries(queries).slice(0, limits.reddit) : []),
    ...(sources.has("x") ? buildXSearchQueries(queries).slice(0, limits.x) : []),
    ...(sources.has("linkedin") ? buildLinkedInSearchQueries(queries).slice(0, limits.linkedin) : []),
    ...(sources.has("youtube") ? buildYouTubeSearchQueries(queries).slice(0, limits.youtube) : []),
  ];
}

function buildBaseDiscoveryQueries(queries: string[]) {
  return uniqueStrings([...queries, ...expandDiscoveryQueries(queries)]);
}

function signalMatchesSourceSelection(signal: MarketSignal, sources: SourceSelection) {
  if (sources.has("reddit") && (signal.sourceType.startsWith("reddit") || Boolean(canonicalRedditPostUrl(signal.url)))) {
    return true;
  }
  if (sources.has("x") && (signal.sourceType.startsWith("x_") || Boolean(canonicalXPostUrl(signal.url)))) {
    return true;
  }
  if (sources.has("linkedin") && (signal.sourceType === "linkedin_post" || Boolean(canonicalLinkedInPostUrl(signal.url)))) {
    return true;
  }
  if (sources.has("youtube") && (signal.sourceType.startsWith("youtube") || Boolean(canonicalYouTubeVideoUrl(signal.url)))) {
    return true;
  }
  if (!sources.has("web")) {
    return false;
  }
  return !canonicalRedditPostUrl(signal.url) && !canonicalXPostUrl(signal.url) && !canonicalLinkedInPostUrl(signal.url) && !canonicalYouTubeVideoUrl(signal.url);
}

export async function searchPublicSignals(
  queries: string[],
  timeWindow: TimeWindow = "1y",
  sources?: SupportedSource[],
  searchDepth: SearchDepth = "fast",
  onSignals?: (signals: MarketSignal[]) => void,
) {
  const budget = runtimeSearchBudget(searchDepth);
  if (!hasBrightDataCredentials() && !hasBrightDataMcpCredentials()) {
    const signals = demoSignals(queries);
    onSignals?.(signals);
    return signals;
  }

  const windowConfig = timeWindowConfig(timeWindow);
  const sourceSelection = normalizeSourceSelection(sources);
  const restSignals = hasBrightDataCredentials() ? await searchWithBrightDataRest(queries, windowConfig, sourceSelection, budget) : [];
  const mcpSignals = hasBrightDataMcpCredentials() ? await searchWithBrightDataMcp(queries, windowConfig, sourceSelection, budget).catch(() => []) : [];

  const serpSignals = dedupeSignals(
    [...mcpSignals, ...restSignals]
      .filter((signal) => signal.url),
  );
  const selectedDiscoverySignals = serpSignals.filter((signal) => signalMatchesSourceSelection(signal, sourceSelection));
  if (selectedDiscoverySignals.length) {
    onSignals?.(filterSignalsByTimeWindow(selectedDiscoverySignals, windowConfig).slice(0, budget.earlyPreviewSignals));
  }
  const enrichmentResults = await Promise.allSettled([
    sourceSelection.has("reddit") && hasBrightDataCredentials() ? enrichRedditSignals(serpSignals, queries, windowConfig, budget) : Promise.resolve([]),
    sourceSelection.has("x") && hasBrightDataCredentials() ? enrichXSignals(serpSignals, windowConfig, budget) : Promise.resolve([]),
    sourceSelection.has("linkedin") && hasBrightDataCredentials() ? enrichLinkedInSignals(serpSignals, windowConfig, budget) : Promise.resolve([]),
    sourceSelection.has("youtube") && hasBrightDataCredentials() ? enrichYouTubeSignals(serpSignals, windowConfig, budget) : Promise.resolve([]),
  ]);
  const [redditSignals, xSignals, linkedinSignals, youtubeSignals] = enrichmentResults.map((result) => result.status === "fulfilled" ? result.value : []);
  const signals = filterSignalsByTimeWindow(dedupeSignals([...redditSignals, ...xSignals, ...linkedinSignals, ...youtubeSignals, ...selectedDiscoverySignals]), windowConfig).slice(0, budget.finalSignals);
  if (signals.length === 0) {
    throw new Error("Bright Data returned no usable public signals.");
  }
  return signals;
}

function runtimeSearchBudget(searchDepth: SearchDepth): SearchBudget {
  const budget = SEARCH_BUDGETS[searchDepth];
  if (!IS_VERCEL || HAS_DURABLE_ANALYSIS_JOBS) {
    return budget;
  }

  if (searchDepth === "deep") {
    return {
      ...budget,
      finalSignals: 90,
      restQueries: { base: 8, reddit: 3, x: 3, linkedin: 3, youtube: 3 },
      mcpQueries: { base: 3, reddit: 1, x: 1, linkedin: 1, youtube: 1 },
      serpResultsPerQuery: 8,
      mcpScrapeUrls: 1,
      redditUrls: 3,
      redditCommentUrls: 1,
      redditKeywordQueries: 1,
      redditPostsPerQuery: 8,
      redditPostParseLimit: 20,
      redditCommentParseLimit: 24,
      xUrls: 4,
      xParseLimit: 20,
      linkedinUrls: 4,
      linkedinParseLimit: 20,
      youtubeUrls: 4,
      youtubeCommentUrls: 1,
      youtubeVideoParseLimit: 16,
      youtubeCommentParseLimit: 20,
    };
  }

  return {
    ...budget,
    finalSignals: 45,
    restQueries: { base: 5, reddit: 1, x: 1, linkedin: 1, youtube: 1 },
    mcpQueries: { base: 2, reddit: 1, x: 1, linkedin: 1, youtube: 1 },
    serpResultsPerQuery: 6,
    mcpScrapeUrls: 1,
    redditUrls: 1,
    redditCommentUrls: 0,
    redditKeywordQueries: 0,
    redditPostsPerQuery: 5,
    redditPostParseLimit: 10,
    redditCommentParseLimit: 0,
    xUrls: 2,
    xParseLimit: 12,
    linkedinUrls: 2,
    linkedinParseLimit: 12,
    youtubeUrls: 2,
    youtubeCommentUrls: 0,
    youtubeVideoParseLimit: 10,
    youtubeCommentParseLimit: 0,
  };
}

async function searchWithBrightDataRest(queries: string[], windowConfig: TimeWindowConfig, sources: SourceSelection, budget: SearchBudget) {
  const cfg = config();
  const searchQueries = buildDiscoveryQueries(queries, sources, budget.restQueries)
    .map((query) => withGoogleTimeFilter(query, windowConfig));
  const batches = await Promise.allSettled(
    searchQueries.map(async (query) => {
      const payload = await brightDataRequest({
        zone: cfg.serpZone,
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}&brd_json=1`,
        format: "json",
        method: "GET",
        country: cfg.country,
      });
      return parseSerpPayload(payload, query, budget.serpResultsPerQuery);
    }),
  );

  return batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []));
}

async function searchWithBrightDataMcp(queries: string[], windowConfig: TimeWindowConfig, sources: SourceSelection, budget: SearchBudget) {
  const mcpUrl = process.env.BRIGHTDATA_MCP_URL;
  if (!mcpUrl) {
    return [];
  }

  const [{ Client }, { SSEClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/sse.js"),
  ]);
  const client = new Client({ name: "social-insight", version: "0.1.0" }, { capabilities: {} });
  const transport = new SSEClientTransport(new URL(mcpUrl));

  try {
    await client.connect(transport, { timeout: 15000 });
    const toolList = await client.listTools(undefined, { timeout: 10000 });
    const tools = new Set(toolList.tools.map((tool) => tool.name));
    const searchSignals: MarketSignal[] = [];

    if (tools.has("search_engine")) {
      const searchQueries = buildDiscoveryQueries(queries, sources, budget.mcpQueries)
        .map((query) => withGoogleTimeFilter(query, windowConfig));
      for (const query of searchQueries) {
        const result = await client.callTool(
          { name: "search_engine", arguments: { query, engine: "google" } },
          undefined,
          { timeout: 35000 },
        );
        searchSignals.push(...parseMcpSearchResult(toolResultText(result), query, budget.serpResultsPerQuery));
      }
    }

    const redditSignals = sources.has("reddit") && tools.has("web_data_reddit_posts")
      ? await enrichRedditSignalsWithMcp(client, searchSignals, budget)
      : [];
    const xSignals = sources.has("x") && tools.has("web_data_x_posts")
      ? await enrichXSignalsWithMcp(client, searchSignals, windowConfig, budget)
      : [];
    const scrapedSignals = sources.has("web") && tools.has("scrape_as_markdown")
      ? await scrapeSignalsWithMcp(client, searchSignals, budget)
      : [];

    return [...redditSignals, ...xSignals, ...scrapedSignals, ...(sources.has("web") ? searchSignals : [])];
  } catch {
    return [];
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function enrichRedditSignalsWithMcp(client: McpToolClient, signals: MarketSignal[], budget: SearchBudget) {
  const redditUrls = Array.from(
    new Set(signals.map((signal) => canonicalRedditPostUrl(signal.url)).filter((url): url is string => Boolean(url))),
  ).slice(0, budget.redditUrls);
  const enriched: MarketSignal[] = [];

  for (const url of redditUrls) {
    try {
      const result = await client.callTool(
        { name: "web_data_reddit_posts", arguments: { url } },
        undefined,
        { timeout: 45000 },
      );
      enriched.push(...parseRedditPosts(parseMcpPayload(toolResultText(result)), budget.redditPostParseLimit));
    } catch {
      // Reddit structured data is additive; SERP evidence remains available.
    }
  }

  return enriched;
}

async function scrapeSignalsWithMcp(client: McpToolClient, signals: MarketSignal[], budget: SearchBudget) {
  const urls = signals
    .filter((signal) => !canonicalRedditPostUrl(signal.url))
    .filter((signal) => !canonicalXPostUrl(signal.url))
    .filter((signal) => !canonicalLinkedInPostUrl(signal.url))
    .filter((signal) => !canonicalYouTubeVideoUrl(signal.url))
    .map((signal) => signal.url)
    .slice(0, budget.mcpScrapeUrls);
  const scraped: MarketSignal[] = [];

  for (const [index, url] of urls.entries()) {
    try {
      const result = await client.callTool(
        { name: "scrape_as_markdown", arguments: { url } },
        undefined,
        { timeout: 35000 },
      );
      const markdown = toolResultText(result);
      if (markdown.trim().length < 80) {
        continue;
      }
      scraped.push({
        sourceId: createSourceId("mcp-scrape", index, url),
        title: titleFromMarkdown(markdown) || `Scraped source: ${hostFromUrl(url)}`,
        url,
        snippet: truncate(excerptFromMarkdown(markdown), 900),
        sourceType: "article",
        query: "Bright Data MCP scrape_as_markdown",
        confidence: 82,
        domain: hostFromUrl(url),
        position: index + 1,
      });
    } catch {
      // Page scraping is additive; search snippets remain available.
    }
  }

  return scraped;
}

async function enrichRedditSignals(signals: MarketSignal[], queries: string[], windowConfig: TimeWindowConfig, budget: SearchBudget) {
  const redditUrls = Array.from(
    new Set(
      signals
        .map((signal) => canonicalRedditPostUrl(signal.url))
        .filter((url): url is string => Boolean(url)),
    ),
  ).slice(0, budget.redditUrls);

  if (redditUrls.length === 0 && queries.length === 0) {
    return [];
  }

  const tasks: Array<Promise<MarketSignal[]>> = [];

  if (redditUrls.length > 0) {
    tasks.push(
      brightDataScraperRequest(
        REDDIT_POSTS_DATASET_ID,
        redditUrls.map((url) => ({ url })),
        { requestTimeoutMs: 70000, pollTimeoutMs: 15000 },
      ).then((payload) => parseRedditPosts(payload, budget.redditPostParseLimit)),
    );

    tasks.push(
      brightDataScraperRequest(
        REDDIT_COMMENTS_DATASET_ID,
        redditUrls.slice(0, budget.redditCommentUrls).map((url) => ({ url, days_back: windowConfig.daysBack })),
        { requestTimeoutMs: 20000, pollTimeoutMs: 5000 },
      ).then((payload) => parseRedditComments(payload, budget.redditCommentParseLimit)),
    );
  }

  if (budget.redditKeywordQueries > 0 && (redditUrls.length < 2 || budget.redditKeywordQueries > 1)) {
    tasks.push(
      brightDataScraperRequest(
        REDDIT_POSTS_DATASET_ID,
        buildRedditKeywordQueries(queries).slice(0, budget.redditKeywordQueries).map((query) => ({ keyword: query, date: windowConfig.redditDate, num_of_posts: budget.redditPostsPerQuery })),
        {
          requestTimeoutMs: 60000,
          pollTimeoutMs: 15000,
          query: { type: "discover_new", discover_by: "keyword" },
        },
      ).then((payload) => parseRedditPosts(payload, budget.redditPostParseLimit)),
    );
  }

  const settled = await Promise.allSettled(tasks);
  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function enrichXSignalsWithMcp(client: McpToolClient, signals: MarketSignal[], windowConfig: TimeWindowConfig, budget: SearchBudget) {
  const xUrls = extractXPostUrls(signals).slice(0, budget.xUrls);
  const enriched: MarketSignal[] = [];

  for (const url of xUrls) {
    try {
      const result = await client.callTool(
        { name: "web_data_x_posts", arguments: { url } },
        undefined,
        { timeout: 45000 },
      );
      enriched.push(...filterSignalsByTimeWindow(parseXPosts(parseMcpPayload(toolResultText(result)), "Bright Data MCP web_data_x_posts", budget.xParseLimit), windowConfig));
    } catch {
      // X structured data is additive; SERP evidence remains available.
    }
  }

  return enriched;
}

async function enrichXSignals(signals: MarketSignal[], windowConfig: TimeWindowConfig, budget: SearchBudget) {
  const xUrls = extractXPostUrls(signals).slice(0, budget.xUrls);
  if (xUrls.length === 0) {
    return [];
  }

  return brightDataScraperRequest(
    X_POSTS_DATASET_ID,
    xUrls.map((url) => ({ url })),
    { requestTimeoutMs: 65000, pollTimeoutMs: 15000 },
  )
    .then((payload) => filterSignalsByTimeWindow(parseXPosts(payload, "Bright Data X Posts API", budget.xParseLimit), windowConfig))
    .catch(() => []);
}

async function enrichLinkedInSignals(signals: MarketSignal[], windowConfig: TimeWindowConfig, budget: SearchBudget) {
  const linkedinUrls = extractLinkedInPostUrls(signals).slice(0, budget.linkedinUrls);
  if (linkedinUrls.length === 0) {
    return [];
  }

  return brightDataScraperRequest(
    LINKEDIN_POSTS_DATASET_ID,
    linkedinUrls.map((url) => ({ url })),
    { requestTimeoutMs: 70000, pollTimeoutMs: 15000 },
  )
    .then((payload) => filterSignalsByTimeWindow(parseLinkedInPosts(payload, "Bright Data LinkedIn Posts API", budget.linkedinParseLimit), windowConfig))
    .catch(() => []);
}

async function enrichYouTubeSignals(signals: MarketSignal[], windowConfig: TimeWindowConfig, budget: SearchBudget) {
  const youtubeUrls = extractYouTubeVideoUrls(signals).slice(0, budget.youtubeUrls);
  if (youtubeUrls.length === 0) {
    return [];
  }

  const tasks: Array<Promise<MarketSignal[]>> = [
    brightDataScraperRequest(
      YOUTUBE_VIDEOS_DATASET_ID,
      youtubeUrls.map((url) => ({ url })),
      { requestTimeoutMs: 70000, pollTimeoutMs: 15000 },
    ).then((payload) => parseYouTubeVideos(payload, "Bright Data YouTube Videos API", budget.youtubeVideoParseLimit)),
  ];

  tasks.push(
    brightDataScraperRequest(
      YOUTUBE_COMMENTS_DATASET_ID,
      youtubeUrls.slice(0, budget.youtubeCommentUrls).map((url) => ({ url })),
      { requestTimeoutMs: 65000, pollTimeoutMs: 15000 },
    ).then((payload) => parseYouTubeComments(payload, "Bright Data YouTube Comments API", budget.youtubeCommentParseLimit)),
  );

  const settled = await Promise.allSettled(tasks);
  const enriched = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  return filterSignalsByTimeWindow(enriched, windowConfig);
}

function extractXPostUrls(signals: MarketSignal[]) {
  return Array.from(
    new Set(
      signals
        .map((signal) => canonicalXPostUrl(signal.url))
        .filter((url): url is string => Boolean(url)),
    ),
  );
}

function extractLinkedInPostUrls(signals: MarketSignal[]) {
  return Array.from(
    new Set(
      signals
        .map((signal) => canonicalLinkedInPostUrl(signal.url))
        .filter((url): url is string => Boolean(url)),
    ),
  );
}

function extractYouTubeVideoUrls(signals: MarketSignal[]) {
  return Array.from(
    new Set(
      signals
        .map((signal) => canonicalYouTubeVideoUrl(signal.url))
        .filter((url): url is string => Boolean(url)),
    ),
  );
}

function buildXSearchQueries(queries: string[]) {
  return expandSocialDiscoveryQueries(queries)
    .map((query) => `(${query}) (site:x.com OR site:twitter.com)`);
}

function buildRedditSearchQueries(queries: string[]) {
  return expandSocialDiscoveryQueries(queries)
    .map((query) => `(${query}) site:reddit.com`);
}

function buildRedditKeywordQueries(queries: string[]) {
  return expandSocialDiscoveryQueries(queries)
    .map((query) => query.replace(/\bsite:[^\s)]+/gi, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function buildLinkedInSearchQueries(queries: string[]) {
  return expandSocialDiscoveryQueries(queries)
    .map((query) => `(${query}) (site:linkedin.com/posts OR site:linkedin.com/feed/update OR site:linkedin.com/pulse)`);
}

function buildYouTubeSearchQueries(queries: string[]) {
  return expandDiscoveryQueries(queries)
    .map((query) => `(${query}) (site:youtube.com/watch OR site:youtu.be OR site:youtube.com/shorts)`);
}

function expandDiscoveryQueries(queries: string[]) {
  const expanded = new Set<string>();
  for (const query of queries) {
    const cleaned = query.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      continue;
    }
    expanded.add(cleaned);
    expanded.add(`${cleaned} pain points`);
    expanded.add(`${cleaned} positive reviews`);
    expanded.add(`${cleaned} recommendations`);
    expanded.add(`${cleaned} testimonials`);
    expanded.add(`${cleaned} success stories`);
    expanded.add(`${cleaned} works well`);
    expanded.add(`${cleaned} implementation complaints`);
    expanded.add(`${cleaned} implementation problems`);
    expanded.add(`${cleaned} pricing complaints`);
    expanded.add(`${cleaned} alternatives comparison`);
    expanded.add(`${cleaned} customer reviews`);
  }
  return Array.from(expanded);
}

function expandSocialDiscoveryQueries(queries: string[]) {
  const expanded = new Set<string>();
  for (const query of queries) {
    const cleaned = query.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      continue;
    }
    expanded.add(cleaned);
    expanded.add(`${cleaned} customer feedback`);
    expanded.add(`${cleaned} user feedback`);
    expanded.add(`${cleaned} people are saying`);
    expanded.add(`${cleaned} discussion`);
    expanded.add(`${cleaned} thread`);
    expanded.add(`${cleaned} comments`);
    expanded.add(`${cleaned} experience`);
    expanded.add(`${cleaned} anyone using`);
    expanded.add(`${cleaned} worth it`);
    expanded.add(`${cleaned} recommend`);
    expanded.add(`${cleaned} love`);
    expanded.add(`${cleaned} hate`);
    expanded.add(`${cleaned} problem`);
    expanded.add(`${cleaned} complaints`);
    expanded.add(`${cleaned} alternatives`);
    expanded.add(`${cleaned} switched from`);
  }
  return Array.from(expanded);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean)));
}

function timeWindowConfig(timeWindow: TimeWindow): TimeWindowConfig {
  const now = new Date();
  const cutoff = new Date(now);
  switch (timeWindow) {
    case "30d":
      cutoff.setDate(cutoff.getDate() - 30);
      return {
        timeWindow,
        cutoff,
        daysBack: 30,
        googleAfter: formatDate(cutoff),
        redditDate: "Past month",
      };
    case "90d":
      cutoff.setDate(cutoff.getDate() - 90);
      return {
        timeWindow,
        cutoff,
        daysBack: 90,
        googleAfter: formatDate(cutoff),
        redditDate: "Past year",
      };
    case "6m":
      cutoff.setMonth(cutoff.getMonth() - 6);
      return {
        timeWindow,
        cutoff,
        daysBack: Math.ceil((now.getTime() - cutoff.getTime()) / 86_400_000),
        googleAfter: formatDate(cutoff),
        redditDate: "Past year",
      };
    case "1y":
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      return {
        timeWindow,
        cutoff,
        daysBack: Math.ceil((now.getTime() - cutoff.getTime()) / 86_400_000),
        googleAfter: formatDate(cutoff),
        redditDate: "Past year",
      };
  }
}

function withGoogleTimeFilter(query: string, windowConfig: TimeWindowConfig) {
  return `${query} after:${windowConfig.googleAfter}`;
}

function filterSignalsByTimeWindow(signals: MarketSignal[], windowConfig: TimeWindowConfig) {
  return signals.filter((signal) => {
    const publishedAt = parsePublishedAt(signal.publishedAt);
    return !publishedAt || publishedAt >= windowConfig.cutoff;
  });
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function canonicalRedditPostUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("reddit.com")) {
      return null;
    }
    const match = parsed.pathname.match(/^(\/r\/[^/]+\/comments\/[^/]+)(?:\/[^/]+)?\/?/i);
    if (!match) {
      return null;
    }
    return `https://www.reddit.com${match[1]}/`;
  } catch {
    return null;
  }
}

function canonicalXPostUrl(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").replace(/^mobile\./, "").toLowerCase();
    if (hostname !== "x.com" && hostname !== "twitter.com") {
      return null;
    }
    const standard = parsed.pathname.match(/^\/([^/]+)\/status(?:es)?\/(\d+)/i);
    if (standard) {
      return `https://x.com/${standard[1]}/status/${standard[2]}`;
    }
    const webStatus = parsed.pathname.match(/^\/i\/web\/status\/(\d+)/i);
    if (webStatus) {
      return `https://x.com/i/web/status/${webStatus[1]}`;
    }
    return null;
  } catch {
    return null;
  }
}

function canonicalLinkedInPostUrl(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (!hostname.endsWith("linkedin.com")) {
      return null;
    }

    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (/^\/posts\/[^/]+/i.test(pathname) || /^\/feed\/update\/[^/]+/i.test(pathname) || /^\/pulse\/[^/]+/i.test(pathname)) {
      return `https://www.linkedin.com${pathname}`;
    }
    return null;
  } catch {
    return null;
  }
}

function canonicalYouTubeVideoUrl(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "").toLowerCase();
    let videoId = "";

    if (hostname === "youtu.be") {
      videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
    } else if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
      videoId = parsed.searchParams.get("v") || "";
      if (!videoId) {
        const match = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i);
        videoId = match?.[1] || "";
      }
    }

    if (!/^[a-z0-9_-]{6,}$/i.test(videoId)) {
      return null;
    }
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return null;
  }
}

function parseRedditPosts(payload: unknown, limit = 12): MarketSignal[] {
  return asRecordArray(payload).slice(0, limit).flatMap((item, index) => {
    const url = String(item.url || "");
    const title = String(item.title || "Reddit post");
    const description = String(item.description || item.post_text || item.headline || "");
    if (!url || !title) {
      return [];
    }
    const community = String(item.community_name || "");
    const comments = Number(item.num_comments || 0);
    const upvotes = Number(item.num_upvotes || 0);
    const publishedAt = dateField(item, ["date_posted", "created_at", "published_at", "date"]);
    const metrics = compactText([community ? `r/${community}` : "", comments ? `${comments.toLocaleString()} comments` : "", upvotes ? `${upvotes.toLocaleString()} upvotes` : ""]);
    return [{
      sourceId: createSourceId("reddit-post", index, url),
      title,
      url,
      snippet: truncate(compactText([description, metrics]), 900),
      sourceType: "reddit_post",
      query: "Bright Data Reddit Posts API",
      publishedAt,
      confidence: 88,
      domain: hostFromUrl(url),
      position: index + 1,
    }];
  });
}

function parseRedditComments(payload: unknown, limit = 30): MarketSignal[] {
  return asRecordArray(payload)
    .filter((item) => String(item.comment || "").trim().length > 20)
    .sort((a, b) => Number(b.num_upvotes || 0) - Number(a.num_upvotes || 0))
    .slice(0, limit)
    .map((item, index) => {
      const url = String(item.url || item.post_url || "");
      const comment = String(item.comment || "");
      const community = String(item.community_name || "");
      const upvotes = Number(item.num_upvotes || 0);
      const replies = Number(item.num_replies || 0);
      const publishedAt = dateField(item, ["date_posted", "created_at", "published_at", "date"]);
      const metrics = compactText([community ? `r/${community}` : "", upvotes ? `${upvotes.toLocaleString()} upvotes` : "", replies ? `${replies.toLocaleString()} replies` : ""]);
      return {
        sourceId: createSourceId("reddit-comment", index, `${url}-${comment}`),
        title: `Reddit comment${community ? ` in r/${community}` : ""}`,
        url,
        snippet: truncate(compactText([comment, metrics]), 900),
        sourceType: "reddit_comment",
        query: "Bright Data Reddit Comments API",
        publishedAt,
        confidence: 92,
        domain: hostFromUrl(url),
        position: index + 1,
      };
    });
}

function parseXPosts(payload: unknown, query = "Bright Data X Posts API", limit = 24): MarketSignal[] {
  return asRecordArray(payload)
    .filter((item) => String(item.description || item.text || item.post_text || item.content || "").trim().length > 20)
    .sort((a, b) => Number(b.likes || 0) + Number(b.replies || 0) - (Number(a.likes || 0) + Number(a.replies || 0)))
    .slice(0, limit)
    .map((item, index) => {
      const user = String(item.user_posted || item.user_name || item.username || item.name || "").replace(/^@/, "");
      const id = String(item.id || item.post_id || "");
      const url = String(item.url || (user && id ? `https://x.com/${user}/status/${id}` : ""));
      const description = String(item.description || item.text || item.post_text || item.content || "");
      const isReply = isLikelyXReply(item);
      const sourceType: MarketSignal["sourceType"] = isReply ? "x_comment" : "x_post";
      const replies = Number(item.replies || item.reply_count || 0);
      const reposts = Number(item.reposts || item.retweets || item.retweet_count || 0);
      const likes = Number(item.likes || item.like_count || 0);
      const views = Number(item.views || item.view_count || 0);
      const publishedAt = dateField(item, ["date_posted", "created_at", "published_at", "date"]);
      const metrics = compactText([
        user ? `@${user}` : "",
        replies ? `${replies.toLocaleString()} replies` : "",
        reposts ? `${reposts.toLocaleString()} reposts` : "",
        likes ? `${likes.toLocaleString()} likes` : "",
        views ? `${views.toLocaleString()} views` : "",
      ]);
      return {
        sourceId: createSourceId(sourceType, index, `${url}-${description}`),
        title: `${isReply ? "X reply" : "X post"}${user ? ` by @${user}` : ""}`,
        url,
        snippet: truncate(compactText([description, metrics]), 900),
        sourceType,
        query,
        publishedAt,
        confidence: isReply ? 90 : 86,
        domain: hostFromUrl(url),
        position: index + 1,
      };
    })
    .filter((signal) => signal.url);
}

function isLikelyXReply(item: Record<string, unknown>) {
  const id = String(item.id || item.post_id || "");
  const parent = item.parent_post_details;
  if (parent && typeof parent === "object") {
    const parentId = String((parent as Record<string, unknown>).post_id || (parent as Record<string, unknown>).id || "");
    if (parentId && id && parentId !== id) {
      return true;
    }
  }
  return Boolean(
    item.in_reply_to_status_id ||
    item.reply_to_status_id ||
    item.in_reply_to_user_id ||
    item.replying_to ||
    item.is_reply,
  );
}

function parseLinkedInPosts(payload: unknown, query = "Bright Data LinkedIn Posts API", limit = 18): MarketSignal[] {
  return asRecordArray(payload)
    .filter((item) => String(item.post_text || item.description || item.text || item.content || item.title || "").trim().length > 20)
    .sort((a, b) => Number(b.num_likes || 0) + Number(b.num_comments || 0) - (Number(a.num_likes || 0) + Number(a.num_comments || 0)))
    .slice(0, limit)
    .map((item, index) => {
      const input = item.input && typeof item.input === "object" ? item.input as Record<string, unknown> : {};
      const rawUrl = String(item.url || input.url || "");
      const url = canonicalLinkedInPostUrl(rawUrl) || rawUrl;
      const author = String(item.user_name || item.author || item.company_name || item.user_id || "");
      const title = String(item.title || item.headline || "LinkedIn post");
      const text = String(item.post_text || item.description || item.text || item.content || title);
      const likes = Number(item.num_likes || item.likes || 0);
      const comments = Number(item.num_comments || item.comments || item.top_visible_comments || 0);
      const followers = Number(item.user_followers || item.followers || 0);
      const publishedAt = dateField(item, ["date_posted", "created_at", "published_at", "date"]);
      const metrics = compactText([
        author,
        likes ? `${likes.toLocaleString()} likes` : "",
        comments ? `${comments.toLocaleString()} comments` : "",
        followers ? `${followers.toLocaleString()} followers` : "",
      ]);
      return {
        sourceId: createSourceId("linkedin-post", index, `${url}-${text}`),
        title: `${title}${author ? ` by ${author}` : ""}`,
        url,
        snippet: truncate(compactText([text, metrics]), 900),
        sourceType: "linkedin_post" as const,
        query,
        publishedAt,
        confidence: 84,
        domain: hostFromUrl(url),
        position: index + 1,
      };
    })
    .filter((signal) => signal.url);
}

function parseYouTubeVideos(payload: unknown, query = "Bright Data YouTube Videos API", limit = 12): MarketSignal[] {
  return asRecordArray(payload)
    .filter((item) => String(item.description || item.transcript || item.title || "").trim().length > 20)
    .sort((a, b) => Number(b.views || 0) + Number(b.num_comments || 0) - (Number(a.views || 0) + Number(a.num_comments || 0)))
    .slice(0, limit)
    .map((item, index) => {
      const input = item.input && typeof item.input === "object" ? item.input as Record<string, unknown> : {};
      const rawUrl = String(item.url || item.video_url || input.url || "");
      const url = canonicalYouTubeVideoUrl(rawUrl) || rawUrl;
      const title = String(item.title || item.video_title || "YouTube video");
      const channel = String(item.youtuber || item.handle_name || item.channel_name || "");
      const description = String(item.description || item.transcript || item.text || "");
      const views = Number(item.views || item.view_count || 0);
      const likes = Number(item.likes || item.like_count || 0);
      const comments = Number(item.num_comments || item.comments || item.comment_count || 0);
      const publishedAt = dateField(item, ["date_posted", "created_at", "published_at", "date"]);
      const metrics = compactText([
        channel,
        views ? `${views.toLocaleString()} views` : "",
        likes ? `${likes.toLocaleString()} likes` : "",
        comments ? `${comments.toLocaleString()} comments` : "",
      ]);
      return {
        sourceId: createSourceId("youtube-video", index, `${url}-${title}`),
        title: `YouTube video: ${title}`,
        url,
        snippet: truncate(compactText([description || title, metrics]), 900),
        sourceType: "youtube_video" as const,
        query,
        publishedAt,
        confidence: 82,
        domain: hostFromUrl(url),
        position: index + 1,
      };
    })
    .filter((signal) => signal.url);
}

function parseYouTubeComments(payload: unknown, query = "Bright Data YouTube Comments API", limit = 30): MarketSignal[] {
  return asRecordArray(payload)
    .filter((item) => String(item.comment_text || item.comment || item.text || item.content || "").trim().length > 20)
    .sort((a, b) => Number(b.likes || 0) + Number(b.replies || 0) - (Number(a.likes || 0) + Number(a.replies || 0)))
    .slice(0, limit)
    .map((item, index) => {
      const rawUrl = String(item.url || item.video_url || "");
      const url = canonicalYouTubeVideoUrl(rawUrl) || rawUrl;
      const comment = String(item.comment_text || item.comment || item.text || item.content || "");
      const username = String(item.username || item.author || item.user_name || "");
      const likes = Number(item.likes || item.like_count || 0);
      const replies = Number(item.replies || item.reply_count || 0);
      const publishedAt = dateField(item, ["date", "date_posted", "created_at", "published_at"]);
      const metrics = compactText([
        username,
        likes ? `${likes.toLocaleString()} likes` : "",
        replies ? `${replies.toLocaleString()} replies` : "",
      ]);
      return {
        sourceId: createSourceId("youtube-comment", index, `${url}-${item.comment_id || comment}`),
        title: `YouTube comment${username ? ` by ${username}` : ""}`,
        url,
        snippet: truncate(compactText([comment, metrics]), 900),
        sourceType: "youtube_comment" as const,
        query,
        publishedAt,
        confidence: 90,
        domain: hostFromUrl(url),
        position: index + 1,
      };
    })
    .filter((signal) => signal.url);
}

function parseMcpSearchResult(text: string, query: string, limit = 8): MarketSignal[] {
  const parsed = parseMcpPayload(text);
  const structured = parseSerpPayload(parsed, query, limit);
  if (structured.length > 0) {
    return structured.map((signal) => ({
      ...signal,
      sourceId: createSourceId(`mcp-${query}`, signal.position || 0, signal.url),
      query: `Bright Data MCP search_engine: ${query}`,
      confidence: Math.max(signal.confidence, 76),
    }));
  }

  return parseMcpMarkdownSearch(text, query);
}

function parseMcpMarkdownSearch(text: string, query: string) {
  const signals: MarketSignal[] = [];
  const seen = new Set<string>();
  const markdownLinkPattern = /\[([^\]]+)]\((https?:\/\/[^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = markdownLinkPattern.exec(text)) && signals.length < 8) {
    const title = stripMarkdown(match[1]);
    const url = match[2];
    if (!title || seen.has(url) || shouldSkipSerpUrl(url)) {
      continue;
    }
    const snippet = nearbyText(text, markdownLinkPattern.lastIndex);
    seen.add(url);
    signals.push({
      sourceId: createSourceId(`mcp-${query}`, signals.length, url),
      title: truncate(title, 140),
      url,
      snippet: truncate(snippet || `Search result for ${query}`, 520),
      sourceType: "serp",
      query: `Bright Data MCP search_engine: ${query}`,
      confidence: 76,
      domain: hostFromUrl(url),
      position: signals.length + 1,
    });
  }

  if (signals.length > 0) {
    return signals;
  }

  const urlPattern = /(https?:\/\/[^\s)]+)/g;
  while ((match = urlPattern.exec(text)) && signals.length < 8) {
    const url = match[1].replace(/[.,;]+$/, "");
    if (seen.has(url) || shouldSkipSerpUrl(url)) {
      continue;
    }
    seen.add(url);
    signals.push({
      sourceId: createSourceId(`mcp-${query}`, signals.length, url),
      title: `Search result from ${hostFromUrl(url)}`,
      url,
      snippet: truncate(nearbyText(text, match.index) || `Search result for ${query}`, 520),
      sourceType: "serp",
      query: `Bright Data MCP search_engine: ${query}`,
      confidence: 70,
      domain: hostFromUrl(url),
      position: signals.length + 1,
    });
  }

  return signals;
}

function toolResultText(result: unknown) {
  const record = result as { content?: Array<Record<string, unknown>>; structuredContent?: unknown; toolResult?: unknown };
  if (record.structuredContent) {
    return JSON.stringify(record.structuredContent);
  }
  if (record.toolResult) {
    return typeof record.toolResult === "string" ? record.toolResult : JSON.stringify(record.toolResult);
  }
  return (record.content || [])
    .map((item) => {
      if (item.type === "text") {
        return String(item.text || "");
      }
      if (item.type === "resource" && item.resource && typeof item.resource === "object") {
        return String((item.resource as { text?: string }).text || "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function parseMcpPayload(text: string) {
  const parsed = parseNestedJson(text);
  if (parsed) {
    return parsed;
  }
  return text;
}

function titleFromMarkdown(markdown: string) {
  const heading = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#{1,2}\s+\S/.test(line));
  return heading ? stripMarkdown(heading.replace(/^#{1,2}\s+/, "")) : "";
}

function excerptFromMarkdown(markdown: string) {
  return stripMarkdown(markdown)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 40 && !/^https?:\/\//.test(line))
    .slice(0, 4)
    .join(" ");
}

function nearbyText(text: string, index: number) {
  return stripMarkdown(text.slice(index, index + 600))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
}

function stripMarkdown(value: string) {
  return value
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asRecordArray(payload: unknown) {
  return Array.isArray(payload) ? payload.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
}

function compactText(parts: string[]) {
  return parts.filter(Boolean).join(" · ");
}

function dateField(item: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const parsed = parsePublishedAt(item[field]);
    if (parsed) {
      return parsed.toISOString();
    }
  }
  return undefined;
}

function dateFromText(value: string) {
  const parsed = parsePublishedAt(value);
  return parsed ? parsed.toISOString() : undefined;
}

function parsePublishedAt(value: unknown) {
  if (!value) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const direct = new Date(text);
  if (Number.isFinite(direct.getTime())) {
    return direct;
  }

  const relative = text.match(/(?:^|\b)(\d+)\s+(hour|day|week|month|year)s?\s+ago(?:\b|$)/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const date = new Date();
    if (unit === "hour") date.setHours(date.getHours() - amount);
    if (unit === "day") date.setDate(date.getDate() - amount);
    if (unit === "week") date.setDate(date.getDate() - amount * 7);
    if (unit === "month") date.setMonth(date.getMonth() - amount);
    if (unit === "year") date.setFullYear(date.getFullYear() - amount);
    return date;
  }

  const monthDate = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i);
  if (monthDate) {
    const parsed = new Date(monthDate[0]);
    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function parseSerpPayload(payload: unknown, query: string, limit = 8): MarketSignal[] {
  if (payload && typeof payload === "object" && typeof (payload as { body?: unknown }).body === "string") {
    const body = (payload as { body: string }).body;
    const nestedJson = parseNestedJson(body);
    if (nestedJson) {
      const nestedSignals = parseSerpPayload(nestedJson, query, limit);
      if (nestedSignals.length > 0) {
        return nestedSignals;
      }
    }

    const htmlSignals = parseGoogleHtml(body, query, limit);
    if (htmlSignals.length > 0) {
      return htmlSignals;
    }
  }

  const organic = extractOrganicItems(payload) || [];
  return organic.slice(0, limit).map((item, index) => {
    const url = String(item.link || item.url || item.href || "");
    const title = String(item.title || item.name || `Result for ${query}`);
    const snippet = String(item.description || item.snippet || item.text || "");
    const publishedAt = dateField(item, ["date", "date_posted", "created_at", "published_at"]) || dateFromText(`${title} ${snippet}`);
    return {
      sourceId: createSourceId(query, index, url),
      title,
      url,
      snippet: truncate(snippet, 520),
      sourceType: "serp",
      query,
      publishedAt,
      confidence: 72,
      domain: hostFromUrl(url),
      position: index + 1,
    };
  });
}

function parseNestedJson(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function parseGoogleHtml(html: string, query: string, limit = 8): MarketSignal[] {
  const signals: MarketSignal[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\s+[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) && signals.length < limit) {
    const url = decodeHtml(match[1]);
    if (seen.has(url) || shouldSkipSerpUrl(url)) {
      continue;
    }

    const anchorHtml = match[2];
    if (!/<h3[\s>]/i.test(anchorHtml)) {
      continue;
    }

    const title = truncate(stripHtml(decodeHtml(anchorHtml)), 140);
    if (!title || title.length < 8) {
      continue;
    }

    const nextChunk = html.slice(anchorPattern.lastIndex, anchorPattern.lastIndex + 900);
    const snippet = truncate(stripHtml(decodeHtml(nextChunk)), 420);

    seen.add(url);
    signals.push({
      sourceId: createSourceId(query, signals.length, url),
      title,
      url,
      snippet: snippet || `Search result for ${query}`,
      sourceType: "serp",
      query,
      publishedAt: dateFromText(`${title} ${snippet}`),
      confidence: 68,
      domain: hostFromUrl(url),
      position: signals.length + 1,
    });
  }

  return signals;
}

function dedupeSignals(signals: MarketSignal[]) {
  const seen = new Set<string>();
  const unique: MarketSignal[] = [];

  for (const signal of signals) {
    const key = normalizeSignalUrl(signal.url) || signal.sourceId;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(signal);
  }

  return unique;
}

function normalizeSignalUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const param of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ved", "usg"]) {
      parsed.searchParams.delete(param);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function createSourceId(query: string, index: number, url: string) {
  const digest = createHash("sha256").update(`${query}\n${index}\n${url}`).digest("hex").slice(0, 12);
  return `src_${digest}`;
}

function shouldSkipSerpUrl(url: string) {
  const domain = hostFromUrl(url);
  return (
    domain === "google.com" ||
    domain.endsWith(".google.com") ||
    domain === "gstatic.com" ||
    domain.endsWith(".gstatic.com") ||
    domain === "accounts.google.com"
  );
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readLimitedText(response: Response, maxBytes: number) {
  if (!response.body) {
    return response.text();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > maxBytes) {
      output += decoder.decode(value.slice(0, Math.max(0, value.byteLength - (received - maxBytes))), { stream: false });
      await reader.cancel();
      break;
    }
    output += decoder.decode(value, { stream: true });
  }

  output += decoder.decode();
  return output;
}

export function demoSignals(queries: string[]): MarketSignal[] {
  const query = queries[0] || "customer pain points";
  return [
    {
      sourceId: "demo_1",
      title: "Reddit search: Customers compare alternatives and recurring problems",
      url: `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`,
      snippet:
        "Public discussions often surface adoption friction, confusing claims, pricing concerns, support gaps, and comparisons with better-known alternatives.",
      sourceType: "demo",
      query,
      confidence: 45,
      domain: "reddit.com",
      position: 1,
    },
    {
      sourceId: "demo_2",
      title: "Community discussion: Product claims need clearer proof",
      url: "https://news.ycombinator.com/",
      snippet:
        "Commenters commonly ask whether products can prove outcomes, integrate with existing habits, and avoid adding complexity for users or buyers.",
      sourceType: "demo",
      query,
      confidence: 42,
      domain: "news.ycombinator.com",
      position: 2,
    },
    {
      sourceId: "demo_3",
      title: "Review roundup: Buyers want easier evaluation and onboarding",
      url: "https://www.g2.com/",
      snippet:
        "Reviews frequently mention setup effort, unclear ROI, implementation delays, missing integrations, and uneven customer support.",
      sourceType: "demo",
      query,
      confidence: 41,
      domain: "g2.com",
      position: 3,
    },
    {
      sourceId: "demo_4",
      title: "Forum post: Users share manual workarounds",
      url: "https://www.reddit.com/",
      snippet:
        "Users often describe spreadsheets, email threads, screenshots, manual exports, and extra review steps when products do not fit their exact process.",
      sourceType: "demo",
      query,
      confidence: 39,
      domain: "reddit.com",
      position: 4,
    },
    {
      sourceId: "demo_5",
      title: "Discussion: Trust and evidence drive buying decisions",
      url: "https://www.reddit.com/search/?q=product%20reviews%20trust%20evidence",
      snippet:
        "Buyers and users often look for proof from peers, published evidence, third-party validation, and transparent limitations before trusting a vendor.",
      sourceType: "demo",
      query,
      confidence: 38,
      domain: "reddit.com",
      position: 5,
    },
    {
      sourceId: "demo_6",
      title: "Review thread: Support and reliability shape satisfaction",
      url: "https://www.g2.com/",
      snippet:
        "Users say response quality, reliability, downtime, confusing documentation, and slow issue resolution can outweigh otherwise strong product value.",
      sourceType: "demo",
      query,
      confidence: 37,
      domain: "g2.com",
      position: 6,
    },
    {
      sourceId: "demo_7",
      title: "Community question: What makes switching worth it?",
      url: "https://www.producthunt.com/",
      snippet:
        "Potential customers compare switching cost, migration risk, learning curve, integrations, and whether the product is meaningfully better than status quo.",
      sourceType: "demo",
      query,
      confidence: 36,
      domain: "producthunt.com",
      position: 7,
    },
    {
      sourceId: "demo_8",
      title: "HN discussion: Simple products versus complex platforms",
      url: "https://news.ycombinator.com/",
      snippet:
        "Commenters compare focused products with broader platforms, favoring clear value, lower friction, transparent pricing, and trustworthy execution.",
      sourceType: "demo",
      query,
      confidence: 35,
      domain: "news.ycombinator.com",
      position: 8,
    },
  ];
}
