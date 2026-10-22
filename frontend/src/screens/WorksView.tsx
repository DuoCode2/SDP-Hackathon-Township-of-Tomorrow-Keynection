import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { BadgeCheck, Ban, CalendarClock, CalendarRange, Eye, EyeOff, FileCheck2, FileClock, Hammer, KeyRound, ListChecks, ScanLine, ShieldCheck, ShieldX, Volume2, VolumeX } from 'lucide-react'
import { api, type ContractorView, type GateCode, type GateResult, type Pass, type UnitInfo, type WorkItem, type Works } from '../api'
import { useDates, useT, type Translate } from '../i18n'
import { Badge, Card, CardHead, Empty, ScreenTitle, Segmented, Sheet, Skeleton, useToast } from '../ui'
import RenovationWizard from './RenovationWizard'
import { SHOW_CONTRACTOR_PASSES, usePilot, useShowAll } from '../features'

interface Props {
  me: UnitInfo
  units: UnitInfo[]
  version: number
  onChange: () => void
}

type Item = WorkItem & { mine: boolean }
type Dates = ReturnType<typeof useDates>

const DAY = 86_400_000
const toDate = (iso: string) => new Date(`${iso}T00:00:00`)
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function noisyAllowed(item: WorkItem, at: Date): boolean {
  const r = item.renovation
  const day = iso(at)
  if (day < r.start || day > r.end) return false
  const wd = at.getDay()
  if (wd === 0 || (r.weekdays_only !== false && wd === 6)) return false
  const hm = at.toTimeString().slice(0, 5)
  if ((r.quiet_breaks ?? []).some((b) => hm >= b.start && hm < b.end)) return false  // a quiet break planned for neighbours
  return hm >= (r.noisy_from ?? '09:00') && hm < (r.noisy_to ?? '17:00')
}

/** A gate result in the reader's language; dates in it are formatted for them too. Older entries have no code. */
function gateText(t: Translate, dates: Dates, code: GateCode | null, values: Record<string, string>, english: string): string {
  if (!code) return english
  return t(`gate.${code}`, {
    ...values, ...(values.start ? { start: dates.date(values.start) } : {}), ...(values.end ? { end: dates.date(values.end) } : {}),
  })
}

export default function WorksView({ me, units, version, onChange }: Props) {
  const t = useT()
  const [tab, setTab] = useState<'schedule' | 'passes'>('schedule')
  const [data, setData] = useState<Works | null>(null)
  const [wizard, setWizard] = useState<{ names: Record<string, string>; preset?: 'bathroom' } | null>(null)
  const pilot = usePilot()
  const showAll = useShowAll()  // the quick example is for presenters, behind "Show every feature"

  // The wizard shows names only for homes this household may know (its circle and accepted contacts).
  // Demo: the quick example opens it already filled in with the bathroom story, on the When step.
  const openWizard = (preset?: 'bathroom') => api.directory(me.id).then((d) => {
    const names: Record<string, string> = { [me.id]: me.resident_name }
    d.circle.forEach((n) => { names[n.id] = n.resident_name })
    d.nearby.forEach((n) => { if (n.resident_name) names[n.id] = n.resident_name })
    setWizard({ names, preset })
  })

  useEffect(() => {
    let live = true
    api.works(me.id).then((d) => live && setData(d))
    return () => {
      live = false
    }
  }, [me.id, version])

  const all: Item[] = data ? [...data.mine.map((w) => ({ ...w, mine: true })), ...data.nearby.map((w) => ({ ...w, mine: false }))] : []
  const noisy = all.filter((w) => noisyAllowed(w, new Date()))

  return (
    <section className="screen">
      <ScreenTitle eyebrow={t('wk.eyebrow', { label: me.label })} title={t('nav.works')} subtitle={t('wk.subtitle')}
        aside={data && (
          <div className="head-actions">
            <div className={`live-pill ${noisy.length ? 'noisy' : 'quiet'}`}>
              <span className="pulse" />
              {noisy.length ? <Volume2 size={15} /> : <VolumeX size={15} />}
              {t(noisy.length ? 'wk.pill.noisy' : 'wk.pill.quiet')}
            </div>
            {!pilot && showAll && <button className="btn" onClick={() => openWizard('bathroom')}>{t('wk.quickExample')}</button>}
            <button className="btn btn-primary" onClick={() => openWizard()}><Hammer size={15} /> {t('wk.register')}</button>
          </div>
        )} />
      {SHOW_CONTRACTOR_PASSES && (
        <div className="tabs-row">
          <Segmented value={tab} onChange={setTab} options={[{ id: 'schedule', label: t('wk.tab.schedule') }, { id: 'passes', label: t('wk.tab.passes') }]} />
        </div>
      )}
      {!data ? <Card><Skeleton lines={4} /></Card> : SHOW_CONTRACTOR_PASSES && tab === 'passes' ? <Passes me={me} data={data} onChange={onChange} /> : <Schedule data={data} all={all} noisy={noisy} />}
      {wizard && <RenovationWizard open onClose={() => setWizard(null)} me={me} units={units} names={wizard.names} preset={wizard.preset} onSent={onChange} />}
    </section>
  )
}

// ---------- schedule ----------

function Schedule({ data, all, noisy }: { data: Works; all: Item[]; noisy: Item[] }) {
  const t = useT()
  const dates = useDates()
  const now = new Date()
  const today = iso(now)
  const upcoming = all.filter((w) => w.renovation.start > today).sort((a, b) => a.renovation.start.localeCompare(b.renovation.start))[0]
  const ongoing = all.filter((w) => w.renovation.start <= today && w.renovation.end >= today)

  const days = 28
  const start = toDate(today)
  const cal = Array.from({ length: days }, (_, i) => new Date(start.getTime() + i * DAY))
  const pos = (d: string) => Math.max(0, Math.min(days, (toDate(d).getTime() - start.getTime()) / DAY))

  return (
    <div className="cols">
      <div className="col">
        <Card>
          <CardHead icon={<CalendarRange size={16} />} title={t('wk.next4')} sub={t('wk.next4.sub')} />
          {all.length === 0 ? (
            <Empty art="house" icon={<VolumeX size={22} />} title={t('wk.none.title')}>{t('wk.none.body')}</Empty>
          ) : (
            <div className="timeline-grid" style={{ ['--days' as string]: days }}>
              <div className="tl-head">
                <span />
                <div className="tl-days">
                  {cal.map((d, i) => (
                    <span key={i} className={`tl-day ${i === 0 ? 'today' : ''} ${d.getDay() === 0 ? 'sun' : ''}`}>
                      {i === 0 || d.getDate() === 1 || d.getDay() === 1 ? d.getDate() : ''}
                    </span>
                  ))}
                </div>
              </div>
              {all.map((w) => (
                <div key={w.intro_id} className="tl-row">
                  <div className="tl-label">
                    {w.mine ? t('wk.yourHome') : w.from_label}
                    <small>{dates.range(w.renovation.start, w.renovation.end)}</small>
                  </div>
                  <div className="tl-track">
                    <div className="tl-cells">{cal.map((d, i) => <i key={i} className={d.getDay() === 0 ? 'sun' : ''} />)}</div>
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
            <CardHead icon={<Hammer size={16} />} tone={w.mine ? 'brand' : 'amber'}
              title={w.mine ? t('wk.yourReno') : `${w.from_name} · ${w.from_label}`} sub={w.renovation.scope}
              right={<Badge tone={w.mine ? 'brand' : 'amber'}>{dates.range(w.renovation.start, w.renovation.end)}</Badge>} />
            <div className="stat-grid">
              <div className="stat"><b>{w.renovation.noisy_from ?? '09:00'}</b><span>{t('wk.noiseFrom')}</span></div>
              <div className="stat"><b>{w.renovation.noisy_to ?? '17:00'}</b><span>{t('wk.noiseUntil')}</span></div>
              <div className="stat"><b>{t(w.renovation.weekdays_only === false ? 'wk.sat' : 'wk.noWeekend')}</b><span>{t('wk.weekend')}</span></div>
            </div>
            {(w.renovation.quiet_breaks ?? []).map((b) => (
              <div key={b.start} className="quiet-line"><CalendarClock size={13} /> {t('wk.quietBreak', { from: b.start, to: b.end })}</div>
            ))}
            {w.renovation.council_permit && (
              <div className={`permit permit-${w.renovation.council_permit}`}>
                {w.renovation.council_permit === 'applied' ? <FileClock size={14} /> : <FileCheck2 size={14} />}
                {t(`wk.permit.${w.renovation.council_permit}`)}
                {w.renovation.permit_ref && <span className="mono">{w.renovation.permit_ref}</span>}
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="col sticky">
        <Card className={noisy.length ? 'alert' : 'glow'}>
          <div className={`now ${noisy.length ? 'now-noisy' : 'now-quiet'}`}>
            <div className="now-icon">{noisy.length ? <Volume2 size={22} /> : <VolumeX size={22} />}</div>
            <div className="grow">
              <div className="mono" style={{ color: noisy.length ? 'var(--amber)' : 'var(--accent-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="pulse" /> {t('wk.live', { time: dates.time(now) })}
              </div>
              <div className="card-title" style={{ marginTop: 4 }}>
                {noisy.length ? t('wk.noisyAt', { where: noisy.map((w) => w.from_label).join(', ') }) : t('wk.quietTitle')}
              </div>
              <div className="small dim" style={{ marginTop: 2 }}>
                {noisy.length
                  ? t('wk.until', { time: noisy[0].renovation.noisy_to ?? '17:00' })
                  : ongoing.length
                    ? t('wk.ongoing', { n: ongoing.length })
                    : upcoming
                      ? upcoming.mine
                        ? t('wk.nextStartMine', { date: dates.date(upcoming.renovation.start) })
                        : t('wk.nextStart', { date: dates.date(upcoming.renovation.start), where: upcoming.from_label })
                      : t('wk.noneInCircle')}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead icon={<ListChecks size={16} />} title={t('wk.rules')} sub={t('wk.gateHours', { open: data.gate_open, close: data.gate_close })} />
          <ul className="rules">
            {data.house_rules.map((r, i) => ({ r, code: data.house_rule_codes?.[i] }))
              .filter(({ code }) => SHOW_CONTRACTOR_PASSES || code !== 'carry_pass')  // "this pass" means nothing without passes
              .map(({ r, code }) => <li key={r}>{code ? t(`rule.${code}`) : r}</li>)}
          </ul>
        </Card>
      </div>
    </div>
  )
}

// ---------- passes ----------

const tokenKey = (id: number) => `keynection.pass:${id}`
const readToken = (id: number) => {
  try {
    return sessionStorage.getItem(tokenKey(id))
  } catch {
    return null
  }
}

function Passes({ me, data, onChange }: { me: UnitInfo; data: Works; onChange: () => void }) {
  const t = useT()
  const dates = useDates()
  const toast = useToast()
  const [issuing, setIssuing] = useState(false)

  if (data.mine.length === 0) {
    return (
      <Card>
        <Empty art="house" icon={<KeyRound size={22} />} title={t('wk.passesEmpty.title')}>{t('wk.passesEmpty.body')}</Empty>
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
      toast(t('wk.issued'))
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('wk.issueFail'), 'error')
    } finally {
      setIssuing(false)
    }
  }

  return (
    <>
      {data.mine.map((item) => {
        const active = item.passes?.filter((p) => p.status === 'active').length ?? 0
        return (
          <div key={item.intro_id} className="stack">
            <Card>
              <div className="issue-row">
                <CardHead icon={<KeyRound size={16} />} title={item.renovation.scope}
                  sub={t('wk.passMeta', { dates: dates.range(item.renovation.start, item.renovation.end), n: item.neighbours_notified ?? 0, p: item.prework_photos ?? 0 })} />
                <button className="btn btn-primary" onClick={() => issue(item)} disabled={issuing || active >= 3}>
                  <KeyRound size={16} /> {t(active >= 3 ? 'wk.limit' : 'wk.issue')}
                </button>
              </div>
            </Card>
            {item.passes?.map((p) => <PassCard key={p.id} pass={p} me={me} item={item} gate={data} onChange={onChange} />)}
          </div>
        )
      })}
    </>
  )
}

function scanPresets(t: Translate, dates: Dates, item: WorkItem) {
  const start = toDate(item.renovation.start)
  const nextDay = (from: Date, test: (d: Date) => boolean) => {
    const d = new Date(from)
    while (!test(d)) d.setDate(d.getDate() + 1)
    return d
  }
  const workday = nextDay(start, (d) => d.getDay() !== 0)
  const sunday = nextDay(start, (d) => d.getDay() === 0)
  const after = new Date(toDate(item.renovation.end).getTime() + DAY)
  const label = (d: Date, hm: string) => `${dates.weekday(d)} ${hm}`
  return [
    { label: t('wk.rightNow'), at: undefined },
    { label: label(workday, '10:00'), at: `${iso(workday)}T10:00` },
    { label: label(sunday, '10:00'), at: `${iso(sunday)}T10:00` },
    { label: label(workday, '20:30'), at: `${iso(workday)}T20:30` },
    { label: label(after, '10:00'), at: `${iso(after)}T10:00` },
  ]
}

function PassCard({ pass, me, item, gate, onChange }: { pass: Pass; me: UnitInfo; item: WorkItem; gate: Works; onChange: () => void }) {
  const t = useT()
  const dates = useDates()
  const toast = useToast()
  const token = readToken(pass.id)
  const [qr, setQr] = useState<string | null>(null)
  const [result, setResult] = useState<GateResult | null>(null)
  const [view, setView] = useState<ContractorView | null>(null)

  useEffect(() => {
    if (!token) return
    QRCode.toDataURL(`KNPASS:${token}`, { margin: 1, width: 320, errorCorrectionLevel: 'M', color: { dark: '#0b1220', light: '#ffffff' } })
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
    toast(t('wk.revokedToast'))
    onChange()
  }

  const revoked = pass.status === 'revoked'
  const hours = { open: gate.gate_open, close: gate.gate_close }
  return (
    <div className="cols even">
      <div className={`pass ${revoked ? 'revoked' : ''}`}>
        <div className="pass-top">
          <div>
            <div className="eyebrow" style={{ marginBottom: 2 }}>{t('wk.passNo', { n: String(pass.id).padStart(4, '0') })}</div>
            <div className="card-title" style={{ fontSize: 17 }}>{pass.contractor_name}</div>
            <div className="small dim">{me.label} · {item.renovation.scope}</div>
          </div>
          {revoked ? <Badge tone="red">{t('wk.badge.revoked')}</Badge> : pass.contractor_cidb ? <Badge tone="brand"><BadgeCheck size={12} /> CIDB</Badge> : <Badge tone="amber">{t('wk.badge.noCidb')}</Badge>}
        </div>
        {token && qr && !revoked ? (
          <div className="pass-qr"><img src={qr} alt="QR" /></div>
        ) : (
          <div className="small dim" style={{ textAlign: 'center', padding: '8px 0' }}>{t(revoked ? 'wk.noLonger' : 'wk.qrGone')}</div>
        )}
        <div className="pass-cut" />
        <div className="pass-meta">
          <div><span>{t('wk.valid')}</span><b>{dates.range(pass.valid_from, pass.valid_to)}</b></div>
          <div><span>{t('wk.gate')}</span><b>{t('wk.gateVal', hours)}</b></div>
        </div>
        <div className="mono muted">{t('wk.fingerprint')}</div>
      </div>

      <div className="col">
        {!revoked && token && (
          <Card className="terminal">
            <CardHead icon={<ScanLine size={16} />} title={t('wk.scanner')} sub={t('wk.scanner.sub')} right={<span className="mono muted">GATE 01</span>} />
            <div className="chips">
              {scanPresets(t, dates, item).map((p) => <button key={p.label} className="chip" onClick={() => scan(p.at)}>{p.label}</button>)}
            </div>
            {result ? (
              <div className={`gate-result ${result.allowed ? 'ok' : 'no'}`}>
                {result.allowed ? <ShieldCheck size={28} /> : <ShieldX size={28} />}
                <div>
                  <strong>{t(result.allowed ? 'wk.allowed' : 'wk.denied')}</strong>
                  <span>
                    {result.allowed && result.pass
                      ? t('wk.allowedDetail', { who: result.pass.contractor_name, label: result.pass.unit_label })
                      : gateText(t, dates, result.reason_code, result.reason_values, result.reason)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="gate-idle"><ScanLine size={18} /> {t('wk.pickTime')}</div>
            )}
            <div className="btn-row">
              <button className="btn btn-sm" onClick={async () => setView(await api.contractorView(token))}><Eye size={14} /> {t('wk.contractorView')}</button>
              <button className="btn btn-sm btn-danger" onClick={revoke}><Ban size={14} /> {t('wk.revoke')}</button>
            </div>
          </Card>
        )}

        {pass.gate_log.length > 0 && (
          <Card>
            <div className="mono muted">{t('wk.gateLog')}</div>
            <div className="log">
              {pass.gate_log.map((e, i) => (
                <div key={i} className="log-row">
                  {e.allowed ? <ShieldCheck size={15} color="var(--accent)" /> : <ShieldX size={15} color="var(--red)" />}
                  <span className="grow">{gateText(t, dates, e.reason_code, e.reason_values, e.reason)}</span>
                  <span className="mono muted">{dates.weekday(new Date(e.scanned_for))} {e.scanned_for.slice(11, 16)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <Sheet open={!!view} onClose={() => setView(null)}>
        {view && (
          <>
            <div className="eyebrow">{t('cv.title')}</div>
            <div className="card-title" style={{ fontSize: 18 }}>{view.unit_label} · {view.scope}</div>
            <div className="stat-grid">
              <div className="stat"><b>{dates.range(view.start, view.end)}</b><span>{t('cv.dates')}</span></div>
              <div className="stat"><b>{view.neighbours_notified}</b><span>{t('cv.notified')}</span></div>
              <div className="stat"><b>{view.prework_photos_on_record}</b><span>{t('cv.photos')}</span></div>
            </div>
            <div className="small dim">{t('cv.noisy', { hours: view.noisy_hours, gate: t('wk.gateVal', hours) })}</div>
            <ul className="rules">{view.house_rules.map((r, i) => <li key={r}>{gate.house_rule_codes?.[i] ? t(`rule.${gate.house_rule_codes[i]}`) : r}</li>)}</ul>
            <Card>
              <div className="card-row"><EyeOff size={16} color="var(--accent)" /><div className="card-title" style={{ fontSize: 14 }}>{t('cv.hidden')}</div></div>
              <ul className="rules">
                <li>{t('cv.h1')}</li>
                <li>{t('cv.h2')}</li>
                <li>{t('cv.h3')}</li>
                <li>{t('cv.h4')}</li>
              </ul>
            </Card>
            <button className="btn btn-block" onClick={() => setView(null)}>{t('cv.close')}</button>
          </>
        )}
      </Sheet>
    </div>
  )
}
