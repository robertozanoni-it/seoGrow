# QA seoGrow AI 1.4.1

Data verifica: 3 settembre 2026.

## Esito

La suite automatica e l'avvio locale della build di produzione sono superati.
Questa versione corregge i difetti riproducibili emersi nel ciclo di verifica,
ma non va considerata una garanzia assoluta: le integrazioni esterne dipendono
anche da credenziali, permessi, disponibilità e risposte di Google, WordPress,
DataForSEO, OpenAI e dei siti sottoposti a crawl.

## Controlli superati

- ESLint senza errori.
- 35 test automatici superati.
- Build Vite completata.
- Sintassi del launcher macOS verificata.
- Audit npm delle dipendenze di produzione: 0 vulnerabilità note.
- Avvio reale della build: pagina HTTP 200, proxy API operativo, sessione locale
  autenticata, intestazioni CSP e anti-framing presenti.
- Endpoint health e versione frontend/API coerenti (`1.4.1`).

## Correzioni di questo ciclo

- Normalizzazione delle task locali incomplete con valori sicuri per stato,
  priorità, testo, collegamenti e progetto.
- Rifiuto di identificativi task duplicati anche se differiscono solo per spazi.
- Tolleranza verso analisi storiche prive degli elenchi introdotti nelle versioni
  più recenti.
- Protezione dei risultati GEO salvati con struttura incompleta.
- Aggiornamento dei suggerimenti GEO quando arrivano nuovi dati, senza
  sovrascrivere domande già modificate dall'utente.
- Annullamento di audit SEO e simulazioni GEO senza falso messaggio di errore.
- Eliminazione delle condizioni di gara sullo stato di caricamento delle analisi.
- Conteggio sicuro dei risultati di analisi provenienti da vecchi salvataggi.
- Blocco delle task senza titolo e normalizzazione della priorità.
- Restituzione del focus al pulsante notifiche dopo la chiusura da tastiera.
- Versione del server e del launcher letta automaticamente da `package.json`,
  evitando il riuso accidentale di una vecchia API locale.

## Limite della verifica in questa sessione

Il browser di collaudo integrato ha rifiutato l'accesso a `localhost` con
`ERR_BLOCKED_BY_CLIENT`. L'app è stata comunque avviata e interrogata realmente
via HTTP, ma in questa sessione non è stato possibile certificare con
automazione visuale ogni singolo clic, layout responsive e percorso con
credenziali reali. Per la chiusura definitiva della fase è quindi consigliato
eseguire sul Mac la checklist manuale descritta nel README usando copie di prova
e credenziali con privilegi minimi.
