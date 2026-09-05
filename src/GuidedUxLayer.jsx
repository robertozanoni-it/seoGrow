import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleGauge,
  ClipboardCheck,
  Database,
  FileText,
  Globe2,
  History,
  Link2,
  Plug,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Target,
  Users,
  WandSparkles,
} from "lucide-react";
import "./GuidedUxLayer.css";

const UI_MODE_KEY = "seogrow-ui-mode-v1";
const SELECTED_CLIENT_KEY = "seogrow-selected-client-v1";
const CLIENTS_KEY = "seogrow-clients";
const TASKS_KEY = "seogrow-tasks-v2";
const GSC_KEY = "seogrow-gsc-v1";
const ANALYSES_KEY = "seogrow-analyses-v2";
const REMEDIATION_INDEX_KEY = "seogrow-remediation-history-v1";

const groups = [
  {
    label: "Progetto",
    items: [
      ["Panoramica", CircleGauge],
      ["Clienti", Users],
      ["Storico", History, true],
    ],
  },
  {
    label: "Analizza",
    items: [
      ["Audit SEO", CircleGauge],
      ["Link interni", Link2],
      ["Posizionamenti", BarChart3],
    ],
  },
  {
    label: "Migliora",
    items: [
      ["Opportunità", Target],
      ["Correzioni", CheckCircle2],
      ["Task", ClipboardCheck],
      ["Piano editoriale", FileText, true],
    ],
  },
  {
    label: "SeoGrow AI",
    items: [
      ["SEO Agent", WandSparkles],
      ["GEO AI", Sparkles, true],
    ],
  },
  {
    label: "Sistema",
    items: [
      ["Integrazioni", Plug],
      ["Impostazioni", Settings],
    ],
  },
];

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

const readMode = () => {
  try {
    const value = localStorage.getItem(UI_MODE_KEY);
    return value === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
  }
};

const readPage = () => {
  try {
    return decodeURIComponent(window.location.hash.slice(1)) || "Panoramica";
  } catch {
    return "Panoramica";
  }
};

const navigate = (page) => {
  const next = `#${encodeURIComponent(page)}`;
  if (page === "Correzioni") {
    // Il core App non possiede questa pagina: il workspace Correzioni è un overlay.
    // Entriamo nella modalità overlay prima di notificare la navigazione, evitando
    // che il fallback core a Panoramica vinca la stessa transizione.
    window.__seogrowCorrectionsMode = true;
    if (window.location.hash !== next) window.history.pushState(null, "", next);
    window.dispatchEvent(new CustomEvent("seogrow-locationchange"));
    return;
  }
  if (window.location.hash !== next) window.location.hash = next;
  else window.dispatchEvent(new CustomEvent("seogrow-locationchange"));
};

const cleanSite = (value) =>
  String(value || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");

const readableDate = (value) => {
  if (!value) return "mai";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "non disponibile";
  return date.toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const latestAnalysis = (value) => {
  if (Array.isArray(value)) return value[0] || null;
  if (value && typeof value === "object") return value;
  return null;
};

function useUiSnapshot() {
  const [, setVersion] = useState(0);
  const [page, setPage] = useState(readPage);
  const [mode, setMode] = useState(readMode);
  const [targets, setTargets] = useState({ sidebar: null, topbar: null, main: null });
  const [dashboardHost, setDashboardHost] = useState(null);

  useEffect(() => {
    const syncTargets = () =>
      setTargets({
        sidebar: document.querySelector(".sidebar"),
        topbar: document.querySelector(".topbar"),
        main: document.querySelector(".app main"),
      });
    syncTargets();
    const frame = window.requestAnimationFrame(syncTargets);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const refresh = () => {
      setPage(readPage());
      setVersion((current) => current + 1);
    };
    const onChange = (event) => {
      if (event.target?.matches?.(".client-select select")) {
        window.setTimeout(refresh, 0);
      }
    };
    window.addEventListener("hashchange", refresh);
    window.addEventListener("seogrow-locationchange", refresh);
    window.addEventListener("seogrow-storage-ok", refresh);
    window.addEventListener("seogrow-remediation-history", refresh);
    document.addEventListener("change", onChange, true);
    return () => {
      window.removeEventListener("hashchange", refresh);
      window.removeEventListener("seogrow-locationchange", refresh);
      window.removeEventListener("seogrow-storage-ok", refresh);
      window.removeEventListener("seogrow-remediation-history", refresh);
      document.removeEventListener("change", onChange, true);
    };
  }, []);

  useEffect(() => {
    document.body.dataset.seogrowUiMode = mode;
    try {
      localStorage.setItem(UI_MODE_KEY, mode);
    } catch {
      /* La modalità resta valida per la sessione anche se lo storage non è disponibile. */
    }
    return () => {
      if (document.body.dataset.seogrowUiMode === mode)
        delete document.body.dataset.seogrowUiMode;
    };
  }, [mode]);

  useEffect(() => {
    let host = null;
    const frame = window.requestAnimationFrame(() => {
      if (page !== "Panoramica" || !targets.main) {
        setDashboardHost(null);
        return;
      }
      const title = targets.main.querySelector(":scope > .page-title");
      if (!title) {
        setDashboardHost(null);
        return;
      }
      host = document.createElement("div");
      host.className = "guided-next-actions-host";
      title.insertAdjacentElement("afterend", host);
      setDashboardHost(host);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      host?.remove();
    };
  }, [page, targets.main]);

  return { page, mode, setMode, targets, dashboardHost };
}

function GuidedNav({ page, mode, setMode }) {
  return (
    <nav className="guided-nav" aria-label="Navigazione guidata SeoGrow">
      <div className="guided-nav-scroll">
        {groups.map((group) => {
          const visibleItems = group.items.filter(([, , advancedOnly]) =>
            mode === "advanced" ? true : !advancedOnly,
          );
          if (!visibleItems.length) return null;
          return (
            <section className="guided-nav-group" key={group.label}>
              <span className="guided-nav-label">{group.label}</span>
              {visibleItems.map(([label, Icon]) => (
                <button
                  type="button"
                  key={label}
                  className={page === label ? "active" : ""}
                  aria-current={page === label ? "page" : undefined}
                  onClick={() => navigate(label)}
                >
                  <Icon />
                  <span>{label}</span>
                </button>
              ))}
            </section>
          );
        })}
      </div>
      <button
        type="button"
        className="guided-mode-toggle"
        onClick={() => setMode(mode === "simple" ? "advanced" : "simple")}
        aria-pressed={mode === "advanced"}
      >
        <SlidersHorizontal />
        <span>
          <strong>{mode === "simple" ? "Modalità semplice" : "Modalità avanzata"}</strong>
          <small>{mode === "simple" ? "Mostra tutti gli strumenti" : "Riduci le voci del menu"}</small>
        </span>
      </button>
    </nav>
  );
}

function ProjectContext({ client, dataset, analysis, page }) {
  if (!client) return null;
  return (
    <div className="guided-project-context" aria-label="Contesto del progetto attivo">
      <span className="guided-context-path">
        <strong>{client.name}</strong>
        <i>/</i>
        <b>{page}</b>
      </span>
      <a href={client.url} target="_blank" rel="noreferrer" title={client.url}>
        <Globe2 />
        {cleanSite(client.url)}
      </a>
      <span className="guided-context-freshness">
        <Database />
        GSC {readableDate(dataset?.importedAt || dataset?.dateTo)} · Audit {readableDate(analysis?.analyzedAt)}
      </span>
    </div>
  );
}

function NextActions({ client, tasks, dataset, analysis, corrections }) {
  const activeTasks = tasks.filter(
    (task) => !task.stale && task.status !== "Completato",
  );
  const highTasks = activeTasks.filter((task) => task.priority === "Alta").length;
  const issues = Array.isArray(analysis?.issues) ? analysis.issues : [];
  const pendingCorrections = corrections.filter((item) =>
    ["Applicato", "Da verificare"].includes(item.status),
  );
  const opportunities = Array.isArray(dataset?.queries)
    ? dataset.queries.filter((row) => {
        const position = Number(row.position);
        return Number.isFinite(position) && position >= 4 && position <= 20;
      }).length
    : 0;

  const actions = [];
  if (activeTasks.length) {
    actions.push({
      page: "Task",
      Icon: ClipboardCheck,
      tone: highTasks ? "urgent" : "normal",
      title: `${activeTasks.length} task aperte${highTasks ? ` · ${highTasks} ad alta priorità` : ""}`,
      text: "Apri l’elenco ordinato e lavora prima sulle attività con maggiore impatto.",
    });
  } else if (!analysis) {
    actions.push({
      page: "Audit SEO",
      Icon: CircleGauge,
      tone: "normal",
      title: "Manca una baseline tecnica",
      text: "Esegui un audit per avere problemi e priorità verificabili del progetto.",
    });
  } else if (issues.length) {
    actions.push({
      page: "Audit SEO",
      Icon: AlertTriangle,
      tone: "urgent",
      title: `${issues.length} problemi nell’ultimo audit`,
      text: "Rivedi i controlli tecnici e le evidenze prima di applicare nuove modifiche.",
    });
  }

  if (pendingCorrections.length) {
    actions.push({
      page: "Correzioni",
      Icon: CheckCircle2,
      tone: "verify",
      title: `${pendingCorrections.length} correzioni da verificare`,
      text: "Controlla che ciò che è stato scritto sia realmente visibile e risolto sul sito.",
    });
  }

  if (!dataset) {
    actions.push({
      page: "Integrazioni",
      Icon: Database,
      tone: "normal",
      title: "Search Console non ancora disponibile",
      text: "Importa o collega i dati per opportunità, query e andamento organico reali.",
    });
  } else if (opportunities) {
    actions.push({
      page: "Opportunità",
      Icon: Target,
      tone: "growth",
      title: `${opportunities} query tra posizione 4 e 20`,
      text: "Sono candidate naturali per una revisione orientata a migliorare visibilità e clic.",
    });
  }

  if (actions.length < 4 && dataset && analysis) {
    actions.push({
      page: "SEO Agent",
      Icon: WandSparkles,
      tone: "ai",
      title: "Chiedi a SeoGrow la prossima priorità",
      text: "Usa insieme audit e dati del progetto per decidere il prossimo intervento.",
    });
  }

  const shown = actions.slice(0, 4);
  return (
    <section className="guided-next-actions" aria-labelledby="guided-next-actions-title">
      <div className="guided-next-actions-head">
        <div>
          <span className="guided-eyebrow">Percorso guidato</span>
          <h2 id="guided-next-actions-title">Cosa fare adesso</h2>
          <p>Priorità operative per {client?.name || "il progetto"}, ricavate dai dati già presenti in SeoGrow.</p>
        </div>
        <span className="guided-flow">Analizza → Capisci → Correggi → Verifica → Monitora</span>
      </div>
      <div className="guided-action-grid">
        {shown.length ? (
          shown.map(({ page: targetPage, Icon, tone, title, text }) => (
            <button
              type="button"
              className={`guided-action-card ${tone}`}
              key={`${targetPage}-${title}`}
              onClick={() => navigate(targetPage)}
            >
              <span className="guided-action-icon"><Icon /></span>
              <span>
                <strong>{title}</strong>
                <small>{text}</small>
              </span>
              <b aria-hidden="true">→</b>
            </button>
          ))
        ) : (
          <button type="button" className="guided-action-card complete" onClick={() => navigate("Audit SEO")}>
            <span className="guided-action-icon"><CheckCircle2 /></span>
            <span>
              <strong>Nessuna urgenza rilevata</strong>
              <small>Puoi rieseguire l’audit per aggiornare la situazione del progetto.</small>
            </span>
            <b aria-hidden="true">→</b>
          </button>
        )}
      </div>
    </section>
  );
}

export default function GuidedUxLayer() {
  const { page, mode, setMode, targets, dashboardHost } = useUiSnapshot();

  const clients = readJson(CLIENTS_KEY, []);
  const domClientId = Number(document.querySelector(".client-select select")?.value || 0);
  const selectedClientId = domClientId || Number(readJson(SELECTED_CLIENT_KEY, 0));
  const client = clients.find((item) => item.id === selectedClientId) || clients[0] || null;
  const tasks = readJson(TASKS_KEY, []).filter(
    (task) =>
      task.sourceClientId === client?.id ||
      (!task.sourceClientId && task.client === client?.name),
  );
  const gscData = readJson(GSC_KEY, {});
  const analyses = readJson(ANALYSES_KEY, {});
  const corrections = readJson(REMEDIATION_INDEX_KEY, []).filter(
    (item) => Number(item.clientId) === Number(client?.id),
  );
  const snapshot = {
    client,
    tasks,
    dataset: client ? gscData[client.id] || null : null,
    analysis: client ? latestAnalysis(analyses[client.id]) : null,
    corrections,
  };

  return (
    <>
      {targets.sidebar &&
        createPortal(
          <GuidedNav page={page} mode={mode} setMode={setMode} />,
          targets.sidebar,
        )}
      {targets.topbar &&
        createPortal(
          <ProjectContext
            client={snapshot.client}
            dataset={snapshot.dataset}
            analysis={snapshot.analysis}
            page={page}
          />,
          targets.topbar,
        )}
      {dashboardHost &&
        createPortal(
          <NextActions {...snapshot} />,
          dashboardHost,
        )}
    </>
  );
}
