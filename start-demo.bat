@echo off
REM Jiran5 demo: double-click to run. Sets itself up on first run, then serves everything on one port.
setlocal
cd /d "%~dp0"
title Jiran5 demo

echo.
echo  ==============================
echo   Jiran5 prototype - demo mode
echo  ==============================
echo.

where python >nul 2>nul || (echo  Python not found. Install Python 3.12 or newer, then run this again. & goto :fail)
where npm >nul 2>nul || (echo  Node.js not found. Install Node.js 20 or newer, then run this again. & goto :fail)

if not exist "backend\.venv\Scripts\python.exe" (
  echo  [1/3] First run: setting up Python packages ^(takes a few minutes^)...
  python -m venv "backend\.venv" || goto :fail
  "backend\.venv\Scripts\python.exe" -m pip install -q -r "backend\requirements.txt" || goto :fail
) else (
  echo  [1/3] Python packages ready
)

if not exist "frontend\node_modules" (
  echo  [2/3] First run: installing web packages...
  call npm --prefix frontend install --no-fund --no-audit || goto :fail
) else (
  echo  [2/3] Web packages ready
)

echo  [3/3] Building the app...
call npm --prefix frontend run build --silent || goto :fail

echo.
echo  Running at http://localhost:8000
echo  Keep this window open during the demo. Close it to stop.
echo.
if not defined JIRAN_NO_BROWSER start "" /b cmd /c "ping -n 5 127.0.0.1 >nul & start http://localhost:8000"
"backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
goto :eof

:fail
echo.
echo  Something went wrong. Read the messages above, or ask the team's developer.
pause
exit /b 1
