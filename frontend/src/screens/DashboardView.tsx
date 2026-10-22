import { useEffect, useState, type ReactNode } from 'react'
import { Activity, Building2, Camera, Clock4, Download, Flag, Link2, Handshake, HeartHandshake, House, Inbox, KeyRound, Megaphone, MessagesSquare, MicOff, RotateCcw, Send, ShieldCheck, ShieldX, Sparkles, UserCheck, Wrench } from 'lucide-react'
import { api, type Concern, type Dashboard, type ModerationReport, type Notice, type WarrantyTicket } from '../api'
import { SHOW_CONTRACTOR_PASSES, usePilot, usePlace, type Place } from '../features'
import ConcernCard from '../components/ConcernCard'
import FrontDesk from '../components/FrontDesk'
import PilotHealth from '../components/PilotHealth'
import WarrantyClock from '../components/WarrantyClock'
import { Badge, Card, CardHead, CountUp, Empty, Ring, ScreenTitle, Segmented, Skeleton, useToast } from '../ui'
import { ticketBadge } from './RepairView'
import { useDates, useT, type Translate } from '../i18n'
import { replayOpening } from '../welcome'

const SUBCONTRACTORS = ['Jaya Plaster Sdn Bhd', 'Kemas Waterproofing', 'Bina Teguh Builders']

export default function DashboardView({ version, onChange, onViewAs }: { version: number; onChange: () => void; onViewAs?: (unitId: string) => void }) {
  const toast = useToast()
  const t = useT()
  const pilot = usePilot()
  const place = usePlace()
  const rehearsal = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('rehearsal')
  const [d, setD] = useState<Dashboard | null>(null)
  const [queue, setQueue] = useState<WarrantyTicket[]>([])
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [reports, setReports] = useState<ModerationReport[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [desk, setDesk] = useState<'warranty' | 'estate' | 'safety' | 'notices' | 'frontdesk'>('warranty')

  useEffect(() => {
    let live = true
    Promise.all([api.dashboard(), api.warrantyQueue(), api.estateConcerns(), api.reports(), api.allNotices()]).then(([dash, q, c, r, n]) => {
      if (!live) return
      setD(dash)
      setQueue(q)
      setConcerns(c)
      setReports(r)
      setNotices(n)
    })
    return () => {
      live = false
    }
  }, [version])

  async function reset() {
    // The demo is shared: whoever else is in it starts over too.
    if (!window.confirm(t('sdp.dash.reset.confirm'))) return
    await api.resetDemo()
    try {
      Object.keys(sessionStorage).filter((k) => k.startsWith('keynection.pass:') || k.startsWith('keynection.join:')).forEach((k) => sessionStorage.removeItem(k))
      replayOpening()
    } catch {
      /* storage blocked */
    }
    toast(t('sdp.dash.reset.done'))
    onChange()
  }

  const ratio = (a: number, b: number) => (b ? a / b : null)

  return (
    <section className="screen">
      <ScreenTitle eyebrow={t('sdp.dash.eyebrow', { place: place.name })} title={t('nav.sdp')} subtitle={t('sdp.dash.subtitle')}
        aside={d && <div className="live-pill quiet"><span className="pulse" /> {t('sdp.dash.live', { n: d.households })}</div>} />
      {pilot && <PilotHealth version={version} />}
      {!d ? (
        <Skeleton lines={6} />
      ) : (
        <>
          <div className="kpi-strip">
            <Kpi icon={<UserCheck size={14} />} label={t('sdp.dash.kpi.joined')} value={d.households_joined} sub={t('sdp.dash.kpi.joined.sub', { n: d.households, m: d.paper_notices_pending })} />
            <Kpi icon={<House size={14} />} label={t('sdp.dash.kpi.know')} value={d.households_with_a_known_neighbour} sub={t('sdp.dash.kpi.ofHomes', { n: d.households })} />
            <Kpi icon={<MessagesSquare size={14} />} label={t('sdp.dash.kpi.messages')} value={d.messages_sent} sub={t('sdp.dash.kpi.messages.sub', { a: d.intros_sent, b: d.contact_requests_accepted, c: d.contact_requests })} />
            <Kpi icon={<Handshake size={14} />} label={t('sdp.dash.kpi.settled')} value={d.concerns_settled_by_neighbours} sub={t('sdp.dash.kpi.settled.sub', { n: d.concerns_raised })} />
            <Kpi icon={<Building2 size={14} />} label={t('sdp.dash.kpi.estate')} value={d.concerns_with_estate} sub={t('sdp.dash.kpi.estate.sub', { n: d.concerns_escalated })} />
            <Kpi icon={<Clock4 size={14} />} label={t('sdp.dash.kpi.overdue')} value={d.warranty_overdue} sub={t('sdp.dash.kpi.overdue.sub', { a: d.warranty_open, b: d.warranty_closed })} />
            {SHOW_CONTRACTOR_PASSES && <Kpi icon={<KeyRound size={14} />} label={t('sdp.dash.kpi.gate')} value={d.gate_allowed + d.gate_denied} sub={t('sdp.dash.kpi.gate.sub', { n: d.gate_denied })} />}
          </div>

          <div className="cols">
            <div className="col">
              <Segmented value={desk} onChange={setDesk} options={[
                { id: 'warranty', label: t('sdp.dash.tab.warranty', { n: d.warranty_open }) },
                { id: 'estate', label: t('sdp.dash.tab.estate', { n: d.concerns_with_estate }) },
                { id: 'safety', label: t('sdp.dash.tab.safety', { n: d.reports_open }) },
                { id: 'notices', label: t('sdp.dash.tab.notices') },
                { id: 'frontdesk', label: t('sdp.dash.tab.frontdesk', { n: d.households - d.households_joined + d.paper_notices_pending }) },
              ]} />
              {desk === 'warranty' && (
                <Card>
                  <CardHead icon={<Wrench size={16} />} tone="blue" title={t('sdp.dash.wq.title')} sub={t('sdp.dash.wq.sub')}
                    right={<div className="head-badges"><Badge tone="blue">{t('sdp.dash.wq.open', { n: d.warranty_open })}</Badge><Badge tone="brand">{t('sdp.dash.wq.closed', { n: d.warranty_closed })}</Badge></div>} />
                  {pilot && queue.length > 0 && <ToProcore queue={queue} onChange={onChange} />}
                  {queue.length === 0 ? (
                    <Empty art="inbox" icon={<Inbox size={22} />} title={t('sdp.dash.wq.empty')}>{t('sdp.dash.wq.emptyBody')}</Empty>
                  ) : (
                    queue.map((tk) => <QueueItem key={tk.id} ticket={tk} onChange={onChange} />)
                  )}
                  {d.repairs_rejected > 0 && <div className="mono muted">{t('sdp.dash.wq.sentBack', { n: d.repairs_rejected })}</div>}
                </Card>
              )}
              {desk === 'estate' && (
                <Card>
                  <CardHead icon={<Building2 size={16} />} tone="red" title={t('sdp.dash.est.title')} sub={t('sdp.dash.est.sub')} />
                  {concerns.length === 0 ? (
                    <Empty art="handshake" icon={<Handshake size={22} />} title={t('sdp.dash.est.empty')}>{t('sdp.dash.est.emptyBody')}</Empty>
                  ) : (
                    concerns.map((c) => (
                      <div key={c.id} className="estate-item">
                        <div className="mono muted">{t('sdp.dash.est.onReno', { scope: c.scope ?? '', n: c.concerns_on_renovation ?? 0 })}</div>
                        <ConcernCard concern={c} estate onChanged={onChange} />
                      </div>
                    ))
                  )}
                </Card>
              )}
              {desk === 'safety' && (
                <Card>
                  <CardHead icon={<Flag size={16} />} tone="amber" title={t('sdp.dash.rep.title')} sub={t('sdp.dash.rep.sub')} />
                  {reports.length === 0 ? (
                    <Empty art="shield" icon={<ShieldCheck size={22} />} title={t('sdp.dash.rep.empty')}>{t('sdp.dash.rep.emptyBody')}</Empty>
                  ) : (
                    reports.map((r) => <ReportItem key={r.id} report={r} onChange={onChange} />)
                  )}
                </Card>
              )}
              {desk === 'notices' && <NoticeDesk notices={notices} onChange={onChange} />}
              {desk === 'frontdesk' && <FrontDesk version={version} onChange={onChange} onViewAs={onViewAs} />}
            </div>

            <div className="col sticky">
              <Card>
                <CardHead icon={<Activity size={16} />} title={t('sdp.dash.health.title')} sub={t('sdp.dash.health.sub')} />
                <div className="rings">
                  <Ring value={d.reply_rate} label={t('sdp.dash.ring.reply')} />
                  <Ring value={ratio(d.renovations_with_prework_photos, d.renovations_registered)} label={t('sdp.dash.ring.photos')} />
                  <Ring value={ratio(d.warranty_closed, d.warranty_closed + d.warranty_open)} label={t('sdp.dash.ring.closed')} />
                  <Ring value={ratio(d.concerns_settled_by_neighbours, d.concerns_raised)} label={t('sdp.dash.ring.settled')} />
                </div>
              </Card>

              <Card>
                <CardHead icon={<HeartHandshake size={16} />} title={t('sdp.dash.bond.title')} sub={t('sdp.dash.bond.sub')} />
                <div className="bond">
                  <Ring value={ratio(d.known_pairs, d.circle_pairs)} label={t('sdp.dash.bond.ring')} />
                  <dl className="bond-facts">
                    <div><dt>{t('sdp.dash.bond.pairs')}</dt><dd>{d.known_pairs} / {d.circle_pairs}</dd></div>
                    <div><dt>{t('sdp.dash.bond.hello')}</dt><dd>{d.days_to_first_hello === null ? '—' : t('sdp.dash.bond.days', { n: d.days_to_first_hello })}</dd></div>
                    <div><dt>{t('sdp.dash.bond.reached')}</dt><dd>{d.households_reached_out} / {d.households}</dd></div>
                    <div><dt>{t('sdp.dash.bond.active')}</dt><dd>{d.active_circles_30d}</dd></div>
                    <div><dt>{t('sdp.dash.bond.quiet')}</dt><dd>{d.quiet_times_kept} / {d.quiet_times_kept + d.quiet_times_missed}</dd></div>
                    <div><dt>{t('sdp.dash.bond.noise')}</dt><dd>{d.noise_concerns}</dd></div>
                  </dl>
                </div>
                <div className="mono muted">{t('sdp.dash.bond.foot')}</div>
              </Card>

              <Card className="glow">
                <div className="card-row">
                  <ShieldCheck size={22} color="var(--accent)" />
                  <div className="grow">
                    <div className="card-title" style={{ fontSize: 14 }}>{t('sdp.dash.logs.title', { a: d.home_histories_verified, b: d.households })}</div>
                    <div className="muted small">{t('sdp.dash.logs.body')}</div>
                  </div>
                </div>
              </Card>

              {/* Rehearsals only: the demo is shared, so a judge must not be able to start everyone over. Open the site
                  with ?rehearsal=1 to see it (docs/test-plan.md); the shared demo still resets itself after 20 quiet minutes. */}
              {!pilot && rehearsal && <button className="link" onClick={reset}><RotateCcw size={12} style={{ verticalAlign: -2 }} /> {t('sdp.dash.reset')}</button>}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function Kpi({ icon, label, value, sub }: { icon: ReactNode; label: string; value: number; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-top">{label}{icon}</div>
      <div className="kpi-value"><CountUp value={value} /></div>
      {sub && <div className="mono muted">{sub}</div>}
    </div>
  )
}

/** Pilot: the warranty team takes tickets into Procore (a punch list and the photos), then writes the item number back. */
function ToProcore({ queue, onChange }: { queue: WarrantyTicket[]; onChange: () => void }) {
  const toast = useToast()
  const t = useT()
  const [which, setWhich] = useState<'new' | 'open' | 'all'>('new')
  const [busy, setBusy] = useState(false)
  async function download() {
    setBusy(true)
    try {
      const zip = await api.warrantyExport(which)
      const url = URL.createObjectURL(zip)
      const a = document.createElement('a')
      a.href = url
      a.download = `keynection-warranty-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      toast(t('sdp.dash.procore.downloaded'))
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('sdp.dash.procore.failed'), 'error')
    } finally {
      setBusy(false)
    }
  }
  const open = queue.filter((x) => x.status !== 'closed').length
  return (
    <div className="to-procore">
      <div className="small"><b>{t('sdp.dash.procore.title')}</b> · {t('sdp.dash.procore.body')}</div>
      <div className="btn-row">
        <select value={which} onChange={(e) => setWhich(e.target.value as 'new' | 'open' | 'all')} aria-label={t('sdp.dash.procore.which')}>
          <option value="new">{t('sdp.dash.procore.new')}</option>
          <option value="open">{t('sdp.dash.procore.allOpen', { n: open })}</option>
          <option value="all">{t('sdp.dash.procore.all', { n: queue.length })}</option>
        </select>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={download}><Download size={14} /> {t('sdp.dash.procore.download')}</button>
      </div>
    </div>
  )
}

/** Pilot: the Procore item number, written on the ticket (the owner's home log shows SDP logged it). */
function ProcoreNumber({ ticket, onChange }: { ticket: WarrantyTicket; onChange: () => void }) {
  const toast = useToast()
  const t = useT()
  const pilot = usePilot()
  const [ref, setRef] = useState(ticket.procore_ref ?? '')
  async function save() {
    try {
      await api.linkProcore(ticket.id, ref.trim(), pilot?.me.name ?? '')
      toast(t('sdp.dash.procore.linked', { ref: ref.trim(), id: String(ticket.id).padStart(3, '0') }))
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('df.couldNotSave'), 'error')
    }
  }
  return (
    <div className="procore-number">
      <label className="field">{t('sdp.dash.procore.no')}
        <input value={ref} maxLength={40} placeholder={t('sdp.dash.procore.eg')} onChange={(e) => setRef(e.target.value)} />
      </label>
      <button className="btn btn-sm" disabled={!ref.trim() || ref.trim() === (ticket.procore_ref ?? '')} onClick={save}><Link2 size={14} /> {t('sdp.dash.procore.link')}</button>
    </div>
  )
}

function QueueItem({ ticket, onChange }: { ticket: WarrantyTicket; onChange: () => void }) {
  const toast = useToast()
  const t = useT()
  const pilot = usePilot()
  const [sub, setSub] = useState(pilot ? '' : SUBCONTRACTORS[0])
  const [busy, setBusy] = useState(false)

  // Pilot: the subcontractor's own photo of the finished repair, checked against the pre-work photo.
  async function upload(file: File) {
    setBusy(true)
    try {
      const done = await api.submitRepair(ticket.id, sub.trim(), file)
      toast(done.repair_check?.verdict === 'restored' ? t('sdp.dash.q.matches') : t('sdp.dash.q.marks'))
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('sdp.dash.q.failed'), 'error')
    } finally {
      setBusy(false)
    }
  }
  const ceiling = ticket.subject.toLowerCase().startsWith('ceiling')

  async function submit(quality: 'good' | 'poor') {
    setBusy(true)
    try {
      const done = await api.submitDemoRepair(ticket.id, `${ceiling ? 'ceiling' : 'wall'}_repair_${quality}`, sub)
      toast(done.repair_check?.verdict === 'restored' ? t('sdp.dash.q.matches') : t('sdp.dash.q.marks'))
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('sdp.dash.q.failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="queue-item">
      <div className="card-row">
        <img className="thumb" style={{ width: 64, height: 48 }} src={(ticket.repair_photo ?? ticket.defect_photo).thumb_url} alt="" loading="lazy" />
        <div className="grow">
          <div className="mono muted">#{String(ticket.id).padStart(3, '0')} · {ticket.unit_label}{ticket.procore_ref ? ` · ${ticket.procore_ref}${ticket.procore_demo ? t('sdp.dash.q.demo') : ''}` : ''}</div>
          <div className="card-title" style={{ fontSize: 14 }}>{ticket.subject}</div>
          {ticket.reopen_count > 0 && <div className="small" style={{ color: 'var(--red)' }}>{t('sdp.dash.q.rejected', { note: ticket.owner_note ?? '' })}</div>}
        </div>
        {ticketBadge(t, ticket.status)}
      </div>
      <WarrantyClock clock={ticket.clock} closed={ticket.status === 'closed'} compact />
      {pilot && <ProcoreNumber key={ticket.procore_ref ?? ''} ticket={ticket} onChange={onChange} />}
      {ticket.status === 'open' && (
        <>
          {pilot ? (
            <>
              <label className="field">{t('sdp.dash.q.sub')}
                <input value={sub} maxLength={80} onChange={(e) => setSub(e.target.value)} placeholder={t('sdp.dash.q.company')} />
              </label>
              <label className={`btn btn-sm btn-primary file-btn ${!sub.trim() || busy ? 'disabled' : ''}`}>
                <Camera size={13} /> {t('sdp.dash.q.upload')}
                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={!sub.trim() || busy}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f) }} />
              </label>
            </>
          ) : (
            <>
              <label className="field">{t('sdp.dash.q.subProcore')}
                <select value={sub} onChange={(e) => setSub(e.target.value)}>{SUBCONTRACTORS.map((s) => <option key={s}>{s}</option>)}</select>
              </label>
              <div className="btn-row">
                <button className="btn btn-sm" onClick={() => submit('poor')} disabled={busy}><Sparkles size={13} /> {t('sdp.dash.q.samplePoor')}</button>
                <button className="btn btn-sm" onClick={() => submit('good')} disabled={busy}><Sparkles size={13} /> {t('sdp.dash.q.sampleGood')}</button>
              </div>
            </>
          )}
          <div className="mono muted">{t('sdp.dash.q.onlyOwner')}</div>
        </>
      )}
      {ticket.status === 'repair_submitted' && (
        <div className="small dim" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {ticket.repair_check?.verdict === 'restored' ? <ShieldCheck size={14} color="var(--accent)" /> : <ShieldX size={14} color="var(--red)" />}
          {t('sdp.dash.q.waiting', { name: ticket.resident_name, verdict: ticket.repair_check?.verdict.replace('_', ' ') ?? '' })}
        </div>
      )}
      {ticket.status === 'closed' && <Badge tone="brand">{t('sdp.dash.q.closedBy', { name: ticket.resident_name })}</Badge>}
    </div>
  )
}

function ReportItem({ report: r, onChange }: { report: ModerationReport; onChange: () => void }) {
  const toast = useToast()
  const t = useT()
  const { date } = useDates()
  async function review(outcome: 'warned' | 'dismissed') {
    await api.reviewReport(r.id, outcome)
    toast(outcome === 'warned' ? t('sdp.dash.report.warnedToast', { name: r.message.from_name }) : t('sdp.dash.report.dismissedToast'))
    onChange()
  }
  return (
    <div className="queue-item">
      <div className="card-row">
        <Flag size={16} color="var(--amber)" />
        <div className="grow">
          <div className="mono muted">{t('sdp.dash.report.meta', { id: String(r.id).padStart(3, '0'), reason: r.reason.toUpperCase(), date: date(r.created_at) })}</div>
          <div className="small">{t('sdp.dash.report.from', { name: r.message.from_name, label: r.message.from_label })}</div>
        </div>
        <Badge tone={r.status === 'open' ? 'amber' : r.status === 'warned' ? 'red' : 'neutral'}>{t(`sdp.dash.report.${r.status}`)}</Badge>
      </div>
      {r.message.kind === 'voice' ? (
        r.message.voice_url ? (
          <div className="report-voice">
            <span className="mono muted">{t('sdp.dash.report.voice', { n: r.message.duration ?? '?' })}</span>
            <audio controls preload="none" src={r.message.voice_url} />
          </div>
        ) : (
          <div className="voice-gone"><MicOff size={14} /> {t('sdp.dash.report.voiceGone')}</div>
        )
      ) : (
        <blockquote className="report-quote">“{r.message.text}”</blockquote>
      )}
      {r.status === 'open' && (
        <div className="btn-row">
          <button className="btn btn-sm" onClick={() => review('dismissed')}>{t('sdp.dash.report.dismiss')}</button>
          <button className="btn btn-sm btn-danger" onClick={() => review('warned')}>{t('sdp.dash.report.warn')}</button>
        </div>
      )}
    </div>
  )
}

/** Who a notice goes to, from the phase's own streets and blocks. */
function audiences(t: Translate, place: Place): Record<string, string> {
  return Object.fromEntries([['phase', t('audience.phase')], ...place.streets.map((s) => [`street:${s}`, s]),
    ...place.blocks.map((b) => [`block:${b}`, t('place.block', { b })])])
}

/** Ring 3: one-way notices to a street, a block or the whole township. Residents can't reply-all. */
function NoticeDesk({ notices, onChange }: { notices: Notice[]; onChange: () => void }) {
  const toast = useToast()
  const t = useT()
  const { date } = useDates()
  const AUDIENCE = audiences(t, usePlace())
  const [audience, setAudience] = useState(() => Object.keys(AUDIENCE).find((k) => k.startsWith('block:')) ?? 'phase')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  async function post() {
    try {
      await api.postNotice(audience, title, body)
      toast(t('sdp.dash.nd.posted', { audience: AUDIENCE[audience] }))
      setTitle('')
      setBody('')
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('sdp.dash.nd.failed'), 'error')
    }
  }
  return (
    <Card>
      <CardHead icon={<Megaphone size={16} />} tone="blue" title={t('sdp.dash.nd.title')} sub={t('sdp.dash.nd.sub')} />
      <div className="grid-2">
        <label className="field">{t('sdp.dash.nd.audience')}
          <select value={audience} onChange={(e) => setAudience(e.target.value)}>
            {Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">{t('sdp.dash.nd.titleField')}<input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={t('sdp.dash.nd.titleEg')} /></label>
      </div>
      <textarea className="input" rows={3} maxLength={400} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('sdp.dash.nd.bodyPh')} />
      <button className="btn btn-primary" disabled={title.trim().length < 3 || body.trim().length < 3} onClick={post}><Send size={14} /> {t('sdp.dash.nd.post')}</button>
      {notices.map((n) => (
        <div key={n.id} className="notice-item">
          <div className="notice-item-top"><b>{n.title}</b><span className="mono muted">{AUDIENCE[n.audience] ?? n.audience}</span></div>
          <p>{n.body}</p>
          <small>{n.author} · {date(n.created_at)}</small>
        </div>
      ))}
    </Card>
  )
}
