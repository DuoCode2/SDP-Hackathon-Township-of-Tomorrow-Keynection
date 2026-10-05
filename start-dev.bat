@echo off
REM Jiran5 development: backend with auto-reload on :8000 and the Vite dev server on :5173, in two windows.
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo Run start-demo.bat once first to install everything.
  pause
  exit /b 1
)

start "Jiran5 API :8000" cmd /k ""backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload --reload-dir backend\app"
start "Jiran5 web :5173" cmd /k "npm --prefix frontend run dev"
if not defined JIRAN_NO_BROWSER start "" /b cmd /c "ping -n 7 127.0.0.1 >nul & start http://localhost:5173"
