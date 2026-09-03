#!/bin/zsh

cd -- "$(dirname -- "$0")" || exit 1
clear
echo "seoGrow AI — avvio dell'app"
echo

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js non risulta installato. Scaricalo da https://nodejs.org/ e riprova."
  echo
  read "?Premi Invio per chiudere…"
  exit 1
fi

node_major=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null)
if [ -z "$node_major" ] || [ "$node_major" -lt 22 ]; then
  echo "Errore: seoGrow AI richiede Node.js 22 o successivo."
  echo "Versione rilevata: $(node -v 2>/dev/null || echo non disponibile)"
  read "?Premi Invio per chiudere…"
  exit 1
fi

if [ ! -f package.json ]; then
  echo "Errore: package.json non trovato nella cartella dell'app."
  read "?Premi Invio per chiudere…"
  exit 1
fi

app_version=$(node -p "require('./package.json').version" 2>/dev/null)
if [ -z "$app_version" ]; then
  echo "Errore: versione dell'app non leggibile da package.json."
  read "?Premi Invio per chiudere…"
  exit 1
fi

if [ -f .env ]; then chmod 600 .env; fi

if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ]; then
  echo "Prima configurazione: installazione dei componenti necessari…"
  npm ci || {
    echo "Installazione non riuscita. Copia il messaggio di errore prima di chiudere."
    read "?Premi Invio per chiudere…"
    exit 1
  }
elif [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Aggiornamento dei componenti dell'app…"
  npm ci || {
    echo "Aggiornamento non riuscito. Copia il messaggio di errore prima di chiudere."
    read "?Premi Invio per chiudere…"
    exit 1
  }
fi

port_file=".seogrow-port"
app_port=5176
if [ -f "$port_file" ]; then
  saved_port=$(tr -dc '0-9' < "$port_file")
  if [ -n "$saved_port" ]; then app_port="$saved_port"; fi
fi

existing_url="http://localhost:$app_port"
mkdir -p .seogrow-data
chmod 700 .seogrow-data
token_file=".seogrow-data/app-token"
if [ ! -s "$token_file" ]; then
  openssl rand -hex 32 > "$token_file"
  chmod 600 "$token_file"
fi
export APP_API_TOKEN=$(tr -d '[:space:]' < "$token_file")
token_fingerprint=$(printf '%s' "$APP_API_TOKEN" | shasum -a 256 | awk '{print substr($1,1,16)}')
if lsof -nP -iTCP:"$app_port" -sTCP:LISTEN -t >/dev/null 2>&1; then
  existing_session=$(curl -fsS "$existing_url/api/session" 2>/dev/null)
  if printf '%s' "$existing_session" | grep -q "\"version\":\"$app_version\"" && printf '%s' "$existing_session" | grep -q "\"tokenFingerprint\":\"$token_fingerprint\""; then
    echo "seoGrow AI $app_version è già aperta su $existing_url."
    open "$existing_url"
    exit 0
  fi
fi

while lsof -nP -iTCP:"$app_port" -sTCP:LISTEN -t >/dev/null 2>&1; do
  app_port=$((app_port + 1))
  if [ "$app_port" -gt 65535 ]; then
    echo "Errore: non è stata trovata una porta frontend libera."
    read "?Premi Invio per chiudere…"
    exit 1
  fi
done

api_port=$(node --input-type=module -e "import fs from 'node:fs'; import dotenv from 'dotenv'; const value=dotenv.parse(fs.existsSync('.env')?fs.readFileSync('.env'):Buffer.from('')).PORT; if(value) process.stdout.write(value)" 2>/dev/null)
if [ -z "$api_port" ]; then api_port=8787; fi
if ! [[ "$api_port" =~ '^[0-9]+$' ]] || [ "$api_port" -lt 1024 ] || [ "$api_port" -gt 65535 ]; then
  echo "Errore: PORT nel file .env deve essere un numero tra 1024 e 65535."
  read "?Premi Invio per chiudere…"
  exit 1
fi

reuse_api=0
if lsof -nP -iTCP:"$api_port" -sTCP:LISTEN -t >/dev/null 2>&1; then
  session=$(curl -fsS -H "x-seogrow-token: $APP_API_TOKEN" "http://127.0.0.1:$api_port/api/session" 2>/dev/null)
  if printf '%s' "$session" | grep -q "\"version\":\"$app_version\"" && printf '%s' "$session" | grep -q "\"tokenFingerprint\":\"$token_fingerprint\""; then
    reuse_api=1
    echo "API seoGrow AI $app_version già attiva e verificata: verrà riutilizzata."
  else
    echo "Errore: la porta API $api_port è occupata da un altro programma."
    echo "Chiudi il programma indicato oppure cambia PORT nel file .env e riavvia."
    lsof -nP -iTCP:"$api_port" -sTCP:LISTEN 2>/dev/null
    read "?Premi Invio per chiudere…"
    exit 1
  fi
fi

app_url="http://localhost:$app_port"
export APP_ORIGIN="$app_url"
export PORT="$api_port"
echo "Avvio in corso su $app_url"
echo "Lascia aperta questa finestra del Terminale mentre usi l'app."

(
  for attempt in {1..30}; do
    if curl -fsS "$app_url/api/health" 2>/dev/null | grep -q '"ok":true'; then
      echo "$app_port" > "$port_file"
      open "$app_url"
      exit 0
    fi
    sleep 0.5
  done
) &
opener_pid=$!
trap 'kill "$opener_pid" 2>/dev/null' EXIT INT TERM

if [ "$reuse_api" -eq 1 ]; then
  ./node_modules/.bin/vite --port "$app_port" --strictPort
else
  ./node_modules/.bin/concurrently --kill-others-on-fail "./node_modules/.bin/vite --port $app_port --strictPort" "node server/index.js"
fi
