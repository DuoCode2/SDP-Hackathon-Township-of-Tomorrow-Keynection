# What is live, what is simulated, what is pilot-only

> **给队员的中文摘要**：评审最怕把模拟的当真的讲。这一页把每个功能分成五级：真做（演示里就是真逻辑、真资料）、有金钥才开（AI）、模拟（画面全做、资料是假的、画面上有标签）、试点才开（做好了，要 `KEYNECTION_DEMO_MODE=0`，本机和测试验证过、还没在部署好的试点上跑过）、收起来（做好了但演示里隐藏）、还没做。画面上怎么标也写明了。

| Status | Meaning |
|---|---|
| **Live** | Real logic and real data in the demo; what you click is what the server did |
| **Live with a key** | Real when the server has an AI key (`ANTHROPIC_API_KEY`, or `GEMINI_API_KEY` for the demo only); without one the same screens work by hand |
| **Simulated** | The screen is built, the data behind it is invented or a stand-in, and the screen says so |
| **Pilot-only** | Built and tested, switched on by `KEYNECTION_DEMO_MODE=0`; verified in a local browser and by automated tests, not yet on a deployed pilot |
| **Switched off** | Built and tested, hidden in the demo on purpose |
| **Not built** | Named in the plan, not in the code |

## Main story (the 3-minute route)

| Feature | Status | On screen | To go live in a pilot |
|---|---|---|---|
| Five homes beside and opposite, from the site plan (terrace and apartment), three layers | Live | Neighbours, Map | — |
| 👋 Wave, hello (Introduce yourself), one-to-one chat, reactions, voice notes | Live | Neighbours, Chats | — |
| Quick replies pre-translated into English, Malay, Chinese, Tamil | Live | Chats | Native speaker's review of Tamil |
| Renovation notice: type of work → who is told (not the owner's choice) → hours → approvals → review | Live | Works → Register renovation | — |
| Noisy hours planned around neighbours' private quiet times; two-sided works warning | Live (plain rules, no AI) | Step 3 "When"; Neighbours → Your quiet times | — |
| One sentence → notice fields (type of work, dates, hours, contractor), approvals never filled by AI | Live with a key | Step 1 "Just say it in one sentence" | A key on the server; a data-processing agreement for a pilot |
| Typed words arrive in the reader's language; calmer wording offered when heated | Live with a key | Chats, notices; "Translated by AI" | Same |
| Obvious insults refused (word list) | Live | Chats | — |
| Pre-work photo sealed (fingerprint, metadata stripped); follow-up aligned and compared; change boxed | Live (computer vision: OpenCV alignment and a darkening rule, not machine learning) | Photos & repairs | In-app camera only, so a gallery photo can't pass as new |
| Triage suggestion by time order; decision by people, nothing pre-selected | Live | Photos & repairs → case | A real inspector role |
| Warranty ticket with the HDA clock (24 months, 30 days); only the owner closes | Live | Photos & repairs; SDP → Warranty | Written-notice step agreed with SDP |
| Home log as a hash chain, "Chain checked" | Live (checked by the same server) | Home log | Signed receipts to the owner and a daily outside timestamp |
| Impact model on the 2020 census question; cost model with editable assumptions | Live (the census figure is real; cost figures are assumptions, labelled) | Impact | Measure in the pilot |
| Command view counts (joined, know a neighbour, pre-work photo coverage, concerns settled by neighbours…) | Live, counts only | SDP | — |
| Channels: step one (welcome-pack code, phone browser, WhatsApp) and step two (SDP App module) | Explained on screen | Channels | Step two needs SDP's app team |
| **WhatsApp phone** | **Simulated** — the text is generated from real data in the reader's language, nothing is sent | Label on the phone: *Step one · preview, nothing is sent* | SDP's WhatsApp Business account; templates ready in `docs/whatsapp-templates.md` |
| **SDP App phone** | **Simulated** — an illustrative layout, not SDP's actual app | Label: *Step two · illustration* | SDP's app team |
| **Scheduled reminders** (photograph 3 days before; check the day after) | **Simulated** in the demo (shown on the WhatsApp preview); real as push notifications in a pilot | "Scheduled" tag on the preview | A deployed pilot |
| Guide panel with the two routes, AI on/off line, "Show every feature" | Live (demo tool) | Top-right | Not shown in a pilot |
| Shared demo: starts over after 20 quiet minutes; daily caps loosened | Live (demo only) | Guide's top line | A pilot never resets |
| Error boundary (no blank page on a screen error) | Live | Only if a screen throws | — |

## Under "Show every feature"

| Feature | Status | On screen | To go live |
|---|---|---|---|
| Concern ladder: neighbour → renovating owner → estate team; estate sees only escalated concerns | Live | Chats → Raise a concern; SDP → Estate | The 24-hour wait before escalating is on in a pilot, off in the demo |
| Report a message; silent block; phone numbers exchanged only when both agree | Live | Chats; SDP → Safety | — |
| Contact requests beyond the five (reason, 3 a day, no repeat after decline) | Live | Map → a layer-2 home | — |
| Estate notices to a street, a block or the phase (read-only official account) | Live | Chats → Estate Office; SDP → Notices | — |
| Front desk: join codes, paper notices (printed, delivered, logged), renovation registered for an owner on paper | Live | SDP → Front desk | — |
| Easy mode; up to two family helpers; download my data (PDPA) | Live | Me | Helpers sign in with their own key |
| Phase setup from a site plan (lorongs, rows, blocks, floors) → circles and ranges in milliseconds, download by unit | Live (read-only, nothing stored) | Phase setup | Semi-D, shoplots and odd plots by the estate office |
| Safeguards: 14 risks, Built / Pilot per measure | Live (a list) | Safeguards | — |
| **CIDB registration check** | **Simulated** (a tick the owner makes; "simulated check in the prototype") | Step 4 | CIDB's registry |
| **Procore reference on a demo warranty ticket** | **Simulated** (PC-… invented in the demo only; the server says so with `procore_demo`) | Owner's card: *Procore PC-… (demo number)*; SDP's queue: *PC-… (demo)* | A pilot shows only the number SDP writes back, never marked |
| **Contractor QR passes and guardhouse scan** | **Switched off** (`SHOW_CONTRACTOR_PASSES` in `frontend/src/features.ts`; server and tests kept) | — | Estate systems already do this |

## Pilot-only (`KEYNECTION_DEMO_MODE=0`)

| Feature | Status | Verified how |
|---|---|---|
| Passkey sign-in for households and staff; the server decides identity on every request; re-entry codes for a lost phone | Pilot-only | `test_signin.py`; local browser (`keynection-pilot`) |
| Import a real phase from SDP's handover list (CSV), one bad row stops the import; welcome-pack cards for a whole phase | Pilot-only | `test_pilot_phase.py`, `test_pilot_data.py`; local browser |
| Push notifications (encrypted per phone; quiet 10 pm–7 am; never the words of a message) | Pilot-only | `test_push.py`; **not yet on a real phone** (needs a deployed pilot) |
| PDPA: retention and automatic deletion, name correction, account closure, daily backups kept 14 days | Pilot-only | `test_privacy.py`, `test_care.py` |
| Warranty tickets → Procore punch-list export; Procore number written back | Pilot-only | `test_procore.py`; local browser (`keynection-procore-check`) |
| Staff sign-in; every SDP screen closed without it; the first staff member from the server | Pilot-only | `test_staff_gating.py`, `test_pilot_setup.py` |
| One-click Render deployment (`render.yaml`), start-up self-checks, Pilot health card | Pilot-only | `docs/pilot-deployment.md`; not yet run on a real pilot host |

## Not built

| | Why not yet |
|---|---|
| WhatsApp sending | Needs SDP's own WhatsApp Business account and Meta's template approval |
| Procore API sync | Needs SDP's company and project IDs and API access; the export file works without it |
| In-app camera only; signed receipts and outside timestamps for the home log | Pilot hardening, listed under Safeguards → Pilot |
| A real SDP inspector role | Pilot |
| Tamil on every screen (Tamil is a reading language today) | Interface stays English / Malay / Chinese for the demo |
| Encryption at rest; an access log the household can see | Pilot |
| Translation of estate notices and concern notes | Known gap, new scope |
