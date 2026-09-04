import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { numberValue, importGscZip, opportunityQueries } from "./gscImport.js";
import {
  addDatasetToHistory,
  analysisDiff,
  compareDatasets,
  contentPlan,
  normalizeStoredTasks,
  queryChanges,
  tasksFromAnalysis,
} from "./platform.js";

test("normalizza task locali incomplete senza bloccare l'interfaccia", () => {
  const tasks = normalizeStoredTasks([
    { id: " t1 ", title: " Correggi pagina ", priority: "Urgente" },
  ]);
  assert.deepEqual(
    {
      id: tasks[0].id,
      title: tasks[0].title,
      priority: tasks[0].priority,
      status: tasks[0].status,
      query: tasks[0].query,
    },
    {
      id: "t1",
      title: "Correggi pagina",
      priority: "Media",
      status: "Da fare",
      query: "",
    },
  );
});

test("rifiuta task locali con identificativi duplicati", () => {
  const fallback = [{ id: "safe", title: "Fallback" }];
  assert.equal(
    normalizeStoredTasks(
      [
        { id: "dup", title: "Uno" },
        { id: " dup ", title: "Due" },
      ],
      fallback,
    ),
    fallback,
  );
});

test("tollera analisi storiche prive degli elenchi di problemi", () => {
  assert.deepEqual(
    analysisDiff({ issues: null }, { issues: "formato-obsoleto" }),
    { newIssues: [], resolvedIssues: [] },
  );
  assert.deepEqual(
    tasksFromAnalysis(
      { analyzedAt: "2026-09-03T00:00:00.000Z", issues: null },
      { id: 1, name: "Cliente", url: "https://example.it" },
    ),
    [],
  );
});
import { normalizeAgentRuns, readWorkspaceBackup } from "./seoHelpers.js";

test("migra memoria Agent legacy e normalizza evidence e sources null", () => {
  const result = normalizeAgentRuns({ 1: [{ id: "run-1", goal: "opportunità", recommendations: [{ evidence: null, sources: null }] }] });
  assert.deepEqual(result[1][0].recommendations[0].evidence, []);
  assert.deepEqual(result[1][0].recommendations[0].sources, []);
  assert.deepEqual(result[1][0].approvalHistory, []);
});

test("rifiuta backup con memoria Agent malformata", async () => {
  const data = { schemaVersion: 3, clients: [{ id: 1, name: "Test", url: "https://example.com" }], tasks: [], gscData: {}, agentRuns: { 1: [{ id: "run", goal: "test", observations: [], recommendations: [{ evidence: null, sources: [] }], approvalHistory: [] }] } };
  const file = { size: 100, text: async () => JSON.stringify(data) };
  await assert.rejects(() => readWorkspaceBackup(file), /memoria SEO Agent non valida/);
});
test("rifiuta memoria Agent attribuita a un progetto inesistente", async () => {
  const run = { id: "run", projectId: 2, goal: "test", observations: [], recommendations: [], approvalHistory: [], plan: { steps: [] } };
  const data = { schemaVersion: 3, clients: [{ id: 1, name: "Test", url: "https://example.com" }], tasks: [], gscData: {}, agentRuns: { 999: [run] } };
  await assert.rejects(() => readWorkspaceBackup({ size: 100, text: async () => JSON.stringify(data) }), /memoria SEO Agent non valida/);
});

test("interpreta correttamente numeri italiani e internazionali", () => {
  assert.equal(numberValue("18,77"), 18.77);
  assert.equal(numberValue("1.234,56"), 1234.56);
  assert.equal(numberValue("1,234.56"), 1234.56);
  assert.equal(numberValue("3,67%"), 3.67);
});

test("non confronta periodi Search Console di durata incompatibile", () => {
  const current = {
    dateFrom: "2026-06-01",
    dateTo: "2026-08-31",
    totals: { clicks: 20, impressions: 200, ctr: 10, position: 8 },
  };
  const previous = {
    dateFrom: "2026-05-01",
    dateTo: "2026-05-31",
    totals: { clicks: 10, impressions: 100, ctr: 10, position: 10 },
  };
  assert.equal(compareDatasets(current, previous), null);
});

test("importa uno ZIP Search Console autocontenuto e ordina il grafico", async () => {
  const zip = new JSZip();
  zip.file("Grafico.csv", "Data,Clic,Impressioni,CTR,Posizione\n2026-08-31,2,20,10%,8\n2026-08-30,1,10,10%,9");
  zip.file("Query.csv", "Query più frequenti,Clic,Impressioni,CTR,Posizione\ngnatologo bergamo,3,30,10%,8.3");
  zip.file("Pagine.csv", "Pagine principali,Clic,Impressioni,CTR,Posizione\nhttps://trovaespertidigitali.it/gnatologo/,3,30,10%,8.3");
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const file = {
    name: "trovaespertidigitali.zip",
    size: bytes.length,
    arrayBuffer: async () => bytes,
  };
  const dataset = await importGscZip(file);
  assert.equal(dataset.property.host, "trovaespertidigitali.it");
  assert.equal(dataset.queries.length, 1);
  assert.equal(dataset.dateFrom, "2026-08-30");
  assert.equal(dataset.dateTo, "2026-08-31");
  assert.ok(
    dataset.graph.every(
      (row, index) => index === 0 || dataset.graph[index - 1].date <= row.date,
    ),
  );
});

test("non confronta periodi sovrapposti o non consecutivi", () => {
  const current = { dateFrom: "2026-06-01", dateTo: "2026-06-30", totals: { clicks: 20, impressions: 200, ctr: 10, position: 8 } };
  const overlapping = { dateFrom: "2026-05-15", dateTo: "2026-06-15", totals: { clicks: 10, impressions: 100, ctr: 10, position: 10 } };
  const distant = { dateFrom: "2026-03-01", dateTo: "2026-03-31", totals: { clicks: 10, impressions: 100, ctr: 10, position: 10 } };
  assert.equal(compareDatasets(current, overlapping), null);
  assert.equal(compareDatasets(current, distant), null);
});

test("include query apparse e scomparse nel confronto", () => {
  const changes = queryChanges(
    { queries: [{ dimension: "nuova", clicks: 2, impressions: 20, position: 9 }] },
    { queries: [{ dimension: "persa", clicks: 3, impressions: 30, position: 7 }] },
  );
  assert.deepEqual(changes.map((row) => row.changeType), ["appeared", "lost"]);
});

test("non sovrascrive dataset con stessi totali ma query diverse", () => {
  const base = { property: { host: "example.it" }, dateFrom: "2026-01-01", dateTo: "2026-01-31", totals: { clicks: 1, impressions: 10 } };
  const first = { ...base, queries: [{ dimension: "uno", clicks: 1, impressions: 10, position: 2 }] };
  const second = { ...base, queries: [{ dimension: "due", clicks: 1, impressions: 10, position: 2 }] };
  assert.equal(addDatasetToHistory({ 1: [first] }, 1, second)[1].length, 2);
});

test("include opportunità oltre la posizione 20 e CTR basso in top 3", () => {
  const rows = opportunityQueries({
    queries: [
      { dimension: "oltre venti", impressions: 100, position: 25, ctr: 3 },
      { dimension: "top con ctr basso", impressions: 90, position: 2, ctr: 1 },
      { dimension: "fuori intervallo", impressions: 80, position: 55, ctr: 1 },
    ],
  });
  assert.deepEqual(
    new Set(rows.map((row) => row.dimension)),
    new Set(["oltre venti", "top con ctr basso"]),
  );
});

test("rifiuta backup con task collegata a un cliente inesistente", async () => {
  const invalid = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    clients: [{ id: 1, name: "Cliente", url: "https://example.it" }],
    tasks: [{ id: "t1", title: "Task", status: "Da fare", sourceClientId: 99 }],
    gscData: {},
  };
  const file = {
    size: 100,
    text: async () => JSON.stringify(invalid),
  };
  await assert.rejects(() => readWorkspaceBackup(file), /clienti o task non validi/i);
});

test("rifiuta backup con progetto selezionato inesistente", async () => {
  const invalid = {
    schemaVersion: 3,
    clients: [{ id: 1, name: "Cliente", url: "https://example.it" }],
    selectedClient: 99,
    tasks: [],
    gscData: {},
  };
  const file = { size: 100, text: async () => JSON.stringify(invalid) };
  await assert.rejects(
    () => readWorkspaceBackup(file),
    /progetto selezionato non valido/i,
  );
});

test("rifiuta backup con identificativi duplicati o URL non sicuri", async () => {
  const invalid = {
    schemaVersion: 2,
    clients: [
      { id: 1, name: "A", url: "https://example.it" },
      { id: 1, name: "B", url: "javascript:alert(1)" },
    ],
    tasks: [],
    gscData: {},
  };
  const file = { size: 100, text: async () => JSON.stringify(invalid) };
  await assert.rejects(() => readWorkspaceBackup(file), /non validi|duplicati/i);
});

async function gscFile(files, name = "example.it.zip") {
  const zip = new JSZip();
  for (const [fileName, content] of Object.entries(files))
    zip.file(fileName, content);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return {
    name,
    size: bytes.length,
    arrayBuffer: async () => bytes,
  };
}

test("rifiuta CSV Search Console privi delle colonne obbligatorie", async () => {
  const file = await gscFile({
    "Grafico.csv": "Data,Clic,Impressioni\n2026-08-30,1,10",
    "Query.csv": "Query più frequenti,Clic\ntest,1",
    "Pagine.csv": "Pagine principali,Clic,Impressioni\nhttps://example.it/,1,10",
  });
  await assert.rejects(() => importGscZip(file), /colonne obbligatorie/i);
});

test("aggrega date e query duplicate nello ZIP Search Console", async () => {
  const file = await gscFile({
    "Grafico.csv": "Data,Clic,Impressioni,Posizione\n2026-08-30,1,10,5\n2026-08-30,2,20,8",
    "Query.csv": "Query più frequenti,Clic,Impressioni,Posizione\nTest,1,10,5\nTest,2,20,8",
    "Pagine.csv": "Pagine principali,Clic,Impressioni,Posizione\nhttps://example.it/,3,30,7",
  });
  const dataset = await importGscZip(file);
  assert.equal(dataset.graph.length, 1);
  assert.equal(dataset.graph[0].clicks, 3);
  assert.equal(dataset.queries.length, 1);
  assert.equal(dataset.queries[0].impressions, 30);
});

test("confronta le query senza differenze dovute alle maiuscole", () => {
  const changes = queryChanges(
    { queries: [{ dimension: "Dentista Bergamo", clicks: 3, impressions: 20, position: 5 }] },
    { queries: [{ dimension: "dentista bergamo", clicks: 2, impressions: 18, position: 6 }] },
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].changeType, "retained");
});

test("il piano mensile non supera dodici attività", () => {
  const queries = Array.from({ length: 40 }, (_, index) => ({
    dimension: `query ${index}`,
    clicks: 1,
    impressions: 100 + index,
    ctr: 1,
    position: 10,
  }));
  assert.ok(contentPlan({ queries, pages: [], queryPages: [] }).length <= 12);
});

test("interpreta i separatori singoli a tre cifre come migliaia", () => {
  assert.equal(numberValue("1.234"), 1234);
  assert.equal(numberValue("1,234"), 1234);
});

test("importa anche i nomi file inglesi di Search Console", async () => {
  const file = await gscFile({
    "Chart.csv": "Date,Clicks,Impressions,Position\n2026-08-30,1,10,5",
    "Queries.csv": "Top queries,Clicks,Impressions,Position\nTest,1,10,5",
    "Pages.csv": "Top pages,Clicks,Impressions,Position\nhttps://example.it/,1,10,5",
    "Countries.csv": "Country,Clicks,Impressions,Position\nItaly,1,10,5",
    "Devices.csv": "Device,Clicks,Impressions,Position\nMobile,1,10,5",
  });
  const dataset = await importGscZip(file);
  assert.equal(dataset.countries.length, 1);
  assert.equal(dataset.devices.length, 1);
  assert.equal(dataset.queries[0].position, 5);
});

test("interpreta il punto decimale delle posizioni nei CSV inglesi", async () => {
  const file = await gscFile({
    "Chart.csv": "Date,Clicks,Impressions,Position\n2026-08-30,1,10,1.234",
    "Queries.csv": "Top queries,Clicks,Impressions,Position\nTest,1,10,1.234",
    "Pages.csv": "Top pages,Clicks,Impressions,Position\nhttps://example.it/,1,10,1.234",
  });
  const dataset = await importGscZip(file);
  assert.equal(dataset.queries[0].position, 1.234);
});

test("rifiuta backup che tentano di salvare password WordPress", async () => {
  const invalid = {
    schemaVersion: 3,
    clients: [{ id: 1, name: "Cliente", url: "https://example.it" }],
    tasks: [],
    gscData: {},
    wordpressProfiles: {
      1: {
        url: "https://example.it",
        username: "editor",
        applicationPassword: "segreto",
      },
    },
  };
  const file = { size: 200, text: async () => JSON.stringify(invalid) };
  await assert.rejects(() => readWorkspaceBackup(file), /WordPress non valido/i);
});

test("ignora i metadati macOS duplicati nello ZIP", async () => {
  const file = await gscFile({
    "Grafico.csv": "Data,Clic,Impressioni,Posizione\n2026-08-30,1,10,5",
    "Query.csv": "Query,Clic,Impressioni,Posizione\nTest,1,10,5",
    "Pagine.csv": "Page,Clic,Impressioni,Posizione\nhttps://example.it/,1,10,5",
    "__MACOSX/Query.csv": "metadata",
  });
  assert.equal((await importGscZip(file)).queries.length, 1);
});

test("rifiuta metriche Search Console incoerenti", async () => {
  const file = await gscFile({
    "Grafico.csv": "Data,Clic,Impressioni,Posizione\n2026-08-30,11,10,5",
    "Query.csv": "Query,Clic,Impressioni,Posizione\nTest,1,10,5",
    "Pagine.csv": "Page,Clic,Impressioni,Posizione\nhttps://example.it/,1,10,5",
  });
  await assert.rejects(() => importGscZip(file), /clic superano le impressioni/i);
});

test("aggrega query senza distinguere maiuscole e minuscole", async () => {
  const file = await gscFile({
    "Grafico.csv": "Data,Clic,Impressioni,Posizione\n2026-08-30,2,20,5",
    "Query.csv": "Query,Clic,Impressioni,Posizione\nDentista,1,10,5\ndentista,1,10,5",
    "Pagine.csv": "Page,Clic,Impressioni,Posizione\nhttps://example.it/,2,20,5",
  });
  const dataset = await importGscZip(file);
  assert.equal(dataset.queries.length, 1);
  assert.equal(dataset.queries[0].clicks, 2);
});

test("il piano mensile riserva spazio ai problemi tecnici", () => {
  const queries = Array.from({ length: 30 }, (_, index) => ({
    dimension: `query ${index}`,
    clicks: 1,
    impressions: 100,
    ctr: 1,
    position: 12,
  }));
  const plan = contentPlan(
    { queries, pages: [], queryPages: [] },
    { issues: [{ type: "orphan", label: "Pagina orfana", url: "https://example.it/a" }] },
  );
  assert.equal(plan.length, 12);
  assert.ok(plan.some((item) => item.type === "Architettura"));
});
