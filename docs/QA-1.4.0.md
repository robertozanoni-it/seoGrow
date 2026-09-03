# QA seoGrow AI 1.4.0

Data: 3 settembre 2026

| Controllo | Esito |
|---|---|
| ESLint | Superato |
| Test unitari/API/regressione | 32/32 superati |
| Build Vite produzione | Superata |
| Sintassi launcher macOS | Superata |
| Audit dipendenze runtime | 0 vulnerabilità note |
| Protezione route API, token e origine | Superata |
| Import ZIP, numeri locali e backup | Superata |
| Blocco reti private IPv4/IPv6/NAT64 | Superato |

Il browser remoto della sessione non può aprire servizi `localhost` della
macchina di compilazione (`ERR_BLOCKED_BY_CLIENT`). La verifica visuale finale
desktop/mobile va quindi eseguita sul Mac aprendo `AVVIA.command`; non è stata
sostituita da una dichiarazione di esito non osservato.
