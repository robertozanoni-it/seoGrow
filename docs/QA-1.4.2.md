# QA finale seoGrow AI 1.4.2

Data verifica: 3 settembre 2026.

## Esito

Il collaudo finale è superato: lint, 36 test automatici, build, launcher macOS,
avvio della build di produzione e 29 gruppi di controlli end-to-end nel browser
sono passati. Non rimangono difetti di priorità Alta riproducibili nel perimetro
verificato.

Il test è stato eseguito in un profilo browser isolato con clienti, URL,
password e risposte API sintetici. Nessuna chiamata a pagamento è stata
effettuata, nessun sito reale è stato contattato e nessun articolo è stato
pubblicato.

## Stato iniziale

- Stack: React 19, Vite 8, Express 5, Node.js 24.19.0 (requisito minimo 22).
- Versione iniziale: 1.4.1.
- ESLint: superato.
- Test automatici iniziali: 35/35 superati.
- Build Vite: superata.
- Sintassi `AVVIA.command`: valida.
- Audit dipendenze di produzione: 0 vulnerabilità note nel controllo disponibile.

## Difetti confermati e corretti

| Priorità | Difetto e riproduzione | Correzione | Regressione |
| --- | --- | --- | --- |
| Alta | Avviando `npm run dev`, la Content Security Policy bloccava il preambolo inline di React Refresh e poteva lasciare la UI vuota. | CSP di sviluppo separata, limitata al server locale, con script inline e WebSocket necessari a Vite; CSP di produzione invariata e restrittiva. | Avvio reale dev più caricamento Chromium superati senza errori inattesi. |
| Alta | Con OpenAI configurata, aprendo **Integrazioni** il componente leggeva uno stato API non ricevuto e poteva interrompere il rendering. | Stato API passato esplicitamente e valore predefinito difensivo. | Flusso Integrazioni eseguito con OpenAI simulata come configurata. |
| Media | Dopo il ripristino di un backup veniva sempre selezionato il primo cliente, facendo apparire mancanti task e dati del progetto precedentemente attivo. | Il backup conserva il progetto selezionato; il ripristino usa quel progetto quando è valido e mantiene la compatibilità con backup precedenti. | Test automatico per progetto inesistente e flusso browser export/ripristino con selezione conservata. |

## Collaudo browser

Sono stati verificati: navigazione nelle 12 sezioni; creazione, duplicazione,
modifica, selezione ed eliminazione protetta dei soli dati QA; ricerca globale;
importazione e associazione Search Console; WordPress; audit rapido e analisi
completa; annullamento; errori API; link interrotti e linking interno; task e
filtri; piano editoriale; topical map; posizionamenti; GEO AI; contenuti e bozza
WordPress; report; backup cifrato e ripristino; aggiornamento automatico;
ricaricamento; tastiera, focus, mobile e dataset da 5.000 query.

Risultato: 29/29 gruppi superati, 44 richieste API intercettate e controllate,
nessun errore JavaScript inatteso, nessun pulsante senza effetto nel perimetro
provato, nessun overflow orizzontale a 390 × 844, nessun pulsante privo di nome
accessibile e nessun campo privo di etichetta rilevato nelle schermate visitate.

Il browser integrato dell'ambiente ha bloccato `localhost` con
`ERR_BLOCKED_BY_CLIENT`; per non ridurre la copertura è stato usato Chromium
headless locale tramite Playwright, mantenendo lo stesso server e gli stessi
flussi reali dell'interfaccia.

## Sicurezza e server

- API in ascolto solo su `127.0.0.1`.
- Health pubblico; sessione e endpoint sensibili rifiutano richieste prive del
  token locale con HTTP 401.
- Origini esterne non autorizzate rifiutate con HTTP 403.
- CSP, anti-framing, `nosniff`, referrer policy e permissions policy presenti.
- Password WordPress sintetica assente dal `localStorage` e dal backup cifrato.
- Scansione statica senza chiavi OpenAI/DataForSEO incorporate nel codice o nel
  pacchetto.
- Build di produzione verificata con pagina 200, health 200, sessione senza token
  401 e sessione autenticata 200.

## Comandi finali

- `npm run lint`: superato.
- `npm test`: 36/36 superati.
- `npm run build`: superato.
- `npm run test:launcher`: superato.
- `npm audit --omit=dev --audit-level=high --offline`: 0 vulnerabilità note.

## Limiti residui

Per rispettare le regole di sicurezza non sono stati eseguiti OAuth Google,
chiamate OpenAI/DataForSEO a pagamento, crawl di siti reali né invii a un vero
WordPress. Queste integrazioni sono state collaudate con risposte positive,
negative e interrotte simulate. Disponibilità, permessi, quote e variazioni dei
servizi esterni richiedono comunque una prova separata e autorizzata con account
di test. Non è stata eseguita una certificazione formale WCAG né una matrice
completa Safari/Firefox/Chrome su dispositivi fisici.

## Conclusione

La versione verificata è **1.4.2**. Nel perimetro locale e con dati sintetici
l'app è affidabile per l'uso MVP; i limiti sopra indicati non sono difetti
riproducibili dell'applicazione, ma dipendenze esterne ancora da validare in un
ambiente di staging autorizzato.
