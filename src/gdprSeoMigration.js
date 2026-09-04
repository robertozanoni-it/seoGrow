const SITE_HISTORY_KEY = "seogrow-analyses-v2";
const PAGE_HISTORY_KEY = "seogrow-page-audit-history-v2";
const TASKS_KEY = "seogrow-tasks-v2";
const MIGRATION_KEY = "seogrow-gdpr-seo-policy-v1";
const GDPR_PATH = /(?:^|\/)(?:privacy(?:-policy)?|cookie(?:-policy)?|gdpr|informativa(?:-privacy)?|consenso(?:-cookie)?)(?:\/|$)/i;

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

const writeJson = (key, value) => {
  const serialized = JSON.stringify(value);
  localStorage.setItem(key, serialized);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: serialized }));
};

const isGdprUrl = (value) => {
  try { return GDPR_PATH.test(new URL(value).pathname); }
  catch { return GDPR_PATH.test(String(value || "")); }
};

const filteredIssues = (issues) => (Array.isArray(issues) ? issues : []).filter((issue) =>
  ![issue?.url, issue?.sourceUrl, issue?.targetUrl].filter(Boolean).some(isGdprUrl),
);

const recomputeSiteScore = (analysis, issues) => {
  const pages = Math.max(1, Number(analysis.pagesChecked || analysis.pages?.length || 1));
  const penalty = issues.reduce((sum, issue) => sum + (issue.severity === "alta" ? 5 : issue.severity === "media" ? 2 : 1), 0);
  const strongest = issues.reduce((maximum, issue) => Math.max(maximum, issue.severity === "alta" ? 5 : issue.severity === "media" ? 2 : 1), 0);
  const normalized = Math.round(strongest + Math.max(0, penalty - strongest) / Math.sqrt(pages));
  const failurePenalty = Math.min(40, Number(analysis.pagesFailed || 0) * 4 + (pages ? 0 : 60));
  return Math.max(0, Math.min(100, 100 - normalized - failurePenalty));
};

const migrateSiteHistory = () => {
  const store = readJson(SITE_HISTORY_KEY, {});
  let changed = false;
  const next = {};
  for (const [clientId, value] of Object.entries(store)) {
    const history = Array.isArray(value) ? value : value?.history || [];
    const mapped = history.map((analysis) => {
      const issues = filteredIssues(analysis?.issues);
      const excluded = (analysis?.issues?.length || 0) - issues.length;
      if (!excluded) return analysis;
      changed = true;
      const gdprPages = (analysis.pages || []).filter((page) => isGdprUrl(page?.url)).map((page) => page.url);
      return {
        ...analysis,
        issues,
        score: recomputeSiteScore(analysis, issues),
        summary: issues.reduce((acc, issue) => {
          acc[issue.type] = (acc[issue.type] || 0) + 1;
          return acc;
        }, {}),
        gdprReview: {
          managedSeparately: true,
          excludedSeoIssues: excluded,
          pagesDetected: gdprPages,
          note: "Pagine GDPR escluse dalle problematiche SEO e demandate al controllo GDPR dedicato.",
        },
      };
    });
    next[clientId] = Array.isArray(value) ? mapped : { ...value, history: mapped };
  }
  if (changed) writeJson(SITE_HISTORY_KEY, next);
};

const migratePageHistory = () => {
  const store = readJson(PAGE_HISTORY_KEY, {});
  let changed = false;
  const next = {};
  for (const [clientId, history] of Object.entries(store)) {
    next[clientId] = (Array.isArray(history) ? history : []).map((analysis) => {
      if (!isGdprUrl(analysis?.url)) return analysis;
      changed = true;
      return {
        ...analysis,
        issues: [],
        score: 100,
        gdprReview: {
          managedSeparately: true,
          url: analysis.url,
          note: "Pagina GDPR esclusa dalle problematiche SEO; verificare nel controllo GDPR dedicato.",
        },
      };
    });
  }
  if (changed) writeJson(PAGE_HISTORY_KEY, next);
};

const migrateTasks = () => {
  const tasks = readJson(TASKS_KEY, []);
  const next = tasks.filter((task) => {
    const url = task.sourceUrl || task.targetUrl || "";
    if (!isGdprUrl(url)) return true;
    return !String(task.id || "").startsWith("analysis-");
  });
  if (next.length !== tasks.length) writeJson(TASKS_KEY, next);
};

if (localStorage.getItem(MIGRATION_KEY) !== "done") {
  migrateSiteHistory();
  migratePageHistory();
  migrateTasks();
  localStorage.setItem(MIGRATION_KEY, "done");
}
