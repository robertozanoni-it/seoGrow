import { access, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

const appUrl = process.argv[2] || "http://127.0.0.1:5176/";
const debuggingPort = 9222;
const profile = `/tmp/seogrow-browser-smoke-${process.pid}`;

const candidates = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

let chromeBin = "";
for (const candidate of candidates) {
  try {
    await access(candidate);
    chromeBin = candidate;
    break;
  } catch {
    // Prova il prossimo binario noto del runner.
  }
}
if (!chromeBin) throw new Error("Chrome/Chromium non disponibile sul runner.");

const chrome = spawn(chromeBin, [
  "--headless",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

let chromeLog = "";
chrome.stderr.on("data", (chunk) => { chromeLog += String(chunk); });
chrome.stdout.on("data", (chunk) => { chromeLog += String(chunk); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, timeoutMs = 15_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`Chrome DevTools non disponibile: ${lastError?.message || "timeout"}`);
}

const version = await waitForJson(`http://127.0.0.1:${debuggingPort}/json/version`);
if (!version.Browser) throw new Error("Chrome DevTools non ha restituito la versione browser.");

const targetResponse = await fetch(
  `http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent("about:blank")}`,
  { method: "PUT" },
);
if (!targetResponse.ok) throw new Error(`Impossibile creare la pagina CDP: HTTP ${targetResponse.status}`);
const target = await targetResponse.json();
if (!target.webSocketDebuggerUrl) throw new Error("WebSocket CDP mancante.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Timeout connessione CDP.")), 10_000);
  socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
  socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Connessione CDP fallita.")); }, { once: true });
});

let messageId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message || "Errore CDP"));
  else resolve(message.result || {});
});

const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++messageId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression) => {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Errore JavaScript browser.");
  return result.result?.value;
};

async function waitFor(expression, label, timeoutMs = 12_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evaluate(`Boolean(${expression})`)) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(120);
  }
  const body = await evaluate("document.body?.innerText || ''").catch(() => "");
  throw new Error(`UI non pronta: ${label}. ${lastError?.message || ""} Testo corrente: ${String(body).slice(0, 1200)}`);
}

const clickSidebar = async (label) => {
  const clicked = await evaluate(`(() => {
    const matches = (root) => [...root.querySelectorAll('button')]
      .find((node) => String(node.textContent || '').trim().includes(${JSON.stringify(label)}));
    const guided = document.querySelector('.guided-nav');
    const button = (guided && matches(guided)) || matches(document.querySelector('.sidebar'));
    if (!button) return false;
    const style = getComputedStyle(button);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Voce sidebar visibile non trovata: ${label}`);
};

const responsiveFixture = `<!doctype html>
<meta charset="utf-8">
<style>
  #desktop-only, #tablet-only, #mobile-only { display: none; }
  @media (min-width: 1025px) { #desktop-only { display: block; } }
  @media (min-width: 768px) and (max-width: 1024px) { #tablet-only { display: block; } }
  @media (max-width: 767px) { #mobile-only { display: block; } }
  .stylesheet-hidden { display: none; }
</style>
<main>
  <div id="desktop-only">desktop</div>
  <div id="tablet-only">tablet</div>
  <div id="mobile-only">mobile</div>
  <div id="stylesheet-hidden">hidden by stylesheet</div>
  <div id="runtime-target"></div>
</main>
<script>
  requestAnimationFrame(() => {
    const node = document.createElement('span');
    node.id = 'runtime-visible';
    node.textContent = 'runtime visible';
    document.querySelector('#runtime-target').append(node);
    document.body.dataset.visibilityFixtureReady = 'true';
  });
</script>`;

const assertViewportVisibility = async (width, expectedId, label) => {
  await command("Emulation.setDeviceMetricsOverride", {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });
  await command("Page.navigate", { url: `data:text/html;charset=utf-8,${encodeURIComponent(responsiveFixture)}` });
  await waitFor("document.body?.dataset.visibilityFixtureReady === 'true'", `fixture responsive ${label}`);
  const state = await evaluate(`(() => {
    const visible = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
    };
    return {
      desktop: visible('#desktop-only'),
      tablet: visible('#tablet-only'),
      mobile: visible('#mobile-only'),
      stylesheetHidden: visible('#stylesheet-hidden'),
      runtimeVisible: visible('#runtime-visible'),
    };
  })()`);
  const expected = { desktop: false, tablet: false, mobile: false };
  expected[expectedId] = true;
  if (
    state.desktop !== expected.desktop ||
    state.tablet !== expected.tablet ||
    state.mobile !== expected.mobile ||
    state.stylesheetHidden !== false ||
    state.runtimeVisible !== true
  ) {
    throw new Error(`Visibilità browser ${label} non coerente: ${JSON.stringify(state)}`);
  }
};

try {
  await command("Page.enable");
  await command("Runtime.enable");

  // Il target parte da about:blank: così lo script di inizializzazione viene eseguito
  // prima del primo mount React dell'app, senza che lo stato di esempio possa sovrascriverlo.
  await command("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const client = { id: 9001, name: 'Browser QA', url: 'https://example.com/' };
      const audit = {
        url: 'https://example.com/pagina-test/',
        analyzedAt: '2026-09-05T18:50:00.000Z',
        score: 88,
        issues: [{
          type: 'h1',
          label: '0 H1',
          detail: 'Pagina di test senza H1 rilevato.',
          severity: 'alta',
          targetUrl: 'https://example.com/pagina-test/'
        }]
      };
      localStorage.setItem('seogrow-clients', JSON.stringify([client]));
      localStorage.setItem('seogrow-selected-client-v1', JSON.stringify(client.id));
      localStorage.setItem('seogrow-selected-page-v1', JSON.stringify('Audit SEO'));
      localStorage.setItem('seogrow-page-audit-history-v2', JSON.stringify({ [client.id]: [audit] }));
      localStorage.setItem('seogrow-analyses-v2', JSON.stringify({ [client.id]: [] }));
    })();`,
  });

  await command("Page.navigate", { url: `${appUrl}#Audit%20SEO` });
  await waitFor("document.readyState === 'complete' && document.querySelector('#root')", "root React con progetto QA");
  await waitFor("document.querySelector('.guided-nav')", "navigazione guidata visibile");
  await waitFor(
    "document.querySelector('.remediation-host') && document.querySelector('.audit-issue-select')",
    "RemediationHost nativo in Audit SEO",
  );
  const remediationText = await evaluate("document.querySelector('.remediation-host')?.textContent || ''");
  if (!/Correzione controllata/i.test(remediationText) || !/Problema da correggere/i.test(remediationText)) {
    throw new Error(`Host remediation incompleto: ${remediationText}`);
  }

  const activeProject = await evaluate("document.body?.innerText || ''");
  if (!/Browser QA/.test(activeProject) || /Progetto di esempio/.test(activeProject)) {
    throw new Error("Il browser smoke non ha inizializzato in modo univoco il progetto QA richiesto.");
  }

  await clickSidebar("Correzioni");
  await waitFor("document.querySelector('.corrections-workspace-root')", "workspace Correzioni");
  const correctionsText = await evaluate("document.querySelector('.corrections-workspace-root')?.textContent || ''");
  if (!/Rollback WordPress stale-safe/i.test(correctionsText)) {
    throw new Error(`Workspace Correzioni incompleto: ${correctionsText}`);
  }

  await clickSidebar("Audit SEO");
  await waitFor(
    "document.querySelector('.remediation-host') && document.querySelector('.audit-issue-select')",
    "ritorno ad Audit SEO con RemediationHost",
  );

  await assertViewportVisibility(1440, "desktop", "desktop");
  await assertViewportVisibility(900, "tablet", "tablet");
  await assertViewportVisibility(390, "mobile", "mobile");
  await command("Emulation.clearDeviceMetricsOverride");

  console.log(`Browser smoke OK con ${version.Browser}. Navigazione reale Audit SEO → Correzioni → Audit SEO e visibilità desktop/tablet/mobile verificate.`);
} finally {
  socket.close();
  chrome.kill("SIGTERM");
  await sleep(200);
  if (!chrome.killed) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
  if (chrome.exitCode && chrome.exitCode !== 0 && !chromeLog.includes("DevTools listening")) {
    console.warn(chromeLog.slice(-1500));
  }
}
