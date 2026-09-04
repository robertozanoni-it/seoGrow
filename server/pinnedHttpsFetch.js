import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";

function privateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && [0, 2].includes(c)) ||
      (a === 198 && [18, 19].includes(b)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  const v = String(address).toLowerCase();
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") ||
    /^fe[89ab]/.test(v) || /^fe[c-f]/.test(v) || v.startsWith("ff") || v.startsWith("2001:db8:");
}

export async function resolvePinnedHttpsUrl(input) {
  const url = input instanceof URL ? new URL(input.href) : new URL(String(input || ""));
  if (url.protocol !== "https:") throw new Error("Sono consentiti solo endpoint HTTPS.");
  const host = url.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1"].includes(host) || host.endsWith(".local"))
    throw new Error("Indirizzo locale non consentito.");
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => privateAddress(item.address)))
    throw new Error("Indirizzo remoto non pubblico.");
  return { url, address: addresses[0].address, family: addresses[0].family };
}

export async function pinnedHttpsFetch(input, options = {}) {
  const { url, address, family } = await resolvePinnedHttpsUrl(input);
  const method = String(options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  headers.set("host", url.host);
  const body = options.body == null ? null : Buffer.from(String(options.body));
  if (body && !headers.has("content-length")) headers.set("content-length", String(body.length));
  const maxBytes = Number(options.maxBytes || 8 * 1024 * 1024);

  return await new Promise((resolve, reject) => {
    const request = https.request({
      hostname: address,
      family,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method,
      headers: Object.fromEntries(headers.entries()),
      servername: url.hostname,
      rejectUnauthorized: true,
      timeout: Number(options.timeout || 20_000),
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy(new Error("Risposta remota troppo grande."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
          else if (value != null) responseHeaders.set(name, String(value));
        }
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode || 500,
          statusText: response.statusMessage || "",
          headers: responseHeaders,
        }));
      });
    });

    const abort = () => request.destroy(options.signal?.reason instanceof Error ? options.signal.reason : new Error("Richiesta annullata."));
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    request.on("timeout", () => request.destroy(new Error("Timeout richiesta remota.")));
    request.on("error", reject);
    request.on("close", () => options.signal?.removeEventListener?.("abort", abort));
    if (body) request.write(body);
    request.end();
  });
}
