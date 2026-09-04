const PATCHED = Symbol.for("seogrow.seoResponseIntegrity");

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
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`;
  } catch {
    return String(value || "").replace(/\/+$/, "");
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

const normalizeSiteAnalysis = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;

  const rawInternal = Array.isArray(data.brokenLinks) ? data.brokenLinks : [];
  const rawExternal = Array.isArray(data.brokenExternalLinks)
    ? data.brokenExternalLinks
    : [];
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
  data.pagesFailed = operationalFailures.length;
  data.crawlExclusions = exclusions;

  const rawIssues = Array.isArray(data.issues) ? data.issues : [];
  data.issues = rawIssues.filter((issue) => {
    const target = normalizeUrl(issue?.targetUrl || "");
    if (issue?.type === "broken-link" && transientInternalTargets.has(target)) return false;
    if (
      issue?.type === "broken-external-link" &&
      transientExternalTargets.has(target)
    )
      return false;
    return true;
  });

  data.summary = data.issues.reduce((summary, issue) => {
    summary[issue.type] = (summary[issue.type] || 0) + 1;
    return summary;
  }, {});
  data.score = scoreFromVerifiedEvidence(data, data.issues, operationalFailures.length);
  return data;
};

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

export { normalizeSiteAnalysis };
