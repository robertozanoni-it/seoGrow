const MONTHS = [
  "gen",
  "feb",
  "mar",
  "apr",
  "mag",
  "giu",
  "lug",
  "ago",
  "set",
  "ott",
  "nov",
  "dic",
];

const normalizedFileName = (name) =>
  name
    .split("/")
    .pop()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function declaredZipSizes(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let index = Math.max(0, bytes.length - 65_557); index <= bytes.length - 22; index += 1)
    if (view.getUint32(index, true) === 0x06054b50) eocd = index;
  if (eocd < 0) throw new Error("ZIP non valido: directory centrale non trovata.");
  const entries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  let offset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || centralSize === 0xffffffff || offset === 0xffffffff)
    throw new Error("ZIP64 non supportato per motivi di sicurezza.");
  if (offset + centralSize > bytes.length)
    throw new Error("ZIP non valido: directory centrale incompleta.");
  const sizes = new Map();
  let total = 0;
  for (let count = 0; count < entries; count += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("ZIP non valido: voce centrale danneggiata.");
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (size === 0xffffffff) throw new Error("ZIP64 non supportato per motivi di sicurezza.");
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new Error("ZIP non valido: nome voce incompleto.");
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    sizes.set(name, size);
    total += size;
    offset = end;
  }
  return { sizes, total };
}

export const numberValue = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let cleaned = String(value ?? "")
    .replace("%", "")
    .replace(/[\s\u00a0]/g, "")
    .trim();
  if (cleaned.includes(",") && cleaned.includes("."))
    cleaned =
      cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
        ? cleaned.replaceAll(".", "").replace(",", ".")
        : cleaned.replaceAll(",", "");
  else if (/^-?\d{1,3}(?:[.,]\d{3})+$/.test(cleaned))
    cleaned = cleaned.replace(/[.,]/g, "");
  else if (cleaned.includes(",")) cleaned = cleaned.replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const finiteNumber = (value, field, fileName, rowIndex, decimalSeparator = "") => {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  let parsed = numberValue(raw);
  const normalized = raw.replace("%", "").replace(/[\s\u00a0]/g, "");
  if (
    decimalSeparator &&
    normalized.includes(decimalSeparator) &&
    !normalized.includes(decimalSeparator === "." ? "," : ".") &&
    /^[-+]?\d+[.,]\d+$/.test(normalized)
  )
    parsed = Number.parseFloat(normalized.replace(decimalSeparator, "."));
  if (!Number.isFinite(parsed) || (!parsed && !/^[-+]?0(?:[.,]0+)?%?$/.test(raw.replace(/[\s\u00a0]/g, ""))))
    throw new Error(
      `Valore numerico non valido in ${fileName}, riga ${rowIndex + 2}, colonna ${field}.`,
    );
  return parsed;
};

const validIsoDate = (value) => {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
};

const shortDate = (value) => {
  const [year, month, day] = String(value).split("-").map(Number);
  return year && month && day ? `${day} ${MONTHS[month - 1]}` : value;
};

export const normalizeSiteHost = (value) => {
  const raw = String(value ?? "")
    .trim()
    .replace(/^sc-domain:/i, "");
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const propertyFromFilters = (rows) => {
  for (const row of rows) {
    const entries = Object.entries(row || {});
    const propertyEntry = entries.find(([key, value]) =>
      /^(?:propriet[aà]|property|sito|site)$/i.test(String(key).trim()) ||
      /^(?:propriet[aà]|property|sito|site)\s*:/i.test(String(value).trim()),
    );
    if (!propertyEntry) continue;
    const [key, rawValue] = propertyEntry;
    const candidate = /^(?:propriet[aà]|property|sito|site)$/i.test(String(key).trim())
      ? rawValue
      : String(rawValue).replace(/^(?:propriet[aà]|property|sito|site)\s*:\s*/i, "");
    const host = normalizeSiteHost(candidate);
    if (host && host.includes(".")) return { host, source: "Filtri.csv" };
  }
  return null;
};

const propertyFromPages = (pages) => {
  const counts = new Map();
  for (const page of pages) {
    const host = normalizeSiteHost(page.dimension);
    if (host) counts.set(host, (counts.get(host) || 0) + 1);
  }
  const host = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return host ? { host, source: "Pagine.csv" } : null;
};

const propertyFromFileName = (fileName) => {
  const cleaned = String(fileName ?? "")
    .replace(/\.zip$/i, "")
    .replace(/^https?___/i, "")
    .replace(/_-performance-on-search.*$/i, "")
    .replace(/_/g, "/");
  const host = normalizeSiteHost(cleaned);
  return host ? { host, source: "nome dello ZIP" } : null;
};

const findColumn = (row, candidates) => {
  const keys = Object.keys(row || {});
  const wanted = candidates.map((item) => item.toLowerCase());
  return keys.find((key) => wanted.includes(key.trim().toLowerCase()));
};

function mapRows(rows, dimensionCandidates, fileName) {
  if (!rows.length) return [];
  const dimension = findColumn(rows[0], dimensionCandidates);
  const clicks = findColumn(rows[0], ["Clic", "Clicks"]);
  const impressions = findColumn(rows[0], ["Impressioni", "Impressions"]);
  const ctr = findColumn(rows[0], ["CTR"]);
  const position = findColumn(rows[0], ["Posizione", "Position"]);
  const english = [clicks, impressions, position].some((name) =>
    /^(?:clicks|impressions|position)$/i.test(String(name || "").trim()),
  );
  const decimalSeparator = english ? "." : ",";
  if (!dimension || !clicks || !impressions)
    throw new Error(
      `${fileName} non contiene le colonne obbligatorie: dimensione, clic e impressioni.`,
    );
  return rows
    .map((row, rowIndex) => {
      const mapped = {
      dimension: dimension ? String(row[dimension] ?? "").trim() : "",
      clicks: clicks ? finiteNumber(row[clicks], clicks, fileName, rowIndex) : 0,
      impressions: impressions ? finiteNumber(row[impressions], impressions, fileName, rowIndex) : 0,
      ctr: ctr ? finiteNumber(row[ctr], ctr, fileName, rowIndex, decimalSeparator) : 0,
      position: position ? finiteNumber(row[position], position, fileName, rowIndex, decimalSeparator) : 0,
      };
      if (mapped.clicks < 0 || mapped.impressions < 0 || mapped.position < 0)
        throw new Error(`${fileName}, riga ${rowIndex + 2}: le metriche non possono essere negative.`);
      if (mapped.clicks > mapped.impressions)
        throw new Error(`${fileName}, riga ${rowIndex + 2}: i clic superano le impressioni.`);
      if (mapped.ctr < 0 || mapped.ctr > 100)
        throw new Error(`${fileName}, riga ${rowIndex + 2}: il CTR deve essere tra 0 e 100.`);
      return mapped;
    })
    .filter((row) => row.dimension);
}

function canonicalPage(value) {
  try {
    const url = new URL(String(value).trim());
    if (!/^https?:$/.test(url.protocol)) return String(value).trim();
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    for (const key of [...url.searchParams.keys()])
      if (/^(?:utm_|gclid$|fbclid$|mc_)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch {
    return String(value).trim();
  }
}

function aggregateImportedRows(rows, kind = "generic") {
  const grouped = new Map();
  for (const row of rows) {
    const display = kind === "page" ? canonicalPage(row.dimension) : row.dimension;
    const key = kind === "query" ? display.toLocaleLowerCase("it") : display;
    const current = grouped.get(key) || {
      dimension: display,
      clicks: 0,
      impressions: 0,
      weightedPosition: 0,
    };
    current.clicks += row.clicks;
    current.impressions += row.impressions;
    current.weightedPosition += row.position * row.impressions;
    grouped.set(key, current);
  }
  return [...grouped.values()].map((row) => ({
    dimension: row.dimension,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.impressions ? (row.clicks / row.impressions) * 100 : 0,
    position: row.impressions ? row.weightedPosition / row.impressions : 0,
  }));
}

export async function importGscZip(file) {
  if (!file?.name.toLowerCase().endsWith(".zip"))
    throw new Error("Seleziona il file ZIP esportato da Search Console.");
  if (file.size && file.size > 50 * 1024 * 1024)
    throw new Error("Il file ZIP supera il limite di sicurezza di 50 MB.");
  const [{ default: JSZip }, { default: Papa }] = await Promise.all([
    import("jszip"),
    import("papaparse"),
  ]);
  const zipInput =
    typeof file.arrayBuffer === "function" ? await file.arrayBuffer() : file;
  const declaredArchive = declaredZipSizes(zipInput);
  if (declaredArchive.total > 120 * 1024 * 1024)
    throw new Error("Il contenuto decompresso dello ZIP supera 120 MB.");
  const archive = await JSZip.loadAsync(zipInput);
  const entries = Object.values(archive.files).filter(
    (entry) => !entry.dir && !/(?:^|\/)__MACOSX(?:\/|$)|(?:^|\/)\.DS_Store$/i.test(entry.name),
  );
  const byName = new Map();
  let declaredUncompressed = 0;
  for (const entry of entries) {
    const baseName = normalizedFileName(entry.name);
    if (byName.has(baseName))
      throw new Error(`Lo ZIP contiene più file chiamati ${baseName}.`);
    byName.set(baseName, entry);
    const declared = Number(declaredArchive.sizes.get(entry.name) ?? -1);
    if (declared < 0) throw new Error(`Dimensione non verificabile per ${baseName}.`);
    if (Number.isFinite(declared) && declared > 40 * 1024 * 1024)
      throw new Error(`Il file ${baseName} decompresso supera 40 MB.`);
    declaredUncompressed += Number.isFinite(declared) ? declared : 0;
  }
  if (declaredUncompressed > declaredArchive.total)
    throw new Error("Le dimensioni dichiarate dello ZIP non sono coerenti.");
  const aliases = {
    "grafico.csv": ["grafico.csv", "chart.csv", "dates.csv"],
    "query.csv": ["query.csv", "queries.csv"],
    "pagine.csv": ["pagine.csv", "pages.csv"],
    "paesi.csv": ["paesi.csv", "countries.csv"],
    "dispositivi.csv": ["dispositivi.csv", "devices.csv"],
    "filtri.csv": ["filtri.csv", "filters.csv"],
  };
  const resolved = new Map(
    Object.entries(aliases).map(([canonical, names]) => [
      canonical,
      names.map((name) => byName.get(name)).find(Boolean),
    ]),
  );
  const required = ["grafico.csv", "query.csv", "pagine.csv"];
  const missing = required.filter((name) => !resolved.get(name));
  if (missing.length)
    throw new Error(`File mancanti nello ZIP: ${missing.join(", ")}.`);

  const parse = async (name) => {
    const entry = resolved.get(name);
    if (!entry) return [];
    const bytes = await entry.async("uint8array");
    if (bytes.byteLength > 40 * 1024 * 1024)
      throw new Error(`Il file ${name} decompresso supera 40 MB.`);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let rowCount = 0;
    for (const character of text) {
      if (character === "\n" && ++rowCount > 250_000)
        throw new Error(`${name} supera il limite di 250.000 righe.`);
    }
    const result = Papa.parse(text.replace(/^\uFEFF/, ""), {
      header: true,
      skipEmptyLines: true,
    });
    if (result.errors.length)
      throw new Error(
        `CSV non valido: ${name} (${result.errors[0].message || result.errors[0].code}).`,
      );
    return result.data;
  };

  const graphRaw = await parse("grafico.csv");
  const queriesRaw = await parse("query.csv");
  const pagesRaw = await parse("pagine.csv");
  const countriesRaw = await parse("paesi.csv");
  const devicesRaw = await parse("dispositivi.csv");
  const filtersRaw = await parse("filtri.csv");
  const graphRows = mapRows(graphRaw, ["Data", "Date"], "grafico.csv");
  const graph = aggregateImportedRows(graphRows)
    .map((row) => ({
      ...row,
      date: row.dimension,
      label: shortDate(row.dimension),
    }))
    .toSorted((a, b) => String(a.date).localeCompare(String(b.date)));
  if (graphRows.some((row) => !validIsoDate(row.dimension)))
    throw new Error("grafico.csv contiene una o più date non valide.");
  const queries = aggregateImportedRows(mapRows(queriesRaw, [
    "Query più frequenti",
    "Top queries",
    "Query",
  ], "query.csv"), "query");
  const mappedPages = mapRows(pagesRaw, ["Pagine principali", "Top pages", "Page"], "pagine.csv");
  if (mappedPages.some((row) => {
    try {
      return !["http:", "https:"].includes(new URL(row.dimension).protocol);
    } catch {
      return true;
    }
  })) throw new Error("pagine.csv contiene una o più URL non valide.");
  const pages = aggregateImportedRows(mappedPages, "page");
  const countries = countriesRaw.length
    ? aggregateImportedRows(mapRows(countriesRaw, ["Paese", "Country"], "paesi.csv"))
    : [];
  const devices = devicesRaw.length
    ? aggregateImportedRows(mapRows(devicesRaw, ["Dispositivo", "Device"], "dispositivi.csv"))
    : [];
  const property =
    propertyFromFilters(filtersRaw) ||
    propertyFromPages(pages) ||
    propertyFromFileName(file.name);
  const totals = graph.reduce(
    (acc, row) => {
      acc.clicks += row.clicks;
      acc.impressions += row.impressions;
      acc.weightedPosition += row.position * row.impressions;
      return acc;
    },
    { clicks: 0, impressions: 0, weightedPosition: 0 },
  );
  totals.ctr = totals.impressions
    ? (totals.clicks / totals.impressions) * 100
    : 0;
  totals.position = totals.impressions
    ? totals.weightedPosition / totals.impressions
    : 0;
  delete totals.weightedPosition;
  if (!graph.length)
    throw new Error("grafico.csv non contiene righe valide: importazione annullata.");

  return {
    schemaVersion: 1,
    source: "Google Search Console",
    fileName: file.name,
    importedAt: new Date().toISOString(),
    dateFrom: graph[0]?.date || "",
    dateTo: graph.at(-1)?.date || "",
    filters: filtersRaw,
    property: property
      ? { ...property, confirmed: property.source !== "nome dello ZIP" }
      : null,
    totals,
    graph,
    queries,
    pages,
    countries,
    devices,
  };
}

export function opportunityQueries(dataset, limit = 20) {
  if (!dataset?.queries?.length) return [];
  return dataset.queries
    .filter(
      (row) =>
        row.impressions > 0 &&
        ((row.position >= 4 && row.position <= 30) ||
          (row.position > 0 && row.position < 4 && row.ctr < 2)),
    )
    .toSorted(
      (a, b) =>
        b.impressions * Math.max(1, Math.min(30, b.position)) -
        a.impressions * Math.max(1, Math.min(30, a.position)),
    )
    .slice(0, limit);
}

export function formatInteger(value) {
  return new Intl.NumberFormat("it-IT", {
    maximumFractionDigits: 0,
    useGrouping: "always",
  }).format(value || 0);
}

export function formatPeriodDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}
