const PATCHED = Symbol.for("seogrow.remediationBatchGuard");
const inspectStatusByUrl = new Map();

const normalizeUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`;
  } catch {
    return String(value || "").replace(/\/+$/, "");
  }
};

const parseJson = (value, fallback = null) => {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return fallback;
  }
};

export function remediationTargetFromGenerateBody(body) {
  const payload = typeof body === "string" ? parseJson(body) : body;
  if (!payload || typeof payload !== "object") return "";
  if (!/^Remediation WordPress\s+(?:title|content|excerpt|h1)$/i.test(String(payload.topic || "")))
    return "";
  const context = typeof payload.context === "string" ? parseJson(payload.context, {}) : payload.context || {};
  return normalizeUrl(context?.issue?.targetUrl || context?.issue?.url || "");
}

export function shouldBlockGenerationForStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return ["trash", "auto-draft", "inherit"].includes(normalized);
}

const blockedResponse = (status) =>
  new Response(
    JSON.stringify({
      error:
        "Remediation automatica bloccata: questo stato WordPress non è una sorgente sicura per creare una bozza corretta.",
      code: "UNSAFE_SOURCE_STATUS",
      currentStatus: String(status || "unknown"),
    }),
    { status: 409, headers: { "content-type": "application/json; charset=utf-8" } },
  );

const requestInfo = (input, init = {}) => {
  const raw = typeof input === "string" ? input : input?.url || "";
  let pathname;
  try {
    pathname = new URL(String(raw), window.location.href).pathname;
  } catch {
    pathname = String(raw).split("?")[0];
  }
  return { pathname, method: String(init?.method || input?.method || "GET").toUpperCase() };
};

const updateBatchProgress = () => {
  const button = [...document.querySelectorAll(".audit-unified-actions button")]
    .find((node) => /Correzione in corso|Correggi tutti/i.test(String(node.textContent || "")));
  const report = document.querySelector(".audit-unified-report");
  if (!button || !button.disabled || !report) return;
  const totalMatch = String(button.dataset.seogrowBatchTotal || button.textContent || "").match(/\((\d+)\)/);
  const total = Number(totalMatch?.[1] || button.dataset.seogrowBatchTotal || 0);
  const done = [...report.children].filter((node) => node.tagName === "DIV").length;
  if (total > 0) button.textContent = `Correzione ${Math.min(done + 1, total)}/${total}…`;
};

const captureBatchTotal = (event) => {
  const button = event.target?.closest?.(".audit-unified-actions button");
  if (!button) return;
  const match = String(button.textContent || "").match(/Correggi tutti\s*\((\d+)\)/i);
  if (match) button.dataset.seogrowBatchTotal = match[1];
};

if (typeof window !== "undefined" && !window.fetch[PATCHED]) {
  const previousFetch = window.fetch.bind(window);
  const guardedFetch = async (input, init = {}) => {
    const { pathname, method } = requestInfo(input, init);

    if (pathname === "/api/generate" && method === "POST") {
      const target = remediationTargetFromGenerateBody(init?.body);
      const inspected = target ? inspectStatusByUrl.get(target) : null;
      if (inspected && shouldBlockGenerationForStatus(inspected.status))
        return blockedResponse(inspected.status);
    }

    const response = await previousFetch(input, init);

    if (pathname === "/api/wordpress/inspect" && method === "POST" && response.ok) {
      try {
        const request = parseJson(init?.body, {});
        const data = await response.clone().json();
        const target = normalizeUrl(request?.url || "");
        if (target) {
          inspectStatusByUrl.set(target, {
            status: data?.entity?.status || "",
            recordedAt: Date.now(),
          });
        }
      } catch {
        // Il normale flusso UI gestisce risposte non interpretabili.
      }
    }

    return response;
  };
  guardedFetch[PATCHED] = true;
  window.fetch = guardedFetch;

  document.addEventListener("click", captureBatchTotal, true);
  const observer = new MutationObserver(updateBatchProgress);
  const start = () => observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  if (document.body) start();
  else window.addEventListener("DOMContentLoaded", start, { once: true });
}
