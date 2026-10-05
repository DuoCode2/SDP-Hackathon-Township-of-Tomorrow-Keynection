import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { BadgeCheck, Ban, Eye, EyeOff, KeyRound, ScanLine, ShieldCheck, ShieldX, Volume2, VolumeX } from 'lucide-react'
import { api, type GateResult, type Pass, type UnitInfo, type WorkItem, type Works, type ContractorView } from '../api'
import { Badge, Card, Empty, formatDate, ScreenTitle, Segmented, Sheet, shortRange, Skeleton, useToast } from '../ui'

interface Props {
  me: UnitInfo
  version: number
  onChange: () => void
}

const DAY = 86_400_000
const toDate = (iso: string) => new Date(`${iso}T00:00:00`)
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function WorksView({ me, version, onChange }: Props) {
  const [tab, setTab] = useState<'schedule' | 'passes'>('schedule')
  const [data, setData] = useState<Works | null>(null)

  useEffect(() => {
    let live = true
    api.works(me.id).then((d) => live && setData(d))
    return () => {
      live = false
    }
  }, [me.id, version])

  return (
    <section className="screen">
      <ScreenTitle eyebrow="Layer 2 · Agree" title="Works" subtitle="Renovation around you, quiet-hour rules, and who is allowed through the gate." />
      <Segmented value={tab} onChange={setTab} options={[{ id: 'schedule', label: 'Schedule' }, { id: 'passes', label: 'Contractor passes' }]} />
      {!data ? <Card><Skeleton lines={4} /></Card> : tab === 'schedule' ? <Schedule data={data} /> : <Passes me={me} data={data} onChange={onChange} />}
    </section>
  )
}

// ---------- schedule ----------

function noisyAllowed(item: WorkItem, at: Date): boolean {
  const r = item.renovation
  const day = iso(at)
  if (day < r.start || day > r.end) return false
  const wd = at.getDay()
  if (wd === 0 || (r.weekdays_only !== false && wd === 6)) return false
  const hm = at.toTimeString().slice(0, 5)
  return hm >= (r.noisy_from ?? '09:00') && hm < (r.noisy_to ?? '17:00')
}

function Schedule({ data }: { data: Works }) {
  const all = [...data.mine.map((w) => ({ ...w, mine: true })), ...data.nearby.map((w) => ({ ...w, mine: false }))]
  const now = new Date()
  const today = iso(now)
  const noisy = all.filter((w) => noisyAllowed(w, now))
  const upcoming = all.filter((w) => w.renovation.start > today).sort((a, b) => a.renovation.start.localeCompare(b.renovation.start))[0]
  const ongoing = all.filter((w) => w.renovation.start <= today && w.renovation.end >= today)

  const days = 28
  const start = toDate(today)
  const pos = (d: string) => Math.max(0, Math.min(days, (toDate(d).getTime() - start.getTime()) / DAY))

  return (
    <>
      <Card className={noisy.length ? 'alert' : 'glow'}>
        <div className={`now ${noisy.length ? 'now-noisy' : 'now-quiet'}`}>
          <div className="now-icon">{noisy.length ? <Volume2 size={22} /> : <VolumeX size={22} />}</div>
          <div className="grow">
            <div className="mono" style={{ color: noisy.length ? 'var(--amber)' : 'var(--accent-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="pulse" /> LIVE · {now.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="card-title" style={{ marginTop: 4 }}>
              {noisy.length ? `Noisy work allowed now at ${noisy.map((w) => w.from_label).join(', ')}` : 'Quiet hours around you'}
            </div>
            <div className="small dim" style={{ marginTop: 2 }}>
              {noisy.length
                ? `Until ${noisy[0].renovation.noisy_to ?? '17:00'} today.`
                : ongoing.length
                  ? `${ongoing.length} renovation(s) in progress; noisy work is outside its allowed hours.`
                  : upcoming
                    ? `Next works start ${formatDate(upcoming.renovation.start)} at ${upcoming.mine ? 'your home' : upcoming.from_label}.`
                    : 'No renovation registered in your circle.'}
            </div>
          </div>
        </div>
      </Card>

      <div className="section-label">Next 4 weeks</div>
      <Card>
        {all.length === 0 ? (
          <Empty icon={<VolumeX size={22} />} title="Nothing scheduled">When anyone in your circle registers renovation, it appears on this timeline.</Empty>
        ) : (
          <div className="timeline-grid" style={{ ['--days' as string]: days }}>
            <div className="tl-head">
              <span />
              <div className="tl-days">
                {Array.from({ length: days }, (_, i) => {
                  const d = new Date(start.getTime() + i * DAY)
                  return <span key={i} className={`tl-day ${i === 0 ? 'today' : ''}`}>{i % 7 === 0 ? d.getDate() : ''}</span>
                })}
              </div>
            </div>
            {all.map((w) => (
              <div key={w.intro_id} className="tl-row">
                <div className="tl-label">
                  {w.mine ? 'Your home' : w.from_label}
                  <small>{shortRange(w.renovation.start, w.renovation.end)}</small>
                </div>
                <div className="tl-track">
                  <div className={`tl-bar ${w.mine ? 'mine' : ''}`}
                    style={{ left: `${(pos(w.renovation.start) / days) * 100}%`, width: `${Math.max(((pos(w.renovation.end) + 1 - pos(w.renovation.start)) / days) * 100, 1.5)}%` }} />
                  <div className="tl-today" style={{ left: 0 }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {all.map((w) => (
        <Card key={w.intro_id}>
          <div className="card-row">
            <div className="grow">
              <div className="card-title">{w.mine ? 'Your renovation' : `${w.from_name} · ${w.from_label}`}</div>
              <div className="small dim">{w.renovation.scope}</div>
            </div>
            <Badge tone={w.mine ? 'brand' : 'amber'}>{shortRange(w.renovation.start, w.renovation.end)}</Badge>
          </div>
          <div className="stat-grid">
            <div className="stat"><b>{w.renovation.noisy_from ?? '09:00'}</b><span>Noise from</span></div>
            <div className="stat"><b>{w.renovation.noisy_to ?? '17:00'}</b><span>Noise until</span></div>
            <div className="stat"><b>{w.renovation.weekdays_only === false ? 'SAT' : 'NONE'}</b><span>Weekend</span></div>
          </div>
        </Card>
      ))}

      <div className="section-label">House rules</div>
      <Card>
        <ul className="rules">{data.house_rules.map((r) => <li key={r}>{r}</li>)}</ul>
      </Card>
    </>
  )
}

// ---------- passes ----------

const tokenKey = (id: number) => `j5pass:${id}`
const readToken = (id: number) => {
  try {
    return sessionStorage.getItem(tokenKey(id))
  } catch {
    return null
  }
}

function Passes({ me, data, onChange }: { me: UnitInfo; data: Works; onChange: () => void }) {
  const toast = useToast()
  const [issuing, setIssuing] = useState(false)

  if (data.mine.length === 0) {
    return (
      <Card>
        <Empty icon={<KeyRound size={22} />} title="Passes come from the renovating home">
          Register renovation from Circle → "I'm planning renovation". You can then issue a QR pass to your contractor; the
          guardhouse scans it and only lets workers in on allowed days and hours.
        </Empty>
      </Card>
    )
  }

  async function issue(item: WorkItem) {
    setIssuing(true)
    try {
      const p = await api.issuePass(item.intro_id, me.id)
      try {
        sessionStorage.setItem(tokenKey(p.id), p.token) // demo convenience: this tab only, cleared when closed
      } catch {
        /* storage blocked: QR still shows until you leave this screen */
      }
      toast('Contractor pass issued')
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not issue pass', 'error')
    } finally {
      setIssuing(false)
    }
  }

  return (
    <>
      {data.mine.map((item) => {
        const active = item.passes?.filter((p) => p.status === 'active').length ?? 0
        return (
          <div key={item.intro_id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Card>
              <div className="card-row">
                <div className="grow">
                  <div className="card-title">{item.renovation.scope}</div>
                  <div className="small dim">{shortRange(item.renovation.start, item.renovation.end)} · {item.neighbours_notified} neighbours notified · {item.prework_photos} pre-work photo(s) on record</div>
                </div>
              </div>
              <button className="btn btn-primary btn-block" onClick={() => issue(item)} disabled={issuing || active >= 3}>
                <KeyRound size={16} /> {active >= 3 ? 'Limit of 3 active passes' : 'Issue contractor pass'}
              </button>
            </Card>
            {item.passes?.map((p) => <PassCard key={p.id} pass={p} me={me} item={item} onChange={onChange} />)}
          </div>
        )
      })}
    </>
  )
}

function scanPresets(item: WorkItem) {
  const start = toDate(item.renovation.start)
  const nextDay = (from: Date, test: (d: Date) => boolean) => {
    const d = new Date(from)
    while (!test(d)) d.setDate(d.getDate() + 1)
    return d
  }
  const workday = nextDay(start, (d) => d.getDay() !== 0)
  const sunday = nextDay(start, (d) => d.getDay() === 0)
  const after = new Date(toDate(item.renovation.end).getTime() + DAY)
  const label = (d: Date, t: string) => `${d.toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' })} ${t}`
  return [
    { label: 'Right now', at: undefined },
    { label: label(workday, '10:00'), at: `${iso(workday)}T10:00` },
    { label: label(sunday, '10:00'), at: `${iso(sunday)}T10:00` },
    { label: label(workday, '20:30'), at: `${iso(workday)}T20:30` },
    { label: label(after, '10:00'), at: `${iso(after)}T10:00` },
  ]
}

function PassCard({ pass, me, item, onChange }: { pass: Pass; me: UnitInfo; item: WorkItem; onChange: () => void }) {
  const toast = useToast()
  const token = readToken(pass.id)
  const [qr, setQr] = useState<string | null>(null)
  const [result, setResult] = useState<GateResult | null>(null)
  const [view, setView] = useState<ContractorView | null>(null)

  useEffect(() => {
    if (!token) return
    QRCode.toDataURL(`J5PASS:${token}`, { margin: 1, width: 320, errorCorrectionLevel: 'M', color: { dark: '#0b1220', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [token])

  async function scan(at?: string) {
    if (!token) return
    const r = await api.scan(token, at)
    setResult(r)
    onChange()
  }

  async function revoke() {
    await api.revokePass(pass.id, me.id)
    toast('Pass revoked: the gate will refuse it from now on')
    onChange()
  }

  const revoked = pass.status === 'revoked'
  return (
    <>
      <div className={`pass ${revoked ? 'revoked' : ''}`}>
        <div className="pass-top">
          <div>
            <div className="eyebrow" style={{ marginBottom: 2 }}>Contractor pass · #{String(pass.id).padStart(4, '0')}</div>
            <div className="card-title" style={{ fontSize: 17 }}>{pass.contractor_name}</div>
            <div className="small dim">{me.label} · {item.renovation.scope}</div>
          </div>
          {revoked ? <Badge tone="red">Revoked</Badge> : pass.contractor_cidb ? <Badge tone="brand"><BadgeCheck size={12} /> CIDB</Badge> : <Badge tone="amber">No CIDB</Badge>}
        </div>
        {token && qr && !revoked ? (
          <div className="pass-qr"><img src={qr} alt="Contractor pass QR code" /></div>
        ) : (
          <div className="small dim" style={{ textAlign: 'center', padding: '8px 0' }}>
            {revoked ? 'This pass no longer opens the gate.' : 'For security the QR is shown only once, on the device that issued it. Issue a new pass if it was lost.'}
          </div>
        )}
        <div className="pass-cut" />
        <div className="pass-meta">
          <div><span>Valid</span><b>{shortRange(pass.valid_from, pass.valid_to)}</b></div>
          <div><span>Gate hours</span><b>08:00–18:00 · Mon–Sat</b></div>
        </div>
        <div className="mono muted">Server keeps only a SHA-256 fingerprint of this code</div>
      </div>

      {!revoked && token && (
        <Card>
          <div className="card-row">
            <ScanLine size={18} color="var(--accent)" />
            <div className="grow card-title" style={{ fontSize: 14 }}>Simulate a guardhouse scan</div>
          </div>
          <div className="chips">
            {scanPresets(item).map((p) => <button key={p.label} className="chip" onClick={() => scan(p.at)}>{p.label}</button>)}
          </div>
          {result && (
            <div className={`gate-result ${result.allowed ? 'ok' : 'no'}`}>
              {result.allowed ? <ShieldCheck size={28} /> : <ShieldX size={28} />}
              <div>
                <strong>{result.allowed ? 'ENTRY ALLOWED' : 'ENTRY DENIED'}</strong>
                <span>
                  {result.allowed && result.pass
                    ? `${result.pass.contractor_name} → ${result.pass.unit_label} · within work dates and gate hours`
                    : result.reason}
                </span>
              </div>
            </div>
          )}
          <div className="btn-row">
            <button className="btn btn-sm" onClick={async () => setView(await api.contractorView(token))}><Eye size={14} /> Contractor's view</button>
            <button className="btn btn-sm btn-danger" onClick={revoke}><Ban size={14} /> Revoke</button>
          </div>
        </Card>
      )}

      {pass.gate_log.length > 0 && (
        <Card>
          <div className="mono muted">GATE LOG</div>
          <div className="log">
            {pass.gate_log.map((e, i) => (
              <div key={i} className="log-row">
                {e.allowed ? <ShieldCheck size={15} color="var(--accent)" /> : <ShieldX size={15} color="var(--red)" />}
                <span className="grow">{e.reason}</span>
                <span className="mono muted">{e.scanned_for.replace('T', ' ')}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Sheet open={!!view} onClose={() => setView(null)}>
        {view && (
          <>
            <div className="eyebrow">What the contractor sees</div>
            <div className="card-title" style={{ fontSize: 18 }}>{view.unit_label} · {view.scope}</div>
            <div className="stat-grid">
              <div className="stat"><b>{shortRange(view.start, view.end)}</b><span>Dates</span></div>
              <div className="stat"><b>{view.neighbours_notified}</b><span>Notified</span></div>
              <div className="stat"><b>{view.prework_photos_on_record}</b><span>Photos on file</span></div>
            </div>
            <div className="small dim">Noisy work: {view.noisy_hours} · Gate: {view.entry_hours}</div>
            <ul className="rules">{view.house_rules.map((r) => <li key={r}>{r}</li>)}</ul>
            <Card>
              <div className="card-row"><EyeOff size={16} color="var(--accent)" /><div className="card-title" style={{ fontSize: 14 }}>Hidden from the contractor</div></div>
              <ul className="rules">
                <li>The owner's phone number and documents</li>
                <li>Neighbours' names and contact details</li>
                <li>Any photos (only a count of photos on file)</li>
                <li>Every other home in the phase</li>
              </ul>
            </Card>
            <button className="btn btn-block" onClick={() => setView(null)}>Close</button>
          </>
        )}
      </Sheet>
    </>
  )
}
