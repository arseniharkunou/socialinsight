import net from "node:net";

export function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeUrl(input: string) {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }
  assertPublicHostname(url.hostname);
  return url.toString();
}

export function isPrivateHostname(hostname: string) {
  const host = cleanHostname(hostname);
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    return isPrivateIpv4(host);
  }
  if (ipVersion === 6) {
    return isPrivateIpv6(host);
  }
  return false;
}

export function isPrivateIpAddress(address: string) {
  const cleaned = cleanHostname(address);
  const ipVersion = net.isIP(cleaned);
  return (ipVersion === 4 && isPrivateIpv4(cleaned)) || (ipVersion === 6 && isPrivateIpv6(cleaned));
}

function assertPublicHostname(hostname: string) {
  if (isPrivateHostname(hostname)) {
    const host = cleanHostname(hostname);
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
      throw new Error("Enter a public product, company, or domain URL.");
    }
    throw new Error("Private network URLs are not supported.");
  }
}

function cleanHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function isPrivateIpv4(ip: string) {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

function isPrivateIpv6(ip: string) {
  const normalized = ip.toLowerCase();
  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4);
  }
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized === "::"
  );
}

function ipv4FromMappedIpv6(ip: string) {
  if (!ip.startsWith("::ffff:")) {
    return null;
  }

  const tail = ip.slice("::ffff:".length);
  if (tail.includes(".")) {
    return net.isIP(tail) === 4 ? tail : null;
  }

  const parts = tail.split(":");
  if (parts.length !== 2) {
    return null;
  }

  const high = Number.parseInt(parts[0], 16);
  const low = Number.parseInt(parts[1], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) {
    return null;
  }

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

export function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hostFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function truncate(text: string, length: number) {
  if (text.length <= length) {
    return text;
  }
  return `${text.slice(0, length - 1).trim()}...`;
}

export function compactArray<T>(items: Array<T | null | undefined | false>): T[] {
  return items.filter(Boolean) as T[];
}
