import {
  lastBatch,
  removeVerifiedTask,
  saveCorrection,
  setLastBatch,
  updateCorrection,
} from "./remediationStore";

window.__seogrowCorrectionsMode = false;

// React navigation in seoGrow updates the hash with history.pushState().
// Browsers do not emit hashchange for pushState, so components mounted outside
// App (Audit workspace/remediation) would occasionally miss navigation changes.
// Emit one location-change signal only when the URL really changes.
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
        // Se la destinazione non è interpretabile, usa il comportamento standard.
      }
    }
    const oldURL = window.location.href;
    const result = original.apply(this, args);
    const newURL = window.location.href;
    if (newURL !== oldURL) {
      window.dispatchEvent(
        new HashChangeEvent("hashchange", { oldURL, newURL }),
      );
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

async function verifyCorrection(record, originalFetch) {
  const family = issueFamily(record.issue);
  if (["title-duplicate", "meta-description-duplicate"].includes(family)) {
    await updateCorrection(record.id, {
      status: "Da verificare",
      verificationNote: "La correzione è stata applicata, ma questo problema richiede un nuovo crawl completo del sito per essere confermato.",
    });
    return;
  }

  try {
    const response = await originalFetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: record.sourceUrl }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Verifica non riuscita");
    const present = issuePresent(data.issues, record.issue, record.sourceUrl);
    const verifiedAt = new Date().toISOString();
    if (present) {
      await updateCorrection(record.id, {
        status: "Da verificare",
        verifiedAt,
        verificationNote: "La modifica è stata applicata ma SeoGrow rileva ancora lo stesso tipo di problema.",
      });
    } else {
      const verified = await updateCorrection(record.id, {
        status: "Verificato",
        verifiedAt,
        verificationNote: "Nuovo audit della pagina: problema non più rilevato.",
      });
      if (verified) removeVerifiedTask(verified);
    }
  } catch (error) {
    await updateCorrection(record.id, {
      status: "Da verificare",
      verificationNote: `Modifica applicata; verifica automatica non conclusa: ${error.message}`,
    });
  }
}

// La remediation WordPress necessita di output JSON deterministico. In più,
// intercettiamo il ciclo generate -> apply per registrare snapshot Prima/Dopo,
// verificare il risultato e chiudere la Task soltanto quando il problema sparisce.
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
        // Se il body non è JSON valido, lascia che l'endpoint originale gestisca l'errore.
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
            verificationNote: "WordPress ha confermato la scrittura. Verifica SeoGrow in corso.",
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

    return originalFetch(input, init);
  };
  patchedFetch.__seogrowRemediationPatched = true;
  window.fetch = patchedFetch;
}
