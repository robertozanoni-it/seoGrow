import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { resolvePinnedHttpsUrl } from "../server/pinnedHttpsFetch.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("tutti i percorsi di avvio caricano il bootstrap remediation", () => {
  const pkg = JSON.parse(read("package.json"));
  const launcher = read("AVVIA.command");
  assert.match(pkg.scripts.dev, /remediationBootstrap\.js/);
  assert.match(pkg.scripts.start, /remediationBootstrap\.js/);
  assert.match(launcher, /remediationBootstrap\.js/);
});

test("le correzioni non usano uno stato fuori dai filtri della UI", () => {
  const integrity = read("src/remediationIntegrity.js");
  assert.doesNotMatch(integrity, /status:\s*["']Non applicato al frontend["']/);
  assert.match(integrity, /frontendFailure/);
});

test("il fetch pinned rifiuta indirizzi loopback", async () => {
  await assert.rejects(
    resolvePinnedHttpsUrl("https://127.0.0.1/wp-json/"),
    /non pubblico|locale/i,
  );
});
