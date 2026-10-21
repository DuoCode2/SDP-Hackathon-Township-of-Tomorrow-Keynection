// Starts the Keynection server for the scripted walk: the AI stand-in (no key, answers marked [stand-in]), demo mode,
// a fresh database in the system temp folder, no site password. Used by playwright.config.ts as the web server.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const backend = path.resolve(here, '..', 'backend')
const dist = path.resolve(here, '..', 'frontend', 'dist', 'index.html')
const port = process.env.KEYNECTION_E2E_PORT ?? '8031'

if (!existsSync(dist)) {
  console.error('frontend/dist is missing. Build the web app first: `npm run build` in prototype/frontend (or `npm run route:build` here).')
  process.exit(1)
}

// A fresh phase every run: the walk starts where a judge starts.
const data = path.join(tmpdir(), 'keynection-e2e')
rmSync(data, { recursive: true, force: true })
mkdirSync(data, { recursive: true })

const venv = process.platform === 'win32'
  ? path.join(backend, '.venv', 'Scripts', 'python.exe')
  : path.join(backend, '.venv', 'bin', 'python')
const python = existsSync(venv) ? venv : 'python'

const env = { ...process.env, KEYNECTION_DB_PATH: path.join(data, 'app.db'), KEYNECTION_DEMO_MODE: '1' }
delete env.KEYNECTION_SITE_PASSWORD
delete env.JIRAN_SITE_PASSWORD
delete env.ANTHROPIC_API_KEY  // the stand-in answers; no key is ever used here
delete env.GEMINI_API_KEY
// The assistant's voice has stand-ins too. KEYNECTION_E2E_REAL=1 (with KEYNECTION_VOICE_KEY) sends wake.spec.ts's
// recording and the spoken reply to the real gateway instead, a fraction of a cent per run; nothing else changes.
if (process.env.KEYNECTION_E2E_REAL !== '1') delete env.KEYNECTION_VOICE_KEY

const child = spawn(python, [path.join(backend, 'scripts', 'ai_standin_server.py'), backend, port], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill())
