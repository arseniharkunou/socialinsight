import type { AnalysisMode, MarketProfile } from "@/lib/types";

export function buildMarketProfile(target: string, websiteText = "", analysisMode: AnalysisMode = "company"): MarketProfile {
  if (analysisMode === "category") {
    return buildCategoryMarketProfile(target, websiteText);
  }

  const product = productNameFromTarget(target);
  const domain = domainFromTarget(target);
  const text = websiteText.toLowerCase();
  const category = inferMarketCategoryFromText(text);
  const categoryQueries = category === "General product or company market" ? [] : [
    `"${queryCategory(category)}" customer complaints`,
    `"${queryCategory(category)}" positive reviews`,
    `"${queryCategory(category)}" alternatives complaints reddit`,
    `"${queryCategory(category)}" recommended by users`,
  ];

  return {
    productName: product,
    category,
    marketDescription: marketDescription(category),
    targetUsers: targetUsers(category),
    jobsToBeDone: jobsToBeDone(category),
    searchQueries: [
      `"${product}" complaints OR frustrating OR problem`,
      `"${product}" reviews OR recommend OR love`,
      `"${product}" works well OR helpful OR reliable`,
      `"${product}" alternatives complaints`,
      `"${product}" feature request OR missing feature`,
      `"${product}" workaround OR hack OR manual`,
      `"${product}" reddit OR forum OR community`,
      ...(domain && domain !== product.toLowerCase() ? [
        `"${domain}" complaints OR reviews OR problems`,
        `"${domain}" positive reviews OR testimonials OR recommend`,
        `"${domain}" alternatives OR competitors`,
      ] : []),
      ...categoryQueries,
    ],
    negativeKeywords: ["jobs", "careers", "pricing page", "press release", "affiliate", "coupon"],
  };
}

export function marketDefaultsForCategory(category: string) {
  return {
    marketDescription: marketDescription(category),
    targetUsers: targetUsers(category),
    jobsToBeDone: jobsToBeDone(category),
  };
}

function buildCategoryMarketProfile(target: string, websiteText: string): MarketProfile {
  const specificTarget = looksLikeSpecificTarget(target);
  const inferredCategory = inferMarketCategoryFromText(websiteText.toLowerCase());
  const category = specificTarget && inferredCategory !== "General product or company market" ? inferredCategory : titleCaseName(target);
  const categoryQuery = queryCategory(category);
  const product = productNameFromTarget(target);
  const domain = domainFromTarget(target);
  const productQueries = specificTarget ? [
    `"${product}" competitors reviews complaints`,
    `"${product}" positive reviews recommendations`,
    `"${product}" alternatives reddit complaints`,
    ...(domain && domain !== product.toLowerCase() ? [`"${domain}" competitors alternatives reviews`] : []),
  ] : [];

  return {
    productName: specificTarget ? product : `${category} category`,
    category,
    marketDescription: `Companies and buyers competing in ${category}, with emphasis on customer sentiment, pain points, switching triggers, and competitor positioning.`,
    targetUsers: targetUsers(category),
    jobsToBeDone: jobsToBeDone(category),
    searchQueries: [
      ...productQueries,
      `"${categoryQuery}" competitors reviews complaints`,
      `"${categoryQuery}" positive reviews recommendations`,
      `"${categoryQuery}" alternatives reddit complaints`,
      `"${categoryQuery}" "best" "worst" reviews`,
      `"${categoryQuery}" G2 reviews pros cons`,
      `"${categoryQuery}" customer success stories`,
      `"${categoryQuery}" competitor comparison sentiment`,
      `"${categoryQuery}" "switching from" OR "migrated from"`,
      `"${categoryQuery}" "too expensive" OR "too complex"`,
      `"${categoryQuery}" "missing feature" OR "feature request"`,
    ],
    negativeKeywords: ["jobs", "careers", "pricing page", "press release", "affiliate", "coupon"],
  };
}

function looksLikeSpecificTarget(target: string) {
  return /^https?:\/\//i.test(target) || /^www\./i.test(target) || /(?:^|[^\s@])\.[a-z]{2,}(?:[/:?#]|$)/i.test(target);
}

export function inferMarketCategoryFromText(text: string) {
  if (hasAny(text, ["anthropic", "claude", "claude code", "large language model", "llm", "foundation model", "ai model", "ai assistant", "generative ai"])) {
    return "AI model and developer platform";
  }
  if (hasAny(text, ["cardiovascular imaging", "cardiac imaging", "coronary cta", "ccta", "ct fractional flow reserve", "ffrct", "heartflow"])) {
    return "AI cardiovascular imaging";
  }
  if (hasAny(text, ["cardiology", "heart disease", "cardiac", "medical", "clinical", "patient", "healthcare", "hospital", "physician", "diagnostic", "fda", "medicare"])) {
    return "Healthcare and medical technology";
  }
  if (hasAny(text, ["api", "developer", "sdk", "repository", "deploy", "code", "integration"])) {
    return "Developer tooling and API platform";
  }
  if (hasAny(text, ["shop", "commerce", "checkout", "storefront", "retail", "payments"])) {
    return "Commerce and online selling software";
  }
  if (hasAny(text, ["sales", "crm", "pipeline", "lead", "revenue", "prospect"])) {
    return "Sales and customer relationship software";
  }
  if (hasAny(text, ["support", "ticket", "helpdesk", "customer service", "chatbot"])) {
    return "Customer support software";
  }
  if (hasAny(text, ["security", "compliance", "risk", "privacy", "fraud", "identity", "authentication"])) {
    return "Security, compliance, and risk technology";
  }
  if (hasAny(text, ["analytics", "dashboard", "data", "insight", "reporting", "intelligence", "forecast"])) {
    return "Analytics and decision intelligence";
  }
  if (hasAny(text, ["education", "learning", "student", "course", "training", "school"])) {
    return "Education and learning products";
  }
  if (hasAny(text, ["recruiting", "hr", "payroll", "employee", "benefits", "talent"])) {
    return "HR and workforce technology";
  }
  return "General product or company market";
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function queryCategory(category: string) {
  return category
    .replace(/\band\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function marketDescription(category: string) {
  if (category === "AI model and developer platform") {
    return "AI users, developers, teams, and buyers evaluating model capability, reliability, workflow fit, safety, pricing, and integration tradeoffs.";
  }
  if (category === "Healthcare and medical technology") {
    return "Healthcare stakeholders evaluating products that affect clinical processes, patient outcomes, reimbursement, implementation, and operational adoption.";
  }
  if (category === "Developer tooling and API platform") {
    return "Technical teams evaluating tools for building, integrating, deploying, and maintaining software systems.";
  }
  if (category === "Commerce and online selling software") {
    return "Operators and growth teams managing online selling, checkout, fulfillment, and customer conversion operations.";
  }
  if (category === "Sales and customer relationship software") {
    return "Revenue teams managing pipeline, prospecting, account context, and customer relationship processes.";
  }
  if (category === "Customer support software") {
    return "Support and operations teams handling customer conversations, ticket queues, escalations, and service quality.";
  }
  if (category === "Security, compliance, and risk technology") {
    return "Security, compliance, legal, and operations teams evaluating products that reduce risk, improve trust, and simplify governance.";
  }
  if (category === "Analytics and decision intelligence") {
    return "Decision makers and analysts evaluating products that turn data into clearer, faster, and more defensible decisions.";
  }
  if (category === "Education and learning products") {
    return "Learners, educators, administrators, and training teams evaluating outcomes, engagement, accessibility, and operational fit.";
  }
  if (category === "HR and workforce technology") {
    return "People teams, managers, employees, and operators evaluating tools for hiring, employee operations, compliance, and workforce decisions.";
  }
  return "Customers, buyers, operators, and end users evaluating whether the product or company solves their problem reliably, affordably, and with acceptable tradeoffs.";
}

function targetUsers(category: string) {
  if (category === "AI model and developer platform") {
    return ["AI users", "Software engineers", "Developer experience teams", "Business and product teams"];
  }
  if (category === "Healthcare and medical technology") {
    return ["Clinicians", "Healthcare administrators", "Patients", "Payers and reimbursement teams"];
  }
  if (category === "Developer tooling and API platform") {
    return ["Software engineers", "Developer experience teams", "Engineering managers", "Platform teams"];
  }
  if (category === "Commerce and online selling software") {
    return ["E-commerce operators", "Growth marketers", "Store owners", "Customer operations teams"];
  }
  if (category === "Sales and customer relationship software") {
    return ["Sales leaders", "Account executives", "Revenue operations teams", "Customer success teams"];
  }
  if (category === "Customer support software") {
    return ["Support managers", "Customer support agents", "Operations leaders", "Customer success teams"];
  }
  if (category === "Security, compliance, and risk technology") {
    return ["Security teams", "Compliance leaders", "Operations leaders", "Business owners"];
  }
  if (category === "Analytics and decision intelligence") {
    return ["Analysts", "Business leaders", "Operations teams", "Domain experts"];
  }
  if (category === "Education and learning products") {
    return ["Learners", "Educators", "Training teams", "Administrators"];
  }
  if (category === "HR and workforce technology") {
    return ["People teams", "Hiring managers", "Employees", "Operations leaders"];
  }
  return ["Customers", "End users", "Buyers", "Operators"];
}

function jobsToBeDone(category: string) {
  if (category === "AI model and developer platform") {
    return ["Generate useful work with reliable models", "Build AI-assisted developer workflows", "Compare model quality, cost, limits, and trust"];
  }
  if (category === "Healthcare and medical technology") {
    return ["Improve clinical or operational decisions", "Reduce adoption friction for healthcare teams", "Create trustworthy outcomes with clear evidence"];
  }
  if (category === "Developer tooling and API platform") {
    return ["Ship reliable integrations faster", "Debug implementation issues with less manual work", "Keep systems maintainable as usage grows"];
  }
  if (category === "Commerce and online selling software") {
    return ["Convert visitors into buyers", "Manage selling operations without manual cleanup", "Understand what blocks purchases or repeat usage"];
  }
  if (category === "Sales and customer relationship software") {
    return ["Prioritize the right accounts", "Keep deal context current", "Reduce manual reporting and follow-up work"];
  }
  if (category === "Customer support software") {
    return ["Resolve customer issues faster", "Route and escalate work reliably", "Maintain visibility into recurring customer pain"];
  }
  if (category === "Security, compliance, and risk technology") {
    return ["Reduce material risk", "Maintain trust and compliance", "Act on threats or obligations with less manual effort"];
  }
  if (category === "Analytics and decision intelligence") {
    return ["Make decisions with better evidence", "Reduce manual analysis", "Explain recommendations clearly to stakeholders"];
  }
  if (category === "Education and learning products") {
    return ["Improve learning outcomes", "Keep users engaged", "Make delivery and administration easier"];
  }
  if (category === "HR and workforce technology") {
    return ["Improve people decisions", "Reduce manual employee operations", "Create clearer employee and manager experiences"];
  }
  return ["Understand whether the product solves the target problem", "Reduce friction in adoption or use", "Compare tradeoffs against alternatives"];
}

function productNameFromTarget(target: string) {
  try {
    const hostname = new URL(target).hostname.replace(/^www\./, "");
    return titleCaseName(hostname.split(".")[0] || target);
  } catch {
    return titleCaseName(target);
  }
}

function domainFromTarget(target: string) {
  try {
    return new URL(target).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function titleCaseName(value: string) {
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[/?#].*$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => (/[A-Z]/.test(word.slice(1)) ? word : word.replace(/^\w/, (c) => c.toUpperCase())))
    .join(" ") || "Target product";
}
