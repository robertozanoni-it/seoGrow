import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleGauge,
  ClipboardCheck,
  Database,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  HelpCircle,
  Home,
  Menu,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Target,
  Trash2,
  Upload,
  Users,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import AgentPage from "./AgentPage";
import GeoPage from "./GeoPage";
import { initialClients } from "./data";
import { apiFetch } from "./api";
import {
  formatInteger,
  formatPeriodDate,
  importGscZip,
  normalizeSiteHost,
  opportunityQueries,
} from "./gscImport";
import {
  downloadClientReport,
  exportWorkspaceBackup,
  readWorkspaceBackup,
  normalizeAgentRuns,
  suggestPageForQuery,
} from "./seoHelpers";
import {
  addDatasetToHistory,
  analysisDiff,
  buildNotifications,
  compareDatasets,
  contentPlan,
  downloadCsv,
  latestOf,
  normalizeAnalysisHistory,
  normalizeStoredTasks,
  opportunityGroups,
  queryChanges,
  queryTaskDetail,
  tasksFromAnalysis,
} from "./platform";

const nav = [
  ["Panoramica", Home],
  ["Clienti", Users],
  ["Audit SEO", CircleGauge],
  ["Storico", CalendarDays],
  ["Link interni", RefreshCw],
  ["Opportunità", Target],
  ["SEO Agent", WandSparkles],
  ["Posizionamenti", BarChart3],
  ["GEO AI", Sparkles],
  ["Piano editoriale", FileText],
  ["Task", ClipboardCheck],
  ["Integrazioni", Plug],
  ["Impostazioni", Settings],
];
const PerformanceChart = lazy(() => import("./PerformanceChart"));
const fetch = apiFetch;
const newId = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const stableKey = (value) => {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const normalizeProjectUrl = (value) => {
  const raw = String(value || "").trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes("."))
    throw new Error("Indirizzo web non valido");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  return url.href;
};
const projectIdentity = (value) => {
  try {
    const url = new URL(normalizeProjectUrl(value));
    return `${url.origin}${url.pathname.replace(/\/$/, "") || "/"}`;
  } catch {
    return "";
  }
};
const validateStoredValue = (key, value, initial) => {
  if (key === "seogrow-clients") {
    if (!Array.isArray(value) || !value.length) return initial;
    const valid = value.every(
      (client) =>
        client &&
        Number.isSafeInteger(client.id) &&
        client.id > 0 &&
        typeof client.name === "string" &&
        client.name.trim() &&
        projectIdentity(client.url),
    );
    return valid ? value : initial;
  }
  if (key.startsWith("seogrow-tasks")) {
    return normalizeStoredTasks(value, initial);
  }
  if (key === "seogrow-agent-runs-v1") return normalizeAgentRuns(value, initial);
  if (key === "seogrow-selected-page-v1")
    return nav.some(([label]) => label === value) ? value : initial;
  if (key === "seogrow-selected-client-v1")
    return Number.isSafeInteger(value) && value > 0 ? value : initial;
  if (Array.isArray(initial)) return Array.isArray(value) ? value : initial;
  if (initial && typeof initial === "object")
    return value && typeof value === "object" && !Array.isArray(value)
      ? { ...initial, ...value }
      : initial;
  return typeof value === typeof initial ? value : initial;
};

function useStoredState(key, fallback) {
  const [value, setValue] = useState(() => {
    const initial = () =>
      typeof fallback === "function" ? fallback() : fallback;
    try {
      const defaultValue = initial();
      return validateStoredValue(
        key,
        JSON.parse(localStorage.getItem(key)) ?? defaultValue,
        defaultValue,
      );
    } catch {
      return initial();
    }
  });
  useEffect(() => {
    const save = () => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        window.dispatchEvent(new CustomEvent("seogrow-storage-ok", { detail: { key } }));
      } catch (error) {
        console.error(`Impossibile salvare ${key}:`, error);
        window.dispatchEvent(
          new CustomEvent("seogrow-storage-error", {
            detail: { key, message: error.message },
          }),
        );
      }
    };
    const timer = window.setTimeout(save, 120);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", save);
    };
  }, [key, value]);
  useEffect(() => {
    const sync = (event) => {
      if (event.key !== key || event.newValue == null) return;
      try {
        const parsedRaw = JSON.parse(event.newValue);
        setValue((current) => {
          const parsed = validateStoredValue(key, parsedRaw, current);
          const compatible = Array.isArray(current)
            ? Array.isArray(parsed)
            : current && typeof current === "object"
              ? parsed && typeof parsed === "object" && !Array.isArray(parsed)
              : typeof parsed === typeof current;
          return compatible ? parsed : current;
        });
      } catch {
        /* Ignora scritture esterne non valide. */
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);
  return [value, setValue];
}

function HistoryPage({ history, client, onAnalyze }) {
  const current = history[0];
  return (
    <>
      <EmptyTitle
        title={`Storico analisi — ${client.name}`}
        text="Confronta scansioni, problemi nuovi e correzioni confermate."
        action="Nuova analisi"
        onAction={onAnalyze}
      />
      {current ? (
        <>
          <div className="stats history-stats">
            <Stat
              label="Punteggio attuale"
              value={`${current.score ?? "—"}/100`}
              meta={
                current.hasPrevious
                  ? `${current.scoreDelta > 0 ? "+" : ""}${current.scoreDelta} punti`
                  : "Prima scansione disponibile"
              }
              tone={current.scoreDelta < 0 ? "red" : "green"}
              Icon={CircleGauge}
            />
            <Stat
              label="Problemi"
              value={current.issues?.length || 0}
              meta={`${current.newIssues?.length || 0} nuovi`}
              tone="red"
              Icon={AlertTriangle}
            />
            <Stat
              label="Risolti"
              value={current.resolvedIssues?.length || 0}
              meta="rispetto al crawl precedente"
              tone="green"
              Icon={Check}
            />
            <Stat
              label="Pagine"
              value={current.pagesChecked || 0}
              meta={`${current.linksChecked || 0} link controllati`}
              tone="blue"
              Icon={Globe2}
            />
          </div>
          <section className="panel history-list">
            <div className="panel-head">
              <h2>Scansioni salvate</h2>
              <button
                className="secondary small-button"
                onClick={() =>
                  downloadCsv(
                    history.map((item) => ({
                      data: item.analyzedAt,
                      score: item.score,
                      pagine: item.pagesChecked,
                      problemi: item.issues?.length || 0,
                      nuovi: item.newIssues?.length || 0,
                      risolti: item.resolvedIssues?.length || 0,
                    })),
                    `storico-${client.name}.csv`,
                  )
                }
              >
                <Download />
                CSV
              </button>
            </div>
            <div className="table-scroll">
              <table>
                <caption className="sr-only">Storico delle analisi SEO del progetto</caption>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Punteggio</th>
                    <th>Pagine</th>
                    <th>Problemi</th>
                    <th>Nuovi</th>
                    <th>Risolti</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.analyzedAt}>
                      <td>
                        {new Date(item.analyzedAt).toLocaleString("it-IT")}
                      </td>
                      <td>
                        <strong>{item.score ?? "—"}/100</strong>
                      </td>
                      <td>{item.pagesChecked}</td>
                      <td>{item.issues?.length || 0}</td>
                      <td>{item.newIssues?.length || 0}</td>
                      <td>{item.resolvedIssues?.length || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <EmptyState
          text="Non ci sono ancora scansioni per questo progetto."
          action="Avvia la prima analisi"
          onAction={onAnalyze}
        />
      )}
    </>
  );
}

function InternalLinksPage({ analysis, client, onAnalyze, onCreateTask }) {
  const suggestions = analysis?.internalLinkSuggestions || [];
  const broken = analysis?.brokenLinks || [];
  return (
    <>
      <EmptyTitle
        title={`Link interni — ${client.name}`}
        text="Collegamenti interrotti verificati e nuove connessioni suggerite dal crawl."
        action="Nuova analisi"
        onAction={onAnalyze}
      />
      {analysis && (
        <div className="source-banner">
          <Check />
          Ultimo crawl: {new Date(analysis.analyzedAt).toLocaleString(
            "it-IT",
          )}{" "}
          · {analysis.linksChecked || 0} link controllati
        </div>
      )}
      <div className="split-panels">
        <section className="panel link-panel">
          <div className="panel-head">
            <div>
              <h2>Link interrotti</h2>
              <p>Tutte le pagine sorgenti rilevate.</p>
            </div>
            <span className="count-badge red">{broken.length}</span>
          </div>
          {broken.length ? (
            broken.map((link) => (
              <div className="link-row" key={link.url}>
                <div>
                  <strong>{link.status || "Errore"}</strong>
                  <a href={link.url} target="_blank" rel="noreferrer">
                    {link.url}
                  </a>
                  {(link.sources || []).map((source) => (
                    <a
                      className="source-link"
                      key={source}
                      href={source}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Da: {source}
                    </a>
                  ))}
                </div>
                <button
                  className="secondary mini"
                  onClick={() =>
                    onCreateTask({
                      title: `Correggi link interrotto: ${link.url}`,
                      sourceUrl: link.sources?.[0] || "",
                      targetUrl: link.url,
                      detail: `${link.error || `HTTP ${link.status}`}\nPagine sorgenti:\n${(link.sources || []).map((source) => `- ${source}`).join("\n")}\nDestinazione interrotta: ${link.url}`,
                      priority: "Alta",
                      kind: "broken-link",
                    })
                  }
                >
                  Crea task
                </button>
              </div>
            ))
          ) : (
            <p className="empty-copy">
              {analysis
                ? "Nessun link interrotto rilevato nell’ultima analisi."
                : "Avvia una nuova analisi completa per controllare i link."}
            </p>
          )}
        </section>
        <section className="panel link-panel">
          <div className="panel-head">
            <div>
              <h2>Link suggeriti</h2>
              <p>Suggerimenti da verificare editorialmente.</p>
            </div>
            <span className="count-badge">{suggestions.length}</span>
          </div>
          {suggestions.length ? (
            suggestions.map((link, index) => (
              <div
                className="link-row"
                key={`${link.sourceUrl}-${link.targetUrl}-${index}`}
              >
                <div>
                  <a href={link.sourceUrl} target="_blank" rel="noreferrer">
                    Pagina sorgente
                  </a>
                  <a href={link.targetUrl} target="_blank" rel="noreferrer">
                    Destinazione: {link.targetUrl}
                  </a>
                  <strong>Anchor: “{link.anchor}”</strong>
                </div>
                <button
                  className="secondary mini"
                  onClick={() =>
                    onCreateTask({
                      title: `Inserisci link interno: “${link.anchor}”`,
                      sourceUrl: link.sourceUrl,
                      targetUrl: link.targetUrl,
                      detail: `${link.reason}\nPagina sorgente: ${link.sourceUrl}\nDestinazione: ${link.targetUrl}\nAnchor consigliata: ${link.anchor}`,
                      priority: "Media",
                      kind: "internal-link",
                    })
                  }
                >
                  Crea task
                </button>
              </div>
            ))
          ) : (
            <p className="empty-copy">
              Avvia un crawl completo per generare suggerimenti.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function EmptyState({ text, action, onAction }) {
  return (
    <section className="panel empty-state">
      <CircleGauge />
      <h2>{text}</h2>
      {action && (
        <button className="primary" onClick={onAction}>
          {action}
        </button>
      )}
    </section>
  );
}

function Logo() {
  return (
    <div className="logo">
      <span>seo</span>
      <strong>Grow</strong>
      <b>AI</b>
      <Activity size={25} />
    </div>
  );
}

function Sidebar({ page, setPage, open, setOpen, displayName }) {
  const sidebarRef = useRef(null);
  const previousFocusRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    window.setTimeout(
      () => sidebarRef.current?.querySelector("button")?.focus(),
      0,
    );
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab") {
        const focusable = [
          ...(sidebarRef.current?.querySelectorAll("button:not(:disabled)") || []),
        ];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      previousFocusRef.current?.focus?.();
    };
  }, [open, setOpen]);
  return (
    <aside
      ref={sidebarRef}
      className={`sidebar ${open ? "open" : ""}`}
      role={open ? "dialog" : undefined}
      aria-modal={open || undefined}
      aria-label={open ? "Menu principale" : undefined}
    >
      <div className="side-head">
        <Logo />
        <button
          className="icon-btn mobile-only"
          onClick={() => setOpen(false)}
          aria-label="Chiudi menu"
        >
          <X />
        </button>
      </div>
      <nav>
        {nav.map(([label, Icon]) => (
          <button
            key={label}
            className={page === label ? "active" : ""}
            aria-current={page === label ? "page" : undefined}
            onClick={() => {
              setPage(label);
              setOpen(false);
            }}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="side-foot">
        <div className="avatar avatar-small">
          {displayName
            .split(/\s+/)
            .map((word) => word[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </div>
        <div>
          <strong>{displayName}</strong>
          <small>Amministratore</small>
        </div>
      </div>
    </aside>
  );
}

function Header({
  clients,
  selectedClient,
  setSelectedClient,
  setMenuOpen,
  query,
  setQuery,
  searchResults,
  onSearchResult,
  notifications,
  onNotifications,
  onHelp,
  displayName,
}) {
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef(null);
  const notificationButtonRef = useRef(null);
  const searchRef = useRef(null);
  const closeNotifications = (restoreFocus = false) => {
    setShowNotifications(false);
    if (restoreFocus)
      window.setTimeout(() => notificationButtonRef.current?.focus(), 0);
  };
  useEffect(() => {
    if (!showNotifications) return undefined;
    const closeOnInteraction = (event) => {
      if (event.key === "Escape") closeNotifications(true);
      if (event.type === "mousedown" && !notificationRef.current?.contains(event.target))
        setShowNotifications(false);
    };
    window.addEventListener("keydown", closeOnInteraction);
    window.addEventListener("mousedown", closeOnInteraction);
    return () => {
      window.removeEventListener("keydown", closeOnInteraction);
      window.removeEventListener("mousedown", closeOnInteraction);
    };
  }, [showNotifications]);
  useEffect(() => {
    if (!showNotifications) return;
    notificationRef.current?.querySelector(".notification-menu button")?.focus();
  }, [showNotifications]);
  useEffect(() => {
    if (!showNotifications) return undefined;
    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const buttons = [
        ...(notificationRef.current?.querySelectorAll(
          ".notification-menu button:not(:disabled)",
        ) || []),
      ];
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trapFocus);
    return () => window.removeEventListener("keydown", trapFocus);
  }, [showNotifications]);
  useEffect(() => {
    if (!query.trim()) return undefined;
    const closeSearch = (event) => {
      if (!searchRef.current?.contains(event.target)) setQuery("");
    };
    window.addEventListener("mousedown", closeSearch);
    return () => window.removeEventListener("mousedown", closeSearch);
  }, [query, setQuery]);
  return (
    <header className="topbar">
      <button
        className="icon-btn mobile-only"
        onClick={() => setMenuOpen(true)}
        aria-label="Apri menu"
      >
        <Menu />
      </button>
      <label className="client-select">
        <Globe2 />
        <select
          aria-label="Progetto attivo"
          value={selectedClient}
          onChange={(e) => setSelectedClient(Number(e.target.value))}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <ChevronDown />
      </label>
      <div className="global-search-wrap" ref={searchRef}>
        <label className="global-search">
          <span className="sr-only">Cerca nell’app</span>
          <Search />
          <input
            aria-label="Cerca nell’app"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
              if (event.key === "ArrowDown") {
                event.preventDefault();
                event.currentTarget
                  .closest(".global-search-wrap")
                  ?.querySelector(".search-results button")
                  ?.focus();
              }
            }}
            placeholder="Cerca clienti, task e sezioni…"
          />
        </label>
        {query.trim() && (
          <div id="global-search-results" className="search-results" role="region" aria-label="Risultati della ricerca">
            {searchResults.length ? (
              searchResults.map((item, index) => (
                <button
                  key={`${item.page}-${item.clientId || "app"}-${item.taskId || item.label}-${index}`}
                  onClick={() => onSearchResult(item)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      (event.currentTarget.nextElementSibling || event.currentTarget.parentElement.firstElementChild)?.focus();
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      (event.currentTarget.previousElementSibling || event.currentTarget.parentElement.lastElementChild)?.focus();
                    }
                    if (event.key === "Escape") {
                      setQuery("");
                      event.currentTarget.closest(".global-search-wrap")?.querySelector("input")?.focus();
                    }
                  }}
                >
                  <strong>{item.label}</strong>
                  <small>{item.meta}</small>
                </button>
              ))
            ) : (
              <p>Nessun risultato.</p>
            )}
          </div>
        )}
      </div>
      <div className="top-actions" ref={notificationRef}>
        <button
          ref={notificationButtonRef}
          className="icon-btn"
          aria-label="Notifiche"
          aria-expanded={showNotifications}
          aria-controls="notification-menu"
          aria-haspopup="dialog"
          onClick={() => setShowNotifications((value) => !value)}
        >
          <Bell />
          {notifications.length > 0 && (
            <i>{notifications.length > 9 ? "9+" : notifications.length}</i>
          )}
        </button>
        <button className="icon-btn help" aria-label="Aiuto" onClick={onHelp}>
          <HelpCircle />
        </button>
        <div className="avatar">
          {displayName
            .split(/\s+/)
            .map((word) => word[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </div>
        {showNotifications && (
          <div id="notification-menu" className="notification-menu" role="dialog" aria-label="Notifiche">
            <div className="panel-head">
              <h2>Notifiche</h2>
              <button
                className="icon-btn"
                aria-label="Chiudi notifiche"
                onClick={() => closeNotifications(true)}
              >
                <X />
              </button>
            </div>
            {notifications.length ? (
              notifications.map((item, index) => (
                <button
                  key={`${item.title}-${item.text}-${index}`}
                  onClick={() => {
                    onNotifications(item);
                    setShowNotifications(false);
                  }}
                >
                  <AlertTriangle className={item.tone} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.text}</small>
                  </span>
                </button>
              ))
            ) : (
              <p>Nessun avviso per il progetto selezionato.</p>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

function Stat({ label, value, meta, tone, Icon }) {
  return (
    <div className="stat">
      <div>
        <span>{label}</span>
        <strong className={tone}>{value}</strong>
        <small>{meta}</small>
      </div>
      <div className={`stat-icon ${tone}`}>
        <Icon />
      </div>
    </div>
  );
}

function VisibilityChart({ dataset }) {
  if (!dataset?.graph?.length)
    return (
      <section className="panel chart-panel empty-chart">
        <h2>Visibilità organica</h2>
        <p>Importa Search Console per visualizzare clic e impressioni reali.</p>
      </section>
    );
  const data = dataset.graph;
  const impressions = formatInteger(dataset.totals.impressions);
  const clicks = formatInteger(dataset.totals.clicks);
  return (
    <section className="panel chart-panel">
      <div className="panel-head">
        <div>
          <h2>Visibilità organica</h2>
          <div className="legend">
            <span className="green-dot" /> Impressioni <b>{impressions}</b>
            <span className="blue-dot" /> Clic <b>{clicks}</b>
          </div>
        </div>
        <span className="chart-period">
          {`${dataset.graph.length} giorni`}
        </span>
      </div>
      <div className="chart-wrap">
        <Suspense fallback={<div className="chart-loading">Caricamento grafico…</div>}>
          <PerformanceChart data={data} />
        </Suspense>
      </div>
    </section>
  );
}

function DataSource({ dataset, openIntegrations }) {
  const rows = dataset
    ? [
        [
          "Query rilevate",
          formatInteger(dataset.queries.length),
          Search,
          "green",
        ],
        [
          "Pagine rilevate",
          formatInteger(dataset.pages.length),
          FileText,
          "blue",
        ],
        [
          "Paesi e dispositivi",
          `${dataset.countries.length} · ${dataset.devices.length}`,
          Globe2,
          "purple",
        ],
      ]
    : [
        ["Google Search Console", "Non importato", Database, "green"],
        ["Metriche dashboard", "Dimostrative", Activity, "blue"],
        ["Importazione", "ZIP Search Console", Upload, "purple"],
      ];
  return (
    <section className="panel agents">
      <div className="panel-head">
        <h2>Origine dei dati</h2>
        <span className={`live ${dataset ? "" : "muted-live"}`}>
          <i />
          {dataset ? "Dati reali" : "Da configurare"}
        </span>
      </div>
      {rows.map(([name, text, Icon, tone]) => (
        <div className="agent" key={name}>
          <div className={`agent-icon ${tone}`}>
            <Icon />
          </div>
          <div>
            <strong>{name}</strong>
            <small>{text}</small>
          </div>
        </div>
      ))}
      <button className="text-link" onClick={openIntegrations}>
        {dataset ? "Aggiorna i dati" : "Importa Search Console"} <span>→</span>
      </button>
    </section>
  );
}

function TaskTable({
  tasks,
  setTasks,
  compact = false,
  title,
  client,
  clients = [],
  openTaskId,
  onTaskOpened,
}) {
  const [editing, setEditing] = useState(
    () => tasks.find((item) => item.id === openTaskId) || null,
  );
  const [taskQuery, setTaskQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Tutti");
  useEffect(() => {
    if (!openTaskId) return undefined;
    const requested = tasks.find((item) => item.id === openTaskId);
    const timer = window.setTimeout(() => {
      if (requested) setEditing(requested);
      onTaskOpened?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openTaskId, onTaskOpened, tasks]);
  const priorityWeight = (task) => ({ Alta: 0, Media: 1, Bassa: 2 })[task.priority] ?? 3;
  const dueTime = (task) =>
    /^\d{4}-\d{2}-\d{2}$/.test(task.due || "")
      ? Date.parse(`${task.due}T00:00:00`)
      : Number.MAX_SAFE_INTEGER;
  const visibleTasks = compact
    ? tasks
        .filter((task) => !task.stale && task.status !== "Completato")
        .toSorted((a, b) => dueTime(a) - dueTime(b) || priorityWeight(a) - priorityWeight(b))
        .slice(0, 8)
    : tasks
        .filter(
          (task) =>
            statusFilter === "Archiviate"
              ? task.stale
              : !task.stale &&
                (statusFilter === "Tutti" || task.status === statusFilter),
        )
        .filter((task) =>
          `${task.title} ${task.detail || ""}`
            .toLowerCase()
            .includes(taskQuery.trim().toLowerCase()),
        )
        .toSorted((a, b) => {
          return dueTime(a) - dueTime(b) || priorityWeight(a) - priorityWeight(b);
        });
  const statuses = ["Da fare", "In corso", "In revisione", "Completato"];
  return (
    <section className={`panel tasks-panel ${compact ? "compact" : ""}`}>
      <div className="panel-head">
        <div>
          <h2>
            {title || (compact ? "Priorità di oggi" : "Task del progetto")}
          </h2>
          <p>
            {compact
              ? "Le attività con il maggiore impatto."
              : "Solo attività relative al sito selezionato."}
          </p>
        </div>
        {!compact && (
          <div className="inline-actions">
            <button
              className="secondary small-button"
              onClick={() =>
                setEditing({
                  title: "",
                  priority: "Media",
                  due: "",
                  status: "Da fare",
                  targetUrl: client?.url || "",
                  sourceUrl: "",
                  detail: "",
                  notes: "",
                  sourceClientId: client?.id,
                  client: client?.name,
                })
              }
            >
              <Plus />
              Nuova task
            </button>
            <button
              className="secondary small-button"
              onClick={() =>
                downloadCsv(tasks, `task-${client?.name || "progetto"}.csv`)
              }
            >
              <Download />
              CSV
            </button>
          </div>
        )}
      </div>
      {!compact && (
        <div className="task-filters">
          <label>
            <span className="sr-only">Cerca task</span>
            <Search />
            <input
              value={taskQuery}
              onChange={(event) => setTaskQuery(event.target.value)}
              placeholder="Cerca nelle task…"
            />
          </label>
          <select
            aria-label="Filtra per stato"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option>Tutti</option>
            <option>Da fare</option>
            <option>In corso</option>
            <option>In revisione</option>
            <option>Completato</option>
            <option>Archiviate</option>
          </select>
          <small>{visibleTasks.length} task visualizzate</small>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Task del progetto selezionato</caption>
          <thead>
            <tr>
              <th>Task</th>
              <th>Pagina o dettaglio</th>
              <th>Priorità</th>
              <th>Scadenza</th>
              <th>Stato</th>
            </tr>
          </thead>
          <tbody>
            {visibleTasks.length ? (
              visibleTasks.map((task) => (
                <tr key={task.id}>
                  <td>
                    <button
                      className="task-title-button"
                      onClick={() => setEditing(task)}
                    >
                      <span className={`row-icon ${task.kind}`}>
                        <Zap />
                      </span>
                      <strong>{task.title}</strong>
                    </button>
                  </td>
                  <td>
                    <div className="task-links">
                      {task.targetUrl ? (
                        <a
                          className="task-link"
                          href={task.targetUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink />
                          {task.linkLabel || "Apri pagina"}
                        </a>
                      ) : (
                        !task.sourceUrl && (
                          <span className="task-detail">
                            {task.detail || "Dettaglio non disponibile"}
                          </span>
                        )
                      )}
                      {task.sourceUrl && (
                        <a
                          className="task-link"
                          href={task.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink />
                          {task.kind === "search"
                            ? "Apri pagina suggerita"
                            : "Apri pagina sorgente"}
                        </a>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`priority ${task.priority.toLowerCase()}`}>
                      {task.priority}
                    </span>
                  </td>
                  <td>{task.due || "Da pianificare"}</td>
                  <td>
                    <select
                      className={`status ${task.status.toLowerCase().replaceAll(" ", "-")}`}
                      aria-label={`Stato della task ${task.title}`}
                      value={task.status}
                      onChange={(event) => {
                        const status = event.target.value;
                        setTasks((items) =>
                          items.map((item) =>
                            item.id === task.id
                              ? {
                                  ...item,
                                  status,
                                  updatedAt: new Date().toISOString(),
                                  completedAt:
                                    status === "Completato"
                                      ? new Date().toISOString()
                                      : null,
                                }
                              : item,
                          ),
                        );
                      }}
                    >
                      {statuses.map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="5" className="empty-row">
                  Nessun task verificato per questo progetto. Importa Search
                  Console o avvia una nuova analisi.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <TaskEditor
          task={editing}
          client={client}
          clients={clients}
          close={() => setEditing(null)}
          save={(task) => {
            const targetClientId = task.sourceClientId || client.id;
            const duplicate = tasks.some(
              (item) =>
                item.id !== task.id &&
                item.sourceClientId === targetClientId &&
                item.status !== "Completato" &&
                String(item.title || "").trim().toLocaleLowerCase("it") ===
                  String(task.title || "").trim().toLocaleLowerCase("it") &&
                (item.sourceUrl || "") === (task.sourceUrl || "") &&
                (item.targetUrl || "") === (task.targetUrl || ""),
            );
            if (duplicate) {
              window.alert("Esiste già una task attiva con lo stesso titolo e gli stessi collegamenti.");
              return;
            }
            setTasks((current) => {
              const exists = current.some((item) => item.id === task.id);
              return exists
                ? current.map((item) =>
                    item.id === task.id ? { ...task, userEdited: true } : item,
                  )
                : [
                    {
                      ...task,
                      id: newId("manual"),
                      sourceClientId: task.sourceClientId || client.id,
                      client:
                        clients.find((item) => item.id === task.sourceClientId)?.name ||
                        task.client ||
                        client.name,
                      kind: "manual",
                      createdAt: new Date().toISOString(),
                    },
                    ...current,
                  ];
            });
            setEditing(null);
          }}
          remove={
            editing.id
              ? () => {
                  if (window.confirm("Eliminare questa task?")) {
                    setTasks((current) =>
                      current.filter((item) => item.id !== editing.id),
                    );
                    setEditing(null);
                  }
                }
              : null
          }
        />
      )}
    </section>
  );
}

function TaskEditor({ task, save, remove, close, clients = [] }) {
  const [form, setForm] = useState(task);
  const suggested = form.associationStatus === "suggested";
  const manuallyVerified = form.associationStatus === "verified-manual";
  return (
    <Modal title={task.id ? "Dettaglio task" : "Nuova task"} close={close}>
      <form
        className="form task-editor"
        onSubmit={(event) => {
          event.preventDefault();
          if (form.title.trim())
            save({ ...form, updatedAt: new Date().toISOString() });
        }}
      >
        {form.kind === "search" && (
          <div
            className={`task-evidence ${suggested ? "warning" : "verified"}`}
          >
            <AlertTriangle />
            <div>
              <strong>
                {suggested
                  ? "Associazione query–pagina da verificare"
                  : manuallyVerified
                    ? "Associazione verificata manualmente"
                    : "Dati query–pagina disponibili"}
              </strong>
              <p>
                {suggested
                  ? "Lo ZIP separa query e pagine: questa URL è un suggerimento, non una relazione certificata."
                  : manuallyVerified
                    ? "Hai confermato questa relazione: resta modificabile dal dettaglio task."
                    : "La pagina proviene dai dati query–pagina dell’importazione API."}
              </p>
            </div>
          </div>
        )}
        {form.kind === "search" && form.sourceUrl && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.associationStatus === "verified-manual"}
              onChange={(event) =>
                setForm({
                  ...form,
                  associationStatus: event.target.checked
                    ? "verified-manual"
                    : "suggested",
                })
              }
            />
            <span>Ho verificato manualmente che questa query appartiene alla pagina indicata</span>
          </label>
        )}
        <label>
          Titolo
          <input
            value={form.title}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
            required
          />
        </label>
        {clients.length > 1 && (
          <label>
            Progetto
            <select
              value={form.sourceClientId || ""}
              onChange={(event) => {
                const sourceClientId = Number(event.target.value);
                const selected = clients.find((item) => item.id === sourceClientId);
                setForm({
                  ...form,
                  id:
                    form.sourceClientId === sourceClientId
                      ? form.id
                      : newId("manual"),
                  sourceClientId,
                  client: selected?.name || form.client,
                  kind: "manual",
                  detachedFromAutomation: true,
                  sourceUrl: "",
                  targetUrl: selected?.url || "",
                  associationStatus: "manual",
                  query: "",
                  metrics: undefined,
                });
              }}
            >
              {clients.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        )}
        <div className="form-row">
          <label>
            Priorità
            <select
              value={form.priority}
              onChange={(event) =>
                setForm({ ...form, priority: event.target.value })
              }
            >
              <option>Alta</option>
              <option>Media</option>
              <option>Bassa</option>
            </select>
          </label>
          <label>
            Stato
            <select
              value={form.status}
              onChange={(event) =>
                setForm({ ...form, status: event.target.value })
              }
            >
              <option>Da fare</option>
              <option>In corso</option>
              <option>In revisione</option>
              <option>Completato</option>
            </select>
          </label>
          <label>
            Scadenza
            <input
              type="date"
              value={/^\d{4}-/.test(form.due || "") ? form.due : ""}
              onChange={(event) =>
                setForm({ ...form, due: event.target.value })
              }
            />
          </label>
        </div>
        <label>
          Pagina da correggere o verificare
          <input
            type="url"
            value={form.sourceUrl || ""}
            onChange={(event) =>
              setForm({ ...form, sourceUrl: event.target.value })
            }
          />
          {form.sourceUrl && (
            <a
              className="inline-resource"
              href={form.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink />
              Apri la pagina
            </a>
          )}
        </label>
        <label>
          Destinazione o risorsa collegata
          <input
            type="url"
            value={form.targetUrl || ""}
            onChange={(event) =>
              setForm({ ...form, targetUrl: event.target.value })
            }
          />
        </label>
        <label>
          Problema, evidenze e istruzioni
          <textarea
            className="task-instructions"
            value={form.detail || ""}
            onChange={(event) =>
              setForm({ ...form, detail: event.target.value })
            }
          />
        </label>
        <label>
          Note operative
          <textarea
            value={form.notes || ""}
            onChange={(event) =>
              setForm({ ...form, notes: event.target.value })
            }
            placeholder="Annota cosa è stato modificato e la data…"
          />
        </label>
        <div className="modal-actions">
          {remove && (
            <button
              type="button"
              className="secondary danger-text"
              onClick={remove}
            >
              <Trash2 />
              Elimina
            </button>
          )}
          <button className="primary">Salva task</button>
        </div>
      </form>
    </Modal>
  );
}

function RecentClients({ clients, setPage, gscData, onOpenClient }) {
  return (
    <section className="panel recent">
      <div className="panel-head">
        <h2>Clienti recenti</h2>
        <button className="text-link" onClick={() => setPage("Clienti")}>
          Vedi tutti
        </button>
      </div>
      {clients.slice(0, 4).map((client) => {
        const dataset = gscData[client.id];
        return (
          <button
            type="button"
            className="client-row"
            key={client.id}
            onClick={() => onOpenClient(client.id)}
          >
            <div
              className="client-initial"
              style={{ background: client.color }}
            >
              {client.name
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div>
              <strong>{client.name}</strong>
              <small>
                {client.sites} {client.sites === 1 ? "sito" : "siti"}
              </small>
            </div>
            <span className={dataset ? "has-real-data" : "demo-data"}>
              <i />
              {dataset
                ? `${formatInteger(dataset.totals.impressions)} imp.`
                : "Non importati"}
            </span>
          </button>
        );
      })}
    </section>
  );
}

function Dashboard({
  clients,
  tasks,
  setTasks,
  setPage,
  openAudit,
  dataset,
  previousDataset,
  analysis,
  selectedClient,
  gscData,
  onOpenClient,
}) {
  const opportunityCount = dataset ? opportunityQueries(dataset).length : 0;
  const selectedName = clients.find(
    (client) => client.id === selectedClient,
  )?.name;
  const clientTasks = tasks.filter(
    (task) =>
      task.sourceClientId === selectedClient ||
      (!task.sourceClientId && task.client === selectedName),
  );
  const comparison = compareDatasets(dataset, previousDataset);
  const notices = buildNotifications({
    tasks: clientTasks,
    dataset,
    previousDataset,
    analysis,
  });
  const metrics = dataset
    ? [
        [
          "Clic organici",
          formatInteger(dataset.totals.clicks),
          comparison?.clicks != null
            ? `${comparison.clicks >= 0 ? "+" : ""}${comparison.clicks.toFixed(1)}% vs precedente`
            : `${formatPeriodDate(dataset.dateFrom)} – ${formatPeriodDate(dataset.dateTo)}`,
          comparison?.clicks < -10 ? "red" : "green",
          Activity,
        ],
        [
          "Impressioni",
          formatInteger(dataset.totals.impressions),
          comparison?.impressions != null
            ? `${comparison.impressions >= 0 ? "+" : ""}${comparison.impressions.toFixed(1)}% vs precedente`
            : "Google Search Console",
          "blue",
          Target,
        ],
        [
          "CTR medio",
          `${dataset.totals.ctr.toFixed(2).replace(".", ",")}%`,
          "clic ÷ impressioni",
          "green",
          CircleGauge,
        ],
        [
          "Posizione media",
          dataset.totals.position.toFixed(1).replace(".", ","),
          `${opportunityCount} opportunità prioritarie`,
          "blue",
          Search,
        ],
      ]
    : [
        ["Clic organici", "—", "Importa Search Console", "green", Activity],
        ["Impressioni", "—", "Importa Search Console", "blue", Target],
        [
          "Salute tecnica",
          analysis?.score != null ? `${analysis.score}/100` : "—",
          analysis ? "Ultima analisi disponibile" : "Avvia una nuova analisi",
          analysis?.score >= 80 ? "green" : "red",
          Bell,
        ],
        [
          "Piano editoriale",
          "—",
          "Richiede dati del progetto",
          "blue",
          FileText,
        ],
      ];
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Panoramica del progetto</h1>
          <p>
            {dataset
              ? `Dati reali Search Console aggiornati al ${formatPeriodDate(dataset.dateTo)}.`
              : "Importa i dati del progetto o avvia una prima analisi."}
          </p>
        </div>
        <button className="primary" onClick={openAudit}>
          <Plus />
          Nuova analisi
        </button>
      </div>
      <div className="stats">
        {metrics.map(([label, value, meta, tone, Icon]) => (
          <Stat
            key={label}
            label={label}
            value={value}
            meta={meta}
            tone={tone}
            Icon={Icon}
          />
        ))}
      </div>
      {notices.length > 0 && (
        <section className="notification-strip">
          {notices.slice(0, 3).map((item) => (
            <button
              key={item.title}
              onClick={() =>
                setPage(item.title.includes("task") ? "Task" : "Opportunità")
              }
            >
              <AlertTriangle className={item.tone} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </span>
            </button>
          ))}
        </section>
      )}
      <div className="dashboard-grid">
        <VisibilityChart dataset={dataset} />
        <DataSource
          dataset={dataset}
          openIntegrations={() => setPage("Integrazioni")}
        />
        <TaskTable
          tasks={clientTasks}
          setTasks={setTasks}
          compact
          title="Priorità del progetto"
          client={clients.find((item) => item.id === selectedClient)}
          clients={clients}
        />
        <RecentClients clients={clients} setPage={setPage} gscData={gscData} onOpenClient={onOpenClient} />
      </div>
    </>
  );
}

function EmptyTitle({ title, text, action, onAction }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action && (
        <button className="primary" onClick={onAction}>
          <Plus />
          {action}
        </button>
      )}
    </div>
  );
}

function ClientsPage({
  clients,
  setClients,
  gscData,
  onOpenClient,
  onDeleteClient,
  onDownloadReport,
  onUpdateClient,
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", url: "" });
  const [formError, setFormError] = useState("");
  const add = (e) => {
    e.preventDefault();
    if (!form.name || !form.url) return;
    let normalizedUrl;
    try {
      normalizedUrl = normalizeProjectUrl(form.url);
    } catch {
      return setFormError("Inserisci un indirizzo web valido.");
    }
    if (clients.some((client) => client.id !== editingId && projectIdentity(client.url) === projectIdentity(normalizedUrl)))
      return setFormError("Esiste già un progetto associato a questo sito o sottocartella.");
    if (editingId) {
      onUpdateClient(editingId, {
        name: form.name.trim(),
        url: normalizedUrl,
      });
      setEditingId(null);
      setOpen(false);
      setForm({ name: "", url: "" });
      setFormError("");
      return;
    }
    setClients([
      ...clients,
      {
        id: Math.max(0, ...clients.map((client) => Number(client.id) || 0)) + 1,
        ...form,
        name: form.name.trim(),
        url: normalizedUrl,
        score: 0,
        sites: 1,
        color: "#2477ee",
      },
    ]);
    setOpen(false);
    setForm({ name: "", url: "" });
    setFormError("");
  };
  const openClient = (event, id) => {
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    onOpenClient(id);
  };
  return (
    <>
      <EmptyTitle
        title="Clienti"
        text="Tutti i progetti SEO in un unico spazio. Clicca una card per aprire la panoramica."
        action="Nuovo cliente"
        onAction={() => setOpen(true)}
      />
      <div className="client-grid">
        {clients.map((c) => {
          const dataset = gscData[c.id];
          return (
            <article
              className="client-card"
              key={c.id}
              onClick={(event) => {
                if (!event.target.closest("a,button")) openClient(event, c.id);
              }}
            >
              <div className="client-card-top">
                <div
                  className="client-initial large"
                  style={{ background: c.color }}
                >
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
                <span className={`score ${dataset ? "" : "demo-score"}`}>
                  {dataset ? formatInteger(dataset.totals.impressions) : "—"}
                  <small>{dataset ? " imp." : ""}</small>
                </span>
              </div>
              <h2>{c.name}</h2>
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                {c.url.replace(/^https?:\/\//, "")}
              </a>
              <div className="client-meta">
                <span>{c.sites} sito</span>
                <span>
                  {dataset
                    ? `${dataset.queries.length} query importate`
                    : "Dati da importare"}
                </span>
              </div>
              <button
                className="open-project"
                aria-label={`Apri la panoramica di ${c.name}`}
                onClick={(event) => openClient(event, c.id)}
              >
                Apri panoramica →
              </button>
              <div className="client-actions">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onDownloadReport(c.id);
                  }}
                >
                  <Download />
                  Report
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingId(c.id);
                    setForm({ name: c.name, url: c.url });
                    setFormError("");
                    setOpen(true);
                  }}
                >
                  Modifica
                </button>
                <button
                  className="danger-text"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteClient(c.id);
                  }}
                >
                  <Trash2 />
                  Elimina
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {open && (
        <Modal
          title={editingId ? "Modifica cliente" : "Nuovo cliente"}
          close={() => {
            setOpen(false);
            setEditingId(null);
            setForm({ name: "", url: "" });
            setFormError("");
          }}
        >
          <form onSubmit={add} className="form">
            <label>
              Nome cliente
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Es. Studio Rossi"
                required
              />
            </label>
            <label>
              Sito web
              <input
                type="url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://…"
                required
              />
            </label>
            {formError && <p className="error">{formError}</p>}
            <button className="primary" type="submit">
              {editingId ? "Salva modifiche" : "Crea cliente"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

function AuditPage({
  auditResult,
  setAuditResult,
  autoOpen = false,
  onCloseAuto,
  initialUrl = "https://studiodentisticozirafa.com/",
}) {
  const [url, setUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const run = async (e) => {
    e?.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAuditResult(data);
      onCloseAuto?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  const form = (
    <form className="audit-form" onSubmit={run}>
      <label>
        URL da analizzare
        <div>
          <Globe2 />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <button className="primary" disabled={loading}>
            {loading ? "Analisi…" : "Avvia audit"}
          </button>
        </div>
      </label>
      {error && <p className="error">{error}</p>}
    </form>
  );
  if (autoOpen)
    return (
      <Modal title="Nuova analisi SEO" close={onCloseAuto}>
        {form}
      </Modal>
    );
  return (
    <>
      <EmptyTitle
        title="Audit SEO"
        text="Controlla in tempo reale gli elementi essenziali di una pagina."
      />
      {form}
      {auditResult && <AuditResults data={auditResult} />}
    </>
  );
}

function AuditResults({ data }) {
  return (
    <div className="audit-results">
      <section className="score-panel">
        <div
          className="score-ring"
          style={{ "--score": `${data.score * 3.6}deg` }}
        >
          <span>
            {data.score}
            <small>/100</small>
          </span>
        </div>
        <div>
          <h2>Risultato dell’analisi</h2>
          <a href={data.url} target="_blank" rel="noreferrer">
            {data.url}
          </a>
          <p>
            {data.issues.length
              ? `${data.issues.length} elementi richiedono attenzione.`
              : "Nessun problema essenziale rilevato."}
          </p>
        </div>
      </section>
      <section className="panel audit-details">
        <h2>Controlli principali</h2>
        <dl>
          <div>
            <dt>Title</dt>
            <dd>
              {data.title || "Mancante"}{" "}
              <small>{data.titleLength} caratteri</small>
            </dd>
          </div>
          <div>
            <dt>Meta description</dt>
            <dd>
              {data.description || "Mancante"}{" "}
              <small>{data.descriptionLength} caratteri</small>
            </dd>
          </div>
          <div>
            <dt>H1</dt>
            <dd>{data.h1}</dd>
          </div>
          <div>
            <dt>Canonical</dt>
            <dd>{data.canonical || "Non rilevata"}</dd>
          </div>
          <div>
            <dt>Immagini</dt>
            <dd>
              {data.images} totali · {data.missingAlt} senza alt
            </dd>
          </div>
        </dl>
      </section>
      <section className="panel issues">
        <h2>Problemi rilevati</h2>
        {data.issues.length ? (
          data.issues.map((issue, i) => (
            <div key={i}>
              <span className={`priority ${issue.severity}`}>
                {issue.severity}
              </span>
              <strong>{issue.label}</strong>
            </div>
          ))
        ) : (
          <div className="success">
            <Check />
            Pagina conforme ai controlli essenziali
          </div>
        )}
      </section>
    </div>
  );
}

function Opportunities({ dataset, openIntegrations, onCreateTask }) {
  const [tab, setTab] = useState("quickWins");
  const groups = opportunityGroups(dataset);
  const tabs = [
    ["quickWins", "Posizioni 4–20"],
    ["lowCtr", "CTR basso"],
    ["losses", "In calo"],
    ["cannibalizations", "Cannibalizzazioni"],
  ];
  const rows = dataset ? groups[tab] : [];
  const pageFor = (row) =>
    row.page ||
    row.pages?.[0] ||
    suggestPageForQuery(row.dimension || row.query, dataset?.pages || [])
      ?.url ||
    "";
  return (
    <>
      <EmptyTitle
        title="Opportunità"
        text={
          dataset
            ? "Analisi delle query reali. Le associazioni certe query–pagina sono disponibili con il collegamento API Google."
            : "Importa Search Console per ottenere opportunità reali."
        }
      />
      {dataset ? (
        <div className="source-banner">
          <Check />
          Google Search Console · {formatPeriodDate(dataset.dateFrom)} –{" "}
          {formatPeriodDate(dataset.dateTo)}
        </div>
      ) : (
        <button className="import-callout" onClick={openIntegrations}>
          <Upload />
          Importa i dati Search Console
        </button>
      )}
      <div className="tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
            <span>{dataset ? groups[id].length : "—"}</span>
          </button>
        ))}
      </div>
      <section className="panel opportunity-table">
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Opportunità SEO ricavate da Search Console</caption>
            <thead>
              <tr>
                <th>Query</th>
                <th>Pagina</th>
                <th>Posizione</th>
                <th>Impressioni</th>
                <th>Azione</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row, index) => {
                  const queryText = row.dimension || row.query;
                  const pageUrl = pageFor(row);
                  return (
                    <tr key={`${queryText}-${index}`}>
                      <td>
                        <strong>{queryText}</strong>
                        {row.pages?.length > 1 && (
                          <small className="block-note">
                            {row.pages.length} URL competono
                          </small>
                        )}
                      </td>
                      <td>
                        {pageUrl ? (
                          <a
                            className="task-link"
                            href={pageUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink />
                            Apri pagina
                          </a>
                        ) : (
                          <span className="task-detail">
                            Non determinabile dal file
                          </span>
                        )}
                      </td>
                      <td>
                        {Number(row.position || 0)
                          .toFixed(2)
                          .replace(".", ",")}
                      </td>
                      <td>{formatInteger(row.impressions)}</td>
                      <td>
                        <button
                          className="secondary mini"
                          disabled={!dataset}
                          onClick={() =>
                            onCreateTask({
                              title: `${tab === "cannibalizations" ? "Verifica cannibalizzazione" : "Ottimizza"} “${queryText}”`,
                              targetUrl: pageUrl,
                              detail: row.pages?.length
                                ? `URL coinvolti: ${row.pages.join(", ")}`
                                : `${formatInteger(row.impressions)} impressioni · posizione ${Number(row.position).toFixed(1)}`,
                            })
                          }
                        >
                          Crea task
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="5" className="empty-row">
                    {tab === "cannibalizations" && !dataset?.queryPages
                      ? "Questo controllo richiede dati query–pagina: collega Search Console tramite API."
                      : "Nessuna opportunità rilevata con questi criteri."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function TopicalMapPanel({
  dataset,
  existingContent,
  dataForSeo,
  topicalMap,
  onSave,
  onCreateTask,
  onNavigate,
  onUsage,
}) {
  const defaults = (dataset?.queries || [])
    .slice(0, 3)
    .map((row) => row.dimension)
    .join("\n");
  const [seeds, setSeeds] = useState(defaults);
  const [locationCode, setLocationCode] = useState(topicalMap?.locationCode || 2380);
  const [languageCode, setLanguageCode] = useState(topicalMap?.languageCode || "it");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generate = async (event) => {
    event.preventDefault();
    if (!dataForSeo.configured) return onNavigate("Integrazioni");
    if (
      !window.confirm(
        `DataForSEO applicherà un costo API per questa ricerca (massimo stimato $${Number(dataForSeo.maxLabsCost || 1).toFixed(2)}). Continuare?`,
      )
    )
      return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/dataforseo/topical-map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seeds: seeds
            .split(/[\n,;]/)
            .map((value) => value.trim())
            .filter(Boolean),
          existingKeywords: (dataset?.queries || []).map(
            (row) => row.dimension,
          ),
          existingContent,
          locationCode,
          languageCode,
          limit: 100,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Topical map non generata");
      if (data.monthlyCost != null) onUsage?.(data.monthlyCost);
      onSave(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  const uncovered = (topicalMap?.ideas || []).filter((item) => !item.covered);
  return (
    <section className="panel topical-panel">
      <div className="panel-head">
        <div>
          <h2>Topical map e articoli mancanti</h2>
          <p>
            Espande gli argomenti principali con volumi DataForSEO e separa le
            keyword già coperte.
          </p>
        </div>
        {topicalMap && (
          <span className="cost-badge">
            Costo API: ${Number(topicalMap.cost || 0).toFixed(4)}
          </span>
        )}
      </div>
      <form className="topical-form" onSubmit={generate}>
        <label>
          Argomenti principali, uno per riga
          <textarea
            value={seeds}
            onChange={(event) => setSeeds(event.target.value)}
            placeholder="es. ortodonzia bergamo"
            required
          />
        </label>
        <div className="form-row two">
          <label>
            Codice località DataForSEO
            <input type="number" min="1" value={locationCode} onChange={(event) => setLocationCode(Number(event.target.value))} />
          </label>
          <label>
            Lingua
            <select value={languageCode} onChange={(event) => setLanguageCode(event.target.value)}>
              <option value="it">Italiano</option>
              <option value="en">English</option>
              <option value="de">Deutsch</option>
              <option value="fr">Français</option>
              <option value="es">Español</option>
            </select>
          </label>
        </div>
        <button className="primary" disabled={loading}>
          {loading
            ? "Creazione…"
            : dataForSeo.configured
              ? "Genera topical map"
              : "Configura DataForSEO"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {topicalMap && (
        <>
          <div className="topical-summary">
            <span>
              <strong>{topicalMap.ideas?.length || 0}</strong>idee trovate
            </span>
            <span>
              <strong>{uncovered.length}</strong>argomenti da coprire
            </span>
            <span>
              <strong>
                {(topicalMap.ideas || []).filter((item) => item.covered).length}
              </strong>
              già presenti in GSC
            </span>
          </div>
          <div className="table-scroll topical-results">
            <table>
              <caption className="sr-only">Topical map e articoli suggeriti</caption>
              <thead>
                <tr>
                  <th>Cluster</th>
                  <th>Articolo suggerito</th>
                  <th>Intento</th>
                  <th>Volume</th>
                  <th>Trend</th>
                  <th>Copertura</th>
                  <th>Azione</th>
                </tr>
              </thead>
              <tbody>
                {(topicalMap.ideas || []).slice(0, 60).map((item) => (
                  <tr key={item.keyword}>
                    <td>{item.coreKeyword}</td>
                    <td>
                      <strong>{item.keyword}</strong>
                    </td>
                    <td>{item.intent}</td>
                    <td>{formatInteger(item.searchVolume)}</td>
                    <td>
                      {item.trend == null
                        ? "—"
                        : `${item.trend > 0 ? "+" : ""}${item.trend}%`}
                    </td>
                    <td>{item.covered ? "Già presente (da verificare)" : "Da coprire"}</td>
                    <td>
                      <button
                        className="secondary mini"
                        disabled={item.covered}
                        onClick={() =>
                          onCreateTask({
                            title: `Scrivi articolo: ${item.keyword}`,
                            detail: `Topical map: ${item.coreKeyword}\nIntento: ${item.intent}\nVolume mensile DataForSEO: ${item.searchVolume}\nObiettivo: coprire un argomento non presente nelle query Search Console.`,
                            priority:
                              item.searchVolume >= 100 ? "Alta" : "Media",
                          })
                        }
                      >
                        Crea task articolo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function RankingsPage({
  client,
  dataset,
  dataForSeo,
  history,
  onSave,
  onCreateTask,
  onNavigate,
  onUsage,
}) {
  const suggested = (dataset?.queries || [])
    .slice(0, 8)
    .map((row) => row.dimension)
    .join("\n");
  const current = history?.[0];
  const previous = (history || []).slice(1).find(
    (item) =>
      item?.rankings?.some((ranking) => !ranking.error) &&
      item.device === current?.device &&
      item.depth === current?.depth &&
      item.locationCode === current?.locationCode &&
      item.languageCode === current?.languageCode,
  );
  const [keywords, setKeywords] = useState(suggested);
  const [depth, setDepth] = useState(20);
  const [device, setDevice] = useState("desktop");
  const [locationCode, setLocationCode] = useState(current?.locationCode || 2380);
  const [languageCode, setLanguageCode] = useState(current?.languageCode || "it");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const comparablePrevious = Boolean(
    current &&
      previous &&
      current.device === previous.device &&
      current.depth === previous.depth &&
      current.locationCode === previous.locationCode &&
      current.languageCode === previous.languageCode
  );
  const previousMap = new Map(
    (comparablePrevious ? previous.rankings || [] : []).map((item) => [
      String(item.keyword || "").toLocaleLowerCase("it"),
      item.position,
    ]),
  );
  const run = async (event) => {
    event.preventDefault();
    if (!dataForSeo.configured) return onNavigate("Integrazioni");
    const list = [
      ...new Set(
        keywords
          .split(/[\n,;]/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ].slice(0, 100);
    if (
      !list.length ||
      !window.confirm(
        `Controllare ${list.length} keyword fino alla posizione ${depth}? Costo massimo stimato: $${(list.length * Number(dataForSeo.maxSerpCost || 0.1)).toFixed(2)}.`,
      )
    )
      return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/dataforseo/rankings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: client.url,
          keywords: list,
          depth,
          device,
          locationCode,
          languageCode,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Controllo posizioni non riuscito");
      if (data.monthlyCost != null) onUsage?.(data.monthlyCost);
      onSave(data);
      if (data.partial)
        setError(
          `${data.errorCount} keyword non sono state verificate; i risultati riusciti sono stati salvati.`,
        );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <EmptyTitle
        title={`Posizionamenti — ${client.name}`}
        text="Posizioni organiche reali rilevate tramite DataForSEO per Google Italia."
      />
      <div className="ranking-layout">
        <form className="panel ranking-form" onSubmit={run}>
          <label>
            Keyword, una per riga
            <textarea
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              required
            />
          </label>
          <div className="form-row two">
            <label>
              Profondità
              <select
                value={depth}
                onChange={(event) => setDepth(Number(event.target.value))}
              >
                <option value="10">Top 10</option>
                <option value="20">Top 20</option>
                <option value="50">Top 50</option>
                <option value="100">Top 100</option>
              </select>
            </label>
            <label>
              Dispositivo
              <select
                value={device}
                onChange={(event) => setDevice(event.target.value)}
              >
                <option value="desktop">Desktop</option>
                <option value="mobile">Mobile</option>
              </select>
            </label>
          </div>
          <div className="form-row two">
            <label>
              Codice località DataForSEO
              <input
                type="number"
                min="1"
                value={locationCode}
                onChange={(event) => setLocationCode(Number(event.target.value))}
              />
            </label>
            <label>
              Lingua
              <select value={languageCode} onChange={(event) => setLanguageCode(event.target.value)}>
                <option value="it">Italiano</option>
                <option value="en">English</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="es">Español</option>
              </select>
            </label>
          </div>
          <div className="integration-note">
            <AlertTriangle />
            Ogni keyword genera una richiesta a pagamento. Un controllo più
            profondo può costare di più.
          </div>
          <button className="primary" disabled={loading}>
            {loading
              ? "Controllo…"
              : dataForSeo.configured
                ? "Controlla posizioni"
                : "Configura DataForSEO"}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
        <section className="panel ranking-results">
          <div className="panel-head">
            <div>
              <h2>Ultimo controllo</h2>
              <p>
                {current
                  ? `${new Date(current.checkedAt).toLocaleString("it-IT")} · ${current.device || "dispositivo non registrato"} · costo $${Number(current.cost || 0).toFixed(4)}`
                  : "Nessun controllo ancora eseguito."}
              </p>
            </div>
          </div>
          {current && (
            <div className="table-scroll">
              <table>
                <caption className="sr-only">Posizionamenti delle keyword monitorate</caption>
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>Posizione</th>
                    <th>Variazione</th>
                    <th>URL posizionata</th>
                    <th>Azione</th>
                  </tr>
                </thead>
                <tbody>
                  {current.rankings.map((item) => {
                    const old = previousMap.get(String(item.keyword || "").toLocaleLowerCase("it"));
                    const delta =
                      item.position && old ? old - item.position : null;
                    return (
                      <tr key={item.keyword}>
                        <td>
                          <strong>{item.keyword}</strong>
                          {item.error && (
                            <small className="block-note error">
                              Errore API: {item.error}
                            </small>
                          )}
                        </td>
                        <td>
                          {item.error
                            ? "Non verificata"
                            : item.position || `Oltre ${current.depth}`}
                        </td>
                        <td
                          className={
                            delta > 0 ? "green" : delta < 0 ? "red" : ""
                          }
                        >
                          {delta == null
                            ? "—"
                            : `${delta > 0 ? "+" : ""}${delta}`}
                        </td>
                        <td>
                          {item.url ? (
                            <a
                              className="task-link"
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink />
                              Apri pagina
                            </a>
                          ) : (
                            "Non trovata"
                          )}
                        </td>
                        <td>
                          <button
                            className="secondary mini"
                            disabled={Boolean(item.error)}
                            onClick={() =>
                              onCreateTask({
                                title: `Migliora posizione: ${item.keyword}`,
                                sourceUrl: item.url,
                                detail: `Posizione DataForSEO: ${item.position || `oltre ${current.depth}`}\nDispositivo: ${current.device}\nLocalità: ${current.locationCode}\nVerificata: ${current.checkedAt}`,
                                priority:
                                  !item.position || item.position > 20
                                    ? "Alta"
                                    : "Media",
                              })
                            }
                          >
                            Crea task
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function ContentPage({
  dataset,
  analysis,
  client,
  onCreateTask,
  requireApproval,
  wordpressConnection,
  onNavigate,
  dataForSeo,
  topicalMap,
  onSaveTopicalMap,
  draft,
  onSaveDraft,
  onDataForSeoUsage,
}) {
  const editorRef = useRef(null);
  const topicalItems = (topicalMap?.ideas || [])
    .filter((item) => !item.covered)
    .slice(0, 12)
    .map((item, index) => ({
      id: `topical-${item.keyword}`,
      type: "Nuovo articolo",
      title: item.keyword,
      reason: `Volume ${item.searchVolume} · intento ${item.intent}`,
      url: "",
      association: "Argomento mancante secondo DataForSEO",
      objective: `Coprire il cluster ${item.coreKeyword}`,
      format: "Articolo editoriale",
      slot: `Settimana ${Math.floor(index / 3) + 1}`,
      priority: item.searchVolume >= 100 ? "Alta" : "Media",
    }));
  const basePlan = contentPlan(dataset, analysis);
  const topicalQuota = Math.min(4, topicalItems.length);
  const initialPlan = [
    ...basePlan.slice(0, 12 - topicalQuota),
    ...topicalItems.slice(0, topicalQuota),
  ]
    .map((item, index) => ({
      ...item,
      slot: `Settimana ${Math.floor(index / 3) + 1}`,
    }));
  const [topic, setTopic] = useState(
    draft?.topic || initialPlan[0]?.title || "",
  );
  const [type, setType] = useState(draft?.type || "brief");
  const [content, setContent] = useState(draft?.content || "");
  const [loading, setLoading] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [publishResult, setPublishResult] = useState("");
  const [publishLink, setPublishLink] = useState("");
  const [wordpressResource, setWordpressResource] = useState("posts");
  const [copyResult, setCopyResult] = useState("");
  const [generatedDemo, setGeneratedDemo] = useState(Boolean(draft?.demo));
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        onSaveDraft({
          topic,
          type,
          content,
          demo: generatedDemo,
          updatedAt: new Date().toISOString(),
        }),
      350,
    );
    return () => window.clearTimeout(timer);
  }, [topic, type, content, generatedDemo, onSaveDraft]);
  const plan = initialPlan.map((item) => {
    if (item.url) return item;
    const suggestion = suggestPageForQuery(item.title, dataset?.pages || []);
    return {
      ...item,
      url: suggestion?.url || "",
      association: suggestion
        ? "URL suggerito da verificare"
        : item.association,
    };
  });
  const generate = async (event) => {
    event.preventDefault();
    setLoading(true);
    setGenerationError("");
    setPublishResult("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic,
          type,
          context: JSON.stringify({
            progetto: client.name,
            sito: client.url,
            querySearchConsole: (dataset?.queries || []).slice(0, 20).map((row) => ({
              query: row.dimension,
              clic: row.clicks,
              impressioni: row.impressions,
              ctr: row.ctr,
              posizione: row.position,
            })),
            pagine: (dataset?.pages || []).slice(0, 12).map((row) => row.dimension || row.url),
            problemiAudit: (analysis?.issues || []).slice(0, 15).map((issue) => ({
              problema: issue.label,
              url: issue.url,
              dettaglio: issue.detail,
            })),
            topicalGap: (topicalMap?.ideas || [])
              .filter((item) => !item.covered)
              .slice(0, 12)
              .map((item) => item.keyword),
            regola: "Usa soltanto queste evidenze; segnala i dati mancanti e non inventare fatti.",
          }),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Generazione non riuscita");
      if (!String(data.content || "").trim())
        throw new Error("OpenAI non ha restituito contenuto utilizzabile.");
      setGeneratedDemo(Boolean(data.demo));
      setContent(data.content);
    } catch (error) {
      setGenerationError(error.message);
    } finally {
      setLoading(false);
    }
  };
  const publishDraft = async () => {
    if (!content.trim())
      return setPublishResult("Genera o incolla prima un contenuto.");
    if (generatedDemo)
      return setPublishResult(
        "Il contenuto è dimostrativo: configura OpenAI o sostituiscilo con un testo revisionato prima dell’invio.",
      );
    if (!wordpressConnection) return onNavigate("Integrazioni");
    if (
      !wordpressConnection.verifiedAt ||
      Date.now() - Date.parse(wordpressConnection.verifiedAt) > 30 * 60_000
    ) {
      setPublishLink("");
      setPublishResult(
        "La verifica WordPress è scaduta. Verifica nuovamente la connessione nelle Integrazioni.",
      );
      return;
    }
    if (
      requireApproval &&
      !window.confirm(
        "Creare una bozza su WordPress? Il contenuto NON verrà pubblicato.",
      )
    )
      return;
    setPublishLink("");
    setPublishResult("Invio in corso…");
    try {
      const response = await fetch("/api/wordpress/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...wordpressConnection,
          title: topic || "Bozza seoGrow AI",
          content,
          resource: wordpressResource,
          confirmed: true,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Creazione bozza non riuscita");
      setPublishResult(`Bozza WordPress creata (ID ${data.id}).`);
      setPublishLink(data.editLink || data.link || "");
    } catch (error) {
      setPublishLink("");
      setPublishResult(`Errore WordPress: ${error.message}`);
    }
  };
  const prepare = (item) => {
    setTopic(item.title);
    setType(
      item.type === "Ottimizza snippet" ? "meta description" : "brief",
    );
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <>
      <EmptyTitle
        title={`Piano editoriale — ${client.name}`}
        text="Priorità mensili, brief e bozze basati sui dati del progetto."
      />
      <TopicalMapPanel
        dataset={dataset}
        existingContent={(analysis?.pages || []).flatMap((page) => [
          page.url,
          page.title,
        ]).filter(Boolean)}
        dataForSeo={dataForSeo}
        topicalMap={topicalMap}
        onSave={onSaveTopicalMap}
        onCreateTask={onCreateTask}
        onNavigate={onNavigate}
        onUsage={onDataForSeoUsage}
      />
      <div className="workflow-strip">
        <span>
          <b>1</b>Scegli un’attività
        </span>
        <span>
          <b>2</b>Genera o scrivi la bozza
        </span>
        <span>
          <b>3</b>Revisiona
        </span>
        <span>
          <b>4</b>Invia a WordPress come bozza
        </span>
      </div>
      <section className="panel planner">
        <div className="panel-head">
          <div>
            <h2>Piano editoriale suggerito</h2>
            <p>
              Le associazioni non certe sono indicate esplicitamente e vanno
              verificate.
            </p>
          </div>
          <button
            className="secondary small-button"
            disabled={!plan.length}
            onClick={() =>
              downloadCsv(plan, `piano-editoriale-${client.name}.csv`)
            }
          >
            <Download />
            Esporta CSV
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Piano editoriale del progetto</caption>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Intervento</th>
                <th>Argomento</th>
                <th>Obiettivo</th>
                <th>Pagina</th>
                <th>Priorità</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {plan.length ? (
                plan.map((item, index) => (
                  <tr key={`${item.id}-${index}`}>
                    <td>{item.slot}</td>
                    <td>
                      {item.type}
                      <small className="block-note">{item.format}</small>
                    </td>
                    <td>
                      <strong>{item.title}</strong>
                      <small className="block-note">{item.reason}</small>
                    </td>
                    <td>{item.objective}</td>
                    <td>
                      {item.url ? (
                        <a
                          className="task-link"
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink />
                          Apri URL
                        </a>
                      ) : (
                        <span className="task-detail">Da associare</span>
                      )}
                      <small className="block-note">{item.association}</small>
                    </td>
                    <td>
                      <span
                        className={`priority ${item.priority.toLowerCase()}`}
                      >
                        {item.priority}
                      </span>
                    </td>
                    <td>
                      <div className="plan-actions">
                        <button
                          className="secondary mini"
                          onClick={() => prepare(item)}
                        >
                          Prepara bozza
                        </button>
                        <button
                          className="secondary mini"
                          onClick={() =>
                            onCreateTask({
                              title: `${item.type}: ${item.title}`,
                              sourceUrl: item.url,
                              targetUrl: "",
                              detail: `${item.reason}\nObiettivo: ${item.objective}\nAssociazione: ${item.association}`,
                              priority: item.priority,
                            })
                          }
                        >
                          Crea task
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="empty-row">
                    Importa Search Console o avvia una nuova analisi per
                    generare il piano editoriale.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <div className="content-layout">
        <form className="panel generator" onSubmit={generate}>
          <div className="generator-title">
            <WandSparkles />
            <div>
              <h2>Prepara contenuto</h2>
              <p>Puoi partire da una voce del piano o inserire un argomento.</p>
            </div>
          </div>
          <label>
            Formato
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="brief">Brief SEO</option>
              <option value="articolo">Articolo</option>
              <option value="meta description">Metadati</option>
            </select>
          </label>
          <label>
            Argomento
            <input
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              required
              placeholder="Es. gnatologo Bergamo"
            />
          </label>
          <button className="primary" disabled={loading}>
            <Sparkles />
            {loading ? "Generazione…" : "Genera contenuto"}
          </button>
          {generationError && (
            <p className="error" role="alert">{generationError}</p>
          )}
        </form>
        <section className="panel editor" ref={editorRef} tabIndex="-1">
          <div className="panel-head">
            <div>
              <h2>Bozza da revisionare</h2>
              <p>
                Salvataggio automatico locale ·{" "}
                {content.trim()
                  ? `${content.trim().split(/\s+/).length} parole`
                  : "bozza vuota"}
              </p>
            </div>
            {content && (
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(content);
                    setCopyResult("Copiato");
                  } catch {
                    setCopyResult("Copia non riuscita");
                  }
                  window.setTimeout(() => setCopyResult(""), 1800);
                }}
              >
                {copyResult || "Copia"}
              </button>
            )}
          </div>
          <textarea
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              if (generatedDemo) setGeneratedDemo(false);
            }}
            placeholder="Il contenuto generato o incollato apparirà qui…"
          />
          {generatedDemo && (
            <p className="error" role="alert">
              Questa è una bozza dimostrativa: configura OpenAI oppure modificala
              manualmente prima dell’invio a WordPress.
            </p>
          )}
          <div
            className={`wordpress-send ${wordpressConnection ? "connected" : ""}`}
          >
            <div>
              <strong>
                {wordpressConnection
                  ? `WordPress verificato: ${wordpressConnection.name || wordpressConnection.username}`
                  : "WordPress non ancora verificato"}
              </strong>
              <small>
                {wordpressConnection
                  ? "Credenziali mantenute solo durante questa sessione. L’invio crea sempre una bozza."
                  : "Vai in Integrazioni, verifica URL, utente e password applicativa, poi torna qui."}
              </small>
            </div>
            {wordpressConnection ? (
              <div className="api-actions">
                <label>
                  Tipo bozza
                  <select value={wordpressResource} onChange={(event) => setWordpressResource(event.target.value)}>
                    <option value="posts">Articolo</option>
                    <option
                      value="pages"
                      disabled={wordpressConnection?.canCreatePages === false}
                    >
                      Pagina
                    </option>
                  </select>
                </label>
                <button
                  className="primary"
                  type="button"
                  disabled={!content.trim() || generatedDemo}
                  onClick={publishDraft}
                >
                  Invia come bozza
                </button>
              </div>
            ) : (
              <button
                className="secondary"
                type="button"
                onClick={() => onNavigate("Integrazioni")}
              >
                Configura WordPress
              </button>
            )}
          </div>
          {publishResult && (
            <p
              className={
                publishResult.startsWith("Errore")
                  ? "error"
                  : "integration-result"
              }
            >
              {publishResult}
              {publishLink && (
                <>
                  {" "}
                  ·{" "}
                  <a href={publishLink} target="_blank" rel="noreferrer">
                    Apri e modifica in WordPress
                  </a>
                </>
              )}
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function Integrations({
  selectedClient,
  dataset,
  history,
  onGscImport,
  wordpressConnection,
  wordpressProfile,
  onWordPressVerified,
  onNavigate,
  dataForSeo,
  aiConfigured,
  aiStatus = {},
  onDataForSeoStatus,
}) {
  const [wp, setWp] = useState(
    () =>
      wordpressConnection || {
        url: wordpressProfile?.url || selectedClient.url,
        username: wordpressProfile?.username || "",
        applicationPassword: "",
      },
  );
  const [result, setResult] = useState(() =>
    wordpressConnection
      ? `Connessione attiva come ${wordpressConnection.name || wordpressConnection.username}.`
      : "",
  );
  const [importStatus, setImportStatus] = useState("");
  const [importing, setImporting] = useState(false);
  const [google, setGoogle] = useState({
    configured: false,
    connected: false,
    properties: [],
  });
  const [property, setProperty] = useState("");
  const [dfsResult, setDfsResult] = useState("");
  const [integrationBusy, setIntegrationBusy] = useState("");
  useEffect(() => {
    fetch("/api/google/status")
      .then((response) => response.json())
      .then(setGoogle)
      .catch(() => {});
  }, []);
  const loadProperties = async () => {
    setImportStatus("Lettura proprietà Google…");
    try {
      const response = await fetch("/api/google/properties");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Lettura non riuscita");
      setGoogle((current) => ({
        ...current,
        connected: true,
        properties: data.properties,
      }));
      setProperty(data.properties[0]?.url || "");
      setImportStatus(`${data.properties.length} proprietà disponibili.`);
    } catch (error) {
      setImportStatus(`Errore Google: ${error.message}`);
    }
  };
  const disconnectGoogle = async () => {
    if (
      !window.confirm(
        "Scollegare Google Search Console e cancellare il token locale?",
      )
    )
      return;
    setIntegrationBusy("google-disconnect");
    try {
      const response = await fetch("/api/google/connection", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Disconnessione non riuscita");
      setGoogle((current) => ({ ...current, connected: false, properties: [] }));
      setProperty("");
      setImportStatus("Google scollegata e token locale eliminato.");
    } catch (error) {
      setImportStatus(`Errore Google: ${error.message}`);
    } finally {
      setIntegrationBusy("");
    }
  };
  const testDataForSeo = async () => {
    setDfsResult("Verifica credenziali…");
    setIntegrationBusy("dataforseo-test");
    try {
      const response = await fetch("/api/dataforseo/test", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Verifica non riuscita");
      setDfsResult(`Connessione verificata${data.login ? ` per ${data.login}` : ""}.`);
      onDataForSeoStatus((current) => ({ ...current, configured: true, verified: true }));
    } catch (error) {
      setDfsResult(`Errore: ${error.message}`);
    } finally {
      setIntegrationBusy("");
    }
  };
  const importApi = async () => {
    if (!property) return;
    setImporting(true);
    setImportStatus("Importazione diretta da Google…");
    try {
      const response = await fetch("/api/google/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ property }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Importazione non riuscita");
      const assigned = onGscImport(data);
      setImportStatus(`Dati API importati e abbinati a ${assigned.clientName}.`);
    } catch (error) {
      setImportStatus(`Errore Google: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };
  const test = async (event) => {
    event.preventDefault();
    setResult("Verifica in corso…");
    setIntegrationBusy("wordpress-test");
    try {
      const response = await fetch("/api/wordpress/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(wp),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Connessione non riuscita");
      onWordPressVerified({
        ...wp,
        name: data.name,
        site: data.site,
        canCreatePosts: data.canCreatePosts,
        canCreatePages: data.canCreatePages,
        verifiedAt: new Date().toISOString(),
      });
      setResult(
        `Connessione verificata come ${data.name}. Ora puoi inviare bozze dal Piano editoriale.`,
      );
    } catch (error) {
      setResult(`Errore: ${error.message}`);
    } finally {
      setIntegrationBusy("");
    }
  };
  const importFile = async (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    setImporting(true);
    setImportStatus(
      files.length === 1
        ? "Lettura dell’esportazione…"
        : `Lettura di ${files.length} esportazioni…`,
    );
    try {
      const assignments = [];
      const failures = [];
      for (const file of files) {
        try {
          const data = await importGscZip(file);
          assignments.push({ data, assignment: onGscImport(data) });
        } catch (error) {
          failures.push(`${file.name}: ${error.message}`);
        }
      }
      const successText = assignments.length
        ? `${assignments.length} importazioni completate: ${assignments.map((item) => item.assignment.clientName).join(", ")}.`
        : "Nessuna importazione completata.";
      setImportStatus(
        failures.length
          ? `${successText} Errori: ${failures.join(" | ")}`
          : successText,
      );
    } catch (error) {
      setImportStatus(`Errore: ${error.message}`);
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };
  return (
    <>
      <EmptyTitle
        title="Integrazioni"
        text={`Collega gli strumenti di ${selectedClient.name}.`}
      />
      <div className="integration-grid">
        <section className="panel integration gsc-integration">
          <div className="integration-head">
            <div className="google-mark">G</div>
            <div>
              <h2>Google Search Console</h2>
              <p>ZIP manuali oppure collegamento API automatico.</p>
            </div>
          </div>
          {dataset ? (
            <div className="gsc-summary">
              <span>
                <strong>{formatInteger(dataset.totals.clicks)}</strong>Clic
              </span>
              <span>
                <strong>{formatInteger(dataset.totals.impressions)}</strong>
                Impressioni
              </span>
              <span>
                <strong>{dataset.queries.length}</strong>Query
              </span>
              <span>
                <strong>{history?.length || 1}</strong>Importazioni
              </span>
            </div>
          ) : (
            <div className="integration-note">
              <Upload />
              Importa lo ZIP oppure configura Google nel file .env.
            </div>
          )}
          <label
            className={`secondary upload-button ${importing ? "disabled" : ""}`}
          >
            <Upload />
            Importa uno o più ZIP
            <input
              data-testid="gsc-file"
              type="file"
              accept=".zip,application/zip"
              multiple
              onChange={importFile}
              disabled={importing}
            />
          </label>
          <div className="api-actions">
            {!google.configured ? (
              <div className="integration-note">
                <AlertTriangle />
                Per il collegamento diretto inserisci GOOGLE_CLIENT_ID e
                GOOGLE_CLIENT_SECRET nel file .env.
              </div>
            ) : !google.connected ? (
              <>
                <a
                  className="secondary button-link"
                  href="/api/google/auth"
                  target="_blank"
                  rel="noreferrer"
                >
                  Collega account Google
                </a>
                <button className="secondary" onClick={loadProperties}>
                  <RefreshCw />
                  Ho autorizzato: aggiorna
                </button>
              </>
            ) : google.properties?.length ? (
              <>
                <select
                  value={property}
                  onChange={(event) => setProperty(event.target.value)}
                >
                  {google.properties.map((item) => (
                    <option key={item.url} value={item.url}>
                      {item.url}
                    </option>
                  ))}
                </select>
                <button
                  className="primary"
                  onClick={importApi}
                  disabled={importing}
                >
                  Importa ora via API
                </button>
                <button
                  className="secondary danger-text"
                  onClick={disconnectGoogle}
                  disabled={integrationBusy === "google-disconnect"}
                >
                  Scollega Google
                </button>
              </>
            ) : (
              <button className="secondary" onClick={loadProperties}>
                <RefreshCw />
                Carica proprietà Google
              </button>
            )}
          </div>
          {importStatus && (
            <p
              className={
                importStatus.includes("importat") &&
                importStatus.includes("abbinat")
                  ? "import-success"
                  : "integration-result"
              }
            >
              {importStatus}
            </p>
          )}
          {dataset && (
            <small className="import-meta">
              Periodo: {formatPeriodDate(dataset.dateFrom)} –{" "}
              {formatPeriodDate(dataset.dateTo)} · Importato{" "}
              {new Date(dataset.importedAt).toLocaleString("it-IT")}
            </small>
          )}
          {dataset?.truncated && (
            <p className="error">
              Importazione parziale: raggiunto il limite di{" "}
              {formatInteger(dataset.maximumRows || dataset.rowCount)} righe.
            </p>
          )}
        </section>
        <form
          className="panel integration wordpress-integration"
          onSubmit={test}
        >
          <div className="integration-head">
            <div className="wp-mark">W</div>
            <div>
              <h2>WordPress</h2>
              <p>
                Verifica il collegamento e abilita l’invio sicuro delle bozze.
              </p>
            </div>
          </div>
          <ol className="integration-steps">
            <li>Crea in WordPress una password applicativa per l’utente.</li>
            <li>Inserisci qui URL, nome utente e password applicativa.</li>
            <li>Verifica e passa al Piano editoriale per creare la bozza.</li>
          </ol>
          <label>
            URL sito
            <input
              type="url"
              value={wp.url}
              onChange={(event) => setWp({ ...wp, url: event.target.value })}
              required
            />
          </label>
          <label>
            Nome utente
            <input
              value={wp.username}
              onChange={(event) =>
                setWp({ ...wp, username: event.target.value })
              }
              required
              autoComplete="username"
            />
          </label>
          <label>
            Password applicativa
            <input
              type="password"
              value={wp.applicationPassword}
              onChange={(event) =>
                setWp({ ...wp, applicationPassword: event.target.value })
              }
              required
              autoComplete="current-password"
            />
          </label>
          <div className="integration-note">
            <Check />
            La password non viene salvata nel browser: resta in memoria solo
            finché l’app è aperta.
          </div>
          <button className="secondary" disabled={integrationBusy === "wordpress-test"}>
            {integrationBusy === "wordpress-test" ? "Verifica…" : "Verifica connessione"}
          </button>
          {result && (
            <p
              className={
                result.startsWith("Errore") ? "error" : "integration-result"
              }
            >
              {result}
            </p>
          )}
          {wordpressConnection && (
            <button
              className="primary"
              type="button"
              onClick={() => onNavigate("Piano editoriale")}
            >
              Vai al Piano editoriale
            </button>
          )}
        </form>
        <section className="panel integration">
          <div className="integration-head">
            <div className="dfs-mark">
              <BarChart3 />
            </div>
            <div>
              <h2>DataForSEO</h2>
              <p>Posizionamenti reali e ricerca per la topical map.</p>
            </div>
          </div>
          <div
            className={`integration-note ${dataForSeo.configured ? "configured-note" : ""}`}
          >
            {dataForSeo.configured ? <Check /> : <AlertTriangle />}
            {dataForSeo.verified
              ? "Credenziali verificate."
              : dataForSeo.configured
                ? "Credenziali presenti ma non ancora verificate."
                : "Inserisci DATAFORSEO_LOGIN e DATAFORSEO_PASSWORD nel file .env e riavvia l’app."}
          </div>
          <small className="settings-help">
            Le chiamate di posizionamento sono a pagamento e protette da un
            limite orario. Spesa del mese: ${Number(dataForSeo.monthlyCost || 0).toFixed(4)}
            {dataForSeo.monthlyBudget
              ? ` su $${Number(dataForSeo.monthlyBudget).toFixed(2)}`
              : ""}.
          </small>
          {dataForSeo.configured && (
            <div className="api-actions">
              <button className="secondary" onClick={testDataForSeo} disabled={integrationBusy === "dataforseo-test"}>
                Verifica credenziali
              </button>
              <button
                className="secondary"
                onClick={() => onNavigate("Posizionamenti")}
              >
                Apri posizionamenti
              </button>
            </div>
          )}
          {dfsResult && (
            <p
              className={
                dfsResult.startsWith("Errore") ? "error" : "integration-result"
              }
            >
              {dfsResult}
            </p>
          )}
        </section>
        <section className="panel integration">
          <div className="integration-head">
            <div className="ai-mark">
              <Sparkles />
            </div>
            <div>
              <h2>OpenAI</h2>
              <p>Generazione protetta tramite API lato server.</p>
            </div>
          </div>
          <div
            className={`integration-note ${aiConfigured ? "configured-note" : ""}`}
          >
            {aiConfigured ? <Check /> : <AlertTriangle />}
            {aiConfigured
              ? "Chiave configurata. I contenuti vengono generati con OpenAI."
              : "Chiave non configurata: viene usato soltanto il brief dimostrativo."}
          </div>
          {aiConfigured && (
            <small className="settings-help">
              Modello: {aiStatus.model || "configurato"}. Spesa stimata del mese: ${Number(aiStatus.monthlyCost || 0).toFixed(4)}
              {aiStatus.monthlyBudget
                ? ` su $${Number(aiStatus.monthlyBudget).toFixed(2)}`
                : ""}.
            </small>
          )}
        </section>
      </div>
    </>
  );
}

function SiteAnalysisModal({
  client,
  previousAnalysis,
  onComplete,
  close,
  openTasks,
}) {
  const [url, setUrl] = useState(client.url);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(previousAnalysis || null);
  const [maxPages, setMaxPages] = useState(75);
  const requestRef = useRef(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  const run = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch("/api/site-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, maxPages }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResult(data);
      onComplete(data);
    } catch (analysisError) {
      if (analysisError.message !== "Richiesta annullata.")
        setError(analysisError.message);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  };
  return (
    <Modal title={`Nuova analisi — ${client.name}`} close={close}>
      <form className="site-analysis-form" onSubmit={run}>
        <label>
          Indirizzo iniziale
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
          />
        </label>
        <label>
          Numero massimo di pagine
          <select
            value={maxPages}
            onChange={(event) => setMaxPages(Number(event.target.value))}
          >
            <option value="25">25 — controllo rapido</option>
            <option value="75">75 — consigliato</option>
            <option value="150">150 — approfondito</option>
            <option value="200">200 — massimo locale</option>
          </select>
        </label>
        <p>
          Controlla metadati, H1, canonical, noindex, immagini, contenuti brevi,
          velocità di risposta, profondità, duplicati, sitemap e link interni.
        </p>
        <button className="primary" disabled={loading}>
          {loading ? "Analisi in corso…" : "Analizza il sito"}
        </button>
        {loading && (
          <button
            type="button"
            className="secondary"
            onClick={() => requestRef.current?.abort()}
          >
            Annulla analisi
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </form>
      {result && (
        <div className="analysis-summary four">
          <div>
            <strong>{result.score ?? "—"}</strong>
            <span>Punteggio SEO</span>
          </div>
          <div>
            <strong>{result.pagesChecked}</strong>
            <span>Pagine controllate</span>
          </div>
          <div>
            <strong>{result.linksChecked}</strong>
            <span>Link controllati</span>
          </div>
          <div>
            <strong>
              {Array.isArray(result.issues)
                ? result.issues.length
                : Array.isArray(result.brokenLinks)
                  ? result.brokenLinks.length
                  : 0}
            </strong>
            <span>Problemi verificati</span>
          </div>
        </div>
      )}
      {result && (
        <div className="analysis-results">
          <h3>Risultati verificati</h3>
          {result.issues?.length ? (
            result.issues.slice(0, 12).map((issue, index) => (
              <div key={`${issue.type}-${issue.url}-${index}`}>
                <span className={`priority ${issue.severity}`}>
                  {issue.severity}
                </span>
                <a
                  href={issue.targetUrl || issue.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {issue.label}
                </a>
                <small>
                  {issue.url}
                  {issue.detail ? ` · ${issue.detail}` : ""}
                </small>
              </div>
            ))
          ) : (
            <p className="success">
              <Check />
              Nessun problema tecnico tra quelli controllati.
            </p>
          )}
          <button className="secondary" onClick={openTasks}>
            Apri i task del progetto
          </button>
        </div>
      )}
    </Modal>
  );
}

function SettingsPage({
  clients,
  selectedClient,
  tasks,
  gscData,
  gscHistory,
  analyses,
  rankings,
  topicalMaps,
  geoData,
  contentDrafts,
  wordpressProfiles,
  auditResults,
  agentRuns,
  snapshots,
  preferences,
  setPreferences,
  onCreateSnapshot,
  onRestoreSnapshot,
  onRestore,
}) {
  const [saved, setSaved] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [backupPassword, setBackupPassword] = useState("");
  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const backup = await readWorkspaceBackup(file, backupPassword);
      if (
        !window.confirm(
          "Importare questo backup? I dati locali attuali verranno sostituiti.",
        )
      )
        return;
      onRestore(backup);
      setBackupPassword("");
      setBackupMessage(
        `Backup del ${new Date(backup.exportedAt).toLocaleString("it-IT")} ripristinato.`,
      );
    } catch (backupError) {
      setBackupMessage(backupError.message);
    } finally {
      event.target.value = "";
    }
  };
  const savePreferences = (event) => {
    event.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };
  return (
    <>
      <EmptyTitle
        title="Impostazioni"
        text="Personalizza l’app, le notifiche e la protezione dei dati locali."
      />
      <div className="settings-layout">
        <form className="panel settings-form" onSubmit={savePreferences}>
          <h2>Preferenze e automazioni</h2>
          <label>
            Nome visualizzato
            <input
              value={preferences.name}
              onChange={(event) =>
                setPreferences({ ...preferences, name: event.target.value })
              }
            />
          </label>
          <label>
            Controllo automatico mentre l’app è aperta
            <select
              value={preferences.refreshHours}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  refreshHours: Number(event.target.value),
                })
              }
            >
              <option value="0">Disattivato</option>
              <option value="6">Ogni 6 ore</option>
              <option value="12">Ogni 12 ore</option>
              <option value="24">Ogni giorno</option>
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={preferences.approveWordPress}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  approveWordPress: event.target.checked,
                })
              }
            />
            <span>
              Richiedi sempre approvazione prima di inviare a WordPress
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={preferences.notifications}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  notifications: event.target.checked,
                })
              }
            />
            <span>Avvisa per cali, nuovi errori e task scadute</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={preferences.autoBackup}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  autoBackup: event.target.checked,
                })
              }
            />
            <span>Crea una copia locale prima di importazioni e analisi</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={preferences.saveDrafts !== false}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  saveDrafts: event.target.checked,
                })
              }
            />
            <span>Salva le bozze editoriali nel browser locale</span>
          </label>
          <p className="settings-help">
            Disattiva questa opzione se le bozze contengono informazioni
            riservate: il testo resterà solo nella scheda aperta.
          </p>
          <button className="primary">
            {saved ? (
              <>
                <Check />
                Salvato
              </>
            ) : (
              "Conferma preferenze"
            )}
          </button>
          <p className="settings-help">
            Le automazioni locali funzionano quando seoGrow AI e il Terminale
            sono aperti. Per esecuzioni a computer spento servirà una versione
            cloud.
          </p>
        </form>
        <section className="panel backup-panel">
          <h2>Backup completo</h2>
          <p>
            Esporta clienti, storico Search Console, task e analisi in un unico
            file cifrato.
          </p>
          <label>
            Password del backup
            <input
              type="password"
              value={backupPassword}
              minLength="10"
              autoComplete="new-password"
              onChange={(event) => setBackupPassword(event.target.value)}
              placeholder="Almeno 10 caratteri"
            />
          </label>
          <button
            className="secondary"
            onClick={async () => {
              try {
                await exportWorkspaceBackup(
                  {
                    clients,
                    selectedClient,
                    tasks,
                    gscData,
                    gscHistory,
                    analyses,
                    rankings,
                    topicalMaps,
                    geoData,
                    contentDrafts,
                    wordpressProfiles,
                    auditResults,
                    agentRuns,
                    preferences,
                  },
                  backupPassword,
                );
                setBackupPassword("");
                setBackupMessage("Backup cifrato esportato correttamente.");
              } catch (error) {
                setBackupMessage(error.message);
              }
            }}
          >
            <Download />
            Esporta backup
          </button>
          <label className="secondary upload-button">
            <Upload />
            Importa backup
            <input
              data-testid="backup-file"
              type="file"
              accept="application/json,.json"
              onChange={importBackup}
            />
          </label>
          <button className="secondary" onClick={onCreateSnapshot}>
            <RefreshCw />
            Crea copia locale ora
          </button>
          {backupMessage && (
            <p className="integration-result">{backupMessage}</p>
          )}
        </section>
        <section className="panel backup-panel snapshot-panel">
          <h2>Copie locali recenti</h2>
          <p>
            Vengono conservate al massimo due copie nel browser per ridurre
            l’uso di spazio.
          </p>
          {snapshots.length ? (
            snapshots.map((snapshot) => (
              <div className="snapshot-row" key={snapshot.id}>
                <span>
                  <strong>
                    {new Date(snapshot.createdAt).toLocaleString("it-IT")}
                  </strong>
                  <small>{snapshot.reason}</small>
                </span>
                <button
                  className="secondary mini"
                  onClick={() => onRestoreSnapshot(snapshot.id)}
                >
                  Ripristina
                </button>
              </div>
            ))
          ) : (
            <p className="empty-copy">Nessuna copia locale.</p>
          )}
        </section>
      </div>
    </>
  );
}

function Modal({ title, close, children }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);
  useEffect(() => {
    const previous = document.activeElement;
    const fn = (event) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const focusable = [
          ...(dialogRef.current?.querySelectorAll(
            "button, input, select, textarea, a[href]",
          ) || []),
        ].filter(
          (element) =>
            !element.disabled &&
            element.getAttribute("aria-hidden") !== "true" &&
            element.getClientRects().length > 0,
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", fn);
    dialogRef.current
      ?.querySelector("input, select, textarea, button")
      ?.focus();
    return () => {
      window.removeEventListener("keydown", fn);
      previous?.focus?.();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button
            className="icon-btn"
            aria-label="Chiudi finestra"
            onClick={close}
          >
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Toast({ message, onOpen, onClose }) {
  useEffect(() => {
    if (onOpen) return undefined;
    const timer = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(timer);
  }, [onClose, onOpen]);
  return (
    <div className="toast">
      <Check aria-hidden="true" />
      <span role="status">{message}</span>
      {onOpen && <button onClick={onOpen}>Apri task</button>}
      <button className="icon-btn" aria-label="Chiudi" onClick={onClose}>
        <X />
      </button>
    </div>
  );
}

export default function App() {
  const [clients, setClients] = useStoredState(
    "seogrow-clients",
    initialClients,
  );
  const [tasks, setTasks] = useStoredState("seogrow-tasks-v2", () => {
    try {
      const previous = JSON.parse(localStorage.getItem("seogrow-tasks")) || [];
      const datasets = JSON.parse(localStorage.getItem("seogrow-gsc-v1")) || {};
      const savedClients =
        JSON.parse(localStorage.getItem("seogrow-clients")) || initialClients;
      return previous
        .filter(
          (task) => typeof task.id === "string" && task.id.startsWith("gsc-"),
        )
        .map((task) => {
          const dataset = datasets[task.sourceClientId];
          const query = task.title.match(/[“"](.+?)[”"]/)?.[1] || "";
          const suggestion = suggestPageForQuery(query, dataset?.pages || []);
          const clientUrl =
            savedClients.find((client) => client.id === task.sourceClientId)
              ?.url || "";
          return {
            ...task,
            targetUrl: suggestion?.url || clientUrl,
            linkLabel: suggestion ? "Pagina suggerita" : "Apri il sito",
          };
        });
    } catch {
      return [];
    }
  });
  const [gscData, setGscData] = useStoredState("seogrow-gsc-v1", {});
  const [gscHistory, setGscHistory] = useStoredState(
    "seogrow-gsc-history-v1",
    () => {
      try {
        const existing =
          JSON.parse(localStorage.getItem("seogrow-gsc-v1")) || {};
        return Object.fromEntries(
          Object.entries(existing).map(([id, data]) => [id, [data]]),
        );
      } catch {
        return {};
      }
    },
  );
  const [analyses, setAnalyses] = useStoredState("seogrow-analyses-v2", () => {
    try {
      const existing =
        JSON.parse(localStorage.getItem("seogrow-analyses-v1")) || {};
      return Object.fromEntries(
        Object.entries(existing).map(([id, data]) => [
          id,
          normalizeAnalysisHistory(data),
        ]),
      );
    } catch {
      return {};
    }
  });
  const [snapshots, setSnapshots] = useStoredState("seogrow-snapshots-v1", []);
  const [rankings, setRankings] = useStoredState("seogrow-rankings-v1", {});
  const [topicalMaps, setTopicalMaps] = useStoredState(
    "seogrow-topical-maps-v1",
    {},
  );
  const [geoData, setGeoData] = useStoredState("seogrow-geo-v1", {});
  const [contentDrafts, setContentDrafts] = useStoredState(
    "seogrow-content-drafts-v1",
    {},
  );
  const [agentRuns, setAgentRuns] = useStoredState("seogrow-agent-runs-v1", {});
  const [wordpressProfiles, setWordpressProfiles] = useStoredState(
    "seogrow-wordpress-profiles-v1",
    {},
  );
  const [preferences, setPreferences] = useStoredState(
    "seogrow-preferences-v1",
    {
      name: "Amministratore",
      refreshHours: 0,
      approveWordPress: true,
      notifications: true,
      autoBackup: true,
      saveDrafts: true,
    },
  );
  const [selectedClient, setSelectedClient] = useStoredState(
    "seogrow-selected-client-v1",
    clients[0]?.id || 1,
  );
  const [page, setPage] = useStoredState(
    "seogrow-selected-page-v1",
    "Panoramica",
  );
  useEffect(() => {
    const fromHash = () => {
      try {
        const requested = decodeURIComponent(window.location.hash.slice(1));
        setPage(nav.some(([label]) => label === requested) ? requested : "Panoramica");
      } catch {
        setPage("Panoramica");
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [setPage]);
  useEffect(() => {
    const nextHash = `#${encodeURIComponent(page)}`;
    if (window.location.hash !== nextHash)
      window.history.pushState(null, "", nextHash);
  }, [page]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [quickAudit, setQuickAudit] = useState(false);
  const [auditResults, setAuditResults] = useStoredState("seogrow-quick-audits-v1", {});
  const [wordpressConnections, setWordpressConnections] = useState({});
  const [dataForSeo, setDataForSeo] = useState({ configured: false });
  const [apiStatus, setApiStatus] = useState({ aiConfigured: false });
  const [storageError, setStorageError] = useState("");
  const [toast, setToast] = useState("");
  const [requestedTask, setRequestedTask] = useState(null);
  const handleGscImportRef = useRef(null);
  const clientsRef = useRef(clients);
  const storageErrorKeyRef = useRef("");
  const automaticRefreshRef = useRef(null);
  useEffect(() => {
    clientsRef.current = clients;
  }, [clients]);
  const selectedClientRecord =
    clients.find((client) => client.id === selectedClient) || clients[0];
  useEffect(() => {
    if (clients.length && !clients.some((client) => client.id === selectedClient))
      setSelectedClient(clients[0].id);
  }, [clients, selectedClient, setSelectedClient]);
  const selectedHistory =
    gscHistory[selectedClient] ||
    (gscData[selectedClient] ? [gscData[selectedClient]] : []);
  const selectedDataset = selectedHistory[0] || gscData[selectedClient];
  const selectedDatasetWithChanges = selectedDataset
    ? {
        ...selectedDataset,
        changes: queryChanges(selectedDataset, selectedHistory[1]),
      }
    : null;
  const selectedAnalysisHistory = normalizeAnalysisHistory(
    analyses[selectedClient],
  );
  const selectedAnalysis = latestOf(selectedAnalysisHistory);
  useEffect(() => {
    Promise.allSettled([
      fetch("/api/health").then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "API non disponibile");
        return data;
      }),
      fetch("/api/dataforseo/status").then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Stato DataForSEO non disponibile");
        return data;
      }),
      fetch("/api/openai/status").then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Stato OpenAI non disponibile");
        return data;
      }),
    ]).then(([healthResult, dataForSeoResult, openAiResult]) => {
        const data = healthResult.status === "fulfilled" ? healthResult.value : { aiConfigured: false };
        const dfs = dataForSeoResult.status === "fulfilled" ? dataForSeoResult.value : {};
        setApiStatus({
          ...data,
          ...(openAiResult.status === "fulfilled" ? openAiResult.value : {}),
          aiConfigured: Boolean(
            openAiResult.status === "fulfilled"
              ? openAiResult.value.configured
              : data.aiConfigured,
          ),
        });
        setDataForSeo((current) => ({
          ...current,
          configured: Boolean(dfs.configured ?? data.dataForSeoConfigured),
          monthlyCost: dfs.monthlyCost,
          monthlyBudget: dfs.monthlyBudget,
          maxSerpCost: dfs.maxSerpCost,
          maxLabsCost: dfs.maxLabsCost,
        }));
      });
  }, []);
  useEffect(() => {
    const listener = (event) => {
      storageErrorKeyRef.current = event.detail?.key || "dati";
      setStorageError(
        `Spazio locale esaurito: ${event.detail?.key || "dati"} non salvati. Esporta un backup e riduci lo storico.`,
      );
    };
    window.addEventListener("seogrow-storage-error", listener);
    const clear = (event) => {
      if (event.detail?.key === storageErrorKeyRef.current) {
        storageErrorKeyRef.current = "";
        setStorageError("");
      }
    };
    window.addEventListener("seogrow-storage-ok", clear);
    return () => {
      window.removeEventListener("seogrow-storage-error", listener);
      window.removeEventListener("seogrow-storage-ok", clear);
    };
  }, []);
  const saveContentDraft = useCallback(
    (draft) =>
      setContentDrafts((current) => {
        if (preferences.saveDrafts !== false)
          return { ...current, [selectedClient]: draft };
        if (!(selectedClient in current)) return current;
        const next = { ...current };
        delete next[selectedClient];
        return next;
      }),
    [preferences.saveDrafts, selectedClient, setContentDrafts],
  );
  useEffect(() => {
    setTasks((current) => {
      let changed = false;
      const migrated = current.map((task) => {
        if (
          task.kind !== "search" ||
          (task.detail &&
            !task.detail.includes("Associazione suggerita dal percorso URL"))
        )
          return task;
        const dataset = gscData[task.sourceClientId];
        const queryText =
          task.query || task.title.match(/[“"](.+?)[”"]/)?.[1] || "";
        const row = dataset?.queries?.find(
          (item) => item.dimension === queryText,
        );
        if (!row) return task;
        const exact =
          dataset.queryPages?.find(
            (item) => (item.dimension || item.query) === queryText,
          )?.pages?.[0] || "";
        const pageUrl =
          exact ||
          suggestPageForQuery(queryText, dataset.pages || [])?.url ||
          "";
        changed = true;
        return {
          ...task,
          query: queryText,
          sourceUrl: pageUrl,
          targetUrl: "",
          associationStatus: exact ? "verified" : "suggested",
          metrics: {
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          },
          detail: queryTaskDetail(row, pageUrl, Boolean(exact)),
        };
      });
      return changed ? migrated : current;
    });
  }, [gscData, setTasks]);
  useEffect(() => {
    const today = new Date();
    const iso = (date) => date.toISOString().slice(0, 10);
    setTasks((current) => {
      let changed = false;
      const normalized = current.map((task) => {
        if (!task.due || /^\d{4}-\d{2}-\d{2}$/.test(task.due)) return task;
        changed = true;
        if (task.due === "Oggi") return { ...task, due: iso(today) };
        if (task.due === "Domani") {
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          return { ...task, due: iso(tomorrow) };
        }
        return { ...task, due: "" };
      });
      return changed ? normalized : current;
    });
  }, [setTasks]);
  const createSnapshot = (reason = "Copia manuale") =>
    setSnapshots((current) =>
      [
        {
          id: newId("snapshot"),
          createdAt: new Date().toISOString(),
          reason,
          data: {
            clients,
            tasks,
            gscData,
            gscHistory,
            analyses,
            rankings,
            topicalMaps,
            geoData,
            contentDrafts,
            wordpressProfiles,
            auditResults,
            agentRuns,
            preferences,
          },
        },
        ...current,
      ].slice(0, 2),
    );
  const handleGscImport = (data) => {
    const propertyHost = data.property?.host || "";
    const currentClients = clientsRef.current;
    const exactPropertyClient = data.property?.url
      ? currentClients.find((client) => client.gscProperty === data.property.url)
      : null;
    const hostClients = propertyHost
      ? currentClients.filter(
          (client) => normalizeSiteHost(client.url) === propertyHost,
        )
      : [];
    if (!exactPropertyClient && hostClients.length > 1)
      throw new Error(
        `Più progetti usano ${propertyHost}. Collega Search Console via API oppure assegna prima la proprietà esatta al progetto corretto.`,
      );
    if (data.property?.confirmed === false) {
      if (!hostClients.length)
        throw new Error(
          `Il dominio ${propertyHost || "dello ZIP"} è stato dedotto soltanto dal nome del file. Rinomina lo ZIP con il dominio corretto oppure importalo nel progetto corrispondente.`,
        );
      if (
        !window.confirm(
          `Il dominio ${propertyHost} è stato dedotto dal nome dello ZIP, non dai dati interni. Confermi l’associazione a ${hostClients[0].name}?`,
        )
      )
        throw new Error("Importazione annullata: associazione non confermata.");
    }
    let targetClient =
      exactPropertyClient || hostClients[0] || (!propertyHost ? selectedClientRecord : null);
    if (preferences.autoBackup)
      createSnapshot("Prima dell’importazione Search Console");
    let targetClientId = targetClient?.id;
    if (!targetClient) {
      targetClientId = Math.max(0, ...currentClients.map((client) => Number(client.id) || 0)) + 1;
      const readableName = propertyHost
        ? propertyHost
        : `Progetto Search Console ${currentClients.length + 1}`;
      targetClient = {
        id: targetClientId,
        name: readableName,
        url: propertyHost ? `https://${propertyHost}` : "",
        score: 0,
        sites: 1,
        color: "#2477ee",
        gscProperty: data.property?.url || "",
      };
      clientsRef.current = [...currentClients, targetClient];
      setClients((current) => [...current, targetClient]);
    } else if (data.property?.url && targetClient.gscProperty !== data.property.url) {
      targetClient = { ...targetClient, gscProperty: data.property.url };
      clientsRef.current = currentClients.map((client) =>
        client.id === targetClientId ? targetClient : client,
      );
      setClients((current) =>
        current.map((client) => (client.id === targetClientId ? targetClient : client)),
      );
    }
    setSelectedClient(targetClientId);
    setGscData((current) => ({ ...current, [targetClientId]: data }));
    setGscHistory((current) =>
      addDatasetToHistory(current, targetClientId, data),
    );
    const generatedTasks = opportunityQueries(data, 20).map((row) => {
      const exact =
        data.queryPages?.find(
          (item) => (item.dimension || item.query) === row.dimension,
        )?.pages?.[0] || "";
      const suggestion = exact
        ? { url: exact }
        : suggestPageForQuery(row.dimension, data.pages);
      const pageUrl = suggestion?.url || "";
      return {
        id: `gsc-${targetClientId}-${stableKey(row.dimension)}`,
        title: `Ottimizza “${row.dimension}”`,
        client: targetClient.name,
        priority: row.position <= 10 ? "Alta" : "Media",
        due: "",
        status: "Da fare",
        kind: "search",
        sourceClientId: targetClientId,
        sourceUrl: pageUrl,
        targetUrl: "",
        linkLabel: exact
          ? "Pagina associata"
          : suggestion
            ? "Pagina suggerita"
            : "Apri il sito",
        associationStatus: exact ? "verified" : "suggested",
        query: row.dimension,
        metrics: {
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        },
        detail: queryTaskDetail(row, pageUrl, Boolean(exact)),
      };
    });
    setTasks((current) => {
      const previousByQuery = new Map(
        current
          .filter(
            (task) =>
              task.sourceClientId === targetClientId && task.kind === "search",
          )
          .map((task) => [String(task.query || "").toLocaleLowerCase("it"), task]),
      );
      const merged = generatedTasks.map((task) => {
        const previous = previousByQuery.get(task.query.toLocaleLowerCase("it"));
        return previous
          ? {
              ...task,
              id: previous.id,
              status: previous.status,
              due: previous.due,
              notes: previous.notes,
              ...(previous.userEdited
                ? {
                    title: previous.title,
                    priority: previous.priority,
                    sourceUrl: previous.sourceUrl,
                    targetUrl: previous.targetUrl,
                    linkLabel: previous.linkLabel,
                    detail: previous.detail,
                    userEdited: true,
                  }
                : {}),
            }
          : task;
      });
      const generatedQueries = new Set(
        generatedTasks.map((task) => task.query.toLocaleLowerCase("it")),
      );
      const archived = current
        .filter(
          (task) =>
            task.sourceClientId === targetClientId &&
            task.kind === "search" &&
            !generatedQueries.has(String(task.query || "").toLocaleLowerCase("it")),
        )
        .map((task) => ({
          ...task,
          stale: true,
          archivedReason:
            "La query non rientra più nelle opportunità principali dell'ultima importazione.",
        }));
      return [
        ...current.filter(
          (task) =>
            !(task.sourceClientId === targetClientId && task.kind === "search"),
        ),
        ...archived,
        ...merged,
      ];
    });
    return { clientName: targetClient.name, clientId: targetClientId };
  };
  useEffect(() => {
    handleGscImportRef.current = handleGscImport;
  });
  useEffect(() => {
    if (!preferences.refreshHours) return undefined;
    const controller = new AbortController();
    const refresh = async () => {
      if (automaticRefreshRef.current) return;
      automaticRefreshRef.current = true;
      try {
        const propertiesResponse = await fetch("/api/google/properties", { signal: controller.signal });
        if (!propertiesResponse.ok) throw new Error("Impossibile leggere le proprietà Google");
        const propertiesData = await propertiesResponse.json();
        const match = propertiesData.properties?.find(
          (item) =>
            item.url === selectedClientRecord.gscProperty ||
            normalizeSiteHost(item.url) === normalizeSiteHost(selectedClientRecord.url),
        );
        if (!match) return;
        const response = await fetch("/api/google/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ property: match.url }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Aggiornamento automatico non riuscito");
        handleGscImportRef.current?.(await response.json());
      } catch (error) {
        if (error.message !== "Richiesta annullata.")
          setStorageError(`Aggiornamento automatico: ${error.message}`);
      } finally {
        automaticRefreshRef.current = null;
      }
    };
    refresh();
    const interval = window.setInterval(
      refresh,
      preferences.refreshHours * 60 * 60 * 1000,
    );
    return () => {
      controller.abort();
      automaticRefreshRef.current = null;
      window.clearInterval(interval);
    };
    // L’intervallo viene ricreato soltanto quando cambiano frequenza o progetto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.refreshHours, selectedClient]);
  const openClient = (clientId) => {
    setSelectedClient(clientId);
    setPage("Panoramica");
  };
  const updateClient = (clientId, changes) => {
    const previous = clients.find((item) => item.id === clientId);
    if (!previous) return;
    const domainChanged =
      changes.url && projectIdentity(changes.url) !== projectIdentity(previous.url);
    if (
      domainChanged &&
      !window.confirm(
        "Il dominio è cambiato. Eliminare dal progetto i vecchi dati Search Console, analisi, ranking, GEO, bozze e connessione WordPress?",
      )
    ) return;
    const safeChanges = domainChanged
      ? { ...changes, gscProperty: "", demo: false }
      : { ...changes, demo: false };
    setClients((current) =>
      current.map((client) =>
        client.id === clientId ? { ...client, ...safeChanges } : client,
      ),
    );
    setTasks((current) =>
      domainChanged
        ? current.filter((task) => task.sourceClientId !== clientId)
        : current.map((task) =>
            task.sourceClientId === clientId
              ? { ...task, client: changes.name || previous.name }
              : task,
          ),
    );
    if (domainChanged) {
      for (const setter of [
        setGscData,
        setGscHistory,
        setAnalyses,
        setRankings,
        setTopicalMaps,
        setGeoData,
        setContentDrafts,
        setWordpressProfiles,
        setAuditResults,
        setAgentRuns,
      ])
        setter((current) => {
          const next = { ...current };
          delete next[clientId];
          return next;
        });
      setWordpressConnections((current) => {
        const next = { ...current };
        delete next[clientId];
        return next;
      });
    }
  };
  const deleteClient = (clientId) => {
    const client = clients.find((item) => item.id === clientId);
    if (!client) return;
    if (clients.length === 1) {
      window.alert(
        "Deve rimanere almeno un progetto. Crea prima un altro cliente.",
      );
      return;
    }
    if (
      !window.confirm(
        `Eliminare ${client.name} e tutti i suoi dati locali, task e analisi?`,
      )
    )
      return;
    if (preferences.autoBackup)
      createSnapshot(`Prima dell’eliminazione di ${client.name}`);
    const remaining = clients.filter((item) => item.id !== clientId);
    const uniqueClientName =
      clients.filter((item) => item.name === client.name).length === 1;
    setClients(remaining);
    setTasks((current) =>
      current.filter(
        (task) =>
          task.sourceClientId !== clientId &&
          !(
            task.sourceClientId == null &&
            uniqueClientName &&
            task.client === client.name
          ),
      ),
    );
    setGscData((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    setGscHistory((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    setAnalyses((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    setRankings((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    setTopicalMaps((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    setGeoData((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    setContentDrafts((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    setWordpressProfiles((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    setAuditResults((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    setAgentRuns((current) => {
      const next = { ...current };
      delete next[clientId];
      return next;
    });
    if (selectedClient === clientId) setSelectedClient(remaining[0].id);
  };
  const downloadReport = (clientId) => {
    const client = clients.find((item) => item.id === clientId);
    if (!client) return;
    const clientTasks = tasks.filter(
      (task) =>
        task.sourceClientId === clientId ||
        (!task.sourceClientId && task.client === client.name),
    );
    downloadClientReport({
      client,
      dataset: (gscHistory[clientId] || [gscData[clientId]])[0],
      tasks: clientTasks,
      analysis: latestOf(normalizeAnalysisHistory(analyses[clientId])),
      geo: geoData[clientId],
    });
  };
  const completeSiteAnalysis = (analysis) => {
    if (preferences.autoBackup) createSnapshot("Prima della nuova analisi");
    const previous = selectedAnalysisHistory[0];
    const diff = analysisDiff(analysis, previous);
    const enriched = {
      ...analysis,
      ...diff,
      scoreDelta: previous?.score != null ? analysis.score - previous.score : 0,
      hasPrevious: previous?.score != null,
    };
    setAnalyses((current) => ({
      ...current,
      [selectedClient]: [
        enriched,
        ...normalizeAnalysisHistory(current[selectedClient]),
      ].slice(0, 20),
    }));
    const verifiedTasks = tasksFromAnalysis(enriched, selectedClientRecord);
    setTasks((current) => {
      const completed = new Set(
        current
          .filter(
            (task) =>
              task.sourceClientId === selectedClient &&
              String(task.id).startsWith("analysis-") &&
              task.kind !== "manual" &&
              task.status === "Completato",
          )
          .map((task) => `${task.kind}|${task.title}|${task.sourceUrl || task.targetUrl || ""}`),
      );
      return [
        ...current.filter(
          (task) =>
            !(
              task.sourceClientId === selectedClient &&
              String(task.id).startsWith("analysis-") &&
              task.kind !== "manual" &&
              task.status !== "Completato"
            ),
        ),
        ...verifiedTasks.map((task) => {
          const wasCompleted = completed.has(
            `${task.kind}|${task.title}|${task.sourceUrl || task.targetUrl || ""}`,
          );
          return wasCompleted
            ? {
                ...task,
                title: `Problema ricomparso: ${task.title}`,
                detail: `REGRESSIONE: il problema era stato completato ma è stato rilevato nuovamente.\n\n${task.detail || ""}`,
                regression: true,
              }
            : task;
        }),
      ];
    });
  };
  const restoreBackup = (backup, { preserveSnapshots = false } = {}) => {
    setClients(backup.clients);
    setTasks(backup.tasks);
    setGscData(backup.gscData);
    setGscHistory(
      backup.gscHistory ||
        Object.fromEntries(
          Object.entries(backup.gscData || {}).map(([id, data]) => [
            id,
            [data],
          ]),
        ),
    );
    setAnalyses(
      Object.fromEntries(
        Object.entries(backup.analyses || {}).map(([id, data]) => [
          id,
          normalizeAnalysisHistory(data),
        ]),
      ),
    );
    setRankings(backup.rankings || {});
    setTopicalMaps(backup.topicalMaps || {});
    setGeoData(backup.geoData || {});
    setContentDrafts(backup.contentDrafts || {});
    setWordpressProfiles(backup.wordpressProfiles || {});
    setAuditResults(backup.auditResults || {});
    setAgentRuns(backup.agentRuns || {});
    if (backup.preferences) setPreferences(backup.preferences);
    if (!preserveSnapshots) setSnapshots([]);
    const preferredClientId = Number(backup.selectedClient ?? selectedClient);
    setSelectedClient(
      backup.clients.some((client) => client.id === preferredClientId)
        ? preferredClientId
        : backup.clients[0].id,
    );
  };
  const restoreSnapshot = (snapshotId) => {
    const snapshot = snapshots.find((item) => item.id === snapshotId);
    if (!snapshot || !window.confirm("Ripristinare questa copia locale?"))
      return;
    restoreBackup(snapshot.data, { preserveSnapshots: true });
  };
  const createManualTask = (values) => {
    const title = String(values?.title || "").trim();
    if (!title) {
      setToast("Task non creata: inserisci un titolo.");
      return null;
    }
    const duplicate = tasks.find(
      (item) =>
        item.sourceClientId === selectedClient &&
        item.status !== "Completato" &&
        String(item.title || "").trim().toLowerCase() === title.toLowerCase() &&
        (item.sourceUrl || "") === (values.sourceUrl || "") &&
        (item.targetUrl || "") === (values.targetUrl || ""),
    );
    if (duplicate) {
      setToast(`Task già presente: ${duplicate.title}`);
      return duplicate;
    }
    const task = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      client: selectedClientRecord.name,
      sourceClientId: selectedClient,
      priority: ["Alta", "Media", "Bassa"].includes(values.priority)
        ? values.priority
        : "Media",
      due: "Da pianificare",
      status: "Da fare",
      kind: values.kind || "manual",
      targetUrl: values.targetUrl || "",
      sourceUrl: values.sourceUrl || "",
      linkLabel: values.targetUrl ? "Apri risorsa" : "Apri pagina",
      detail: values.detail || "",
      notes: "",
      createdAt: new Date().toISOString(),
    };
    setTasks((current) => [task, ...current]);
    setToast(`Task creata: ${task.title}`);
    return task;
  };
  const selectedTasks = tasks.filter(
    (task) =>
      task.sourceClientId === selectedClient ||
      (!task.sourceClientId && task.client === selectedClientRecord?.name),
  );
  const notifications = preferences.notifications
    ? buildNotifications({
        tasks: selectedTasks,
        dataset: selectedDataset,
        previousDataset: selectedHistory[1],
        analysis: selectedAnalysis,
      })
    : [];
  const normalizedSearch = query.trim().toLowerCase();
  const searchResults = normalizedSearch
    ? [
        ...nav
          .filter(([label]) => label.toLowerCase().includes(normalizedSearch))
          .slice(0, 3)
          .map(([label]) => ({ label, meta: "Sezione", page: label })),
        ...clients
          .filter((client) =>
            `${client.name} ${client.url}`
              .toLowerCase()
              .includes(normalizedSearch),
          )
          .slice(0, 3)
          .map((client) => ({
            label: client.name,
            meta: client.url,
            page: "Panoramica",
            clientId: client.id,
          })),
        ...tasks
          .filter((task) => String(task.title || "").toLowerCase().includes(normalizedSearch))
          .slice(0, 8)
          .map((task) => ({
            label: task.title,
            meta: task.client,
            page: "Task",
            clientId: task.sourceClientId,
            taskId: task.id,
          })),
      ].slice(0, 10)
    : [];
  const content = (() => {
    if (page === "Panoramica")
      return (
        <Dashboard
          clients={clients}
          tasks={tasks}
          setTasks={setTasks}
          setPage={setPage}
          openAudit={() => setQuickAudit(true)}
          dataset={selectedDataset}
          previousDataset={selectedHistory[1]}
          analysis={selectedAnalysis}
          selectedClient={selectedClient}
          gscData={gscData}
          onOpenClient={openClient}
        />
      );
    if (page === "Clienti")
      return (
        <ClientsPage
          clients={clients}
          setClients={setClients}
          gscData={gscData}
          onOpenClient={openClient}
          onDeleteClient={deleteClient}
          onDownloadReport={downloadReport}
          onUpdateClient={updateClient}
        />
      );
    if (page === "Audit SEO")
      return (
        <AuditPage
          key={selectedClient}
          auditResult={auditResults[selectedClient] || null}
          setAuditResult={(result) =>
            setAuditResults((current) => ({ ...current, [selectedClient]: result }))
          }
          initialUrl={selectedClientRecord.url}
        />
      );
    if (page === "Storico")
      return (
        <HistoryPage
          history={selectedAnalysisHistory}
          client={selectedClientRecord}
          onAnalyze={() => setQuickAudit(true)}
        />
      );
    if (page === "Link interni")
      return (
        <InternalLinksPage
          analysis={selectedAnalysis}
          client={selectedClientRecord}
          onAnalyze={() => setQuickAudit(true)}
          onCreateTask={createManualTask}
        />
      );
    if (page === "Opportunità")
      return (
        <Opportunities
          dataset={selectedDatasetWithChanges}
          openIntegrations={() => setPage("Integrazioni")}
          onCreateTask={createManualTask}
        />
      );
    if (page === "SEO Agent")
      return (
        <AgentPage
          key={selectedClient}
          client={selectedClientRecord}
          dataset={selectedDatasetWithChanges}
          analysis={selectedAnalysis}
          rankings={rankings[selectedClient] || []}
          savedRuns={agentRuns[selectedClient] || []}
          onSaveRun={(run) =>
            setAgentRuns((current) => ({
              ...current,
              [selectedClient]: [run, ...(current[selectedClient] || []).filter((item) => item.id !== run.id)].slice(0, 20),
            }))
          }
          onDeleteRun={(runId) => setAgentRuns((current) => ({ ...current, [selectedClient]: (current[selectedClient] || []).filter((item) => item.id !== runId) }))}
          onCreateTask={createManualTask}
        />
      );
    if (page === "Posizionamenti")
      return (
        <RankingsPage
          key={selectedClient}
          client={selectedClientRecord}
          dataset={selectedDataset}
          dataForSeo={dataForSeo}
          history={rankings[selectedClient] || []}
          onSave={(result) =>
            setRankings((current) => ({
              ...current,
              [selectedClient]: [
                result,
                ...(current[selectedClient] || []),
              ].slice(0, 20),
            }))
          }
          onCreateTask={createManualTask}
          onNavigate={setPage}
          onUsage={(monthlyCost) =>
            setDataForSeo((current) => ({ ...current, monthlyCost }))
          }
        />
      );
    if (page === "GEO AI")
      return (
        <GeoPage
          key={selectedClient}
          client={selectedClientRecord}
          dataset={selectedDataset}
          analysis={selectedAnalysis}
          topicalMap={topicalMaps[selectedClient]}
          saved={geoData[selectedClient]}
          onSave={(value) =>
            setGeoData((current) => ({ ...current, [selectedClient]: value }))
          }
          onCreateTask={createManualTask}
          aiConfigured={apiStatus.aiConfigured}
          aiStatus={apiStatus}
          onNavigate={setPage}
        />
      );
    if (page === "Piano editoriale")
      return (
        <ContentPage
          key={selectedClient}
          dataset={selectedDataset}
          analysis={selectedAnalysis}
          client={selectedClientRecord}
          onCreateTask={createManualTask}
          requireApproval={preferences.approveWordPress}
          wordpressConnection={wordpressConnections[selectedClient]}
          onNavigate={setPage}
          dataForSeo={dataForSeo}
          topicalMap={topicalMaps[selectedClient]}
          onSaveTopicalMap={(result) =>
            setTopicalMaps((current) => ({
              ...current,
              [selectedClient]: result,
            }))
          }
          draft={contentDrafts[selectedClient]}
          onSaveDraft={saveContentDraft}
          onDataForSeoUsage={(monthlyCost) =>
            setDataForSeo((current) => ({ ...current, monthlyCost }))
          }
        />
      );
    if (page === "Task")
      return (
        <>
          <EmptyTitle
            title={`Task — ${selectedClientRecord.name}`}
            text="Sono mostrate soltanto le attività del progetto selezionato."
            action="Nuova analisi"
            onAction={() => setQuickAudit(true)}
          />
          <TaskTable
            key={selectedClient}
            tasks={selectedTasks}
            setTasks={setTasks}
            client={selectedClientRecord}
            clients={clients}
            openTaskId={requestedTask?.id}
            onTaskOpened={() => setRequestedTask(null)}
          />
        </>
      );
    if (page === "Integrazioni")
      return (
        <Integrations
          key={selectedClient}
          selectedClient={selectedClientRecord}
          dataset={selectedDataset}
          history={selectedHistory}
          onGscImport={handleGscImport}
          wordpressConnection={wordpressConnections[selectedClient]}
          wordpressProfile={wordpressProfiles[selectedClient]}
          onWordPressVerified={(connection) => {
            setWordpressConnections((current) => ({
              ...current,
              [selectedClient]: connection,
            }));
            setWordpressProfiles((current) => ({
              ...current,
              [selectedClient]: {
                url: connection.url,
                username: connection.username,
                name: connection.name,
              },
            }));
          }}
          onNavigate={setPage}
          dataForSeo={dataForSeo}
          aiConfigured={apiStatus.aiConfigured}
          aiStatus={apiStatus}
          onDataForSeoStatus={setDataForSeo}
        />
      );
    return (
      <SettingsPage
        clients={clients}
        selectedClient={selectedClient}
        tasks={tasks}
        gscData={gscData}
        gscHistory={gscHistory}
        analyses={analyses}
        rankings={rankings}
        topicalMaps={topicalMaps}
        geoData={geoData}
        contentDrafts={contentDrafts}
        wordpressProfiles={wordpressProfiles}
        auditResults={auditResults}
        agentRuns={agentRuns}
        snapshots={snapshots}
        preferences={preferences}
        setPreferences={setPreferences}
        onCreateSnapshot={() => createSnapshot("Copia manuale")}
        onRestoreSnapshot={restoreSnapshot}
        onRestore={restoreBackup}
      />
    );
  })();
  return (
    <div className="app">
      <Sidebar
        page={page}
        setPage={setPage}
        open={menuOpen}
        setOpen={setMenuOpen}
        displayName={preferences.name || "Amministratore"}
      />
      {menuOpen && (
        <button
          className="nav-scrim"
          aria-label="Chiudi menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className="workspace">
        <Header
          clients={clients}
          selectedClient={selectedClient}
          setSelectedClient={setSelectedClient}
          setMenuOpen={setMenuOpen}
          query={query}
          setQuery={setQuery}
          searchResults={searchResults}
          onSearchResult={(item) => {
            if (item.clientId) setSelectedClient(item.clientId);
            if (item.taskId)
              setRequestedTask({ id: item.taskId, nonce: Date.now() });
            setPage(item.page);
            setQuery("");
          }}
          notifications={notifications}
          onNotifications={(item) =>
            setPage(item.title.includes("task") ? "Task" : "Opportunità")
          }
          onHelp={() => setPage("Impostazioni")}
          displayName={preferences.name || "Amministratore"}
        />
        {storageError && (
          <div className="storage-warning" role="alert">
            <AlertTriangle />
            <span>{storageError}</span>
            <button
              aria-label="Chiudi avviso"
              onClick={() => setStorageError("")}
            >
              <X />
            </button>
          </div>
        )}
        <main>{content}</main>
      </div>
      {quickAudit && (
        <SiteAnalysisModal
          key={selectedClient}
          client={selectedClientRecord}
          previousAnalysis={selectedAnalysis}
          onComplete={completeSiteAnalysis}
          close={() => setQuickAudit(false)}
          openTasks={() => {
            setQuickAudit(false);
            setPage("Task");
          }}
        />
      )}
      {toast && (
        <Toast
          message={toast}
          onOpen={() => {
            setPage("Task");
            setToast("");
          }}
          onClose={() => setToast("")}
        />
      )}
    </div>
  );
}
