const GDPR_PATH = /(?:^|\/)(?:privacy(?:-policy)?|cookie(?:-policy)?|gdpr|informativa(?:-privacy)?|consenso(?:-cookie)?)(?:\/|$)/i;
const GDPR_TEXT = /(?:cookie consent|consenso cookie|preferenze privacy|gestisci(?:re)? i cookie|iubenda|complianz|cookiebot|cookie law)/i;

export const isGdprUrl = (value) => {
  try { return GDPR_PATH.test(new URL(String(value || "")).pathname); }
  catch { return GDPR_PATH.test(String(value || "")); }
};

const parseJson = (value, fallback = {}) => {
  try { return JSON.parse(String(value ?? "")); } catch { return fallback; }
};

export const scoreWithoutExcludedIssues = (data, issues) => {
  const pages = Math.max(1, Number(data.pagesChecked || data.pages?.length || 1));
  const penalty = issues.reduce(
    (sum, issue) => sum + (issue.severity === "alta" ? 5 : issue.severity === "media" ? 2 : 1),
    0,
  );
  const strongest = issues.reduce(
    (maximum, issue) => Math.max(maximum, issue.severity === "alta" ? 5 : issue.severity === "media" ? 2 : 1),
    0,
  );
  const normalized = Math.round(strongest + Math.max(0, penalty - strongest) / Math.sqrt(pages));
  const failurePenalty = Math.min(40, Number(data.pagesFailed || 0) * 4 + (pages ? 0 : 60));
  return Math.max(0, Math.min(100, 100 - normalized - failurePenalty));
};

export async function normalizeGdprResponse(response, requestUrl, init = {}) {
  if (!response?.ok || !["/api/site-analysis", "/api/audit"].includes(String(requestUrl || ""))) return response;
  const body = parseJson(init?.body || "{}", {});
  let data;
  try { data = await response.clone().json(); } catch { return response; }

  if (requestUrl === "/api/audit" && isGdprUrl(body.url || data.url)) {
    data.gdprReview = {
      managedSeparately: true,
      url: data.url || body.url || "",
      note: "Pagina GDPR esclusa dalle problematiche SEO. Verificarla nel flusso di regolarizzazione GDPR dedicato.",
    };
    data.issues = [];
    data.score = 100;
  }

  if (requestUrl === "/api/site-analysis") {
    const originalIssues = Array.isArray(data.issues) ? data.issues : [];
    const filtered = originalIssues.filter(
      (issue) => ![issue?.url, issue?.sourceUrl, issue?.targetUrl].filter(Boolean).some(isGdprUrl),
    );
    const gdprPages = (Array.isArray(data.pages) ? data.pages : [])
      .filter((page) => isGdprUrl(page?.url))
      .map((page) => page.url);
    const bannerDetected = (Array.isArray(data.pages) ? data.pages : [])
      .some((page) => GDPR_TEXT.test(String(page?.contentExcerpt || "")));
    data.issues = filtered;
    data.score = scoreWithoutExcludedIssues(data, filtered);
    data.summary = filtered.reduce((acc, issue) => {
      acc[issue.type] = (acc[issue.type] || 0) + 1;
      return acc;
    }, {});
    data.gdprReview = {
      managedSeparately: true,
      excludedSeoIssues: originalIssues.length - filtered.length,
      pagesDetected: gdprPages,
      bannerDetected,
      note: "Pagine e componenti GDPR non concorrono al punteggio SEO; restano da verificare nel controllo GDPR dedicato.",
    };
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
