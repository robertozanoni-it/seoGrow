import dns from "node:dns/promises";
import net from "node:net";
import express from "express";

const HOOKED = Symbol.for("seogrow.frontendVerificationHook");
const USE_PATCHED = Symbol.for("seogrow.frontendVerificationUsePatched");
const LISTEN_PATCHED = Symbol.for("seogrow.frontendVerificationListenPatched");

function privateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && [0, 2].includes(c)) ||
      (a === 198 && [18, 19].includes(b)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  const v = String(address).toLowerCase();
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") ||
    /^fe[89ab]/.test(v) || /^fe[c-f]/.test(v) || v.startsWith("ff") || v.startsWith("2001:db8:");
}

async function safeTarget(input) {
  const url = new URL(String(input || ""));
  if (url.protocol !== "https:") throw new Error("La verifica frontend richiede HTTPS.");
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase()) || url.hostname.endsWith(".local"))
    throw new Error("Indirizzo frontend locale non consentito.");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => privateAddress(item.address)))
    throw new Error("Indirizzo frontend non pubblico.");
  url.hash = "";
  return url;
}

function firstMatch(value, pattern) {
  return String(value || "").match(pattern)?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function metaContent(html, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return firstMatch(
    html,
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
  ) || firstMatch(
    html,
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escaped}["']`, "i"),
  );
}

function canonicalHref(html) {
  return firstMatch(html, /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/i) ||
    firstMatch(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["']/i);
}

function visibleText(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:nav|footer|aside)\b[\s\S]*?<\/(?:nav|footer|aside)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("it");
}

export function contentOwnershipEvidence(expectedContent, visibleContent, frontendWords) {
  const expected = normalizeText(expectedContent);
  const visible = normalizeText(visibleContent);
  const words = expected ? expected.split(/\s+/).filter(Boolean) : [];
  const expectedWords = words.length;
  if (!expectedWords || !visible) {
    return { expectedWords, contentProbeMatches: 0, contentProbeCount: 0, contentCoverageStrong: false };
  }

  const probes = [];
  const addProbe = (start, length) => {
    const probe = words.slice(start, start + length).join(" ").trim();
    if (probe && !probes.includes(probe)) probes.push(probe);
  };

  if (expectedWords < 20) {
    addProbe(0, expectedWords);
  } else {
    const width = Math.min(18, Math.max(10, Math.floor(expectedWords / 4)));
    addProbe(0, width);
    addProbe(Math.max(0, Math.floor((expectedWords - width) / 2)), width);
    addProbe(Math.max(0, expectedWords - width), width);
  }

  const contentProbeMatches = probes.filter((probe) => visible.includes(probe)).length;
  const ratio = Number(frontendWords) > 0 ? expectedWords / Number(frontendWords) : 0;
  const allMatched = probes.length > 0 && contentProbeMatches === probes.length;
  const contentCoverageStrong = expectedWords < 20
    ? allMatched && ratio >= 0.4
    : probes.length >= 2 && allMatched && ratio >= 0.55;

  return {
    expectedWords,
    contentProbeMatches,
    contentProbeCount: probes.length,
    contentCoverageStrong,
  };
}

function pageKind(pathname) {
  if (/(?:privacy|cookie|gdpr|termini|terms|legal|consent)/i.test(pathname)) return "gdpr";
  if (/(?:contatt|contact)/i.test(pathname)) return "utility";
  if (/(?:category|categoria|tag|author|autore|page\/\d+)/i.test(pathname)) return "archive";
  return "content";
}

async function fetchPage(initialUrl) {
  let current = await safeTarget(initialUrl);
  const originalHost = current.hostname.toLowerCase();
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.1", "user-agent": "seoGrowAI/1.4-frontend-verification" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Redirect frontend senza destinazione.");
      const next = await safeTarget(new URL(location, current).href);
      if (next.hostname.toLowerCase() !== originalHost)
        throw new Error("La pagina frontend reindirizza verso un altro dominio.");
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`Frontend HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type") || "";
    const isHtml = /(?:text\/html|application\/xhtml\+xml)/i.test(contentType);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) throw new Error("Pagina frontend troppo grande per la verifica.");
    const html = isHtml ? bytes.toString("utf8") : "";
    return {
      url: current.href,
      status: response.status,
      contentType,
      isHtml,
      html,
      xRobotsTag: response.headers.get("x-robots-tag") || "",
    };
  }
  throw new Error("Troppi redirect durante la verifica frontend.");
}

function signals(page) {
  const title = firstMatch(page.html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = (page.html.match(/<h1\b[^>]*>/gi) || []).length;
  const text = visibleText(page.html);
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const kind = pageKind(new URL(page.url).pathname);
  const minimumWords = kind === "utility" ? 60 : kind === "archive" ? 80 : kind === "gdpr" ? 0 : 180;
  const robots = metaContent(page.html, "robots");
  const googlebot = metaContent(page.html, "googlebot");
  const directives = `${robots},${googlebot},${page.xRobotsTag}`;
  const noindex = /(?:^|[,;\s])noindex(?:$|[,;\s])/i.test(directives);
  const canonical = canonicalHref(page.html);
  return {
    title,
    h1,
    text,
    words,
    pageKind: kind,
    minimumWords,
    robots,
    googlebot,
    xRobotsTag: page.xRobotsTag,
    noindex,
    indexable: page.isHtml && !noindex,
    canonical,
  };
}

async function inspect(url) {
  const page = await fetchPage(url);
  const result = signals(page);
  return {
    ok: true,
    url: page.url,
    status: page.status,
    contentType: page.contentType,
    isHtml: page.isHtml,
    title: result.title,
    h1: result.h1,
    words: result.words,
    pageKind: result.pageKind,
    minimumWords: result.minimumWords,
    robots: result.robots,
    googlebot: result.googlebot,
    xRobotsTag: result.xRobotsTag,
    noindex: result.noindex,
    indexable: result.indexable,
    canonical: result.canonical,
    _visibleText: result.text,
  };
}

function publicResult(result) {
  const safe = { ...result };
  delete safe._visibleText;
  return safe;
}

function registerRoutes(app) {
  if (app[HOOKED]) return;
  app[HOOKED] = true;

  app.post("/api/frontend/inspect", async (req, res) => {
    try {
      return res.json(publicResult(await inspect(req.body?.url)));
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Ispezione frontend non riuscita.",
      });
    }
  });

  app.post("/api/wordpress/verify-frontend", async (req, res) => {
    try {
      const { url, expected = {} } = req.body || {};
      const result = await inspect(url);
      if (!result.isHtml) throw new Error(`Il frontend non restituisce HTML (${result.contentType || "Content-Type assente"}).`);
      const expectedTitle = normalizeText(expected.title);
      const expectedContent = normalizeText(expected.content);
      const normalizedVisible = normalizeText(result._visibleText);
      const contentProbe = expectedContent ? expectedContent.slice(0, Math.min(180, expectedContent.length)) : "";
      const ownership = contentOwnershipEvidence(expected.content, result._visibleText, result.words);
      return res.json({
        ...publicResult(result),
        ...ownership,
        titleMatchesExpected: expectedTitle ? normalizeText(result.title) === expectedTitle : null,
        contentProbeVisible: contentProbe ? normalizedVisible.includes(contentProbe) : null,
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Verifica frontend non riuscita.",
      });
    }
  });
}

const originalUse = express.application.use;
if (!originalUse[USE_PATCHED]) {
  const patchedUse = function (...args) {
    if (!this[HOOKED] && args[0] === "/api") registerRoutes(this);
    return originalUse.apply(this, args);
  };
  patchedUse[USE_PATCHED] = true;
  express.application.use = patchedUse;
}

const originalListen = express.application.listen;
if (!originalListen[LISTEN_PATCHED]) {
  const patchedListen = function (...args) {
    registerRoutes(this);
    return originalListen.apply(this, args);
  };
  patchedListen[LISTEN_PATCHED] = true;
  express.application.listen = patchedListen;
}
