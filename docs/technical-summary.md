# Technical summary

> **给队员的中文摘要**：给评审（SDP 数码团队）看的三页技术摘要：架构一张图、四个状态机（不满阶梯、案件决定、保修单、联系请求）、权限表（谁能看、谁能做）、资料去向，以及前十条已知限制和试点怎么补。README 是给团队的中文长文，这一页是英文的浓缩版，不重复 README。

## 1. Architecture

```
  Resident's phone / laptop                       One container (Render, Singapore; or any Docker host)
  ┌──────────────────────────┐    HTTPS           ┌───────────────────────────────────────────────────┐
  │ React 19 + TypeScript    │ ────────────────▶  │ FastAPI (Python 3.13), one worker                  │
  │ (Vite build, no UI kit,  │  JSON over /api    │  ├─ rules: neighbours · quiet · triage · vision    │
  │ fonts and icons bundled) │ ◀────────────────  │  │          ledger · planner · talk · privacy      │
  │ 3 interface languages    │                    │  ├─ auth (passkeys) · push (web push) · backup     │
  │ add to Home Screen       │                    │  └─ ai: Claude (design) / Gemini (demo only)       │
  └──────────────────────────┘                    │ SQLite (34 tables) + photo files on one disk       │
                                                  └───────────────────────────────────────────────────┘
       Outside the box, optional: Anthropic or Google (AI text only) · Google/Apple push services (encrypted
       alerts) · SDP's WhatsApp Business account (pilot) · Procore (export file today, API later)
```

- **One codebase, two modes.** Demo mode (judges): cast switcher, guide, sample photos, reset; the server trusts the unit number in a request. Pilot mode (`KEYNECTION_DEMO_MODE=0`): passkey sign-in, the server decides identity on every request, no fictional data, no reset.
- **No network needed to demo.** Fonts, icons and QR generation are bundled; the AI is optional and the app works without it.
- **Sizes.** 103 API endpoints, 34 tables, 17 screens, about 740 KB of front-end bundle (233 KB gzipped), 326 server tests.
- **Why SQLite and one container.** A pilot is one phase on one server; backups are a file copy; SDP IT can run it with Docker in an afternoon (`docs/pilot-deployment.md`). It is not built for many townships on one database, and says so.

## 2. Four state machines

Every transition is checked on the server (who may take it, in which state) and written to both households' home logs.

**Concern ladder** (`concerns.status`)

```
 open ──(renovating owner replies)──▶ acknowledged ──(raiser: sorted)──▶ resolved
  │                                        │
  └──(raiser, after 24 h in a pilot)──▶ escalated ──(estate: remind ×n)──▶ escalated
                                           └──(estate: close)──▶ closed_by_estate
```
The estate team sees a concern only once it is `escalated`; the private chat stays private.

**Case decision** (`incidents.status`)

```
 open ─┬─(reporter: building defect)──────────────────▶ decided  + warranty ticket opened
       ├─(reporter: ask an SDP inspector)──────────────▶ decided  (inspector asked; residents can't record a finding)
       ├─(reporter: nothing to do)─────────────────────▶ decided
       └─(reporter: caused by the renovation)──▶ proposed ─┬─(other side agrees)──▶ decided
                                                           └─(other side disagrees)──▶ disputed → only inspector / warranty / nothing remain
```
A change photographed before the works can never be proposed as "caused by the renovation"; nothing is pre-selected.

**Warranty ticket** (`warranty_tickets.status`)

```
 open ──(SDP submits a repair, photo compared with the pre-work photo)──▶ repair_submitted ──(owner accepts)──▶ closed
  ▲                                                                              │
  └──────────────────────(owner: not fixed; reopen_count + 1; the 30-day clock does not restart)──┘
```
Only the owner closes. The clock follows HDA Schedules G/H: 24-month defect liability, 30 days from written notice.

**Contact request** (`contact_requests.status`)

```
 pending ──(the other home accepts)──▶ accepted   (name shown, chat opens)
    └─────(declines)────────────────▶ declined   (no new request to that home)
```

Also: reports `open → warned | dismissed`; paper notices `to_print → printed → delivered` (or `superseded` by a newer notice); contractor passes `active → revoked` (switched off in the demo).

## 3. Who may see and do what

| Actor | Sees | Does | Never |
|---|---|---|---|
| **Household (owner)** | Its five homes by name; layer 2 by unit; its own chats, photos, cases, tickets, home log | Wave, hello, chat, register a renovation, set quiet times, seal photos, decide a case, close its own ticket, raise and escalate its own concern, block, report, download its data, close its account | Remove a home from a notice; record an inspector's finding; close another home's ticket; see who talked to whom |
| **Family helper** | What the household sees | The same actions, each logged under the helper's name | Act for another household; use a name that looks like SDP, the estate or the police |
| **Neighbour in the circle** | The notice sent to it (hours, whether its quiet time was avoided), the sender's name | Reply, wave, raise a concern, seal its own photos | See the renovating owner's other chats or whose quiet times were used |
| **Layer-2 home** | Unit numbers | Send a contact request with a reason (3/day) | See a name before acceptance; message directly |
| **Home not on Keynection** | — (receives a paper notice) | — | Appear by name anywhere |
| **Estate team (staff)** | Escalated concerns, notices it sent, the front desk, counts | Remind, close an escalated concern, send notices, issue join codes, print and log paper notices, register a renovation on paper | Read private chats; close a warranty ticket; see non-escalated concerns |
| **Warranty / safety staff** | Tickets; reported messages (and a reported voice note) | Submit a repair; warn a sender or dismiss a report; export to Procore | Close a ticket; see who reported |
| **Contractor pass (switched off)** | Works dates and hours | Show the QR at the guardhouse | See the owner's phone, neighbours' names, photos |
| **AI service** | The text being written (and a name or unit only if the writer typed it) | Return structured fields: notice draft, translation, calmer wording | See the directory, who writes to whom, or decide anything |

In the demo the household's identity is the unit number in the request (so judges can switch roles); in a pilot it is the passkey session, checked on every household endpoint (`test_signin.py`).

## 4. Data and where it goes

| Data | Stored | Leaves the server? | Kept |
|---|---|---|---|
| Names neighbours see, reading language, bio | SQLite | No | Until the household closes its account |
| Messages, voice notes | SQLite / files | Only the typed text, to the AI service, when AI is on | Voice 30 days; messages one year after the home's DLP ends (or one year after they were made, if later) |
| Photos | Files, re-encoded (no GPS, camera model, capture time) | No | Same as messages; photos inside a home are seen only by that home, staff and the other side of its case |
| Home log | SQLite, hash chain | No (a pilot adds an outside timestamp) | Stays with the unit |
| Push alerts | Encrypted per phone (RFC 8291) | Through Google's or Apple's push service, unreadable to them | — |
| SDP's handover list (pilot) | Unit, street, owner name, handover date | No; phone, e-mail and IC numbers are never imported | — |
| Counts for SDP | Derived | No | — |

## 5. Known limitations (top 10) and the pilot fix

| # | Limitation | What it means for the judges | Pilot fix |
|---|---|---|---|
| 1 | The demo trusts the unit number in a request | The online demo holds fictional data only | Pilot mode: passkey sign-in, server-decided identity (built) |
| 2 | The home log is kept and checked by the same server | It catches a silent edit, not a full rewrite or a dropped last entry | Signed receipts to the owner; a daily outside timestamp |
| 3 | A photo proves its upload time, not its capture time | An old photo could pose as a pre-work photo | In-app camera only; the renovating owner confirms the pre-work photo |
| 4 | Triage looks at time order only | It can rule a cause out, not prove one | An SDP inspector role records the finding |
| 5 | One shared-wall photo is not enough | Ceilings, floors, fences and drains are affected too | A photo checklist per type of work |
| 6 | The council's working hours vary by local authority; public holidays are not known | The prototype uses Mon–Sat 9–6 everywhere | Set per township; a holiday calendar |
| 7 | AI translation and the "heated" judgement can be wrong, especially in mixed Malaysian speech | Every translation is marked, the original is one tap away, the calmer wording is only a suggestion | A native speaker's review; a data-processing agreement or Claude on SDP's own cloud |
| 8 | WhatsApp, the CIDB check, the demo's Procore number and the guardhouse scan are simulated | Labelled on screen | SDP's WhatsApp Business account; CIDB's registry; Procore API access |
| 9 | Tamil was written with AI help | The fourth reading language needs a human check | A native speaker before the pilot |
| 10 | Push notifications are built but unverified on a real phone | Needs a deployed pilot with its own address | First week of the pilot |

## 6. Settings that matter

| Setting | Demo | Pilot |
|---|---|---|
| `KEYNECTION_DEMO_MODE` | `1` (default) | `0` |
| `KEYNECTION_SITE_PASSWORD` | required online (three-language password page) | never |
| `KEYNECTION_ORIGIN` | — | the pilot's https address (passkeys are bound to it) |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | either (Gemini is demo-only) | Anthropic only |
| `KEYNECTION_DEMO_IDLE_MINUTES` | 20 (the shared demo starts over) | ignored |
| `KEYNECTION_FIRST_STAFF`, `KEYNECTION_BACKUP_DIR`, `KEYNECTION_PUSH_CONTACT` | — | see `docs/pilot-deployment.md` |
