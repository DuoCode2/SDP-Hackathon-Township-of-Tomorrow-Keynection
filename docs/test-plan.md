# Manual test plan: the judge route and the safety boundaries

> **给队员的中文摘要**：这是人能读的测试清单，和 `evidence/device-check/README.md` 用同一套编号（K00–K15 是评审 3 分钟路线，每一步一条；K16–K21 是六条安全边界；K22–K23 是没开 AI 时的替代走法和共用演示的自动重置）。每一条写明怎么做、应该看到什么、在哪台设备核对过。评审看不懂 333 个自动测试，但看得懂这一页。做法：开始前清掉浏览器里这个网站的储存资料（或用无痕模式），这样看到的才是评审第一眼的样子。

Keynection has 333 automated server tests (`testing-overview.md`). This page is the part a person walks through: the 3-minute judge route step by step, then the boundaries that protect residents. The numbering is shared with the real-device record in `evidence/device-check/README.md`, so one table serves both.

## Before you start

- **Where**: the online demo https://keynection.onrender.com (shared password, given privately), or locally with `start-demo.bat` (http://localhost:8000). Locally, AI screens can be checked without a key using the stand-in server (`.claude/launch.json` → `keynection-ai-standin`, port 8030; answers are marked `[stand-in]`).
- **Clean start**: clear this site's storage in the browser (or use a private window) so the welcome card and the guide appear as a judge sees them.
- **Shared demo**: the online demo is one database for everyone. After 20 quiet minutes it starts over by itself; a wave counts as "already waved" for 5 minutes; daily caps are ten times a pilot's. If a step still says it was already done, press **Reset demo data** at the bottom of the SDP page (under "Show every feature").
- **Record**: for each ID write *Pass* or *Blocked (one line: where)*, the device, browser and date. Screenshots go to `evidence/device-check/` (phones) or `evidence/route-screenshots/` (desktop, scripted).

## A. The 3-minute judge route (K00–K15)

| ID | Where | Do | Expect |
|---|---|---|---|
| K00 | Open the URL | Enter the shared password | Trilingual password page → the app opens. Note how long the first open took |
| K01 | Neighbours, Aiman (No. 12) | Look at the home screen | A row of door avatars at the top; five neighbour cards: Siti (No. 11), Kumar (No. 13), Priya (No. 21), Hafiz (No. 22) and No. 23 shown by unit only ("not on Keynection yet"); a welcome card the first time |
| K02 | Neighbours | Press **👋 Wave** on Siti's card | A short celebration; the button changes to "waved today"; Siti's avatar ring turns green once she waves back later |
| K03 | Works → **Register renovation** | Type one sentence in "Just say it in one sentence" (e.g. *Retiling the master bathroom from next Monday for two weeks, weekdays 9 to 5*) → **Fill it in for me** | AI on: type of work, dates, hours and contractor are filled in, with one line saying why and what is still missing; approvals and the CIDB tick stay empty. AI off: the box is titled "Try an example"; tapping an example fills in a ready-made preset without AI, or the form is filled in by hand (see K22). Either is a pass; record which |
| K04 | Step 2, "Who is told" | Read the list and the plan | Every home in range is listed with the reason (shared wall, across the road…); No. 23 is marked for a paper notice; there is no way to remove a home |
| K05 | Step 3, "When" | Read the planned hours | "Noisy hours planned around the neighbours" with the hours (e.g. 11:00–17:00, quiet 13:00–15:00) and "avoids the quiet times of 2 homes"; whose is never shown; the owner keeps at least 4 hours a day; "Use my own hours" is available |
| K06 | Step 5, review → **Send** | Check the notice text, send | "Sent to N homes"; Works shows the renovation; the home screen shows the works badge; No. 23's copy appears at Front desk as a paper notice |
| K07 | Channels, Kumar (No. 13) | Switch the cast to Kumar (top bar) and open Channels | The WhatsApp phone shows the renovation notice **in Tamil**, including Aiman's description translated (AI on) or in English (AI off); below it two **Scheduled** reminders: photograph 3 days before, check the day after; the phone carries a "preview, nothing is sent" label |
| K08 | **Both sides** (top bar) | Turn it on | Aiman on the left, Siti on the right, a shared wall between. On a phone-width screen there is no split view: switch the cast instead and continue |
| K09 | Siti's Chats | Open Aiman's notice | The notice reads "Noisy hours planned around your quiet time" (Siti's baby nap, which she never had to mention) |
| K10 | Siti's Chats | Wave back, then type something sharp in Malay (e.g. *Rumah awak bising macam kilang! Tak reti hormat jiran ke?*) | AI on: a calmer wording is offered first; Siti chooses which to send. AI off: the message goes as written. An insult is refused either way, with no "send anyway": the word list always, the AI's own judgement when it is on |
| K11 | Aiman's Chats | Read the new message | Shown in English with "Translated by AI"; the original Malay appears on tap (AI off: original only). On Siti's side her message now carries two ticks (one tick until Aiman opened the thread) |
| K12 | Siti → Photos & repairs | **Use sample** (pre-work photo) → **Sample crack** | The follow-up photo is aligned and compared; the crack is boxed; the suggestion says the crack was there **before** the works, so it goes to the warranty, not to Aiman; no option is pre-selected |
| K13 | Impact (SDP) | Open the Impact model | The census question with Selangor 13.2% and Malaysia 6.5%; the state can be changed; every cost assumption is editable and labelled |
| K14 | Guide (top-right) | Open it, switch 中文 / English | The six route steps are listed and clickable; clicking one jumps to that screen and household; the AI on/off line is at the top |
| K15 | iPhone only | Share → Add to Home Screen → open from the icon | Opens full-screen, like an app |

## B. Safety boundaries (K16–K21)

These are what keep neighbours safe from each other and from the tool. Each is also covered by automated tests (file named).

| ID | Boundary | Do | Expect | Automated test |
|---|---|---|---|---|
| K16 | **Only the owner closes a warranty ticket** | Show every feature → Siti's Photos & repairs: record *Building defect* → SDP → Warranty: **Sample: poor patch** → back to Siti | SDP can submit a repair but has no Close button; the invented Procore number reads *PC-… (demo)* in SDP's queue and *Procore PC-… (demo number)* on Siti's card (in all three interface languages); Siti sees *Not fixed* / *Accept*; *Not fixed* reopens the ticket and the 30-day clock does **not** restart. Also walked by `e2e/warranty.spec.ts` | `test_talk.py`, `test_layers_2_4.py`, `test_procore.py` |
| K17 | **Beyond the five, unit numbers only** | Aiman → Neighbours → Map → tap No. 15 | Shown as "No. 15" with no name and no Message button; only **Request to connect** with a reason; after Nurul accepts (switch cast), the name appears | `test_rings.py` |
| K18 | **Insults are refused** | In any chat type an insult (the word list covers English and Manglish, Malay and Chinese: "stupid", "go die", "bodoh", "神经病"...) and send; with AI on, also abuse the list does not know (with the stand-in: "you people are hopeless") | Refused with a tone message and no "send anyway" button; nothing is delivered or logged as sent. A plain complaint ("my plants will die from the dust", "lampu mati") goes through | `test_hello_safety.py`, `test_talk.py`, `test_ai.py` |
| K19 | **Nobody is in Keynection without consent** | Aiman → Neighbours: look at No. 23 | Unit number only, no Message, no Wave; the renovation notice for No. 23 appears at Front desk as a **paper notice** in that home's language with English below | `test_join.py` |
| K20 | **The estate team sees only what neighbours escalate** | Siti → Raise a concern → send; SDP → Estate queue; then Siti escalates | The queue is empty while the concern is between the two homes; it appears only after Siti escalates; the estate team can remind or close, never read the private chat | `test_talk.py`, `test_staff_gating.py` |
| K21 | **The notice range is not the owner's choice** | Register renovation, step 2; then pick *Extension* and leave the council permit unset | No remove control on any listed home; with structural works and no approval the **Next/Send** button is disabled and "Approval first" is shown | `test_hello_safety.py`, `test_neighbours.py` |

In **pilot mode** (`KEYNECTION_DEMO_MODE=0`) two more boundaries apply that the demo cannot show, because the demo trusts the unit number in each request so that judges can switch roles: changing a unit number in a request gets nothing (`test_signin.py`), and every SDP screen needs a staff sign-in (`test_staff_gating.py`).

## C. Alternative paths and the shared demo (K22–K23)

| ID | Situation | Do | Expect |
|---|---|---|---|
| K22 | **AI is off** (no key on the server, or offline) | Walk K03, K07, K10, K11 | The guide's top line says AI is off; the three examples still fill the notice in (from a preset on the device, no AI call), or it is filled in step by step from the first card; typed words go as written; quick replies are still translated (they are pre-translated); nothing errors or hangs |
| K23 | **Shared demo starts over** (local check) | Start the server with `KEYNECTION_DEMO_IDLE_MINUTES=0.1`, wave at Siti, wait 10 s, reload | The wave is gone and the fictional phase is as seeded; a pilot server never does this (`test_shared_demo.py`) |

## D. Record

| Device (model, OS) | Browser | Date | Network | First open (s) | AI on? | K00 | K01 | K02 | K03 | K04 | K05 | K06 | K07 | K08 | K09 | K10 | K11 | K12 | K13 | K14 | K15 | K16 | K17 | K18 | K19 | K20 | K21 | K22 | K23 | Blocked where (one line) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Windows laptop, Chrome (scripted walk, local, stand-in AI) | Chromium | | local | – | stand-in | | | | | | | | | | | | | | | | – | | | | | | | | | |
| Android phone | | | | | | | | | | | | | | | | | | | | | – | | | | | | | | | |
| iPhone | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | |

The real-device rows are filled in by a teammate with the phones (see `evidence/device-check/README.md`); the scripted row is produced by `e2e/` (see `testing-overview.md`).
