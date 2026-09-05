import test from "node:test";
import assert from "node:assert/strict";
import { pickExactWordPressEntity } from "../server/wordpressEntityIdentity.js";

test("l'ispezione WordPress seleziona solo il permalink esatto", () => {
  const rows = [
    { id: 10, link: "https://example.it/blog/pagina/" },
    { id: 11, link: "https://example.it/pagina/" },
  ];
  assert.equal(pickExactWordPressEntity(rows, "/pagina")?.id, 11);
});

test("nessun candidato viene usato come fallback se il permalink non coincide", () => {
  const rows = [
    { id: 10, link: "https://example.it/blog/pagina/" },
    { id: 11, link: "https://example.it/archivio/pagina/" },
  ];
  assert.equal(pickExactWordPressEntity(rows, "/pagina"), null);
});

test("slash finale equivalente sullo stesso pathname non crea ambiguità", () => {
  const rows = [{ id: 12, link: "https://example.it/pagina/" }];
  assert.equal(pickExactWordPressEntity(rows, "/pagina/")?.id, 12);
});

test("link WordPress malformati vengono ignorati e non diventano fallback", () => {
  const rows = [
    { id: 1, link: "not-a-url" },
    { id: 2, link: "https://example.it/altra/" },
  ];
  assert.equal(pickExactWordPressEntity(rows, "/pagina"), null);
});
