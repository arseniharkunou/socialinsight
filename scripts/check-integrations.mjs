import fs from "node:fs";

const env = readEnvFile(".env.local");

const brightDataKey = env.BRIGHTDATA_API_KEY;
const brightDataMcpUrl = env.BRIGHTDATA_MCP_URL;
const openAiKey = env.OPENAI_API_KEY;

console.log("PainRadar integration check");
console.log("---------------------------");
console.log(`OpenAI key: ${openAiKey ? "set" : "missing"}`);
console.log(`OpenAI model: ${env.OPENAI_MODEL || "gpt-5.2"}`);
console.log(`Bright Data key: ${brightDataKey ? "set" : "missing"}`);
console.log(`Configured SERP zone: ${env.BRIGHTDATA_SERP_ZONE || "missing"}`);
console.log(`Configured Unlocker zone: ${env.BRIGHTDATA_WEB_UNLOCKER_ZONE || "missing"}`);
console.log(`Bright Data MCP URL: ${brightDataMcpUrl ? "set" : "missing"}`);
console.log("");

if (openAiKey) {
  await checkOpenAI();
}

if (brightDataKey) {
  await checkBrightDataZones();
  await checkBrightDataRequest("Unlocker", env.BRIGHTDATA_WEB_UNLOCKER_ZONE, {
    zone: env.BRIGHTDATA_WEB_UNLOCKER_ZONE,
    url: "https://example.com",
    format: "raw",
    method: "GET",
    country: env.BRIGHTDATA_COUNTRY || "us",
    data_format: "markdown",
  });
  await checkBrightDataRequest("SERP", env.BRIGHTDATA_SERP_ZONE, {
    zone: env.BRIGHTDATA_SERP_ZONE,
    url: "https://www.google.com/search?q=example.com%20customer%20complaints&brd_json=1",
    format: "json",
    method: "GET",
    country: env.BRIGHTDATA_COUNTRY || "us",
  });
}

if (brightDataMcpUrl) {
  await checkBrightDataMcp();
}

function readEnvFile(path) {
  if (!fs.existsSync(path)) {
    return {};
  }

  const parsed = {};
  for (const line of fs.readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

async function checkOpenAI() {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-5.2",
        input: "Return only the word ok.",
      }),
    });
    console.log(`OpenAI test: ${response.ok ? "ok" : `failed (${response.status})`}`);
    if (!response.ok) {
      console.log(`  ${sanitize(await response.text())}`);
    }
  } catch (error) {
    console.log(`OpenAI test: failed (${sanitize(error.message)})`);
  }
}

async function checkBrightDataZones() {
  try {
    const response = await fetch("https://api.brightdata.com/zone/get_active_zones", {
      headers: { Authorization: `Bearer ${brightDataKey}` },
    });
    console.log(`Bright Data zones: ${response.ok ? "ok" : `failed (${response.status})`}`);
    if (!response.ok) {
      console.log(`  ${sanitize(await response.text())}`);
      return;
    }
    const zones = await response.json();
    if (!Array.isArray(zones) || zones.length === 0) {
      console.log("  No active zones returned.");
      return;
    }
    for (const zone of zones) {
      console.log(`  ${zone.name}: ${zone.type || "unknown"}`);
    }
    const hasSerp = zones.some((zone) => zone.type === "serp");
    const hasUnlocker = zones.some((zone) => zone.type === "unblocker");
    if (!hasSerp) {
      console.log("  Missing active SERP zone. Create one in Bright Data and set BRIGHTDATA_SERP_ZONE.");
    }
    if (!hasUnlocker) {
      console.log("  Missing active Unlocker zone. Create one in Bright Data and set BRIGHTDATA_WEB_UNLOCKER_ZONE.");
    }
  } catch (error) {
    console.log(`Bright Data zones: failed (${sanitize(error.message)})`);
  }
}

async function checkBrightDataRequest(label, zone, body) {
  if (!zone) {
    console.log(`Bright Data ${label} test: skipped, zone missing`);
    return;
  }
  try {
    const response = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${brightDataKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    console.log(`Bright Data ${label} test: ${response.ok ? "ok" : `failed (${response.status})`}`);
    if (!response.ok) {
      console.log(`  ${sanitize(await response.text())}`);
    }
  } catch (error) {
    console.log(`Bright Data ${label} test: failed (${sanitize(error.message)})`);
  }
}

async function checkBrightDataMcp() {
  let client;
  try {
    const [{ Client }, { SSEClientTransport }] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/client/sse.js"),
    ]);
    client = new Client({ name: "painradar-check", version: "0.1.0" }, { capabilities: {} });
    await client.connect(new SSEClientTransport(new URL(brightDataMcpUrl)), { timeout: 15000 });
    const tools = await client.listTools(undefined, { timeout: 10000 });
    const names = new Set(tools.tools.map((tool) => tool.name));
    const expected = ["search_engine", "scrape_as_markdown", "web_data_reddit_posts"];
    const available = expected.filter((name) => names.has(name));
    console.log(`Bright Data MCP test: ok (${available.join(", ") || "connected"})`);
  } catch (error) {
    console.log(`Bright Data MCP test: failed (${sanitize(error.message)})`);
  } finally {
    await client?.close().catch(() => undefined);
  }
}

function sanitize(value) {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(brightDataKey || "__never__", "***")
    .replace(brightDataMcpUrl || "__never__", "***")
    .replace(/token=[^&\s]+/g, "token=***")
    .slice(0, 700);
}
