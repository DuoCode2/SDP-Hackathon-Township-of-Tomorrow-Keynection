# How Keynection is tested

> **给队员的中文摘要**：测试分五层，底层是 437 个自动测试（后端，用 AI 替身，永远不连真的 AI），往上是前端的严格类型检查、浏览器自动走完评审路线并截图、人工按 `test-plan.md` 核对、真手机核对；每次推送到 GitHub 都自动跑前两层。最后一节老实写了还没测到的东西。**数字只在这里写一次**，README 和其他文件引用这一页。

```
                     ┌───────────────────────────┐
                     │  Real phones (Android, iOS) │  evidence/device-check/   ← pending, by a teammate
                     ├───────────────────────────┤
                     │  Manual plan K00–K23        │  docs/test-plan.md
                     ├───────────────────────────┤
                     │  Scripted browser walk      │  e2e/ (Playwright): the 6 judge steps, screenshots
                     ├───────────────────────────┤
                     │  Front end: strict types    │  npm run build (TypeScript strict, Vite)
                     ├───────────────────────────┤
                     │  437 server tests           │  backend/tests (pytest), ~3½ min, every push (CI)
                     └───────────────────────────┘
```

## Layer 1 — 437 automated server tests

`cd backend && .venv/Scripts/python -m pytest -q` — 437 collected, all passing on 22 Oct 2026 (about 3½ minutes on a laptop). Each test gets its own SQLite database in a temporary folder; the AI is a **stand-in** (`tests/conftest.py`), so no test ever reaches Anthropic or Google. The count below is what pytest collects (parametrised cases counted separately).

| What they protect | Files | Tests |
|---|---|---|
| **Plain rules** — noisy hours planned around quiet times (owner keeps ≥ 4 h, inside the council's hours, private, capped), two-sided works, reminders; triage by time order with reason codes; three layers of neighbours and notice ranges; the house behind a terrace told about wet, hacking and structural works; phase setup from a site plan; photo alignment and change detection; the home-log hash chain under concurrent writes | `test_quiet.py`, `test_triage.py`, `test_neighbours.py`, `test_rings.py`, `test_vision.py`, `test_ledger.py`, `test_pilot_phase.py` | 17 + 7 + 6 + 16 + 11 + 4 + 17 = **78** |
| **Who may do what** — only owners close tickets, only recipients report, only raisers escalate; residents can't record an inspector's finding; blocks, quiet mode, daily caps; staff screens closed without staff sign-in; nobody writes to a home log by hand; in a pilot the server decides identity on every household endpoint; the site password gate and its one-click link (`/?key=…`: the key is taken out of the address bar and out of the server's log); PDPA deletion, closure, backups | `test_decisions.py`, `test_hello_safety.py`, `test_talk.py`, `test_layers_2_4.py`, `test_staff_gating.py`, `test_signin.py`, `test_site_gate.py`, `test_privacy.py`, `test_care.py` | 13 + 11 + 26 + 14 + 12 + 13 + 23 + 13 + 13 = **138** |
| **Languages** — quick replies and notices in English, Malay, Chinese and Tamil; dates and hours written per reader; every server-generated line carries a code so the screen can show it in the reader's language | `test_keynection.py`, `test_codes.py`, `test_reader_language.py` (the estate notices and the neighbours' bios in every reading language, the team's wording for the demo cast and the AI's for new text, the screen language override; every refusal from the server as a code with its values, and a cross-check that the app has wording for each code), `test_talk.py` (shared above) | 11 + 11 + 11 = **33** |
| **AI, with the stand-in** — one sentence → notice fields, rule-breaking answers dropped; translation and calmer wording per reader; an insult refused outright, on the word list or on Claude's own judgement, with no "send anyway"; no key / no answer / network down → everything works as before; daily allowance; only the text leaves; the official SDK is exercised with the network swapped out; Gemini is demo-only, and a 503 is tried once more; the assistant reads one sentence into one of six intents and its fields, answers house-rule questions from a fixed text, counts status lines on the server, falls back to key words without AI, keeps the last six turns as history, and sends only the household's own records and its neighbours' unit numbers; the assistant's voice through the gateway — a short real recording is passed on and dropped, Malay and Chinese asked for by Deepgram's own detect_language, only English replies are spoken and cut at a sentence, the same reply from memory, daily allowances per home, the key never logged, off in a pilot | `test_ai.py`, `test_assistant.py`, `test_voice.py` | 35 + 19 + 34 = **88** |
| **Pilot mode** — passkey sign-in, re-entry codes, CSV import that refuses a bad row, welcome packs, push subscriptions and encryption, Procore export, the first staff member, start-up self-checks, no rebuild of a pilot's data | `test_signin.py` (above), `test_pilot_setup.py`, `test_pilot_data.py`, `test_procore.py`, `test_push.py`, `test_join.py` | 7 + 6 + 7 + 10 + 13 = **43** |
| **Demo and surface** — waves, reactions, voice notes, profiles, the official account; evidence API; the shared demo that starts over after a quiet spell with loosened caps; old `JIRAN_` names still working; health check, naming the deployed commit; `.env.example` complete and honest | `test_social.py`, `test_evidence_api.py`, `test_shared_demo.py`, `test_rename.py`, `test_api.py`, `test_deploy_version.py`, `test_env_example.py` | 15 + 16 + 8 + 6 + 6 + 2 + 4 = **57** |
| | **Total (34 files)** | **437** |

Three files answer the question judges ask most, "who is stopped from doing what": `test_staff_gating.py` (every SDP screen closes without a staff sign-in; nobody can write to a home log directly), `test_decisions.py` (propose, agree, disagree, inspector: who may take each step), `test_hello_safety.py` (blocks, quiet mode, tone, contact details, daily caps, approvals before structural works).

Three tests were written after our own security review, each named for the problem it prevents: the demo's trust in a self-reported unit number stops at the pilot boundary (`test_signin.py`); SDP can submit a repair but never close a ticket (`test_talk.py`); the second layer never reveals a name before a request is accepted (`test_rings.py`).

## Layer 2 — front end

`cd frontend && npm run build` compiles the app with TypeScript in strict mode; a type error fails the build. There are no front-end unit tests: the screens are checked by the scripted walk and the manual plan instead. The bundle is about 740 KB (233 KB gzipped), fonts and icons included, so the demo runs with no network.

## Layer 3 — scripted browser walk

`e2e/` holds ten Playwright scripts (seventeen tests) against the server with the AI stand-in, in a desktop browser at 1920×1080, each starting from the fictional phase as seeded (how to run them: `e2e/README.md`):

- `route.spec.ts` walks the six steps of the judge route (K01–K14, fourteen checks) and saves a screenshot per step to `evidence/route-screenshots/` (17 frames, about 20 seconds). The screenshots go into the deck and the appendix.
- `warranty.spec.ts` walks K16: a building-defect decision, SDP's repair, the owner sending it back and accepting a proper one; checks that SDP has no Close button and that the demo's invented Procore number is marked as such in all three interface languages (three more frames).
- `bothsides.spec.ts` walks a case in split view: Siti asks Aiman to confirm, and the case Aiman already has open shows the question with no reopening; Aiman agrees, and Siti's open case shows the decision the same way (the Evidence screen re-reads its open case after every reload).
- `monkey.spec.ts` makes 250 random clicks and keystrokes across every screen (seed printed, repeatable with `MONKEY_SEED`) and fails on any uncaught error, 5xx answer or the error boundary appearing; the app's own refusals (a second wave today, an insult, a cap) are allowed.
- `a11y.spec.ts` checks that every button on the route has a name a screen reader can say (an aria-label, visible text or an image's alt; a title alone does not count), on a desktop and at phone width where the top bar keeps only icons, and inside the renovation form, a chat thread and the split view.
- `audit.spec.ts` is read-only: it counts the solid primary buttons and the rubber stamps on each screen and prints a table for a person to judge (one primary button per screen is the rule; the result is in `reports/主按钮与印章检查_2026-10-17.md`).
- `ai-off.spec.ts` walks K22's renovation notice with the page told AI is off: a terrace starts on the first card (wet work), the box is titled "Try an example", and the Malay example fills in a ready-made preset on the device with no AI call, so Send notice is reached without touching an approval.
- `assistant.spec.ts` (two tests) types into the assistant and checks that a renovation sentence opens the notice with the words in it and a status question gets an answer, with AI off and with the AI not answering; neither ever sends a notice or a message.
- `opening.spec.ts` (two tests) walks the demo's key-day opening (the welcome-pack card, who you are, the five homes lighting up) on a laptop and at phone width, and checks Skip.
- `wake.spec.ts` (six tests) runs the real wake-word engine with Chrome's fake microphone playing a recording (`fixtures/`): hands-free turned on from the chat's own offer, "Hello Neighbour" opens the assistant and the question after it is asked and its reply spoken, then a follow-up is heard without the wake word and after silence the wake word listens again; near misses never open it over 25 seconds while it keeps hearing, and out of sight it lets go of the microphone; a browser without its own listening sends the recording to the server and gets words back; holding the mic asks what was said, a typed question stays quiet, a reply is read aloud and stopped; an engine download cut half way is fetched once more; and hands-free switched off while the browser is still asking for the microphone lets go of the microphone the moment it is granted. `KEYNECTION_E2E_REAL=1` or `E2E_BASE_URL` runs it against the real gateway or a deployed site.

Last full run 21 Oct 2026: all seventeen tests in the ten scripts passing, no browser console errors. They read the text on screen (button labels, headings) rather than test hooks, so a renamed button fails a walk on purpose.

## Layer 4 — manual plan

`docs/test-plan.md`: K00–K15 the judge route, K16–K21 the safety boundaries, K22–K23 the AI-off path and the shared-demo reset. Walked on a laptop before each submission; the table records device, date and result.

## Layer 5 — real phones

`evidence/device-check/README.md`: the same K-numbers on an Android phone and an iPhone against the online demo, with a screenshot per step and "Add to Home Screen" on the iPhone. **Pending** — needs two phones and a teammate.

## Continuous integration

`.github/workflows/ci.yml` runs layers 1 and 2 on every push to `main` and on every pull request (Python 3.13, Node 24, the same pinned versions as the laptops). It cannot stop Render from deploying a broken push (Render deploys on commit), but it tells us within minutes.

## Verified by hand, outside the layers

- The error boundary (a screen that throws shows "Something went wrong on this screen" in three languages with a Reload button, nothing lost on the server): verified locally on 17 Oct 2026 by throwing on purpose, then removing the throw.
- The shared demo's reset: verified locally with `KEYNECTION_DEMO_IDLE_MINUTES=0.1`.
- `start-demo.bat`: the "port 8000 already in use" message (with the process id) and the `--lan` option (prints the Wi-Fi address; the health check answered on it) were both run by hand on 17 Oct 2026. `start-demo.sh` has the same two changes, checked for syntax only (no Mac here).
- `.env.example` is kept complete by `test_env_example.py`: every setting the code or the deployment files read is listed, nothing else is, and each has a line saying what it does.
- Pilot mode sign-in with a passkey, the CSV import and the Procore export: verified in a local browser in pilot mode (`keynection-pilot`, `keynection-procore-check` in `.claude/launch.json`).

## Not covered yet (honest list)

| Gap | Why | Plan |
|---|---|---|
| A real push notification on a real phone | Needs a deployed pilot server with its own address | First week of a pilot |
| The real AI with a real key | Tests use the stand-in. Walked locally with Claude Haiku 5.5 on 20 Oct 2026 (notice draft, chat check, notice translation, every assistant intent); the online demo runs Claude Sonnet 5.5 (`ANTHROPIC_API_KEY` set on Render on 21 Oct 2026) | Walk the route once online after every deploy |
| WhatsApp delivery | Simulated on purpose; needs SDP's WhatsApp Business account | Templates ready in `docs/whatsapp-templates.md` |
| Tamil wording | Written with AI help | A native speaker's review before a pilot |
| Load and many users at once | One SQLite file, one worker, one township | Fine for a pilot phase; measured if it grows |
| Screen-reader accessibility | Icon buttons in the top bar lack names | After the shortlist |
