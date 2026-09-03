# seoGrow AI 1.3.0 — correzioni dell’audit

Questa versione consolida i rilievi dell’audit successivo alla 1.2.0.

## Avvio e protezione locale

- Node.js 22 indicato in modo coerente nella documentazione e nel launcher.
- Porta frontend 5176 fissa per `dev` e `start`; il launcher conserva una porta alternativa soltanto quando necessario.
- Riconoscimento di un’istanza già aperta e verifica della sessione API tramite token locale.
- Permessi `600` applicati al file `.env` esistente.
- Origini loopback accettate soltanto insieme al token API; origini esterne respinte.
- Estensione dei controlli SSRF a IPv4 mappati in IPv6 e reti riservate.

## Progetti, task e contenuti

- Dati iniziali anonimizzati e nessuna task fittizia operativa.
- Risultati dell’audit rapido separati per progetto.
- Cambio dominio con conferma e rimozione dei dati incompatibili del vecchio sito.
- URL progetto conservati con porta, percorso e protocollo validi.
- Task completate escluse dalla vista prioritaria.
- Controllo duplicati anche nell’editor; spostamento tra progetti senza vecchi URL o metriche.
- Reimportazione Search Console non sovrascrive le personalizzazioni manuali.
- Piano editoriale massimo di 12 attività, distribuito su quattro settimane e con spazio riservato ai problemi tecnici.
- Tipo “Metadati” allineato al valore accettato dal server.

## Search Console e crawler

- Supporto ai nomi file italiani e inglesi e ai file Paesi/Dispositivi/Filtri.
- Metadati `__MACOSX` ignorati, controlli dimensionali anticipati e CSV vuoti respinti.
- Query aggregate senza distinzione tra maiuscole e minuscole; URL pagina canonici.
- Metriche negative o incoerenti respinte.
- Coda crawler deduplicata, redirect convergenti deduplicati e risposte richieste/finali memorizzate.
- Pulsante di annullamento crawl con propagazione al server.
- Minore concorrenza per i controlli link e ritardo applicato anche dopo gli errori.
- Errori di scansione inclusi nel punteggio e motivi di troncamento dichiarati.
- Sitemap annidate lette a gruppi con scadenza globale; namespace e CDATA supportati.
- Estrazione link depurata da script/commenti/template e supporto a `<base href>`.

## GEO, DataForSEO, WordPress e OpenAI

- Controllo content-type anche sulla prima pagina GEO e deduplica delle destinazioni finali.
- Controlli Schema concentrati sulle pagine informative, non sulle pagine di servizio tecnico.
- Blocco GPTBot trattato come scelta informativa, senza penalità sul punteggio.
- Domande GEO limitate e risposta AI verificata uno-a-uno, anche in caso di riordino.
- Confronto ranking comprensivo di lingua, case-insensitive e basato sulla posizione assoluta.
- Richieste DataForSEO in gruppi più piccoli, annullabili e con costi/stime validati.
- Prenotazioni di budget rilasciate anche se la scrittura del registro fallisce.
- Limite token OpenAI validato e budget mensile con contatori token e tariffe configurabili.
- Tabelle HTML WordPress ammesse; Markdown multilinea e blocchi di codice convertiti in modo sicuro.

## Verifica

- ESLint: superato.
- Test Node: 30 test automatici, inclusi import ZIP, sicurezza URL, conversione WordPress e route HTTP protette.
- Build Vite: superata.
- Smoke test: frontend Vite, proxy API, health, sessione autenticata, rifiuto origine esterna.
- Verifica visuale automatizzata: non eseguita perché il browser controllabile non era disponibile nella sessione di build.
