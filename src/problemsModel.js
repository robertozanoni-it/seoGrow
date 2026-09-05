import {
  correctionEvent,
  deriveProblemState,
  issueConfidence,
  issueCorrectability,
  issueIdentity,
  latestAudit,
  normalizeClientId,
  normalizeHttpUrl,
  taskEvent,
} from "./reliabilityModel.js";

const timestamp = (value) => Date.parse(value || 0) || 0;

const pageKindFromUrl = (value) => {
  try {
    const segments = new URL(value).pathname.toLowerCase().split("/").filter(Boolean);
    const first = segments[0] || "";
    if (/^(?:category|categoria|tag|author|autore|date)$/.test(first) || (first === "page" && /^\d+$/.test(segments[1] || ""))) return "archive";
    if (/^(?:contatti?|contact|contacts)$/.test(first)) return "utility";
    if (/^(?:privacy(?:-policy)?|cookie(?:-policy)?|gdpr|termini(?:-e-condizioni)?|terms(?:-and-conditions)?|legal)$/.test(first)) return "gdpr";
    return "content";
  } catch {
    return "unknown";
  }
};

const severity = (value) => {
  const text = String(value || "").toLowerCase();
  if (/critical|critico|alta|high|error/.test(text)) return "high";
  if (/medium|media|warning|importante/.test(text)) return "medium";
  if (/bassa|low|opportun/.test(text)) return "low";
  return "unknown";
};

const priority = (value) => {
  const text = String(value || "").toLowerCase();
  if (/alta|high|urgent/.test(text)) return "high";
  if (/media|medium/.test(text)) return "medium";
  if (/bassa|low/.test(text)) return "low";
  return "unknown";
};

const exactUrlIdentity = (record = {}) => issueIdentity({
  ...record,
  wordpressId: undefined,
  resourceId: undefined,
  entityId: undefined,
  idWordPress: undefined,
  finalUrl: undefined,
  resolvedUrl: undefined,
  canonical: undefined,
  canonicalUrl: undefined,
  canonicalConfirmed: false,
});

const identityCandidates = (record) => [...new Set([
  issueIdentity(record),
  exactUrlIdentity(record),
  record?.issueKey ? `legacy:${record.issueKey}` : "",
].filter(Boolean))];

const latestPagesByUrl = (pageHistory) => {
  const byUrl = new Map();
  for (const item of Array.isArray(pageHistory) ? pageHistory : []) {
    const key = normalizeHttpUrl(item?.url || "", { stripSlash: false }) || String(item?.url || "");
    const current = byUrl.get(key);
    if (!current || timestamp(item?.analyzedAt || item?.startedAt) > timestamp(current?.analyzedAt || current?.startedAt)) byUrl.set(key, item);
  }
  return [...byUrl.values()];
};

const latestSite = (history) => latestAudit(
  (Array.isArray(history) ? history : history ? [history] : []).map((item) => ({ type: "site", item })),
  { scope: "site" },
)?.item || null;

const createGroup = (record, issue, sourceUrl) => ({
  key: issueIdentity(record),
  aliases: new Set(identityCandidates(record)),
  title: issue?.label || issue?.type || record.issueLabel || record.issueType || "Problema SEO",
  issueType: issue?.type || record.issueType || "",
  sourceUrl,
  detail: issue?.detail || "",
  severity: severity(issue?.severity || record.severity),
  priority: "unknown",
  pageKind: issue?.pageKind || pageKindFromUrl(sourceUrl),
  events: [],
  sources: [],
  evidence: [],
  fields: [],
  adapters: [],
  ownershipBlocked: false,
  technicalError: false,
  auditScopes: new Set(),
  quality: null,
});

const attachAlias = (groups, aliasMap, group, aliases) => {
  for (const alias of aliases) {
    group.aliases.add(alias);
    aliasMap.set(alias, group.key);
  }
  groups.set(group.key, group);
};

const findOrCreate = (groups, aliasMap, record, issue, sourceUrl) => {
  const aliases = identityCandidates(record);
  const existingKey = aliases.map((alias) => aliasMap.get(alias)).find(Boolean);
  if (existingKey && groups.has(existingKey)) {
    const group = groups.get(existingKey);
    attachAlias(groups, aliasMap, group, aliases);
    return group;
  }
  const group = createGroup(record, issue, sourceUrl);
  attachAlias(groups, aliasMap, group, aliases);
  return group;
};

const addSource = (group, source) => {
  group.sources.push(source);
  if (source.detail) group.evidence.push({
    source: source.label,
    detail: source.detail,
    at: source.at || "",
    nature: source.nature || "observed",
  });
};

export function buildUnifiedProblems({
  clientId,
  siteHistory = [],
  pageHistory = [],
  tasks = [],
  corrections = [],
  now = Date.now(),
} = {}) {
  const normalizedClientId = normalizeClientId(clientId);
  if (!normalizedClientId) return { rows: [], warnings: ["Cliente non selezionato o ID non valido."], coverage: null };

  const groups = new Map();
  const aliasMap = new Map();
  const warnings = [];
  const site = latestSite(siteHistory);
  const pageAudits = latestPagesByUrl(pageHistory);
  const audits = [
    ...(site ? [{ scope: "site", item: site }] : []),
    ...pageAudits.map((item) => ({ scope: "page", item })),
  ];

  for (const { scope, item } of audits) {
    const at = item?.analyzedAt || item?.startedAt || "";
    for (const issue of Array.isArray(item?.issues) ? item.issues : []) {
      const sourceUrl = issue?.targetUrl || issue?.url || item?.url || "";
      const record = { issueType: issue?.type, issueLabel: issue?.label, sourceUrl, issue };
      const group = findOrCreate(groups, aliasMap, record, issue, sourceUrl);
      const intentional = issue?.intentional === true;
      group.events.push({ kind: intentional ? "audit_intentional" : "audit_detected", at, source: "audit", scope });
      group.auditScopes.add(scope);
      if (!group.detail || timestamp(at) >= timestamp(group.latestAuditAt)) group.detail = issue?.detail || group.detail;
      if (severity(issue?.severity) !== "unknown") group.severity = severity(issue?.severity);
      group.latestAuditAt = timestamp(at) >= timestamp(group.latestAuditAt) ? at : group.latestAuditAt;
      addSource(group, {
        label: scope === "site" ? "Audit sito" : "Audit pagina",
        kind: "audit",
        at,
        detail: issue?.detail || issue?.label || "Rilevazione audit",
        nature: "observed",
      });
    }
  }

  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (normalizeClientId(task?.sourceClientId) !== normalizedClientId) {
      if (!task?.sourceClientId && task?.client) warnings.push(`Task legacy non associata tramite ID: ${task.title || "senza titolo"}.`);
      continue;
    }
    const sourceUrl = task?.sourceUrl || task?.targetUrl || "";
    const record = { issueType: task?.kind, issueLabel: task?.title, sourceUrl };
    const group = findOrCreate(groups, aliasMap, record, null, sourceUrl);
    const event = taskEvent(task);
    group.events.push(event);
    if (priority(task?.priority) !== "unknown") group.priority = priority(task.priority);
    if (!group.detail) group.detail = task?.detail || task?.notes || "";
    addSource(group, {
      label: "Task SeoGrow",
      kind: "task",
      at: event.at,
      detail: task?.detail || task?.notes || task?.title || "Task tecnica",
      nature: "operational",
    });
  }

  for (const correction of Array.isArray(corrections) ? corrections : []) {
    if (normalizeClientId(correction?.clientId) !== normalizedClientId) continue;
    const sourceUrl = correction?.sourceUrl || "";
    const record = {
      ...correction,
      issueType: correction?.issueType,
      issueLabel: correction?.issueLabel,
      sourceUrl,
    };
    const group = findOrCreate(groups, aliasMap, record, null, sourceUrl);
    const event = correctionEvent(correction);
    group.events.push(event);
    group.fields = [...new Set([...group.fields, ...(Array.isArray(correction?.fields) ? correction.fields : [])])];
    if (correction?.adapter) group.adapters = [...new Set([...group.adapters, correction.adapter])];
    const reason = `${correction?.reason || ""} ${correction?.verificationNote || ""} ${correction?.error || ""}`;
    if (/ownership/i.test(reason)) group.ownershipBlocked = true;
    if (/error|errore|failed|fallit/i.test(String(correction?.status || "")) || correction?.error) group.technicalError = true;
    if (correction?.quality) group.quality = correction.quality;
    addSource(group, {
      label: "Correzione WordPress",
      kind: "correction",
      at: event.at,
      detail: correction?.verificationNote || correction?.reason || `Stato correzione: ${correction?.status || "sconosciuto"}`,
      nature: correction?.status === "Verificato" ? "verified" : "operational",
    });
  }

  const rows = [...groups.values()].map((group) => {
    const state = deriveProblemState(group.events);
    const latestSource = [...group.sources].sort((a, b) => timestamp(b.at) - timestamp(a.at))[0] || null;
    const observedAt = state.lastAuditAt || latestSource?.at || "";
    const ageMs = observedAt ? Math.max(0, now - timestamp(observedAt)) : Number.POSITIVE_INFINITY;
    const confidence = issueConfidence(
      { type: group.issueType, label: group.title, detail: group.detail },
      {
        pageKind: group.pageKind,
        canonicalEvidence: group.evidence.some((item) => /canonical.*(?:http|frontend|destin)/i.test(item.detail || "")),
        browserRendered: group.evidence.some((item) => /browser|render|frontend verificato/i.test(item.detail || "")),
      },
    );
    return {
      key: group.key,
      title: group.title,
      issueType: group.issueType,
      sourceUrl: group.sourceUrl,
      detail: group.detail || "Dettaglio non disponibile.",
      severity: group.severity,
      priority: group.priority,
      problemState: state.problemState,
      interventionState: state.interventionState,
      correctability: issueCorrectability(
        { type: group.issueType, label: group.title, detail: group.detail },
        { pageKind: group.pageKind, ownershipBlocked: group.ownershipBlocked },
      ),
      confidence,
      observedAt,
      verifiedAt: state.verifiedAt,
      stale: !Number.isFinite(ageMs) || ageMs > 7 * 24 * 60 * 60_000,
      regression: state.problemState === "reappeared",
      ownershipBlocked: group.ownershipBlocked,
      technicalError: group.technicalError,
      fields: group.fields,
      adapters: group.adapters,
      sources: group.sources.toSorted((a, b) => timestamp(b.at) - timestamp(a.at)),
      evidence: group.evidence.toSorted((a, b) => timestamp(b.at) - timestamp(a.at)),
      auditScopes: [...group.auditScopes],
      quality: group.quality,
      pageKind: group.pageKind,
    };
  }).toSorted((a, b) => {
    const stateWeight = { reappeared: 0, open: 1, needs_verification: 2, intentional: 3, resolved: 4 };
    const severityWeight = { high: 0, medium: 1, low: 2, unknown: 3 };
    return (stateWeight[a.problemState] ?? 9) - (stateWeight[b.problemState] ?? 9) ||
      (severityWeight[a.severity] ?? 9) - (severityWeight[b.severity] ?? 9) ||
      timestamp(b.observedAt) - timestamp(a.observedAt);
  });

  return {
    rows,
    warnings: [...new Set(warnings)],
    coverage: {
      siteAuditAt: site?.analyzedAt || site?.startedAt || "",
      sitePages: Number(site?.pagesChecked || site?.pages?.length || 0),
      pageAudits: pageAudits.length,
    },
  };
}
