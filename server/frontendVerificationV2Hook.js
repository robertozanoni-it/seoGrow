import express from "express";

const HOOKED = Symbol.for("seogrow.frontendVerificationV2Hook");
const USE_PATCHED = Symbol.for("seogrow.frontendVerificationV2UsePatched");
const LISTEN_PATCHED = Symbol.for("seogrow.frontendVerificationV2ListenPatched");
const USER_AGENT = "seoGrowAI/1.4-frontend-verification";
const MAX_BYTES = 5 * 1024 * 1024;

const sameSiteHost = (left, right) => {
  const normalize = (value) => String(value || "").toLowerCase().replace(/^www\./, "");
  return normalize(left) === normalize(right);
};

const safeInputUrl = (input) => {
  const url = new URL(String(input || ""));
  if (url.protocol !== "https:") throw new Error("La verifica frontend richiede HTTPS.");
  if (url.username || url.password) throw new Error("La URL frontend non può contenere credenziali.");
  url.hash = "";
  return url;
};

const decodeEntities = (value) => String(value || "")
  .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code) || 32))
  .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16) || 32))
  .replace(/&(nbsp|amp|quot|apos|lt|gt);/gi, (_match, name) => ({
    nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">",
  })[String(name).toLowerCase()] || " ");

const stripTags = (value) => decodeEntities(String(value || "").replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ")
  .trim();

const attr = (tag, name) => {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(tag || "").match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match?.[2] ?? "";
};

const tags = (html, name) => String(html || "").match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || [];

const metaContent = (html, names) => {
  const wanted = new Set((Array.isArray(names) ? names : [names]).map((item) => String(item).toLowerCase()));
  for (const tag of tags(html, "meta")) {
    const key = (attr(tag, "name") || attr(tag, "property")).toLowerCase();
    if (wanted.has(key)) return decodeEntities(attr(tag, "content")).trim();
  }
  return "";
};

const canonicalHref = (html) => {
  for (const tag of tags(html, "link")) {
    const rel = attr(tag, "rel").toLowerCase().split(/\s+/);
    if (rel.includes("canonical")) return attr(tag, "href").trim();
  }
  return "";
};

const removeHiddenBlocks = (html) => {
  let output = String(html || "");
  const hidden = /<([a-z][a-z0-9:-]*)\b[^>]*(?:\bhidden(?:\s|=|>)|aria-hidden\s*=\s*["']true["']|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'])[^>]*>[\s\S]*?<\/\1\s*>/gi;
  for (let pass = 0; pass < 3; pass += 1) output = output.replace(hidden, " ");
  return output;
};

const visibleText = (html) => {
  const body = String(html || "").match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || String(html || "");
  return stripTags(
    removeHiddenBlocks(body)
      .replace(/<(?:script|style|template|noscript)\b[\s\S]*?<\/(?:script|style|template|noscript)>/gi, " ")
      .replace(/<(?:nav|footer|aside)\b[\s\S]*?<\/(?:nav|footer|aside)>/gi, " "),
  );
};

const normalizeText = (value) => stripTags(value)
  .normalize("NFKC")
  .replace(/\s+/g, " ")
  .trim()
  .toLocaleLowerCase("it");

const h1Texts = (html) => [...String(html || "").matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)]
  .map((match) => stripTags(match[1]))
  .filter(Boolean);

export function contentOwnershipEvidence(expectedContent, visibleContent, frontendWords) {
  const expected = normalizeText(expectedContent);
  const visible = normalizeText(visibleContent);
  const words = expected ? expected.split(/\s+/).filter(Boolean) : [];
  const expectedWords = words.length;
  if (!expectedWords || !visible) {
    return {
      expectedWords,
      contentProbeMatches: 0,
      contentProbeCount: 0,
      contentProbeAllMatched: false,
      contentCoverageRatio: 0,
      contentCoverageStrong: false,
    };
  }

  const probes = [];
  const add = (start, width) => {
    const probe = words.slice(start, start + width).join(" ").trim();
    if (probe && probe.length >= 18 && !probes.includes(probe)) probes.push(probe);
  };
  if (expectedWords < 12) add(0, expectedWords);
  else {
    const width = Math.min(18, Math.max(8, Math.floor(expectedWords / 4)));
    add(0, width);
    add(Math.max(0, Math.floor((expectedWords - width) / 2)), width);
    add(Math.max(0, expectedWords - width), width);
  }
  const contentProbeMatches = probes.filter((probe) => visible.includes(probe)).length;
  const contentProbeAllMatched = probes.length > 0 && contentProbeMatches === probes.length;
  const ratio = Number(frontendWords) > 0 ? expectedWords / Number(frontendWords) : 0;
  const contentCoverageStrong = expectedWords < 20
    ? contentProbeAllMatched && ratio >= 0.35
    : probes.length >= 2 && contentProbeAllMatched && ratio >= 0.5;
  return {
    expectedWords,
    contentProbeMatches,
    contentProbeCount: probes.length,
    contentProbeAllMatched,
    contentCoverageRatio: Number(ratio.toFixed(4)),
    contentCoverageStrong,
  };
}

const pageKind = (pathname) => {
  const segments = String(pathname || "").toLowerCase().split("/").filter(Boolean);
  const exact = new Set(segments);
  if (["privacy", "privacy-policy", "cookie", "cookie-policy", "gdpr", "termini", "terms", "legal", "consent"].some((item) => exact.has(item))) return "gdpr";
  if (["contatti", "contatto", "contact", "contacts"].some((item) => exact.has(item))) return "utility";
  if (["category", "categoria", "tag", "author", "autore", "date", "feed"].some((item) => exact.has(item))) return "archive";
  if (segments.some((item, index) => item === "page" && /^\d+$/.test(segments[index + 1] || ""))) return "archive";
  return "content";
};

async function fetchPage(initial) {
  let current = safeInputUrl(initial);
  const originalHost = current.hostname;
  for (let redirects = 0; redirects < 5; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.1", "user-agent": USER_AGENT },
      maxBytes: MAX_BYTES,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel?.();
      if (!location) throw new Error("Redirect frontend senza destinazione.");
      const next = safeInputUrl(new URL(location, current).href);
      if (!sameSiteHost(originalHost, next.hostname)) throw new Error("La pagina frontend reindirizza verso un dominio differente.");
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`Frontend HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type") || "";
    if (!/(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) throw new Error(`Il frontend non restituisce HTML (${contentType || "Content-Type assente"}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error("Pagina frontend troppo grande per la verifica.");
    return {
      url: current.href,
      status: response.status,
      html: bytes.toString("utf8"),
      contentType,
      xRobotsTag: response.headers.get("x-robots-tag") || "",
    };
  }
  throw new Error("Troppi redirect durante la verifica frontend.");
}

const inspect = async (url) => {
  const page = await fetchPage(url);
  const text = visibleText(page.html);
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const kind = pageKind(new URL(page.url).pathname);
  const minimumWords = kind === "utility" ? 60 : kind === "archive" ? 80 : kind === "gdpr" ? 0 : 180;
  const title = stripTags(page.html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || "");
  const description = metaContent(page.html, ["description"]);
  const robots = metaContent(page.html, ["robots"]);
  const googlebot = metaContent(page.html, ["googlebot"]);
  const directives = `${robots},${googlebot},${page.xRobotsTag}`;
  const noindex = /(?:^|[,;\s])noindex(?:$|[,;\s])/i.test(directives);
  return {
    ok: true,
    url: page.url,
    status: page.status,
    contentType: page.contentType,
    title,
    description,
    h1Texts: h1Texts(removeHiddenBlocks(page.html)),
    words,
    pageKind: kind,
    minimumWords,
    robots,
    googlebot,
    xRobotsTag: page.xRobotsTag,
    noindex,
    indexable: !noindex,
    canonical: canonicalHref(page.html),
    _visibleText: text,
  };
};

const publicResult = (result) => {
  const safe = { ...result, h1: result.h1Texts.length };
  delete safe._visibleText;
  return safe;
};

function registerRoutes(app) {
  if (app[HOOKED]) return;
  app[HOOKED] = true;
  app.post("/api/wordpress/verify-frontend-v2", async (req, res) => {
    try {
      const { url, expected = {} } = req.body || {};
      const result = await inspect(url);
      const ownership = contentOwnershipEvidence(expected.content, result._visibleText, result.words);
      const expectedTitle = normalizeText(expected.title);
      const expectedDescription = normalizeText(expected.description);
      const expectedH1Text = normalizeText(expected.h1Text);
      const publicData = publicResult(result);
      return res.json({
        ...publicData,
        ...ownership,
        titleMatchesExpected: expectedTitle ? normalizeText(result.title) === expectedTitle : null,
        descriptionMatchesExpected: expectedDescription ? normalizeText(result.description) === expectedDescription : null,
        h1TextMatchesExpected: expectedH1Text ? result.h1Texts.some((value) => normalizeText(value) === expectedH1Text) : null,
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Verifica frontend V2 non riuscita." });
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
