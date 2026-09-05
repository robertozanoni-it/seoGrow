import { basePath, connectorStatus, safeBase } from "./wordpressInspectFastHook.js";

const HOOKED = Symbol.for("seogrow.wordpressConnectionHook");
const RATE = new Map();

function rateLimit(req) {
  const now = Date.now();
  const key = req.ip || "local";
  const recent = (RATE.get(key) || []).filter((time) => now - time < 10 * 60_000);
  if (recent.length >= 120) return false;
  recent.push(now);
  RATE.set(key, recent);
  return true;
}

function authHeaders(username, password) {
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
    accept: "application/json",
    "user-agent": "seoGrowAI/1.4-wordpress-remediation",
  };
}

function userEndpoint(base) {
  return new URL(`${basePath(base)}/wp-json/wp/v2/users/me?context=edit`, base.origin);
}

async function responseJson(response) {
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    throw new Error("WordPress ha restituito un redirect inatteso durante il controllo connessione.");
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch (error) { throw new Error(`Risposta WordPress non valida (HTTP ${response.status}).`, { cause: error }); }
  if (!response.ok) throw new Error(data?.message || data?.code || `WordPress HTTP ${response.status}`);
  return data;
}

function registerRoutes(app) {
  if (app[HOOKED]) return;
  app[HOOKED] = true;

  app.post("/api/wordpress/connection-check", async (req, res) => {
    if (!rateLimit(req)) return res.status(429).json({ error: "Limite controlli connessione WordPress raggiunto. Riprova più tardi." });
    try {
      const { siteUrl, url, username, applicationPassword } = req.body || {};
      if (!username || !applicationPassword) throw new Error("Inserisci utente e password applicativa WordPress.");
      const base = await safeBase(siteUrl || url);
      const headers = authHeaders(username, applicationPassword);
      const [user, connector] = await Promise.all([
        fetch(userEndpoint(base), {
          method: "GET",
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(20_000),
        }).then(responseJson),
        connectorStatus(base, headers).catch(() => null),
      ]);
      return res.json({
        ok: true,
        siteUrl: base.href,
        user: {
          id: Number(user?.id || 0),
          name: String(user?.name || user?.slug || username),
        },
        connector,
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Connessione WordPress non riuscita." });
    }
  });
}

export { registerRoutes, userEndpoint };
