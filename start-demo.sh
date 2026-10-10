#!/usr/bin/env bash
# Keynection demo for macOS/Linux: sets itself up on first run, then serves everything on http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")"

command -v python3 >/dev/null || { echo "Python 3.12+ not found"; exit 1; }
command -v npm >/dev/null || { echo "Node.js 20+ not found"; exit 1; }

if [ ! -x backend/.venv/bin/python ]; then
  echo "[1/3] First run: setting up Python packages..."
  python3 -m venv backend/.venv
  backend/.venv/bin/python -m pip install -q -r backend/requirements.txt
fi
# Set up before the AI features came: add the one new package.
backend/.venv/bin/python -c "import anthropic" 2>/dev/null || backend/.venv/bin/python -m pip install -q -r backend/requirements.txt
if [ ! -d frontend/node_modules ]; then
  echo "[2/3] First run: installing web packages..."
  npm --prefix frontend install --no-fund --no-audit
fi
echo "[3/3] Building the app..."
npm --prefix frontend run build --silent

echo "Running at http://localhost:8000 (Ctrl+C to stop)"
if [ -z "${JIRAN_NO_BROWSER:-}" ]; then
  (sleep 4; (command -v open >/dev/null && open http://localhost:8000) || (command -v xdg-open >/dev/null && xdg-open http://localhost:8000) || true) &
fi
exec backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
