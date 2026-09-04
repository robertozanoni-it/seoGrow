import {
  lastBatch,
  removeVerifiedTask,
  saveCorrection,
  setLastBatch,
  updateCorrection,
} from "./remediationStore";

window.__seogrowCorrectionsMode = false;

const GDPR_PATH = /(?:^|\/)(?:privacy(?:-policy)?|cookie(?:-policy)?|gdpr|informativa(?:-privacy)?|consenso(?:-cookie)?)(?:\/|$)/i;
const GDPR_TEXT = /(?:cookie consent|consenso cookie|preferenze privacy|gestisci(?:re)? i cookie|iubenda|complianz|cookiebot|cookie law)/i;

const isGdprUrl = (value) => {
  try {
    return GDPR_PATH.test(new URL(value).pathname);
  } catch {
    return GDPR_PATH.test(String(value || ""));
  }
};

const patchHistoryMethod = (methodName) => {
  const original = window.history[methodName];
  if (typeof original !== "function" || original.__seogrowPatched) return;

  const patched = function patchedHistoryMethod(...args) {
    const destination = args[2] == null ? "" : String(args[2]);
    if (window.__seogrowCorrectionsMode && window.location.hash === `#${encodeURIComponent("Correzioni")}`) {
      try {
        const next = new URL(destination || window.location.href, window.location.href);
        if (decodeURIComponent(next.hash.slice(1)) === "Panoramica") return undefined;
      } catch {
        // Usa il comportamento standard se la destinazione non è interpretabile.
      }
    }
    const oldURL = window.location.href;
    const result = original.apply(this, args);
    const newURL = window.location.href;
    if (newURL !== oldURL) {
      window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL }));
      window.dispatchEvent(new Event("seogrow-locationchange"));
    }
    return result;
  };

  patched.__seogrowPatched = true;
  window.history[methodName] = patched;
};

patchHistoryMethod("pushState");
patchHistoryMethod("replaceState");

const pendingGenerations = [];

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

const normalizeUrl = (value) => {
  try {
    const url = new URL(value);
    url.hash = "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`;
  } catch {
    return String(value || "").replace(/\/+$/, "");
  }
};

const normalizeText = (value) => String(value || "")
  .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&(?:nbsp|amp|quot|apos);/gi, " ")
  .replace(/\s+/g, " ")
  .trim()
  .toLocaleLowerCase("it");

const issueFamily = (issue) => {
  const text = `${issue?.type || ""} ${issue?.label || ""} ${issue?.detail || ""}`.toLowerCase();
  if (/title duplic|titolo duplic/.test(text)) return "title-duplicate";
  if (/meta description duplic/.test(text)) return "meta-description-duplicate";
  if (/contenuto breve|short content|content.*parole|parole/.test(text)) return "short-content";
  if (/\bh1\b/.test(text)) return "h1";
  if (/title|titolo/.test(text)) return "title";
  if (/excerpt|estratto/.test(text)) return "excerpt";
  if (/canonical/.test(text)) return "canonical";
  if (/noindex/.test(text)) return "noindex";
  return String(issue?.label || issue?.type || "issue").trim().toLowerCase();
};

const issuePresent = (issues, originalIssue, targetUrl) => {
  const family = issueFamily(originalIssue);
  const expectedUrl = normalizeUrl(targetUrl);
  return (Array.isArray(issues) ? issues : []).some((candidate) => {
    if (issueFamily(candidate) !== family) return false;
    const candidateUrl = normalizeUrl(candidate?.targetUrl || candidate?.url || targetUrl);
    return !expectedUrl || !candidateUrl || candidateUrl === expectedUrl;
  });
};

const currentClient = () => {
  const clients = readJson("seogrow-clients", []);
  const clientId = Number(readJson("seogrow-selected-client-v1", clients[0]?.id));
  const client = clients.find((item) => Number(item.id) === clientId) || clients[0] || {};
  return { clientId, client };
};

const startBatchFromClick = (event) => {
  const button = event.target?.closest?.(".audit-unified-actions button");
  if (button) {
    const text = String(button.textContent || "").trim();
    if (/Correggi tutti|Correggi questo problema/i.test(text)) {
      const batchId = `remediation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setLastBatch(batchId);
      sessionStorage.setItem("seogrow-remediation-active-batch-v1", batchId);
    }
  }
  const sidebarButton = event.target?.closest?.(".sidebar nav button");
  if (sidebarButton && !sidebarButton.classList.contains("corrections-nav-button")) {
    window.__seogrowCorrectionsMode = false;
  }
};

document.addEventListener("click", startBatchFromClick, true);

const scoreWithoutExcludedIssues = (data, issues) => {
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

const filterGdprFromSeoResponse = async (response, requestUrl, init) => {
  if (!response.ok || !["/api/site-analysis", "/api/audit"].includes(requestUrl)) return response;
  let body = {};
  try { body = JSON.parse(String(init?.body || "{}")); } catch { body = {}; }
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
    const filtered = originalIssues.filter((issue) => {
      const urls = [issue?.url, issue?.sourceUrl, issue?.targetUrl].filter(Boolean);
      return !urls.some(isGdprUrl);
    });
    const gdprPages = (Array.isArray(data.pages) ? data.pages : [])
      .filter((page) => isGdprUrl(page?.url))
      .map((page) => page.url);
    const bannerDetected = (Array.isArray(data.pages) ? data.pages : [])
      .some((page) => GDPR_TEXT.test(String(page?.contentExcerpt || "")));
    const excluded = originalIssues.length - filtered.length;
    data.issues = filtered;
    data.score = scoreWithoutExcludedIssues(data, filtered);
    data.summary = filtered.reduce((acc, issue) => {
      acc[issue.type] = (acc[issue.type] || 0) + 1;
      return acc;
    }, {});
    data.gdprReview = {
      managedSeparately: true,
      excludedSeoIssues: excluded,
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
};

const expectedVisibleInPage = (record, page) => {
  const fields = Array.isArray(record.fields) ? record.fields : Object.keys(record.after || {});
  if (!fields.some((field) => field === "content" || field === "excerpt")) return true;
  const expected = normalizeText(record.after?.content || record.after?.excerpt || "");
  const visible = normalizeText(page?.contentExcerpt || "");
  if (!expected || !visible) return false;
  const words = expected.split(/\s+/).filter(Boolean);
  if (words.length < 8) return visible.includes(expected);
  const fragments = [
    words.slice(0, 14).join(" "),
    words.slice(Math.max(0, Math.floor(words.length / 3)), Math.max(0, Math.floor(words.length / 3)) + 14).join(" "),
  ].filter((fragment) => fragment.length >= 35);
  return fragments.some((fragment) => visible.includes(fragment));
};

async function verifyCorrection(record, originalFetch) {
  const family = issueFamily(record.issue);
  if (["title-duplicate", "meta-description-duplicate"].includes(family)) {
    await updateCorrection(record.id, {
      status: "Da verificare",
      verificationNote: "Modifica salvata in WordPress. Per confermare un duplicato serve un nuovo crawl completo del sito.",
    });
    return;
  }

  try {
    const useSiteAudit = ["short-content", "h1"].includes(family) || (record.fields || []).includes("content");
    const response = await originalFetch(useSiteAudit ? "/api/site-analysis" : "/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(useSiteAudit ? { url: record.sourceUrl, maxPages: 5 } : { url: record.sourceUrl }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Verifica non riuscita");

    const page = useSiteAudit
      ? (data.pages || []).find((item) => normalizeUrl(item.url) === normalizeUrl(record.sourceUrl)) || data.pages?.[0]
      : data;
    const present = issuePresent(data.issues, record.issue, record.sourceUrl);
    const visibleConfirmed = expectedVisibleInPage(record, page);
    const verifiedAt = new Date().toISOString();

    if (present) {
      await updateCorrection(record.id, {
        status: "Da verificare",
        verifiedAt,
        frontendConfirmed: visibleConfirmed,
        verificationNote: "WordPress ha salvato la modifica, ma il nuovo controllo rileva ancora lo stesso tipo di problema SEO.",
      });
    } else if (!visibleConfirmed) {
      await updateCorrection(record.id, {
        status: "Da verificare",
        verifiedAt,
        frontendConfirmed: false,
        verificationNote: "Il problema SEO non è stato rilevato nel ricontrollo, ma il contenuto modificato non è confermato nel frontend. Possibili cause: Elementor, cache o template separato.",
      });
    } else {
      const verified = await updateCorrection(record.id, {
        status: "Verificato",
        verifiedAt,
        frontendConfirmed: true,
        verificationNote: "Confermato: modifica visibile nel frontend e problema SEO non più rilevato.",
      });
      if (verified) removeVerifiedTask(verified);
    }
  } catch (error) {
    await updateCorrection(record.id, {
      status: "Da verificare",
      verificationNote: `WordPress ha salvato la modifica; verifica automatica non conclusa: ${error.message}`,
    });
  }
}

const originalFetch = window.fetch.bind(window);
if (!window.fetch.__seogrowRemediationPatched) {
  const patchedFetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url;
    const method = String(init?.method || "GET").toUpperCase();

    if (url === "/api/generate" && method === "POST") {
      try {
        const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
        if (/^Remediation WordPress\s+(?:title|content|excerpt|h1)$/i.test(String(body?.topic || ""))) {
          let context = {};
          try { context = JSON.parse(String(body?.context || "{}")); } catch { context = {}; }
          const response = await originalFetch("/api/wordpress/generate-patch", init);
          if (response.ok) {
            try {
              const data = await response.clone().json();
              const parsed = JSON.parse(String(data.content || "{}"));
              pendingGenerations.push({
                issue: context.issue || {},
                page: context.page || {},
                changes: parsed.changes || {},
              });
            } catch {
              // La UI mostrerà l'errore di struttura se la risposta non è valida.
            }
          }
          return response;
        }
      } catch {
        // L'endpoint originale gestirà eventuali body non validi.
      }
    }

    if (url === "/api/wordpress/remediate" && method === "POST") {
      const rollbackHeader = new Headers(init.headers || {}).get("x-seogrow-rollback") === "1";
      let requestBody = {};
      try { requestBody = JSON.parse(String(init.body || "{}")); } catch { requestBody = {}; }
      const generation = rollbackHeader ? null : pendingGenerations.shift() || null;
      const response = await originalFetch(input, init);
      if (response.ok && !rollbackHeader) {
        try {
          const data = await response.clone().json();
          const { clientId, client } = currentClient();
          const changed = Array.isArray(data.changed) && data.changed.length
            ? data.changed
            : Object.keys(requestBody.changes || {});
          const before = {};
          const after = {};
          for (const field of changed) {
            before[field] = generation?.page?.[field] ?? data.before?.[field] ?? "";
            after[field] = requestBody.changes?.[field] ?? data.after?.[field] ?? "";
          }
          const batchId = sessionStorage.getItem("seogrow-remediation-active-batch-v1") || lastBatch() || `remediation-${Date.now()}`;
          const issue = generation?.issue || { label: `Modifica ${changed.join(", ")}` };
          const record = {
            id: `correction-${crypto.randomUUID()}`,
            batchId,
            clientId,
            clientName: client?.name || "",
            platform: "wordpress",
            issue,
            issueLabel: issue.label || "Problema SEO",
            issueType: issue.type || "audit",
            severity: issue.severity || "media",
            sourceUrl: data.link || requestBody.url || client?.url || "",
            resource: data.resource || requestBody.resource,
            entityId: Number(data.id || requestBody.id),
            username: requestBody.username || "",
            fields: changed,
            before,
            after,
            status: "Applicato",
            appliedAt: new Date().toISOString(),
            frontendConfirmed: false,
            verificationNote: "WordPress ha confermato la scrittura. Verifica SeoGrow e frontend in corso.",
          };
          await saveCorrection(record);
          window.dispatchEvent(new CustomEvent("seogrow-remediation-applied", { detail: { id: record.id, batchId } }));
          void verifyCorrection(record, originalFetch);
        } catch (error) {
          console.error("Impossibile registrare la remediation:", error);
        }
      }
      return response;
    }

    const response = await originalFetch(input, init);
    return filterGdprFromSeoResponse(response, url, init);
  };
  patchedFetch.__seogrowRemediationPatched = true;
  window.fetch = patchedFetch;
}
