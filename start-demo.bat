@echo off
REM Keynection demo: double-click to run. Sets itself up on first run, then serves everything on one port.
REM   start-demo.bat --lan   (or set KEYNECTION_LAN=1 first): also listen on the local network and print the address
REM   that phones on the same Wi-Fi can open, for rehearsals. Trusted networks only: the local demo has no password.
setlocal
cd /d "%~dp0"
title Keynection demo
set "PORT=8000"
set "HOST=127.0.0.1"
if /i "%~1"=="--lan" set "KEYNECTION_LAN=1"
if "%KEYNECTION_LAN%"=="1" set "HOST=0.0.0.0"

echo.
echo  ==============================
echo   Keynection prototype - demo mode
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
REM Set up before the AI features or the digital keys came: add the new packages.
"backend\.venv\Scripts\python.exe" -c "import anthropic, webauthn, google.genai" 2>nul || (
  echo        Adding new packages ^(once^)...
  "backend\.venv\Scripts\python.exe" -m pip install -q -r "backend\requirements.txt" || goto :fail
)

if not exist "frontend\node_modules" (
  echo  [2/3] First run: installing web packages...
  call npm --prefix frontend install --no-fund --no-audit || goto :fail
) else if not exist "frontend\node_modules\@simplewebauthn\browser" (
  echo  [2/3] Adding new web packages ^(once^)...
  call npm --prefix frontend install --no-fund --no-audit || goto :fail
) else (
  echo  [2/3] Web packages ready
)

echo  [3/3] Building the app...
call npm --prefix frontend run build --silent || goto :fail

REM Something is already listening on the port (usually a demo window left open): say so plainly instead of
REM letting the server fail with a long Python error.
set "BUSY="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do if not defined BUSY set "BUSY=%%p"
if defined BUSY (
  echo.
  echo  Port %PORT% is already in use ^(process id %BUSY%^). Is another Keynection window still open?
  echo  Close it, or run:  taskkill /pid %BUSY% /f   and then double-click this file again.
  goto :fail
)

echo.
echo  Running at http://localhost:%PORT%
if "%KEYNECTION_LAN%"=="1" (
  echo  Phones on this Wi-Fi can open:
  for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=* delims= " %%b in ("%%a") do echo      http://%%b:%PORT%
  )
  echo  ^(the local demo has no password, so use a trusted network; Windows may ask to allow Python through the firewall^)
)
if defined ANTHROPIC_API_KEY (echo  AI translation and notice writing: on) else (echo  AI translation and notice writing: off - set ANTHROPIC_API_KEY to turn it on)
echo  Keep this window open during the demo. Close it to stop.
echo.
if not defined KEYNECTION_NO_BROWSER if not defined JIRAN_NO_BROWSER start "" /b cmd /c "ping -n 5 127.0.0.1 >nul & start http://localhost:%PORT%"
"backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir backend --host %HOST% --port %PORT%
goto :eof

:fail
echo.
echo  Something went wrong. Read the messages above, or ask the team's developer.
pause
exit /b 1
