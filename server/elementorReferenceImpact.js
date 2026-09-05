const DEFAULT_MAX_NODES = 5_000;
const DEFAULT_MAX_REFERENCES = 200;
const ALLOWED_REFERENCE_KEYS = new Set(["template_id", "templateID"]);

const positiveInt = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

function parseElementorData(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function scanElementorExplicitReferences(value, {
  maxNodes = DEFAULT_MAX_NODES,
  maxReferences = DEFAULT_MAX_REFERENCES,
} = {}) {
  const root = parseElementorData(value);
  const nodeLimit = positiveInt(maxNodes) || DEFAULT_MAX_NODES;
  const referenceLimit = positiveInt(maxReferences) || DEFAULT_MAX_REFERENCES;
  if (!root) {
    return {
      ok: false,
      status: "malformed-elementor-data",
      malformed: true,
      truncated: false,
      nodesVisited: 0,
      references: [],
      sharedWriteAllowed: false,
    };
  }

  const stack = [root];
  const references = [];
  const dedupe = new Set();
  let nodesVisited = 0;
  let truncated = false;

  while (stack.length) {
    const node = stack.pop();
    nodesVisited += 1;
    if (nodesVisited > nodeLimit) {
      truncated = true;
      break;
    }

    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index -= 1) stack.push(node[index]);
      continue;
    }
    if (!node || typeof node !== "object") continue;

    for (const [key, raw] of Object.entries(node)) {
      if (ALLOWED_REFERENCE_KEYS.has(key)) {
        const id = positiveInt(raw);
        if (id) {
          const dedupeKey = `${key}:${id}`;
          if (!dedupe.has(dedupeKey)) {
            dedupe.add(dedupeKey);
            references.push({
              id,
              key,
              referenceKind: key === "template_id" ? "template-widget" : "global-widget",
            });
            if (references.length >= referenceLimit) {
              truncated = stack.length > 0 || Object.keys(node).length > 1;
              break;
            }
          }
        }
      }
      if (references.length >= referenceLimit) break;
      if (raw && typeof raw === "object") stack.push(raw);
    }
    if (references.length >= referenceLimit) break;
  }

  return {
    ok: !truncated,
    status: truncated ? "truncated" : "complete-read-only-scan",
    malformed: false,
    truncated,
    nodesVisited: Math.min(nodesVisited, nodeLimit),
    references,
    sharedWriteAllowed: false,
  };
}

export function aggregateElementorReferenceImpact(rows, { expectedDocuments = null } = {}) {
  const input = Array.isArray(rows) ? rows : [];
  const expected = positiveInt(expectedDocuments);
  const referencesById = new Map();
  let malformedDocuments = 0;
  let truncatedDocuments = 0;
  let invalidDocuments = 0;

  for (const row of input) {
    const sourceId = positiveInt(row?.sourceId);
    const sourceUrl = typeof row?.sourceUrl === "string" ? row.sourceUrl : "";
    const scan = row?.scan;
    if (!sourceId || !sourceUrl || !scan || typeof scan !== "object") {
      invalidDocuments += 1;
      continue;
    }
    if (scan.malformed === true) malformedDocuments += 1;
    if (scan.truncated === true) truncatedDocuments += 1;
    if (scan.ok !== true) continue;

    for (const reference of Array.isArray(scan.references) ? scan.references : []) {
      const id = positiveInt(reference?.id);
      if (!id || !ALLOWED_REFERENCE_KEYS.has(reference?.key)) continue;
      if (!referencesById.has(id)) referencesById.set(id, []);
      referencesById.get(id).push({
        sourceId,
        sourceUrl,
        key: reference.key,
        referenceKind: reference.referenceKind,
      });
    }
  }

  const complete = input.length > 0 &&
    invalidDocuments === 0 &&
    malformedDocuments === 0 &&
    truncatedDocuments === 0 &&
    input.every((row) => row?.scan?.ok === true) &&
    (expected === null || expected === input.length);

  return {
    ok: complete,
    status: complete ? "verified-read-only-reference-scan" : "incomplete-reference-scan",
    complete,
    expectedDocuments: expected,
    scannedDocuments: input.length,
    malformedDocuments,
    truncatedDocuments,
    invalidDocuments,
    references: [...referencesById.entries()]
      .map(([templateId, sources]) => ({ templateId, sources }))
      .sort((a, b) => a.templateId - b.templateId),
    affectedPagesEnumerated: complete,
    sharedWriteAllowed: false,
  };
}

export const ELEMENTOR_REFERENCE_KEYS = Object.freeze(["template_id", "templateID"]);
