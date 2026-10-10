@echo off
REM Keynection development: backend with auto-reload on :8000 and the Vite dev server on :5173, in two windows.
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo Run start-demo.bat once first to install everything.
  pause
  exit /b 1
)
"backend\.venv\Scripts\python.exe" -c "import anthropic, webauthn" 2>nul || "backend\.venv\Scripts\python.exe" -m pip install -q -r "backend\requirements.txt"
if not exist "frontend\node_modules\@simplewebauthn\browser" call npm --prefix frontend install --no-fund --no-audit

start "Keynection API :8000" cmd /k ""backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload --reload-dir backend\app"
start "Keynection web :5173" cmd /k "npm --prefix frontend run dev"
if not defined JIRAN_NO_BROWSER start "" /b cmd /c "ping -n 7 127.0.0.1 >nul & start http://localhost:5173"
