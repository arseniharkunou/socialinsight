import type { PainRadarReport } from "@/lib/types";

export function reportTitle(report: PainRadarReport) {
  if (report.analysisMode === "category") {
    return (
      cleanCategoryTitle(categoryFromExecutiveSummary(report.executiveSummary)) ||
      cleanCategoryTitle(report.market.category) ||
      cleanCategoryTitle(report.market.productName) ||
      "Market intelligence report"
    );
  }

  const company = cleanCompanyTitle(report.market.productName) || cleanCompanyTitle(report.analyzedUrl);
  const summaryCategory = cleanCategoryTitle(categoryFromExecutiveSummary(report.executiveSummary));
  const marketCategory = cleanCategoryTitle(report.market.category);
  const category = categoryConflict(summaryCategory, marketCategory, report.executiveSummary) ? summaryCategory : summaryCategory || marketCategory;
  if (company && category) {
    return `${company}: ${category}`;
  }
  return company || category || "Market intelligence report";
}

export function displayExecutiveSummary(summary: string) {
  return summary
    .replace(/,\s+not\s+[^.]+?\s+(?:software|platform|product|company|category|market|app|tool|provider)\./gi, ".")
    .replace(/\s+not\s+(?:a|an|the)\s+[^.]+?\s+(?:software|platform|product|company|category|market|app|tool|provider)\./gi, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanReportTitle(value: string) {
  const cleaned = value
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[/?#].*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || /^(unknown|n\/a|not available|null|undefined)$/i.test(cleaned)) {
    return "";
  }

  return cleaned;
}

function cleanCompanyTitle(value: string) {
  const cleaned = cleanReportTitle(value);
  if (!cleaned) {
    return "";
  }

  try {
    const host = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, "");
    if (host.includes(".")) {
      return titleCaseDisplay(host.split(".")[0] || cleaned);
    }
  } catch {
    // Plain product or company name.
  }

  return titleCaseDisplay(cleaned.replace(/\s+category$/i, ""));
}

function cleanCategoryTitle(value: string) {
  const cleaned = cleanReportTitle(value).replace(/\s+category$/i, "").trim();
  if (!cleaned || looksLikeDomain(cleaned) || isGenericMarketTitle(cleaned)) {
    return "";
  }
  return titleCaseDisplay(cleaned);
}

function isGenericMarketTitle(value: string) {
  return /^(general product or company market|market intelligence|target product|product or company market)$/i.test(value.trim());
}

function categoryConflict(summaryCategory: string, marketCategory: string, summary: string) {
  if (!summaryCategory || !marketCategory || summaryCategory === marketCategory) {
    return false;
  }

  const normalizedMarket = marketCategory.toLowerCase();
  if (/not\s+[^.]*\bhr\b/i.test(summary) && /\b(?:hr|workforce)\b/i.test(marketCategory)) {
    return true;
  }

  return new RegExp(`\\bnot\\s+(?:a|an|the\\s+)?${escapeRegExp(normalizedMarket).replace(/\s+/g, "\\s+")}`, "i").test(summary);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksLikeDomain(value: string) {
  return /(?:^|\s)[a-z0-9-]+\.[a-z]{2,}(?:\s|$)/i.test(value);
}

function titleCaseDisplay(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => {
      if (/^(ai|api|ccta|cta|ct|ffrct|mri|ehr|crm)$/i.test(word)) {
        return word.toUpperCase();
      }
      if (/^(and|or|for|of|the|to|in|with)$/i.test(word)) {
        return word.toLowerCase();
      }
      if (/[A-Z]/.test(word.slice(1)) || word.includes("/") || word.includes("&")) {
        return word;
      }
      return word.replace(/^\w/, (c) => c.toUpperCase());
    })
    .join(" ");
}

export function categoryFromExecutiveSummary(summary: string) {
  const patterns = [
    /\bsupported\s+category\s+is\s+(.+?)(?:,\s+with\b|,\s+but\b|,\s+while\b|\.|;|\n|$)/i,
    /\bsupported\s+market\s+is\s+(.+?)(?:,\s+with\b|,\s+but\b|,\s+while\b|\.|;|\n|$)/i,
    /\bcategory\s+is\s+(.+?)(?:,\s+with\b|,\s+but\b|,\s+while\b|\.|;|\n|$)/i,
    /\bsupport\s+.+?\s+as\s+(?:a|an)\s+(.+?\s+provider)\b/i,
    /\bpositions?\s+.+?\s+as\s+(?:a|an)\s+(.+?\s+provider)\b/i,
    /\bsupport\s+.+?\s+as\s+(?:a|an)\s+(.+?)(?:\s+provider\b|\s+company\b|\s+platform\b|\s+product\b|\s+category\b|,\s+not\b|\s+rather\s+than\b|\.|;|\n|$)/i,
    /\bpositions?\s+.+?\s+as\s+(?:a|an)\s+(.+?)(?:\s+provider\b|\s+company\b|\s+platform\b|\s+product\b|\s+category\b|,\s+not\b|\s+rather\s+than\b|\.|;|\n|$)/i,
    /\bappears\s+to\s+be\s+(?:a|an)\s+(.+?)(?:\s+company\b|\s+platform\b|\s+product\b|\s+category\b|,\s+not\b|\s+rather\s+than\b|\.|;|\n|$)/i,
    /\bappears\s+to\s+compete\s+in\s+(.+?)(?:\s+rather\s+than\b|\.|;|\n|$)/i,
    /\bcompetes?\s+in\s+(.+?)(?:\s+rather\s+than\b|\.|;|\n|$)/i,
    /\bas\s+a\s+(.+?)\s+category\b/i,
    /\bas\s+an\s+(.+?)\s+category\b/i,
    /\bbest evaluated as\s+(.+?)(?:\.|,|;|\n|$)/i,
  ];

  for (const pattern of patterns) {
    const match = summary.match(pattern);
    if (match?.[1]) {
      return match[1]
        .replace(/\bAI\s+model\/platform\b/i, "AI model and developer platform")
        .replace(/\bmodel\/platform\b/i, "model and developer platform")
        .replace(/\s+provider$/i, "")
        .replace(/\s+centered\s+on\b.*$/i, "")
        .replace(/\s+focused\s+on\b.*$/i, "")
        .replace(/,\s+not\b.*$/i, "")
        .replace(/\s+not\s+(?:a|an|the)\b.*$/i, "")
        .replace(/\s+(?:company|product|market)$/i, "")
        .trim();
    }
  }

  return "";
}
