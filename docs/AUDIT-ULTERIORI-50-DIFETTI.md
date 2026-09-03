# seoGrow AI 0.8 — 50 ulteriori difetti e miglioramenti

Questo elenco contiene problemi residui individuati dopo le correzioni della versione 0.8. Non sono presentati come funzioni già disponibili.

## Dati e archiviazione

1. **LocalStorage resta il database principale.** Non è adatto a grandi crawl o molti clienti.
2. **Manca un archivio IndexedDB.** Dataset voluminosi non possono essere gestiti in modo efficiente.
3. **Mancano transazioni atomiche.** Un arresto durante più aggiornamenti può lasciare dati parzialmente coerenti.
4. **Non esiste un controllo automatico dell’integrità all’avvio.** Record danneggiati vengono ignorati o ripristinati solo parzialmente.
5. **Non esiste un sistema completo di migrazione delle versioni.** Sono presenti soltanto migrazioni mirate per alcuni dataset.
6. **I backup non sono cifrati.** Chi apre il JSON può leggere clienti, task e dati SEO.
7. **Il backup non contiene un checksum.** Non è possibile distinguere un file alterato da uno originale.
8. **Non esiste un cestino per i clienti.** La cancellazione resta definitiva.
9. **Le copie locali non possono essere eliminate singolarmente.** Si può soltanto sovrascriverle nel tempo.
10. **Manca un comando “Cancella tutti i dati”.** Utile per privacy, reset e consegna del computer.

## Search Console e posizionamenti

11. **Non è disponibile il filtro per tipo di ricerca.** Web, immagini, video e news non sono separati.
12. **Non sono importate le search appearance.** Rich result e risultati speciali non vengono analizzati.
13. **Manca la segmentazione brand/non-brand.** Le opportunità possono mescolare intenti molto diversi.
14. **Mancano filtri regex per query e URL.** Non si possono isolare directory, località o cluster.
15. **Non esiste l’integrazione URL Inspection.** Indicizzazione e copertura non sono verificate.
16. **Non vengono annotati aggiornamenti o modifiche al sito sui grafici.** È difficile collegare azioni e risultati.
17. **Le query senza mapping API possono ricevere una URL suggerita debole.** Il matching usa soprattutto il percorso URL.
18. **Manca un’associazione manuale persistente query–pagina.** L’utente non può confermare e salvare la propria scelta.
19. **Non esiste uno storico grafico per singola keyword DataForSEO.** È disponibile soltanto una tabella di controlli.
20. **Mancano tag e gruppi per le keyword.** Liste grandi diventano difficili da gestire.

## Crawler e audit tecnico

21. **I link esterni non vengono controllati.** L’audit copre soltanto i collegamenti interni.
22. **Le pagine JavaScript non vengono renderizzate.** Contenuti generati lato client possono risultare assenti.
23. **Non esiste un limite esplicito ai byte HTML scaricati.** Una risposta enorme può consumare molta memoria.
24. **Non c’è un pulsante per annullare il crawl.** L’utente deve attendere o interrompere l’app.
25. **Non viene mostrato l’avanzamento pagina per pagina.** Durante analisi lunghe l’interfaccia appare ferma.
26. **Non è previsto un retry controllato.** Un timeout temporaneo può diventare un falso errore.
27. **I codici 401 e 403 sono classificati come link problematici senza distinguere aree protette.** Serve una categoria separata.
28. **I redirect non vengono riportati come catene.** Si conserva principalmente la destinazione finale.
29. **Le canonical relative non sono normalizzate e verificate completamente.** Possono generare interpretazioni errate.
30. **Non viene controllato `X-Robots-Tag`.** Una pagina esclusa via header può sembrare indicizzabile.
31. **Le regole robots con wildcard e `$` non sono interpretate completamente.** Il parser attuale è intenzionalmente essenziale.
32. **Le sitemap compresse `.xml.gz` non sono supportate.** Alcuni siti possono risultare senza sitemap completa.
33. **Non viene verificato lo stato HTTP delle URL canonical.** Una canonical rotta può non essere segnalata.
34. **Non viene calcolata la similarità del corpo pagina.** Mancano contenuti duplicati e quasi duplicati.
35. **Le immagini con `alt=""` non sono distinte tra decorative e mancanti.** Il controllo può sottostimare problemi reali.
36. **Non vengono controllate dimensioni e peso delle immagini.** L’audit non identifica asset troppo pesanti.
37. **Non vengono rilevati dati strutturati invalidi.** JSON-LD e schema.org non sono validati.
38. **Mancano controlli hreflang.** Siti multilingua non ricevono diagnosi specifiche.
39. **Non vengono misurati LCP, CLS e INP.** Il tempo di risposta non equivale ai Core Web Vitals.
40. **Il punteggio non è normalizzato per numero di pagine.** Un sito grande può essere penalizzato più di uno piccolo.

## Contenuti, WordPress e collaborazione

41. **Non esiste una cronologia delle versioni della bozza.** L’autosalvataggio conserva solo l’ultima versione.
42. **Manca un editor visuale con anteprima HTML.** Markdown complesso deve essere controllato in WordPress.
43. **Non sono gestite immagini in evidenza e media WordPress.** L’invio riguarda soprattutto testo e titolo.
44. **Non sono configurabili categorie, tag, autore, slug ed excerpt.** Servono modifiche manuali in WordPress.
45. **Mancano campi Rank Math e Yoast.** Title e description SEO non vengono inviati ai plugin.
46. **Non si può aggiornare una bozza esistente.** Ogni invio crea un nuovo post e può produrre duplicati.
47. **Non esiste un registro persistente degli invii WordPress.** Dopo il riavvio non resta la cronologia delle bozze create.
48. **La topical map non visualizza graficamente pillar e cluster.** Il server restituisce i cluster, ma l’interfaccia resta tabellare.
49. **Non esistono utenti, ruoli e assegnatari.** L’app rimane personale e mono-utente.
50. **Manca una coda cloud per analisi e automazioni programmate.** A computer spento nessuna attività viene eseguita.

## Ordine suggerito

Per la versione successiva: IndexedDB/database, avanzamento e annullamento crawl, mapping manuale query–URL, storico keyword, editor con versioni, aggiornamento bozze WordPress e controlli tecnici avanzati.
