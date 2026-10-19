# How Keynection is tested

> **给队员的中文摘要**：测试分五层，底层是 333 个自动测试（后端，用 AI 替身，永远不连真的 AI），往上是前端的严格类型检查、浏览器自动走完评审路线并截图、人工按 `test-plan.md` 核对、真手机核对；每次推送到 GitHub 都自动跑前两层。最后一节老实写了还没测到的东西。**数字只在这里写一次**，README 和其他文件引用这一页。

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
                     │  333 server tests           │  backend/tests (pytest), ~2½ min, every push (CI)
                     └───────────────────────────┘
```

## Layer 1 — 333 automated server tests

`cd backend && .venv/Scripts/python -m pytest -q` — 333 collected, all passing on 17 Oct 2026 (about 2 minutes on a laptop). Each test gets its own SQLite database in a temporary folder; the AI is a **stand-in** (`tests/conftest.py`), so no test ever reaches Anthropic or Google. The count below is what pytest collects (parametrised cases counted separately).

| What they protect | Files | Tests |
|---|---|---|
| **Plain rules** — noisy hours planned around quiet times (owner keeps ≥ 4 h, inside the council's hours, private, capped), two-sided works, reminders; triage by time order with reason codes; three layers of neighbours and notice ranges; phase setup from a site plan; photo alignment and change detection; the home-log hash chain under concurrent writes | `test_quiet.py`, `test_triage.py`, `test_neighbours.py`, `test_rings.py`, `test_vision.py`, `test_ledger.py`, `test_pilot_phase.py` | 15 + 7 + 5 + 16 + 11 + 4 + 16 = **74** |
| **Who may do what** — only owners close tickets, only recipients report, only raisers escalate; residents can't record an inspector's finding; blocks, quiet mode, daily caps; staff screens closed without staff sign-in; nobody writes to a home log by hand; in a pilot the server decides identity on every household endpoint; the site password gate; PDPA deletion, closure, backups | `test_decisions.py`, `test_hello_safety.py`, `test_talk.py`, `test_layers_2_4.py`, `test_staff_gating.py`, `test_signin.py`, `test_site_gate.py`, `test_privacy.py`, `test_care.py` | 10 + 11 + 21 + 14 + 12 + 13 + 13 + 12 + 13 = **119** |
| **Languages** — quick replies and notices in English, Malay, Chinese and Tamil; dates and hours written per reader; every server-generated line carries a code so the screen can show it in the reader's language | `test_keynection.py`, `test_codes.py`, `test_talk.py` (shared above) | 11 + 11 = **22** |
| **AI, with the stand-in** — one sentence → notice fields, rule-breaking answers dropped; translation and calmer wording per reader; an insult refused outright, on the word list or on Claude's own judgement, with no "send anyway"; no key / no answer / network down → everything works as before; daily allowance; only the text leaves; the official SDK is exercised with the network swapped out; Gemini is demo-only, and a 503 is tried once more | `test_ai.py` | **30** |
| **Pilot mode** — passkey sign-in, re-entry codes, CSV import that refuses a bad row, welcome packs, push subscriptions and encryption, Procore export, the first staff member, start-up self-checks, no rebuild of a pilot's data | `test_signin.py` (above), `test_pilot_setup.py`, `test_pilot_data.py`, `test_procore.py`, `test_push.py`, `test_join.py` | 7 + 6 + 7 + 10 + 13 = **43** |
| **Demo and surface** — waves, reactions, voice notes, profiles, the official account; evidence API; the shared demo that starts over after a quiet spell with loosened caps; old `JIRAN_` names still working; health check; `.env.example` complete and honest | `test_social.py`, `test_evidence_api.py`, `test_shared_demo.py`, `test_rename.py`, `test_api.py`, `test_env_example.py` | 14 + 13 + 8 + 6 + 5 + 4 = **50** |
| | **Total (30 files)** | **339** |

Three files answer the question judges ask most, "who is stopped from doing what": `test_staff_gating.py` (every SDP screen closes without a staff sign-in; nobody can write to a home log directly), `test_decisions.py` (propose, agree, disagree, inspector: who may take each step), `test_hello_safety.py` (blocks, quiet mode, tone, contact details, daily caps, approvals before structural works).

Three tests were written after our own security review, each named for the problem it prevents: the demo's trust in a self-reported unit number stops at the pilot boundary (`test_signin.py`); SDP can submit a repair but never close a ticket (`test_talk.py`); the second layer never reveals a name before a request is accepted (`test_rings.py`).

## Layer 2 — front end

`cd frontend && npm run build` compiles the app with TypeScript in strict mode; a type error fails the build. There are no front-end unit tests: the screens are checked by the scripted walk and the manual plan instead. The bundle is about 740 KB (233 KB gzipped), fonts and icons included, so the demo runs with no network.

## Layer 3 — scripted browser walk

`e2e/` holds five Playwright scripts against the server with the AI stand-in, in a desktop browser at 1920×1080, each starting from the fictional phase as seeded (how to run them: `e2e/README.md`):

- `route.spec.ts` walks the six steps of the judge route (K01–K14, fourteen checks) and saves a screenshot per step to `evidence/route-screenshots/` (17 frames, about 20 seconds). The screenshots go into the deck and the appendix.
- `warranty.spec.ts` walks K16: a building-defect decision, SDP's repair, the owner sending it back and accepting a proper one; checks that SDP has no Close button and that the demo's invented Procore number is marked as such in all three interface languages (three more frames).
- `bothsides.spec.ts` walks a case in split view: Siti asks Aiman to confirm, and the case Aiman already has open shows the question with no reopening; Aiman agrees, and Siti's open case shows the decision the same way (the Evidence screen re-reads its open case after every reload).
- `monkey.spec.ts` makes 250 random clicks and keystrokes across every screen (seed printed, repeatable with `MONKEY_SEED`) and fails on any uncaught error, 5xx answer or the error boundary appearing; the app's own refusals (a second wave today, an insult, a cap) are allowed.
- `a11y.spec.ts` checks that every button on the route has a name a screen reader can say (an aria-label, visible text or an image's alt; a title alone does not count), on a desktop and at phone width where the top bar keeps only icons, and inside the renovation form, a chat thread and the split view.
- `audit.spec.ts` is read-only: it counts the solid primary buttons and the rubber stamps on each screen and prints a table for a person to judge (one primary button per screen is the rule; the result is in `reports/主按钮与印章检查_2026-10-17.md`).

First run 17 Oct 2026: all three passing, no browser console errors. They read the text on screen (button labels, headings) rather than test hooks, so a renamed button fails a walk on purpose.

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
| The real AI with a real key | Tests use the stand-in; the online demo's key is not set yet | Walk the route once with the key set (Gemini for the demo, Claude by design) |
| WhatsApp delivery | Simulated on purpose; needs SDP's WhatsApp Business account | Templates ready in `docs/whatsapp-templates.md` |
| Tamil wording | Written with AI help | A native speaker's review before a pilot |
| Load and many users at once | One SQLite file, one worker, one township | Fine for a pilot phase; measured if it grows |
| Screen-reader accessibility | Icon buttons in the top bar lack names | After the shortlist |
