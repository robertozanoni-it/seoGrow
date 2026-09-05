import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { userEndpoint } from "../server/wordpressConnectionHook.js";

const connectionUi = await readFile(new URL("./WordPressConnectionControl.jsx", import.meta.url), "utf8");
const connectionServer = await readFile(new URL("../server/wordpressConnectionHook.js", import.meta.url), "utf8");

test("il controllo connessione non usa più il permalink come prova di identità pagina", () => {
  assert.match(connectionUi, /\/api\/wordpress\/connection-check/);
  assert.doesNotMatch(connectionUi, /\/api\/wordpress\/inspect-fast/);
  assert.match(connectionUi, /siteUrl: credentials\.url/);
});

test("connection-check conserva la sottocartella WordPress", () => {
  const endpoint = userEndpoint(new URL("https://example.it/wordpress/"));
  assert.equal(endpoint.href, "https://example.it/wordpress/wp-json/wp/v2/users/me?context=edit");
  assert.match(connectionServer, /connectorStatus\(base, headers\)/);
});
