const STOP_WORDS = new Set([
  "a",
  "al",
  "alla",
  "con",
  "da",
  "dei",
  "del",
  "della",
  "di",
  "e",
  "il",
  "in",
  "la",
  "le",
  "lo",
  "per",
  "su",
  "un",
  "una",
  "uno",
  "vicino",
  "migliore",
]);

const tokens = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

export function suggestPageForQuery(query, pages = []) {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return null;
  let best = null;
  for (const page of pages) {
    let url;
    try {
      url = new URL(page.dimension);
    } catch {
      continue;
    }
    const pathTokens = new Set(tokens(decodeURIComponent(url.pathname)));
    const titleTokens = new Set(tokens(page.title || ""));
    const excerptTokens = new Set(tokens(page.contentExcerpt || ""));
    const matches = queryTokens.filter(
      (token) =>
        pathTokens.has(token) ||
        titleTokens.has(token) ||
        excerptTokens.has(token),
    );
    const weighted = queryTokens.reduce(
      (sum, token) =>
        sum +
        (pathTokens.has(token) ? 1 : 0) +
        (titleTokens.has(token) ? 0.8 : 0) +
        (excerptTokens.has(token) ? 0.25 : 0),
      0,
    );
    const score = weighted / (queryTokens.length * 1.8);
    if (!best || score > best.score)
      best = { url: page.dimension, score, matches };
  }
  return best && (best.score >= 0.35 || best.matches.length >= 2) ? best : null;
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const downloadText = (content, fileName, type) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const safeReportUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};

const reportLink = (value, label = "Apri") => {
  const url = safeReportUrl(value);
  return url
    ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : "—";
};

export function downloadClientReport({
  client,
  dataset,
  tasks,
  analysis,
  geo,
}) {
  const generatedAt = new Date().toLocaleString("it-IT");
  const metricRows = dataset
    ? [
        ["Clic", dataset.totals.clicks],
        ["Impressioni", dataset.totals.impressions],
        ["CTR medio", `${dataset.totals.ctr.toFixed(2)}%`],
        ["Posizione media", dataset.totals.position.toFixed(2)],
        ["Query", dataset.queries.length],
        ["Pagine", dataset.pages.length],
      ]
    : [["Search Console", "Dati non importati"]];
  const queryRows = (dataset?.queries || [])
    .slice(0, 1000)
    .map(
      (row) => `
    <tr><td>${escapeHtml(row.dimension)}</td><td>${row.clicks}</td><td>${row.impressions}</td><td>${row.position.toFixed(2)}</td></tr>`,
    )
    .join("");
  const taskRows = tasks
    .map(
      (task) => `
    <tr><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.priority)}</td><td>${escapeHtml(task.status)}</td><td>${reportLink(task.targetUrl || task.sourceUrl)}</td></tr>`,
    )
    .join("");
  const brokenRows = [
    ...(analysis?.brokenLinks || []),
    ...(analysis?.brokenExternalLinks || []),
  ]
    .flatMap((link) =>
      (link.sources?.length ? link.sources : [""]).map(
        (source) => `
    <tr><td>${reportLink(link.url, link.url)}</td><td>${escapeHtml(link.status || link.error)}</td><td>${reportLink(source, source)}</td></tr>`,
      ),
    )
    .join("");
  const issueRows = (analysis?.issues || [])
    .slice(0, 1000)
    .map(
      (issue) =>
        `<tr><td>${escapeHtml(issue.label)}</td><td>${escapeHtml(issue.severity)}</td><td>${reportLink(issue.url, issue.url)}</td><td>${escapeHtml(issue.detail)}</td></tr>`,
    )
    .join("");
  const geoRows = (geo?.audit?.issues || [])
    .map(
      (issue) =>
        `<tr><td>${escapeHtml(issue.title)}</td><td>${escapeHtml(issue.severity)}</td><td>${escapeHtml(issue.detail)}</td><td>${escapeHtml(issue.recommendation)}</td></tr>`,
    )
    .join("");
  const queryNotice =
    (dataset?.queries || []).length > 1000
      ? `<p class="meta">Mostrate 1.000 query su ${(dataset?.queries || []).length}. Usa il CSV per il dettaglio completo.</p>`
      : "";
  const issueNotice =
    (analysis?.issues || []).length > 1000
      ? `<p class="meta">Mostrati 1.000 problemi su ${(analysis?.issues || []).length}.</p>`
      : "";
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; navigate-to https: http:"><title>Report SEO — ${escapeHtml(client.name)}</title><style>body{font:15px/1.55 Arial,sans-serif;color:#10213d;max-width:1100px;margin:40px auto;padding:0 24px}h1{margin-bottom:4px}h2{margin-top:34px;border-bottom:2px solid #16a05d;padding-bottom:8px}.meta{color:#6b7890}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.metric{border:1px solid #dbe3ed;border-radius:8px;padding:14px}.metric strong{display:block;font-size:24px;color:#167a4b}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #dbe3ed;padding:9px;vertical-align:top}a{color:#1767d5}@media print{body{margin:0}.no-print{display:none}}</style></head><body><button class="no-print" onclick="window.print()">Stampa / Salva PDF</button><h1>Report SEO — ${escapeHtml(client.name)}</h1><p class="meta">${escapeHtml(client.url)} · Generato ${generatedAt}</p><div class="metrics">${analysis ? `<div class="metric">Punteggio tecnico<strong>${escapeHtml(analysis.score ?? "—")}/100</strong></div>` : ""}${geo?.audit ? `<div class="metric">Preparazione GEO<strong>${escapeHtml(geo.audit.score ?? "—")}/100</strong></div>` : ""}${metricRows.map(([label, value]) => `<div class="metric">${escapeHtml(label)}<strong>${escapeHtml(value)}</strong></div>`).join("")}</div><h2>Task del progetto</h2><table><thead><tr><th>Task</th><th>Priorità</th><th>Stato</th><th>Link</th></tr></thead><tbody>${taskRows || '<tr><td colspan="4">Nessun task disponibile</td></tr>'}</tbody></table><h2>Problemi tecnici verificati</h2>${issueNotice}<table><thead><tr><th>Problema</th><th>Priorità</th><th>Pagina</th><th>Dettaglio</th></tr></thead><tbody>${issueRows || '<tr><td colspan="4">Analisi non ancora eseguita.</td></tr>'}</tbody></table><h2>Preparazione GEO</h2><p class="meta">L’indice GEO valuta preparazione tecnica e informativa; non garantisce citazioni nei motori AI.</p><table><thead><tr><th>Controllo</th><th>Priorità</th><th>Prova</th><th>Intervento</th></tr></thead><tbody>${geoRows || '<tr><td colspan="4">Audit GEO non ancora eseguito.</td></tr>'}</tbody></table><h2>Top query Search Console</h2>${queryNotice}<table><thead><tr><th>Query</th><th>Clic</th><th>Impressioni</th><th>Posizione</th></tr></thead><tbody>${queryRows || '<tr><td colspan="4">Dati non disponibili</td></tr>'}</tbody></table><h2>Link interni ed esterni non raggiungibili</h2><table><thead><tr><th>Destinazione</th><th>Risposta</th><th>Pagina sorgente</th></tr></thead><tbody>${brokenRows || '<tr><td colspan="3">Nessun link interrotto rilevato o analisi non ancora eseguita.</td></tr>'}</tbody></table></body></html>`;
  const slug = client.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  downloadText(
    html,
    `report-seo-${slug || "cliente"}-${new Date().toISOString().slice(0, 10)}.html`,
    "text/html;charset=utf-8",
  );
}

const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};
const base64ToBytes = (value) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

async function backupKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 250000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function exportWorkspaceBackup(data, passphrase) {
  if (String(passphrase || "").length < 10)
    throw new Error(
      "Usa una password di almeno 10 caratteri per proteggere il backup.",
    );
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      ...data,
    }),
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await backupKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  downloadText(
    JSON.stringify({
      format: "seogrow-encrypted-backup-v1",
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      payload: bytesToBase64(new Uint8Array(encrypted)),
    }),
    `seogrow-backup-protetto-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json",
  );
}

export async function readWorkspaceBackup(file, passphrase = "") {
  if (!file || file.size > 25 * 1024 * 1024)
    throw new Error("Il backup supera il limite di sicurezza di 25 MB.");
  let data = JSON.parse(await file.text());
  if (data.format === "seogrow-encrypted-backup-v1") {
    if (!passphrase)
      throw new Error("Inserisci la password usata per creare il backup.");
    try {
      const key = await backupKey(passphrase, base64ToBytes(data.salt));
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(data.iv) },
        key,
        base64ToBytes(data.payload),
      );
      data = JSON.parse(new TextDecoder().decode(decrypted));
    } catch {
      throw new Error("Password errata oppure backup danneggiato.");
    }
  }
  if (
    ![1, 2, 3].includes(data.schemaVersion) ||
    !Array.isArray(data.clients) ||
    !data.clients.length ||
    !Array.isArray(data.tasks) ||
    !data.gscData ||
    Array.isArray(data.gscData) ||
    typeof data.gscData !== "object"
  ) {
    throw new Error("Il file selezionato non è un backup seoGrow AI valido.");
  }
  const validClient = (client) =>
    client &&
    Number.isSafeInteger(client.id) &&
    client.id > 0 &&
    typeof client.name === "string" &&
    client.name.trim() &&
    typeof client.url === "string" &&
    Boolean(safeReportUrl(client.url));
  const validTask = (task) =>
    task &&
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    typeof task.status === "string" &&
    ["Da fare", "In corso", "In revisione", "Completato"].includes(
      task.status,
    ) &&
    (task.sourceClientId == null ||
      data.clients.some(
        (client) => Number(client.id) === Number(task.sourceClientId),
      )) &&
    [task.sourceUrl, task.targetUrl]
      .filter(Boolean)
      .every((value) => Boolean(safeReportUrl(value)));
  if (!data.clients.every(validClient) || !data.tasks.every(validTask))
    throw new Error("Il backup contiene clienti o task non validi.");
  if (
    data.selectedClient != null &&
    !data.clients.some((client) => client.id === Number(data.selectedClient))
  )
    throw new Error("Il backup indica un progetto selezionato non valido.");
  if (
    new Set(data.clients.map((client) => client.id)).size !== data.clients.length ||
    new Set(data.tasks.map((task) => task.id)).size !== data.tasks.length
  )
    throw new Error("Il backup contiene identificativi duplicati.");
  const validRecord = (value) =>
    value == null || (typeof value === "object" && !Array.isArray(value));
  for (const key of [
    "gscData",
    "gscHistory",
    "analyses",
    "rankings",
    "topicalMaps",
    "geoData",
    "contentDrafts",
    "wordpressProfiles",
    "auditResults",
    "agentRuns",
    "preferences",
  ]) {
    if (key in data && !validRecord(data[key]))
      throw new Error(`Il backup contiene una sezione non valida: ${key}.`);
  }
  if (data.wordpressProfiles) {
    for (const [clientId, profile] of Object.entries(data.wordpressProfiles)) {
      if (
        !data.clients.some((client) => String(client.id) === String(clientId)) ||
        !profile ||
        typeof profile !== "object" ||
        typeof profile.username !== "string" ||
        !safeReportUrl(profile.url) ||
        "applicationPassword" in profile
      )
        throw new Error("Il backup contiene un profilo WordPress non valido.");
    }
  }
  const jsonSize = JSON.stringify(data).length;
  if (jsonSize > 25 * 1024 * 1024)
    throw new Error("Il contenuto del backup supera il limite consentito.");
  return data;
}
