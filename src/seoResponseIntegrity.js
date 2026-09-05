const PATCHED = Symbol.for("seogrow.seoResponseIntegrityV3");
const SITE_HISTORY_KEY = "seogrow-analyses-v2";
const HISTORY_MIGRATION_KEY = "seogrow-seo-response-integrity-v3";

const requestPath = (input) => {
  try {
    const raw = typeof input === "string" ? input : input?.url;
    return new URL(String(raw || ""), window.location.href).pathname;
  } catch {
    return String(input || "").split("?")[0];
  }
};

const normalizeUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return String(value || "");
  }
};

const confirmedBroken = (link) => [404, 410].includes(Number(link?.status));

const robotsExclusion = (failure) =>
  /(?:esclus[ao]\s+da\s+robots\.txt|robots\.txt.*esclus)/i.test(
    String(failure?.reason || failure?.error || ""),
  );

const scoreFromVerifiedEvidence = (data, issues, failedPages) => {
  const pages = Math.max(1, Number(data.pagesChecked || data.pages?.length || 1));
  const penalty = issues.reduce(
    (sum, issue) =>
      sum + (issue?.severity === "alta" ? 5 : issue?.severity === "media" ? 2 : 1),
    0,
  );
  const strongest = issues.reduce(
    (maximum, issue) =>
      Math.max(
        maximum,
        issue?.severity === "alta" ? 5 : issue?.severity === "media" ? 2 : 1,
      ),
    0,
  );
  const normalizedPenalty = Math.round(
    strongest + Math.max(0, penalty - strongest) / Math.sqrt(pages),
  );
  const failurePenalty = Math.min(
    40,
    Math.max(0, Number(failedPages || 0)) * 4 + (Number(data.pagesChecked || 0) ? 0 : 60),
  );
  return Math.max(0, Math.min(100, 100 - normalizedPenalty - failurePenalty));
};

const transientTargetSet = (links) =>
  new Set(
    links
      .filter((link) => !confirmedBroken(link))
      .map((link) => normalizeUrl(link?.url))
      .filter(Boolean),
  );

const issueLooksTransientLink = (issue) => {
  if (!["broken-link", "broken-external-link"].includes(issue?.type)) return false;
  const text = `${issue?.label || ""} ${issue?.detail || ""}`;
  const status = Number(text.match(/\b(?:HTTP\s*)?(\d{3})\b/i)?.[1]);
  return Number.isFinite(status) && ![404, 410].includes(status);
};

const reviewOnlyReason = (issue) => {
  const text = `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`.toLowerCase();
  if (/canonical/.test(text)) {
    if (/\b(?:404|410)\b|canonical.*(?:rotta|broken|irraggiungibile)/i.test(text)) return "";
    return "Una canonical differente o non rilevata non è automaticamente un errore. Verificare URL finale, HTML pubblico, sitemap, link interni e intenzione della pagina.";
  }
  if (/noindex|indexability|indicizzabil/.test(text)) {
    return "La direttiva noindex può essere intenzionale. Verificare tipo di pagina, strategia di indicizzazione e coerenza con sitemap/link interni prima di correggere.";
  }
  return "";
};

const toReviewItem = (issue, reason) => ({
  ...issue,
  severity: "bassa",
  diagnosisState: "needs-confirmation",
  evidenceNature: "observed-signal",
  reviewReason: reason,
});

const normalizeSiteAnalysis = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;

  const rawInternal = Array.isArray(data.brokenLinks) ? data.brokenLinks : [];
  const rawExternal = Array.isArray(data.brokenExternalLinks) ? data.brokenExternalLinks : [];
  const transientInternalTargets = transientTargetSet(rawInternal);
  const transientExternalTargets = transientTargetSet(rawExternal);

  const transientLinks = [
    ...rawInternal.filter((link) => !confirmedBroken(link)).map((link) => ({
      ...link,
      scope: "internal",
      verificationState: "temporarily-unverifiable",
    })),
    ...rawExternal.filter((link) => !confirmedBroken(link)).map((link) => ({
      ...link,
      scope: "external",
      verificationState: "temporarily-unverifiable",
    })),
  ];

  data.brokenLinks = rawInternal.filter(confirmedBroken);
  data.brokenExternalLinks = rawExternal.filter(confirmedBroken);
  data.linkVerificationWarnings = transientLinks;

  const rawFailures = Array.isArray(data.failures) ? data.failures : [];
  const exclusions = rawFailures.filter(robotsExclusion);
  const operationalFailures = rawFailures.filter((failure) => !robotsExclusion(failure));
  data.failures = operationalFailures;
  data.pagesFailed = operationalFailures.length;
  data.crawlExclusions = exclusions;

  const rawIssues = Array.isArray(data.issues) ? data.issues : [];
  const filtered = rawIssues.filter((issue) => {
    if (issueLooksTransientLink(issue)) return false;
    const target = normalizeUrl(issue?.targetUrl || "");
    if (issue?.type === "broken-link" && transientInternalTargets.has(target)) return false;
    if (issue?.type === "broken-external-link" && transientExternalTargets.has(target)) return false;
    return true;
  });

  const confirmed = [];
  const reviewItems = [];
  for (const issue of filtered) {
    const reason = reviewOnlyReason(issue);
    if (reason) reviewItems.push(toReviewItem(issue, reason));
    else confirmed.push({ ...issue, diagnosisState: issue?.diagnosisState || "confirmed" });
  }

  const previousReviewItems = Array.isArray(data.reviewItems) ? data.reviewItems : [];
  data.rawIssueCount = rawIssues.length;
  data.issues = confirmed;
  data.reviewItems = [...reviewItems, ...previousReviewItems].filter((item, index, rows) => {
    const key = `${item?.type || ""}|${item?.label || ""}|${normalizeUrl(item?.targetUrl || item?.url || "")}`;
    return rows.findIndex((candidate) => `${candidate?.type || ""}|${candidate?.label || ""}|${normalizeUrl(candidate?.targetUrl || candidate?.url || "")}` === key) === index;
  });

  data.summary = data.issues.reduce((summary, issue) => {
    summary[issue.type] = (summary[issue.type] || 0) + 1;
    return summary;
  }, {});
  data.reviewSummary = data.reviewItems.reduce((summary, issue) => {
    summary[issue.type || "review"] = (summary[issue.type || "review"] || 0) + 1;
    return summary;
  }, {});

  data.rawScore = Number.isFinite(Number(data.score)) ? Number(data.score) : null;
  data.score = scoreFromVerifiedEvidence(data, data.issues, operationalFailures.length);
  data.scoreSource = "seogrow-derived";
  data.scoreLabel = "Indice di salute tecnica SeoGrow";
  data.scoreMethodology = "Indice interno derivato dai problemi confermati e dai fallimenti del crawl; non è un voto Google.";
  data.evidencePolicy = "confirmed-issues-only";
  return data;
};

const normalizeStoredHistory = () => {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(HISTORY_MIGRATION_KEY) === "1") return;
    const raw = localStorage.getItem(SITE_HISTORY_KEY);
    if (!raw) {
      localStorage.setItem(HISTORY_MIGRATION_KEY, "1");
      return;
    }
    const history = JSON.parse(raw);
    if (!history || typeof history !== "object" || Array.isArray(history)) return;
    const normalized = Object.fromEntries(
      Object.entries(history).map(([clientId, value]) => [
        clientId,
        Array.isArray(value)
          ? value.map((item) => normalizeSiteAnalysis({ ...item }))
          : normalizeSiteAnalysis({ ...value }),
      ]),
    );
    localStorage.setItem(SITE_HISTORY_KEY, JSON.stringify(normalized));
    localStorage.setItem(HISTORY_MIGRATION_KEY, "1");
    window.dispatchEvent(new StorageEvent("storage", {
      key: SITE_HISTORY_KEY,
      newValue: JSON.stringify(normalized),
    }));
  } catch (error) {
    console.warn("Normalizzazione storico audit non completata:", error);
  }
};

if (typeof window !== "undefined") {
  normalizeStoredHistory();
  const originalFetch = window.fetch.bind(window);
  if (!window.fetch[PATCHED]) {
    const integrityFetch = async (input, init = {}) => {
      const response = await originalFetch(input, init);
      if (!response.ok || requestPath(input) !== "/api/site-analysis") return response;

      let data;
      try {
        data = await response.clone().json();
      } catch {
        return response;
      }

      const normalized = normalizeSiteAnalysis(data);
      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(normalized), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };
    integrityFetch[PATCHED] = true;
    window.fetch = integrityFetch;
  }
}

export { normalizeSiteAnalysis, reviewOnlyReason, scoreFromVerifiedEvidence };
