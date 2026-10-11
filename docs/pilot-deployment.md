# Running a Keynection pilot

For SDP's IT team. The judges' demo stays as it is; a pilot is a **separate server in pilot mode**
(`JIRAN_DEMO_MODE=0`) with an empty database. Everyone signs in with their own phone's digital key (a passkey:
fingerprint, face or screen lock), and the server decides who is asking on every request.

## 1. Choose the address first

Digital keys are made for one web address. Choose the pilot's final address (for example
`https://keynection.your-domain`) **before the first household joins**. Moving later means every household needs
a re-entry code from the estate office.

## 2. Start the server

### Option A: Render (Blueprint)

1. Render dashboard → **New → Blueprint** → connect this repository. Render reads `render.yaml`: one web service,
   `keynection-pilot` (Docker, Singapore, 5 GB persistent disk at `/data`, deploys only when you click Deploy).
2. When asked, fill in `KEYNECTION_ORIGIN` (the address from step 1), `KEYNECTION_FIRST_STAFF` (the first
   estate-office staff member's name) and, if wanted, `KEYNECTION_PUSH_CONTACT` and `ANTHROPIC_API_KEY`.
3. For your own domain: the service's **Settings → Custom Domains**, then set `KEYNECTION_ORIGIN` to it, before
   anyone joins.

The instance and the disk are paid plans: check Render's current prices.

### Option B: any server with Docker

```bash
docker build -t keynection .
docker run -d --name keynection -p 8000:8000 -v keynection-data:/data \
  -e JIRAN_DEMO_MODE=0 -e KEYNECTION_ORIGIN=https://keynection.your-domain \
  -e KEYNECTION_FIRST_STAFF="Farah Aziz" keynection
```

Serve it over HTTPS (a reverse proxy or the cloud's load balancer, passing `X-Forwarded-Proto`). Run **one**
instance: the database is SQLite on one disk.

## 3. Settings

| Setting | | |
|---|---|---|
| `JIRAN_DEMO_MODE` | required | `0` for a pilot |
| `KEYNECTION_ORIGIN` | required | The pilot's `https://` address; digital keys only work there |
| `KEYNECTION_FIRST_STAFF` | first start | The first staff member's name (see step 4) |
| `KEYNECTION_FIRST_STAFF_ROLE` | optional | `estate` (default) or `sdp` |
| `KEYNECTION_PUSH_CONTACT` | optional | How push services can reach you, e.g. `mailto:estate@your-domain` (default: the address) |
| `KEYNECTION_BACKUP_DIR` | optional | Where daily backups go (default: `backups` next to the database) |
| `ANTHROPIC_API_KEY` | optional | Turns on AI translation and notice writing (text goes to Anthropic, outside Malaysia) |
| `JIRAN_DB_PATH` | set by the image | `/data/app.db` |
| `JIRAN_SITE_PASSWORD` | **never** in a pilot | Residents sign in with digital keys, not a shared password |

## 4. The first staff member

On start-up the server log shows a line like:

```
WARNING:     First staff member Farah Aziz: open https://…/?code=… on your own phone to sign in and make your digital key …
```

Open that link on the staff member's own phone and make the digital key. If the link expires before anyone uses
it, restart the service for a new one (this stops once someone has signed in). From then on, staff add colleagues
in the app: **Front desk → Add a colleague**. On a server with a command line:
`python backend/scripts/add_staff.py "Name" --role estate --site https://…`.

The log also lists anything still missing (`Pilot setup: …`); staff see the same list under **Command view →
Pilot health**.

## 5. Day one

1. **Phase setup → Import SDP's handover list**: one row per home, as a CSV (the **Template** button and the column
   notes are on that card). Fix the lines it names; nothing is saved while any line is wrong.
2. **Front desk → Welcome packs**: print a card for every home still to join; one goes into each owner's pack.
3. At handover the owner scans the card, joins, makes a digital key and turns on notifications (an iPhone needs
   **Share → Add to Home Screen** first; the app shows how).
4. A lost phone: **Front desk → Lost phone · re-entry code**, after checking the owner's ID.

## 6. Backups

- Every day the server copies the database and mirrors the photos into `/data/backups`, keeping 14 days (the
  privacy notice promises 14 days, so deleted data leaves the copies too).
- These copies are on the same disk. **Also keep copies off the server**: Render takes daily snapshots of the disk;
  on your own host, copy `/data/backups` elsewhere every day and keep no more than 14 days.
- Restore: stop the server, copy `backups/keynection-YYYYMMDD-HHMM.db` over `/data/app.db`, copy `backups/photos`
  and `backups/compare` back into `/data`, start. Try a restore once before the pilot starts.

## 7. New versions

Deploy when you are ready (auto-deploy is off). A pilot database is never rebuilt: a new version only adds tables
and columns. If a version ever needed anything else, the server stops at start-up **without changing anything**
and says why in the log: deploy the previous version again and contact the team.

## 8. Privacy and security checklist

- `KEYNECTION_ORIGIN` is an `https://` address; `JIRAN_SITE_PASSWORD` is not set.
- Staff sign in with their own phone's digital key; the first staff member is made only from the server.
- Notifications go only through Google's, Apple's, Mozilla's or Microsoft's push service, encrypted for each phone.
- Data is kept as the privacy notice (`pilot-2026-10b`) says: records are deleted automatically when their time is
  up, accounts close in the app or at the front desk, backups are kept 14 days.
- Before a wider rollout: a data protection impact assessment (neighbour relationships, children), a data
  processing agreement if AI translation is on, a native speaker's review of the Tamil texts, and Meta's approval
  of the WhatsApp templates (`docs/whatsapp-templates.md`) if WhatsApp alerts are wanted.

## 9. Keeping an eye on it

- `/api/health` for the host's health checks.
- Staff: **Command view → Pilot health**: what setup still needs, the last backup, homes joined, phones with
  notifications on.
