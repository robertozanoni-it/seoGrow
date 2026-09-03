# QA seoGrow AI 1.3.0

Data: 3 settembre 2026

| Controllo | Esito |
|---|---|
| ESLint sorgenti correnti | Superato |
| Test unitari e regressione | 30/30 superati |
| Sintassi launcher macOS (`zsh -n`) | Superata |
| Build Vite di produzione | Superata |
| Avvio API locale isolata | Superato |
| Proxy frontend → API | Superato |
| Health pubblico locale | Superato |
| Sessione senza token | HTTP 401, atteso |
| Sessione con token | HTTP 200, atteso |
| Origine esterna | HTTP 403, atteso |
| Contenuto ZIP senza `.env` e archivi locali | Superato in fase di packaging |

La prova visuale desktop/mobile resta da ripetere su macOS dopo l’estrazione dello ZIP; in questa sessione non era disponibile un browser controllabile.
