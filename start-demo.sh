#!/usr/bin/env bash
# Keynection demo for macOS/Linux: sets itself up on first run, then serves everything on http://localhost:8000
#   ./start-demo.sh --lan   (or KEYNECTION_LAN=1): also listen on the local network and print the address that
#   phones on the same Wi-Fi can open, for rehearsals. Trusted networks only: the local demo has no password.
set -euo pipefail
cd "$(dirname "$0")"
PORT=8000
HOST=127.0.0.1
if [ "${1:-}" = "--lan" ]; then KEYNECTION_LAN=1; fi
if [ "${KEYNECTION_LAN:-}" = "1" ]; then HOST=0.0.0.0; fi

command -v python3 >/dev/null || { echo "Python 3.12+ not found"; exit 1; }
command -v npm >/dev/null || { echo "Node.js 20+ not found"; exit 1; }

if [ ! -x backend/.venv/bin/python ]; then
  echo "[1/3] First run: setting up Python packages..."
  python3 -m venv backend/.venv
  backend/.venv/bin/python -m pip install -q -r backend/requirements.txt
fi
# Set up before the AI features or the digital keys came: add the new packages.
backend/.venv/bin/python -c "import anthropic, webauthn, google.genai" 2>/dev/null || backend/.venv/bin/python -m pip install -q -r backend/requirements.txt
if [ ! -d frontend/node_modules/@simplewebauthn/browser ]; then
  echo "[2/3] Installing web packages..."
  npm --prefix frontend install --no-fund --no-audit
fi
echo "[3/3] Building the app..."
npm --prefix frontend run build --silent

# Something already listening on the port (usually a demo left running): say so plainly.
if command -v lsof >/dev/null && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Is another Keynection still running? Stop it (lsof -nP -iTCP:$PORT -sTCP:LISTEN shows it) and run this again."
  exit 1
fi

echo "Running at http://localhost:$PORT (Ctrl+C to stop)"
if [ "${KEYNECTION_LAN:-}" = "1" ]; then
  echo "Phones on this Wi-Fi can open:"
  if command -v ipconfig >/dev/null; then  # macOS
    for dev in en0 en1; do ip=$(ipconfig getifaddr "$dev" 2>/dev/null || true); [ -n "$ip" ] && echo "    http://$ip:$PORT"; done
  elif command -v hostname >/dev/null; then  # Linux
    for ip in $(hostname -I 2>/dev/null || true); do echo "    http://$ip:$PORT"; done
  fi
  echo "(the local demo has no password, so use a trusted network)"
fi
if [ -z "${KEYNECTION_NO_BROWSER:-}${JIRAN_NO_BROWSER:-}" ]; then
  (sleep 4; (command -v open >/dev/null && open "http://localhost:$PORT") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT") || true) &
fi
exec backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host "$HOST" --port "$PORT"
