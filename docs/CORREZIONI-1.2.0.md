# seoGrow AI 1.2.0 — revisione completa

Questa versione consolida la correzione dei difetti riproducibili individuati
nei cicli di audit precedenti.

## Avvio e protezione locale

- launcher più affidabile, controllo Node.js 22 e installazione riproducibile;
- arresto coordinato di frontend e API;
- porta salvata soltanto dopo il controllo di funzionamento;
- token e credenziali nella stessa cartella protetta;
- file sensibili esclusi da Git;
- stato pubblico dell’API privo dei dettagli sulle integrazioni.

## Search Console e contenuti

- controllo delle colonne obbligatorie dei CSV;
- aggregazione di date e query duplicate;
- confronto query senza differenze tra maiuscole e minuscole;
- identificazione dataset sull’intero insieme delle query;
- storico esteso a 24 importazioni;
- piano mensile limitato a 12 attività.

## Crawl e GEO

- limiti per HTML, robots.txt e sitemap;
- redirect fuori dominio bloccati;
- sitemap miste e compresse gestite in sicurezza;
- canonical risolti e controllati;
- punteggi tecnici meno soggetti a diluizione;
- ID GEO stabili, problemi Schema per pagina e conteggio domini sorgente;
- errori delle singole pagine GEO conservati nel risultato.

## WordPress e DataForSEO

- allowlist HTML conservativa prima dell’invio a WordPress;
- URL WordPress in sottocartella normalizzati;
- limiti per titolo e contenuto;
- verifica WordPress valida per 30 minuti;
- registro costi DataForSEO atomico e con fuso orario configurabile;
- prenotazioni di costo esposte nello stato;
- keyword duplicate normalizzate e gruppi più rapidi.

## Interfaccia

- risultati di ricerca aprono direttamente la task;
- notifiche richiudibili con Escape e clic esterno;
- clienti modificabili e task trasferibili tra progetti;
- navigazione ripristinabile con URL e pulsanti del browser;
- migliore rispetto della preferenza di movimento ridotto.
