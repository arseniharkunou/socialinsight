import type { Evidence, SentimentTrend, TimeWindow } from "@/lib/types";

const POSITIVE_SENTIMENT_TERMS = [
  "accurate",
  "appreciate",
  "best",
  "better",
  "case study",
  "delighted",
  "easy",
  "easy to use",
  "effective",
  "efficient",
  "excellent",
  "fast",
  "favorite",
  "good",
  "great",
  "happy",
  "helpful",
  "highly recommend",
  "impressed",
  "impressive",
  "improved",
  "love",
  "loved",
  "positive",
  "prefer",
  "productive",
  "recommend",
  "recommended",
  "recommendation",
  "reliable",
  "saves",
  "saves time",
  "success",
  "success story",
  "solved",
  "strong",
  "testimonial",
  "useful",
  "valuable",
  "works great",
  "works well",
];

const NEGATIVE_SENTIMENT_TERMS = [
  "bad",
  "broken",
  "bug",
  "can't",
  "complaint",
  "complex",
  "concern",
  "confusing",
  "costly",
  "delay",
  "difficult",
  "doesn't",
  "expensive",
  "failed",
  "friction",
  "frustrating",
  "hard",
  "hate",
  "issue",
  "limitation",
  "missing",
  "negative",
  "pain",
  "poor",
  "problem",
  "slow",
  "unreliable",
  "workaround",
  "worse",
];

export function buildSentimentTrend(sources: Evidence[], timeWindow: TimeWindow, generatedAt?: string): SentimentTrend {
  const end = parseDate(generatedAt) || new Date();
  const bucketCount = trendBucketCount(timeWindow);
  const start = timelineStart(end, timeWindow);
  const duration = Math.max(1, end.getTime() - start.getTime());
  const bucketMs = duration / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = new Date(start.getTime() + bucketMs * index);
    return {
      label: trendBucketLabel(bucketStart, timeWindow),
      positive: 0,
      negative: 0,
    };
  });

  let datedCount = 0;
  let excludedCount = 0;

  for (const source of sources) {
    const publishedAt = parseDate(source.publishedAt);
    if (!publishedAt || publishedAt < start || publishedAt > end) {
      excludedCount += 1;
      continue;
    }

    datedCount += 1;
    const sentiment = sourceSentiment(source);
    if (sentiment !== "positive" && sentiment !== "negative") {
      excludedCount += 1;
      continue;
    }

    const bucketIndex = Math.min(bucketCount - 1, Math.max(0, Math.floor((publishedAt.getTime() - start.getTime()) / bucketMs)));
    buckets[bucketIndex][sentiment] += 1;
  }

  return {
    buckets,
    positiveTotal: buckets.reduce((sum, bucket) => sum + bucket.positive, 0),
    negativeTotal: buckets.reduce((sum, bucket) => sum + bucket.negative, 0),
    datedCount,
    excludedCount,
  };
}

function sourceSentiment(source: Evidence) {
  const title = source.title.toLowerCase();
  const snippet = source.snippet.toLowerCase();
  const fullText = (source.fullText || "").toLowerCase();
  const query = (source.query || "").toLowerCase();
  const text = `${title} ${snippet} ${fullText}`;
  let positiveScore = countTermMatches(text, POSITIVE_SENTIMENT_TERMS);
  let negativeScore = countTermMatches(text, NEGATIVE_SENTIMENT_TERMS);

  if (/\b(?:4(?:\.\d+)?|5(?:\.0)?)\s*(?:\/\s*5|stars?|star rating)\b/i.test(text)) {
    positiveScore += 2;
  }
  if (/\b(?:1(?:\.\d+)?|2(?:\.\d+)?)\s*(?:\/\s*5|stars?|star rating)\b/i.test(text)) {
    negativeScore += 2;
  }
  if (/\b(?:not good|not great|does not work|doesn't work|cannot recommend|can't recommend)\b/i.test(text)) {
    negativeScore += 2;
  }
  if (/\b(?:recommend|recommended|recommendations|positive reviews|testimonials|success stories)\b/i.test(query)) {
    positiveScore += 1;
  }
  if (/\b(?:complaints|problems|issues|pain points|alternatives)\b/i.test(query)) {
    negativeScore += 1;
  }

  if (positiveScore > negativeScore) {
    return "positive";
  }
  if (negativeScore > positiveScore) {
    return "negative";
  }
  return "neutral";
}

function countTermMatches(text: string, terms: string[]) {
  return terms.reduce((count, term) => count + (new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(text) ? 1 : 0), 0);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trendBucketCount(timeWindow: TimeWindow) {
  if (timeWindow === "30d") return 30;
  if (timeWindow === "90d") return 13;
  if (timeWindow === "6m") return 6;
  return 12;
}

function timelineStart(end: Date, timeWindow: TimeWindow) {
  const start = new Date(end);
  if (timeWindow === "30d") start.setDate(start.getDate() - 30);
  if (timeWindow === "90d") start.setDate(start.getDate() - 90);
  if (timeWindow === "6m") start.setMonth(start.getMonth() - 6);
  if (timeWindow === "1y") start.setFullYear(start.getFullYear() - 1);
  return start;
}

function trendBucketLabel(date: Date, timeWindow: TimeWindow) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: timeWindow === "6m" || timeWindow === "1y" ? undefined : "numeric",
  });
}

function parseDate(value?: string) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
