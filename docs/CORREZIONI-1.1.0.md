# seoGrow AI 1.1.0 — correzioni

Questa versione applica il secondo ciclo di 50 correzioni tecniche.

## Dati e progetti

- Importazione multipla Search Console indipendente per ogni ZIP.
- Rilevamento di duplicati, CSV corrotti, date e numeri non validi.
- Limiti sia sul file ZIP sia sul contenuto decompresso.
- Associazione prudente quando il dominio proviene soltanto dal nome del file.
- Storico distinto anche quando due dataset hanno gli stessi totali.
- Confronti ammessi soltanto tra periodi compatibili, consecutivi e non sovrapposti.
- Query nuove e scomparse incluse nei confronti.

## Task e backup

- ID delle task GSC stabili rispetto alla query.
- Task archiviate escluse dalle viste operative e disponibili tramite filtro.
- Date di aggiornamento e completamento registrate al cambio di stato.
- Scadenze calcolate sulla fine della giornata locale.
- Backup controllati per ID duplicati, tipi, relazioni e URL sicuri.
- Le copie locali del workspace precedente vengono rimosse dopo un ripristino esterno.

## Sicurezza e integrazioni

- Token API locale casuale anche con avvio manuale.
- Chiave di cifratura delle credenziali separata dal token API, con migrazione del token Google esistente.
- Confronto token sicuro anche con caratteri Unicode.
- Verifica reale dello stato Google e pulizia degli stati OAuth scaduti.
- Revoca Google senza inserire il token nell’URL.
- Date e proprietà Search Console validate lato server.
- HTML inviato a WordPress ripulito da script, iframe, event handler e URL attivi.
- Permessi WordPress distinti per articoli e pagine.

## Crawl e GEO

- User-agent coerente e aggiornato a 1.1.
- Riduzione dei crawl trap e normalizzazione degli slash finali.
- Sitemap dichiarate in robots.txt e sitemap `.xml.gz` supportate.
- Errori nelle sitemap figlie non eliminano i risultati già raccolti.
- Risposte protette 401/403 distinte dai link realmente interrotti.
- Fino a 50 pagine sorgenti conservate per ogni collegamento.
- Punteggio tecnico normalizzato per il numero di pagine.
- Errori GEO, noindex, Schema e contenuto scarso associati alla pagina corretta.
- Affidabilità GEO ridotta quando alcune pagine non possono essere controllate.
- Contenuti dei siti isolati dalle istruzioni del modello per ridurre la prompt injection.

## Costi ed esportazioni

- Contatore DataForSEO serializzato contro le scritture concorrenti.
- Prenotazione prudenziale del budget prima delle richieste a pagamento.
- Costi delle risposte parziali registrati quando comunicati dal provider.
- Posizione organica distinta dalla posizione assoluta nella SERP.
- Confronti ranking separati anche per lingua.
- Copertura topical map estesa alle pagine rilevate dal crawl.
- CSV con oggetti serializzati in JSON invece di `[object Object]`.
- Report protetti da URL non HTTP/HTTPS, con CSP e avvisi sui limiti di righe.

## Verifica

- `npm run lint`
- `npm test` — 12 test
- `npm run build`
- avvio frontend e API locali
- API senza token: HTTP 401
- token Unicode errato: HTTP 401 senza arresto del server
