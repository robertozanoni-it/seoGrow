import test from "node:test";
import assert from "node:assert/strict";
import { pickExactWordPressEntity } from "../server/wordpressEntityIdentity.js";

test("l'ispezione WordPress seleziona solo il permalink esatto", () => {
  const rows = [
    { id: 10, link: "https://example.it/blog/pagina/" },
    { id: 11, link: "https://example.it/pagina/" },
  ];
  assert.equal(pickExactWordPressEntity(rows, "/pagina", "example.it")?.id, 11);
});

test("nessun candidato viene usato come fallback se il permalink non coincide", () => {
  const rows = [
    { id: 10, link: "https://example.it/blog/pagina/" },
    { id: 11, link: "https://example.it/archivio/pagina/" },
  ];
  assert.equal(pickExactWordPressEntity(rows, "/pagina", "example.it"), null);
});

test("un permalink identico su un altro host non viene considerato la stessa risorsa", () => {
  const rows = [
    { id: 20, link: "https://other.example/pagina/" },
    { id: 21, link: "https://example.it/altra/" },
  ];
  assert.equal(pickExactWordPressEntity(rows, "/pagina", "example.it"), null);
});

test("www e non-www sono equivalenti solo a parità di pathname", () => {
  const rows = [{ id: 22, link: "https://www.example.it/pagina/" }];
  assert.equal(pickExactWordPressEntity(rows, "/pagina", "example.it")?.id, 22);
});

test("slash finale equivalente sullo stesso pathname non crea ambiguità", () => {
  const rows = [{ id: 12, link: "https://example.it/pagina/" }];
  assert.equal(pickExactWordPressEntity(rows, "/pagina/", "example.it")?.id, 12);
});

test("link WordPress malformati vengono ignorati e non diventano fallback", () => {
  const rows = [
    { id: 1, link: "not-a-url" },
    { id: 2, link: "https://example.it/altra/" },
  ];
  assert.equal(pickExactWordPressEntity(rows, "/pagina", "example.it"), null);
});
