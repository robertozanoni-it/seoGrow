import test from "node:test";
import assert from "node:assert/strict";
import { validateSeoSuggestion } from "./editorialQuality.js";

const page = {
  title: "Yoga per dimagrire: guida pratica",
  excerpt: "Scopri come integrare lo yoga in una routine equilibrata.",
  content: "Lo yoga può essere inserito in un percorso di benessere insieme ad abitudini sostenibili. La pagina presenta posizioni, consigli pratici e indicazioni generali senza promettere risultati specifici.",
};

test("rifiuta meta description tronca come gli esempi dell'audit reale", () => {
  const result = validateSeoSuggestion(
    "meta_description",
    "Yoga per Dimagrire: La Guida per Trasformare il Tuo Corpo. Yoga per Dimagrire: La Guida per Trasformare il Tuo Corpo Introduzione: Lo yoga per dimagrire è.",
    page,
  );
  assert.equal(result.publishable, false);
  assert.ok(result.errors.length > 0);
});

test("rifiuta una frase che termina con articolo sospeso", () => {
  const result = validateSeoSuggestion(
    "meta_description",
    "Yoga a Cinisello Balsamo per principianti: benefici, come iniziare e scegliere il corso giusto. Approfondisci consigli utili per una.",
    page,
  );
  assert.equal(result.publishable, false);
  assert.match(result.errors.join(" "), /termina/i);
});

test("rifiuta dati numerici inventati rispetto alla sorgente", () => {
  const result = validateSeoSuggestion(
    "meta_description",
    "Scopri una pratica di yoga con 30 giorni garantiti per migliorare il benessere, con indicazioni utili e un percorso semplice da seguire ogni giorno.",
    page,
  );
  assert.equal(result.publishable, false);
  assert.match(result.errors.join(" "), /numerici/i);
});

test("accetta una meta description completa e coerente", () => {
  const result = validateSeoSuggestion(
    "meta_description",
    "Scopri come integrare lo yoga in una routine equilibrata con posizioni, consigli pratici e indicazioni utili per iniziare in modo graduale e consapevole.",
    page,
  );
  assert.equal(result.publishable, true);
});

test("title troppo lungo non passa il gate", () => {
  const result = validateSeoSuggestion(
    "seo_title",
    "Yoga per dimagrire: guida completa con posizioni benefici consigli pratici abitudini quotidiane e approfondimenti per iniziare subito",
    page,
  );
  assert.equal(result.publishable, false);
  assert.match(result.errors.join(" "), /70/);
});
