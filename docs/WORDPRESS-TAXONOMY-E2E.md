# Test E2E reale — tassonomie WordPress

Questo test è **distruttivo ma autoripristinante**: modifica temporaneamente la meta description di una categoria e di un tag, verifica il valore pubblico, prova il blocco stale-state e ripristina il valore originale.

Usarlo esclusivamente su un sito WordPress di prova/staging autorizzato con **SeoGrow Connector 1.3.0 o superiore**. Non usarlo su un sito di produzione.

## Prerequisiti

1. SeoGrow in esecuzione localmente, normalmente su `http://127.0.0.1:5176`.
2. WordPress HTTPS raggiungibile pubblicamente.
3. Password applicativa WordPress per un utente autorizzato a modificare categoria e tag.
4. Una categoria e un tag reali e pubblicamente raggiungibili.
5. Un solo adapter SEO attivo per il test: Rank Math **oppure** Yoast. Se entrambi risultano attivi SeoGrow deve bloccare la scrittura.

## Variabili obbligatorie

```bash
export SEOGROW_WP_SITE_URL='https://staging.example.com/'
export SEOGROW_WP_USERNAME='utente-test'
export SEOGROW_WP_APPLICATION_PASSWORD='xxxx xxxx xxxx xxxx xxxx xxxx'
export SEOGROW_WP_CATEGORY_URL='https://staging.example.com/category/seo/'
export SEOGROW_WP_TAG_URL='https://staging.example.com/tag/test/'
export SEOGROW_WP_E2E_CONFIRM_HOST='staging.example.com'
export SEOGROW_WP_E2E_ALLOW_WRITE='YES_I_UNDERSTAND'
```

Opzionale, per assicurarsi di testare l'adapter previsto:

```bash
export SEOGROW_WP_EXPECT_ADAPTER='rank-math'
# oppure: yoast
```

Se SeoGrow usa una porta diversa:

```bash
export SEOGROW_E2E_APP_URL='http://127.0.0.1:5176'
```

## Avvio

Con SeoGrow già avviato:

```bash
npm run test:wordpress-taxonomy-e2e
```

## Cosa verifica

Per **categoria** e **tag**:

1. `connection-check` e Connector rilevato;
2. identità esatta del termine dal permalink reale;
3. ownership SEO univoca;
4. preview single-field della meta description;
5. apply con token monouso;
6. impossibilità di riutilizzare il token;
7. rilettura del valore salvato;
8. verifica del valore pubblico;
9. rifiuto di un rollback con `expectedCurrent` errato (`STALE_ROLLBACK`);
10. preview + apply del rollback corretto;
11. verifica pubblica del valore originale dopo il ripristino.

Se un errore avviene dopo la scrittura, lo script tenta automaticamente un rollback di sicurezza e segnala chiaramente se il ripristino non riesce.

## Criterio di completamento Phase 3

Il supporto tassonomie può essere dichiarato validato end-to-end su WordPress reale solo dopo almeno due esecuzioni riuscite del test:

- una con **Rank Math** come unico adapter SEO attivo;
- una con **Yoast** come unico adapter SEO attivo.

Conservare nel report di QA: host staging, data/ora, versione Connector, adapter, categoria/tag usati e risultato finale. Non salvare mai la password applicativa nel repository o nel report.
