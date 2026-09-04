# seoGrow AI — MVP 1.4.3

Le verifiche storiche della versione 1.4.2 sono riepilogate in `docs/QA-1.4.2.md`. La release 1.4.3 aggiunge il workflow di remediation WordPress con verifica frontend, storico correzioni e rollback.

MVP personale per gestire clienti SEO, audit on-page, opportunità, contenuti, task e integrazioni WordPress.

## Avvio locale

1. Installa Node.js 22 o superiore.
2. Apri il Terminale nella cartella del progetto.
3. Esegui `npm install`.
4. Copia `.env.example` in `.env` e compila soltanto le chiavi necessarie.
5. Esegui `npm run dev` oppure usa `AVVIA.command`.
6. Apri `http://localhost:5176`.

`npm run dev`, `npm start` e `AVVIA.command` caricano gli stessi adapter di remediation e verifica frontend. Con `AVVIA.command` non serve digitare l’indirizzo: il launcher usa normalmente `http://localhost:5176`, memorizza la porta e la riutilizza per conservare lo stesso archivio del browser. Se seoGrow AI è già attiva, la riapre senza avviare una seconda copia.

## Produzione

Esegui `npm run build` e quindi `npm start`. Apri `http://localhost:5176`; l’API rimane locale sulla porta indicata da `PORT`.

## Funzioni incluse

- dashboard responsive con metriche e andamento;
- importazione manuale ZIP e collegamento diretto alle API di Google Search Console;
- riconoscimento automatico del dominio e abbinamento al progetto corretto;
- importazione multipla di più ZIP Search Console in una sola selezione;
- card dei siti cliccabili per aprire la relativa panoramica;
- storico fino a 24 importazioni Search Console e confronto con il periodo precedente;
- task separati per progetto, creabili, modificabili, eliminabili ed esportabili in CSV;
- task Search Console con metriche, distinzione tra URL confermata e suggerita, checklist operativa e link alla pagina;
- crawl configurabile fino a 200 pagine, 800 link interni e 250 link esterni;
- controlli di title, description, H1, canonical, noindex, immagini, contenuti brevi, tempi di risposta, profondità, duplicati, sitemap e link interrotti;
- storico delle analisi con problemi nuovi, risolti e variazione del punteggio;
- suggerimenti di linking interno con pagina sorgente, destinazione e anchor;
- creazione task verificata dai suggerimenti editoriali, dai link interrotti e dai link interni consigliati, con conferma visibile;
- opportunità per posizioni 4–20, CTR basso, query in calo e cannibalizzazioni;
- piano editoriale mensile ricavato dai dati, con settimana, obiettivo, formato, URL, priorità ed esportazione CSV;
- topical map DataForSEO con volumi, intento, cluster e articoli mancanti rispetto alle query già coperte;
- controllo posizionamenti DataForSEO per desktop/mobile, profondità fino alla top 100, URL posizionata, storico e variazione;
- eliminazione protetta dei clienti e dei relativi dati locali;
- report HTML scaricabile per ogni cliente, stampabile anche in PDF;
- backup completo cifrato con password, incluse cronologia e snapshot di rollback delle remediation, e copie locali automatiche ripristinabili;
- notifiche per cali, nuovi problemi, correzioni e task scadute;
- metriche reali per cliente: clic, impressioni, CTR, posizione, query, pagine, Paesi e dispositivi;
- opportunità e task iniziali derivati dalle query importate;
- gestione locale di clienti e task;
- audit reale di una singola URL;
- generatore di brief/contenuti con modalità demo;
- API OpenAI lato server quando `OPENAI_API_KEY` è configurata;
- verifica guidata WordPress e invio dei contenuti editoriali esclusivamente come bozze, con credenziali mantenute solo durante la sessione;
- remediation WordPress separata per campi supportati, con verifica del frontend prima di considerare risolto un problema SEO e storico Prima/Dopo con rollback;
- ricerca globale funzionante per sezioni, clienti e task;
- integrazione OAuth Search Console con importazione query–pagina reale e aggiornamento periodico mentre l’app è aperta;
- salvataggio delle preferenze nel browser;
- salvataggio automatico delle bozze editoriali per progetto;
- server accessibile esclusivamente dal computer locale e protezione delle chiamate a pagamento;
- verifica reale delle credenziali DataForSEO e avviso per importazioni Search Console parziali;
- filtri e ricerca nelle task, prevenzione dei duplicati e conservazione dello stato dopo gli aggiornamenti GSC;
- WordPress consentito soltanto tramite HTTPS, con verifica del permesso di creare bozze.

## Importare Search Console

1. In Search Console apri **Prestazioni → Risultati di ricerca**.
2. Esporta i dati nel formato **CSV/Google Fogli** e scarica il pacchetto ZIP.
3. In seoGrow AI apri **Integrazioni → Google Search Console**.
4. Premi **Importa ZIP Search Console** e seleziona uno o più ZIP senza estrarli.
5. L’app riconosce il dominio dagli URL contenuti nell’esportazione e abbina ogni file al progetto corretto.

Se il dominio non è ancora presente, viene creato automaticamente un nuovo progetto. Le nuove importazioni aggiornano il dataset corrente e alimentano lo storico senza duplicare lo stesso periodo.

I dati rimangono sul computer nel browser utilizzato.

## Sicurezza

Non inserire chiavi API nel codice frontend. Le password applicative WordPress non vengono salvate nel browser né dal server: restano in memoria soltanto fino alla chiusura o al ricaricamento dell’app. Le richieste WordPress e di verifica frontend usate dalla remediation vengono risolte su indirizzi pubblici e bloccate contro destinazioni locali/private.

## Piano editoriale e WordPress

1. Apri **Piano editoriale** dal menu e scegli **Prepara bozza** su una riga.
2. Genera il brief, l’articolo o i metadati e revisiona il testo.
3. Apri **Integrazioni → WordPress**, inserisci URL del sito, nome utente e password applicativa, quindi premi **Verifica connessione**.
4. Torna al **Piano editoriale** e premi **Invia come bozza**. L’app usa sempre `status: draft` e non pubblica direttamente.

La **remediation SEO** è un workflow distinto dall’invio editoriale: quando viene eseguita su una pagina esistente può modificare i campi WordPress espressamente supportati. Una modifica non viene considerata risolta finché il frontend e il nuovo controllo SEO non la confermano. I title SEO gestiti da plugin come Rank Math/Yoast non vengono dichiarati corretti dal solo adapter WordPress core.

## DataForSEO: posizionamenti e topical map

1. Copia `.env.example` in un nuovo file chiamato `.env`.
2. Inserisci `DATAFORSEO_LOGIN` e `DATAFORSEO_PASSWORD` ricevuti da DataForSEO.
3. Riavvia l’app e controlla lo stato in **Integrazioni → DataForSEO**.
4. Apri **Posizionamenti** per verificare fino a 100 keyword per volta e scegliere località e lingua.
5. Apri **Piano editoriale → Topical map e articoli mancanti** per generare nuovi cluster e trasformarli in task.

Le richieste DataForSEO sono a pagamento. Prima di ogni chiamata l’app mostra una conferma e, dopo l’operazione, il costo restituito dall’API. Le credenziali restano nel server locale e non vengono inserite nel codice frontend.

## Link interrotti e suggeriti

Il controllo dei link interrotti richiede una **Nuova analisi** del sito: Search Console da sola non contiene questi errori. Il crawler verifica link interni e fino a 250 link esterni, mostra sorgente, destinazione e risposta HTTP ed esegue un secondo tentativo sugli errori temporanei. Da ogni riga puoi creare una task dettagliata.

## Report, backup e analisi

- In **Siti**, premi **Report** nella card di un cliente. Apri il file HTML e usa **Stampa / Salva PDF** se desideri un PDF.
- In **Impostazioni → Backup completo**, scegli una password di almeno 10 caratteri: il file viene cifrato con AES-GCM. Conservala, perché non può essere recuperata dall’app. Nella 1.4.3 il backup include anche storico correzioni e snapshot Prima/Dopo usati per il rollback.
- In **Panoramica**, **Storico**, **Link interni** o **Task**, premi **Nuova analisi**. Puoi scegliere da 25 a 200 pagine.

L’esportazione standard di Search Console non contiene l’abbinamento query-pagina. Quando possibile, seoGrow AI suggerisce una pagina confrontando la query con il percorso degli URL; il suggerimento non viene presentato come dato confermato da Google.

## Collegamento diretto a Search Console

1. Crea credenziali OAuth desktop/web in Google Cloud con Search Console API abilitata.
2. Imposta come URI di reindirizzamento `http://localhost:8787/api/google/callback`.
3. Crea un file `.env` copiando `.env.example` e inserisci `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
4. Riavvia l’app e apri **Integrazioni → Collega account Google**.

Le credenziali OAuth rimangono nel file `.env`; il token autorizzato viene cifrato e conservato nella cartella privata `.seogrow-data`.

## GEO AI

La voce **GEO AI** nella sidebar lavora sul progetto selezionato e offre:

- audit tecnico della preparazione ai motori generativi;
- verifica distinta di OAI-SearchBot, Googlebot e GPTBot;
- indice di preparazione GEO con criteri espliciti;
- domande suggerite da Search Console e topical map;
- simulazione OpenAI dichiarata come simulazione, non come ranking reale;
- task dettagliate con URL, prova rilevata e intervento;
- esportazione CSV e inclusione dell’audit nel report cliente;
- salvataggio dei dati GEO nel backup completo.

L’audit non garantisce che un motore AI menzioni o citi il sito. Le risposte
generative possono variare e Search Console non separa tutte le citazioni AI.

## Limiti della versione 1.4

Le automazioni funzionano finché app e Terminale restano aperti. Database multiutente, invii programmati a computer spento, email automatiche e gestione di più utenti richiedono una versione installata su server/cloud. Le chiamate DataForSEO reali richiedono credenziali attive e consumano il relativo credito.
