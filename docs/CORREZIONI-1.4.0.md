# seoGrow AI 1.4.0 — consolidamento tecnico

La versione 1.4.0 applica le correzioni verificabili emerse dall’audit tecnico
della 1.3.0, con priorità a dati, sicurezza, costi API e operazioni quotidiane.

## Dati e flussi applicativi

- Validazione degli store locali e sincronizzazione degli errori per singola chiave.
- Identificativi robusti per task e snapshot; apertura task dalla ricerca consumata una sola volta.
- Audit rapido persistente, incluso in snapshot e backup cifrati.
- Metadati WordPress non segreti persistenti; password applicativa sempre e solo in memoria.
- Cambio dominio basato su origine e sottocartella, con eliminazione confermata dei dati incompatibili.
- Task ordinate per scadenza e priorità, vista dashboard limitata alle attività rilevanti.
- Cambio stato tramite selezione esplicita e timestamp di completamento.
- Problemi ricomparsi riaperti come regressioni e riepilogo quando l’audit genera troppe attività.
- Bozze dimostrative riconoscibili e non inviabili a WordPress.
- Opzione per non salvare le bozze editoriali nel browser.

## Search Console, ranking e topical map

- Lettura preventiva della directory ZIP e limite dichiarato prima della decompressione.
- Decompressione sequenziale, tetto di 250.000 righe CSV e validazione URL pagina.
- Interpretazione dei decimali coerente con la lingua delle intestazioni.
- Firma dataset estesa a grafico, query, pagine, Paesi, dispositivi e query–pagina.
- Conferma per proprietà dedotte dal nome ZIP e blocco dell’abbinamento ambiguo sullo stesso host.
- Aggiornamento GSC automatico immediato, senza esecuzioni concorrenti e con annullamento al cambio progetto.
- Timeout client DataForSEO coerente con il caso peggiore del server.
- Validazione rigorosa di keyword, profondità, località, lingua e limiti topical map.
- Costo massimo stimato mostrato prima del consenso; run completamente falliti non salvati.
- Confronto ranking con l’ultimo run compatibile e riuscito, non semplicemente con il precedente.
- Idee topical già coperte ancora visibili e quota riservata nel piano editoriale.

## Crawler, GEO e sicurezza

- Protezione SSRF con connessione all’IP DNS già verificato e blocco delle forme IPv4/IPv6/NAT64 riservate.
- Redirect con cancellazione del body, nuova validazione DNS e semantica corretta per POST → GET.
- Limiti streaming per HTML, JSON, sitemap, robots e risposte delle integrazioni.
- `robots.txt` ricaricato dopo cambio origine e cancellabile insieme all’analisi.
- Controlli link cancellabili, Retry-After numerico o HTTP-date e pausa di cortesia sui percorsi anticipati.
- Decompressione sitemap gzip asincrona e sitemap figlie esterne filtrate prima della richiesta.
- Soglie title/description coerenti tra audit rapido e crawl.
- GEO con input strutturati limitati, risposta OpenAI validata uno-a-uno e richieste annullabili.
- Header di sicurezza anche sul frontend Vite/preview.
- Rate limit separati per crawler, integrazioni, OpenAI e DataForSEO.
- Porta, origine, fuso di fatturazione, budget e tariffe validati all’avvio/uso.
- Stato e spesa mensile OpenAI/DataForSEO visibili nell’interfaccia.

## Accessibilità e operatività

- Focus visibile uniforme, caption nascoste per le tabelle e messaggi critici annunciati.
- Menu mobile e notifiche con Escape, ingresso del focus e contenimento del Tab.
- Scrim mobile trasformato in controllo semantico.
- Ricerca globale chiudibile fuori area e senza pattern ARIA incompleto.
- Il comando “Prepara bozza” porta direttamente all’editor.
- Pulsanti interattivi del toast non vengono rimossi automaticamente.

## Limiti architetturali dichiarati

Questa resta una app locale monoutente. Transazioni atomiche tra tutti gli store,
sincronizzazione multiutente, job pagati recuperabili dopo spegnimento, rendering
JavaScript del crawler e automazioni a computer spento richiedono un database e
un worker/server persistente. Non sono simulati né dichiarati come disponibili.
