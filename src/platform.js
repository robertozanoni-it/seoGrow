const day = 86_400_000;

const taskPriorities = new Set(["Alta", "Media", "Bassa"]);
const taskStatuses = new Set([
  "Da fare",
  "In corso",
  "In revisione",
  "Completato",
]);

export function normalizeStoredTasks(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set();
  const normalized = [];
  for (const task of value) {
    const normalizedId =
      typeof task?.id === "string" ? task.id.trim() : "";
    if (
      !task ||
      typeof task !== "object" ||
      !normalizedId ||
      seen.has(normalizedId) ||
      typeof task.title !== "string" ||
      !task.title.trim()
    )
      return fallback;
    seen.add(normalizedId);
    normalized.push({
      ...task,
      id: normalizedId,
      title: task.title.trim(),
      priority: taskPriorities.has(task.priority) ? task.priority : "Media",
      status: taskStatuses.has(task.status) ? task.status : "Da fare",
      due: typeof task.due === "string" ? task.due : "",
      kind: typeof task.kind === "string" && task.kind ? task.kind : "manual",
      client: typeof task.client === "string" ? task.client : "",
      sourceClientId:
        Number.isSafeInteger(task.sourceClientId) && task.sourceClientId > 0
          ? task.sourceClientId
          : null,
      sourceUrl: typeof task.sourceUrl === "string" ? task.sourceUrl : "",
      targetUrl: typeof task.targetUrl === "string" ? task.targetUrl : "",
      detail: typeof task.detail === "string" ? task.detail : "",
      notes: typeof task.notes === "string" ? task.notes : "",
      query: typeof task.query === "string" ? task.query : "",
      stale: task.stale === true,
    });
  }
  return normalized;
}

export const latestOf = (value) =>
  Array.isArray(value) ? value[0] || null : value || null;

export function normalizeAnalysisHistory(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function datasetKey(dataset) {
  let hash = 2166136261;
  const add = (value) => {
    const text = String(value ?? "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };
  for (const section of ["graph", "queries", "pages", "countries", "devices", "queryPages"]) {
    add(section);
    for (const row of dataset?.[section] || []) {
      add(row.dimension || row.query || row.date);
      add(row.clicks);
      add(row.impressions);
      add(row.ctr);
      add(row.position);
      if (row.pages) row.pages.forEach(add);
    }
  }
  return [
    dataset?.property?.host,
    dataset?.dateFrom,
    dataset?.dateTo,
    dataset?.totals?.clicks,
    dataset?.totals?.impressions,
    (dataset?.queries || []).length,
    (hash >>> 0).toString(36),
  ].join("|");
}

export function addDatasetToHistory(history, clientId, dataset) {
  const current = Array.isArray(history?.[clientId]) ? history[clientId] : [];
  const next = [
    dataset,
    ...current.filter((item) => datasetKey(item) !== datasetKey(dataset)),
  ]
    .toSorted(
      (a, b) =>
        String(b.dateTo || b.importedAt).localeCompare(
          String(a.dateTo || a.importedAt),
        ) || String(b.importedAt).localeCompare(String(a.importedAt)),
    )
    .slice(0, 24);
  return { ...(history || {}), [clientId]: next };
}

export function compareDatasets(current, previous) {
  if (!current || !previous) return null;
  const duration = (dataset) => {
    const start = Date.parse(`${dataset.dateFrom}T00:00:00Z`);
    const end = Date.parse(`${dataset.dateTo}T00:00:00Z`);
    return Number.isFinite(start) && Number.isFinite(end)
      ? Math.max(1, Math.round((end - start) / day) + 1)
      : null;
  };
  const currentDays = duration(current);
  const previousDays = duration(previous);
  if (
    currentDays &&
    previousDays &&
    Math.abs(currentDays - previousDays) / Math.max(currentDays, previousDays) >
      0.1
  )
    return null;
  const currentStart = Date.parse(`${current.dateFrom}T00:00:00Z`);
  const previousEnd = Date.parse(`${previous.dateTo}T00:00:00Z`);
  if (
    Number.isFinite(currentStart) &&
    Number.isFinite(previousEnd) &&
    (previousEnd >= currentStart || currentStart - previousEnd > 8 * day)
  )
    return null;
  const change = (now, before) =>
    before ? ((now - before) / before) * 100 : null;
  return {
    clicks: change(current.totals.clicks, previous.totals.clicks),
    impressions: change(
      current.totals.impressions,
      previous.totals.impressions,
    ),
    ctr: current.totals.ctr - previous.totals.ctr,
    position: current.totals.position - previous.totals.position,
  };
}

export function queryChanges(current, previous) {
  if (!current?.queries?.length || !previous?.queries?.length) return [];
  const normalizedQuery = (value) => String(value || "").trim().toLocaleLowerCase("it");
  const before = new Map(previous.queries.map((row) => [normalizedQuery(row.dimension), row]));
  const after = new Map(current.queries.map((row) => [normalizedQuery(row.dimension), row]));
  const retainedAndNew = current.queries.map((row) => {
    const old = before.get(normalizedQuery(row.dimension));
    return {
      ...row,
      query: row.dimension,
      page: row.page || "",
      changeType: old ? "retained" : "appeared",
      clickDelta: row.clicks - (old?.clicks || 0),
      impressionDelta: row.impressions - (old?.impressions || 0),
      positionDelta: old ? row.position - old.position : null,
    };
  });
  const lost = previous.queries
    .filter((row) => !after.has(normalizedQuery(row.dimension)))
    .map((row) => ({
      ...row,
      query: row.dimension,
      changeType: "lost",
      clickDelta: -row.clicks,
      impressionDelta: -row.impressions,
      positionDelta: null,
    }));
  return [...retainedAndNew, ...lost];
}

export function opportunityGroups(dataset) {
  if (!dataset?.queries?.length)
    return { quickWins: [], lowCtr: [], losses: [], cannibalizations: [] };
  const quickWins = dataset.queries
    .filter(
      (row) => row.impressions >= 10 && row.position >= 4 && row.position <= 20,
    )
    .toSorted((a, b) => b.impressions - a.impressions)
    .slice(0, 50);
  const lowCtr = dataset.queries
    .filter((row) => row.impressions >= 30 && row.ctr < 1.5)
    .toSorted((a, b) => b.impressions - a.impressions)
    .slice(0, 50);
  const losses = (dataset.changes || [])
    .filter((row) => row.clickDelta < 0 || row.positionDelta > 2)
    .toSorted((a, b) => a.clickDelta - b.clickDelta)
    .slice(0, 50);
  const cannibalizations = (dataset.queryPages || [])
    .filter((row) => row.pages?.length > 1)
    .toSorted((a, b) => b.impressions - a.impressions)
    .slice(0, 50);
  return { quickWins, lowCtr, losses, cannibalizations };
}

export function tasksFromAnalysis(analysis, client) {
  const issues = Array.isArray(analysis?.issues) ? analysis.issues : [];
  const tasks = issues.slice(0, 300).map((issue, index) => ({
    id: `analysis-${client.id}-${analysis.analyzedAt}-${index}`,
    title: issue.label,
    client: client.name,
    sourceClientId: client.id,
    priority:
      issue.severity === "alta"
        ? "Alta"
        : issue.severity === "bassa"
          ? "Bassa"
          : "Media",
    due: "Da pianificare",
    status: "Da fare",
    kind: issue.type || "audit",
    targetUrl: issue.targetUrl || issue.url || client.url,
    sourceUrl: issue.sourceUrl || "",
    linkLabel: issue.targetUrl ? "Apri destinazione" : "Apri pagina",
    detail: issue.detail || "",
    notes: "",
    createdAt: new Date().toISOString(),
  }));
  if (issues.length > tasks.length)
    tasks.push({
      id: `analysis-${client.id}-${analysis.analyzedAt}-summary`,
      title: `Rivedi ${issues.length - tasks.length} problemi aggiuntivi dell’audit`,
      client: client.name,
      sourceClientId: client.id,
      priority: "Media",
      due: "Da pianificare",
      status: "Da fare",
      kind: "audit-summary",
      targetUrl: client.url,
      sourceUrl: "",
      detail: `L’audit ha rilevato ${issues.length} problemi. Sono state create task dettagliate per i primi ${tasks.length}; consulta il report cliente per l’elenco completo.`,
      createdAt: new Date().toISOString(),
    });
  return tasks;
}

const planKey = (value) =>
  String(value || "item")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

export function contentPlan(dataset, analysis) {
  const groups = opportunityGroups(dataset);
  const exactPages = new Map(
    (dataset?.queryPages || []).map((row) => [
      row.dimension || row.query,
      row.pages?.[0] || "",
    ]),
  );
  const technicalSource = (analysis?.issues || [])
    .filter((issue) => ["orphan", "thin"].includes(issue.type))
    .slice(0, 4);
  const technical = technicalSource.map((issue, index) => ({
    id: `technical-${planKey(issue.url || issue.label || index)}`,
    type: "Architettura",
    title: issue.label,
    reason: issue.detail || "Problema rilevato dal crawl",
    url: issue.url,
    association: "Verificata dal crawl",
    objective: "Migliorare scansione e collegamenti",
    format: "Intervento tecnico",
    slot: `Settimana ${Math.floor(index / 3) + 1}`,
    priority: "Alta",
  }));
  const availableEditorial = Math.max(0, 12 - technical.length);
  const updateLimit = Math.min(8, Math.ceil(availableEditorial * 0.7));
  const update = groups.quickWins.slice(0, updateLimit).map((row, index) => ({
    id: `update-${row.dimension}`,
    type: "Aggiornamento",
    title: row.dimension,
    reason: `${row.impressions} impressioni · posizione ${row.position.toFixed(1)} · CTR ${row.ctr.toFixed(2)}%`,
    url: row.page || exactPages.get(row.dimension) || "",
    association:
      row.page || exactPages.get(row.dimension)
        ? "Confermata da dati query–pagina"
        : "URL da verificare",
    objective:
      row.position <= 10
        ? "Consolidare la prima pagina"
        : "Entrare nella prima pagina",
    format: "Pagina esistente",
    slot: `Settimana ${Math.floor(index / 3) + 1}`,
    priority: row.position <= 10 ? "Alta" : "Media",
  }));
  const alreadyPlanned = new Set(update.map((item) => item.title));
  const create = groups.lowCtr
    .filter((row) => !alreadyPlanned.has(row.dimension))
    .slice(0, Math.max(0, availableEditorial - update.length))
    .map((row, index) => ({
      id: `create-${row.dimension}`,
      type: "Ottimizza snippet",
      title: row.dimension,
      reason: `${row.impressions} impressioni · CTR ${row.ctr.toFixed(2)}%`,
      url: row.page || exactPages.get(row.dimension) || "",
      association:
        row.page || exactPages.get(row.dimension)
          ? "Confermata da dati query–pagina"
          : "URL da verificare",
      objective: "Aumentare il CTR organico",
      format: "Title e meta description",
      slot: `Settimana ${Math.floor((technical.length + update.length + index) / 3) + 1}`,
      priority: "Media",
    }));
  const result = [...technical, ...update, ...create]
    .slice(0, 12)
    .map((item, index) => ({ ...item, slot: `Settimana ${Math.floor(index / 3) + 1}` }));
  if (result.length || !dataset?.queries?.length) return result;
  return dataset.queries.slice(0, 6).map((row, index) => ({
    id: `monitor-${row.dimension}`,
    type: "Valutazione",
    title: row.dimension,
    reason: `${row.impressions} impressioni · posizione ${row.position.toFixed(1)} · CTR ${row.ctr.toFixed(2)}%`,
    url: exactPages.get(row.dimension) || "",
    association: exactPages.has(row.dimension)
      ? "Confermata da dati query–pagina"
      : "URL da verificare",
    objective: "Valutare intento e pagina più adatta",
    format: "Analisi query",
    slot: `Settimana ${Math.floor(index / 3) + 1}`,
    priority: "Bassa",
  }));
}

export function queryTaskDetail(row, pageUrl = "", exactAssociation = false) {
  const metrics = `${row.impressions} impressioni · ${row.clicks} clic · CTR ${Number(row.ctr || 0).toFixed(2)}% · posizione media ${Number(row.position || 0).toFixed(1)}`;
  const association = pageUrl
    ? exactAssociation
      ? `Pagina associata dai dati query–pagina: ${pageUrl}`
      : `Pagina suggerita dal percorso URL, da verificare: ${pageUrl}`
    : "Pagina non determinabile dallo ZIP: associare manualmente la query a una URL prima di intervenire.";
  return `EVIDENZA SEARCH CONSOLE\n${metrics}\n${association}\n\nAZIONI CONSIGLIATE\n1. Verifica che la pagina risponda allo stesso intento della query.\n2. Controlla title, H1 e primo paragrafo: devono spiegare subito il tema senza forzare la keyword.\n3. Confronta il contenuto con le pagine già posizionate e completa solo le informazioni realmente mancanti.\n4. Aggiungi 2–4 link interni pertinenti verso questa pagina e controlla quelli in uscita.\n5. Se le impressioni sono alte ma il CTR è basso, migliora title e meta description.\n6. Dopo la modifica annota la data e confronta clic, CTR e posizione alla prossima importazione.`;
}

export function buildNotifications({
  tasks,
  dataset,
  previousDataset,
  analysis,
}) {
  const items = [];
  const overdue = tasks.filter(
    (task) =>
      task.status !== "Completato" &&
      task.due &&
      /^\d{4}-\d{2}-\d{2}$/.test(task.due) &&
      new Date(`${task.due}T23:59:59`).getTime() < Date.now(),
  ).length;
  if (overdue)
    items.push({
      tone: "red",
      title: `${overdue} task scadute`,
      text: "Aggiorna scadenza o stato delle attività.",
    });
  const comparison = compareDatasets(dataset, previousDataset);
  if (comparison?.clicks < -10)
    items.push({
      tone: "red",
      title: `Clic in calo del ${Math.abs(comparison.clicks).toFixed(1)}%`,
      text: "Confronto con l’importazione precedente.",
    });
  if (comparison?.impressions > 15)
    items.push({
      tone: "green",
      title: `Impressioni in crescita del ${comparison.impressions.toFixed(1)}%`,
      text: "Valuta le query con maggiore potenziale.",
    });
  if (analysis?.newIssues?.length)
    items.push({
      tone: "red",
      title: `${analysis.newIssues.length} nuovi problemi tecnici`,
      text: "Rilevati rispetto all’analisi precedente.",
    });
  if (analysis?.resolvedIssues?.length)
    items.push({
      tone: "green",
      title: `${analysis.resolvedIssues.length} problemi risolti`,
      text: "Confermati dall’ultima scansione.",
    });
  return items;
}

export function analysisDiff(current, previous) {
  if (!current || !previous) return { newIssues: [], resolvedIssues: [] };
  const key = (issue) =>
    `${issue.type}|${issue.url}|${issue.targetUrl || ""}|${issue.label}`;
  const old = new Map(
    (Array.isArray(previous.issues) ? previous.issues : []).map((issue) => [
      key(issue),
      issue,
    ]),
  );
  const now = new Map(
    (Array.isArray(current.issues) ? current.issues : []).map((issue) => [
      key(issue),
      issue,
    ]),
  );
  return {
    newIssues: [...now]
      .filter(([id]) => !old.has(id))
      .map(([, issue]) => issue),
    resolvedIssues: [...old]
      .filter(([id]) => !now.has(id))
      .map(([, issue]) => issue),
  };
}

export function downloadCsv(rows, fileName) {
  if (!rows.length) return;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    let text =
      value && typeof value === "object"
        ? JSON.stringify(value)
        : String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = [
    columns.map(escape).join(","),
    ...rows.map((row) =>
      columns.map((column) => escape(row[column])).join(","),
    ),
  ].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
