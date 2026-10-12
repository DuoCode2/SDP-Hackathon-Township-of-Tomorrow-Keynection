import { useEffect, useState, type ReactNode } from 'react'
import { Activity, Building2, Camera, Clock4, Download, Flag, Link2, Handshake, HeartHandshake, House, Inbox, KeyRound, Megaphone, MessagesSquare, MicOff, RotateCcw, Send, ShieldCheck, ShieldX, Sparkles, UserCheck, Wrench } from 'lucide-react'
import { api, type Concern, type Dashboard, type ModerationReport, type Notice, type WarrantyTicket } from '../api'
import { SHOW_CONTRACTOR_PASSES, usePilot, usePlace, type Place } from '../features'
import ConcernCard from '../components/ConcernCard'
import FrontDesk from '../components/FrontDesk'
import PilotHealth from '../components/PilotHealth'
import WarrantyClock from '../components/WarrantyClock'
import { Badge, Card, CardHead, CountUp, Empty, formatDate, Ring, ScreenTitle, Segmented, Skeleton, useToast } from '../ui'
import { ticketBadge } from './RepairView'
import { tEn } from '../i18n'
import { replayWelcome } from './CircleView'

const SUBCONTRACTORS = ['Jaya Plaster Sdn Bhd', 'Kemas Waterproofing', 'Bina Teguh Builders']

export default function DashboardView({ version, onChange, onViewAs }: { version: number; onChange: () => void; onViewAs?: (unitId: string) => void }) {
  const toast = useToast()
  const pilot = usePilot()
  const place = usePlace()
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
    await api.resetDemo()
    try {
      Object.keys(sessionStorage).filter((k) => k.startsWith('keynection.pass:') || k.startsWith('keynection.join:')).forEach((k) => sessionStorage.removeItem(k))
      replayWelcome()
    } catch {
      /* storage blocked */
    }
    toast('Demo data reset')
    onChange()
  }

  const ratio = (a: number, b: number) => (b ? a / b : null)

  return (
    <section className="screen">
      <ScreenTitle eyebrow={`SDP · ${place.name}`} title="Command view" subtitle="What SDP's handover, warranty and estate teams would see in PACC."
        aside={d && <div className="live-pill quiet"><span className="pulse" /> LIVE · {d.households} households</div>} />
      {pilot && <PilotHealth version={version} />}
      {!d ? (
        <Skeleton lines={6} />
      ) : (
        <>
          <div className="kpi-strip">
            <Kpi icon={<UserCheck size={14} />} label="Joined Keynection" value={d.households_joined} sub={`of ${d.households} homes · ${d.paper_notices_pending} on paper`} />
            <Kpi icon={<House size={14} />} label="Know a neighbour" value={d.households_with_a_known_neighbour} sub={`of ${d.households} homes`} />
            <Kpi icon={<MessagesSquare size={14} />} label="Messages" value={d.messages_sent} sub={`${d.intros_sent} intros · ${d.contact_requests_accepted}/${d.contact_requests} requests accepted`} />
            <Kpi icon={<Handshake size={14} />} label="Settled by neighbours" value={d.concerns_settled_by_neighbours} sub={`of ${d.concerns_raised} concerns`} />
            <Kpi icon={<Building2 size={14} />} label="With estate team" value={d.concerns_with_estate} sub={`${d.concerns_escalated} escalated in total`} />
            <Kpi icon={<Clock4 size={14} />} label="Repairs overdue" value={d.warranty_overdue} sub={`${d.warranty_open} open · ${d.warranty_closed} closed`} />
            {SHOW_CONTRACTOR_PASSES && <Kpi icon={<KeyRound size={14} />} label="Gate scans" value={d.gate_allowed + d.gate_denied} sub={`${d.gate_denied} refused`} />}
          </div>

          <div className="cols">
            <div className="col">
              <Segmented value={desk} onChange={setDesk} options={[
                { id: 'warranty', label: `Warranty · ${d.warranty_open}` },
                { id: 'estate', label: `Estate · ${d.concerns_with_estate}` },
                { id: 'safety', label: `Safety · ${d.reports_open}` },
                { id: 'notices', label: 'Notices' },
                { id: 'frontdesk', label: `Front desk · ${d.households - d.households_joined + d.paper_notices_pending}` },
              ]} />
              {desk === 'warranty' && (
                <Card>
                  <CardHead icon={<Wrench size={16} />} tone="blue" title="Warranty queue" sub="Building-defect decisions land here with the photos attached"
                    right={<div className="head-badges"><Badge tone="blue">{d.warranty_open} open</Badge><Badge tone="brand">{d.warranty_closed} closed</Badge></div>} />
                  {pilot && queue.length > 0 && <ToProcore queue={queue} onChange={onChange} />}
                  {queue.length === 0 ? (
                    <Empty art="inbox" icon={<Inbox size={22} />} title="No tickets yet">When neighbours agree a change is a building defect, the ticket appears here automatically.</Empty>
                  ) : (
                    queue.map((t) => <QueueItem key={t.id} ticket={t} onChange={onChange} />)
                  )}
                  {d.repairs_rejected > 0 && <div className="mono muted">{d.repairs_rejected} REPAIR(S) SENT BACK BY OWNERS</div>}
                </Card>
              )}
              {desk === 'estate' && (
                <Card>
                  <CardHead icon={<Building2 size={16} />} tone="red" title="Estate team: neighbour concerns" sub="Only concerns a neighbour escalated. Everything else stays between the two homes." />
                  {concerns.length === 0 ? (
                    <Empty art="handshake" icon={<Handshake size={22} />} title="No concerns">Concerns start between neighbours. Only the ones they can't settle are escalated here.</Empty>
                  ) : (
                    concerns.map((c) => (
                      <div key={c.id} className="estate-item">
                        <div className="mono muted">{c.scope} · {c.concerns_on_renovation} concern(s) on this renovation</div>
                        <ConcernCard concern={c} estate onChanged={onChange} />
                      </div>
                    ))
                  )}
                </Card>
              )}
              {desk === 'safety' && (
                <Card>
                  <CardHead icon={<Flag size={16} />} tone="amber" title="Reported messages" sub="Review within one working day. Reporters stay anonymous; warnings go only to the sender." />
                  {reports.length === 0 ? (
                    <Empty art="shield" icon={<ShieldCheck size={22} />} title="Nothing reported">Residents can report any message sent to them from the chat.</Empty>
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
                <CardHead icon={<Activity size={16} />} title="Community health" sub="Live from resident activity" />
                <div className="rings">
                  <Ring value={d.reply_rate} label="Reply rate" />
                  <Ring value={ratio(d.renovations_with_prework_photos, d.renovations_registered)} label="Pre-work photo coverage" />
                  <Ring value={ratio(d.warranty_closed, d.warranty_closed + d.warranty_open)} label="Closed by owner" />
                  <Ring value={ratio(d.concerns_settled_by_neighbours, d.concerns_raised)} label="Settled without SDP" />
                </div>
              </Card>

              <Card>
                <CardHead icon={<HeartHandshake size={16} />} title="Neighbour relationships" sub="Counts only, never who or what was said" />
                <div className="bond">
                  <Ring value={ratio(d.known_pairs, d.circle_pairs)} label="Next-door pairs who know each other" />
                  <dl className="bond-facts">
                    <div><dt>Pairs that know each other</dt><dd>{d.known_pairs} / {d.circle_pairs}</dd></div>
                    <div><dt>Keys to first hello</dt><dd>{d.days_to_first_hello === null ? '—' : `${d.days_to_first_hello} days`}</dd></div>
                    <div><dt>Households that reached out</dt><dd>{d.households_reached_out} / {d.households}</dd></div>
                    <div><dt>Active circles · 30 days</dt><dd>{d.active_circles_30d}</dd></div>
                    <div><dt>Quiet times kept by renovation notices</dt><dd>{d.quiet_times_kept} / {d.quiet_times_kept + d.quiet_times_missed}</dd></div>
                    <div><dt>Noise concerns</dt><dd>{d.noise_concerns}</dd></div>
                  </dl>
                </div>
                <div className="mono muted">FOR HANDOVER PLANNING · NOT FOR MARKETING OR PROFILING RESIDENTS</div>
              </Card>

              <Card className="glow">
                <div className="card-row">
                  <ShieldCheck size={22} color="var(--accent)" />
                  <div className="grow">
                    <div className="card-title" style={{ fontSize: 14 }}>Home logs consistent · {d.home_histories_verified}/{d.households}</div>
                    <div className="muted small">Every home's chain links up (server check; owner receipts come with the pilot).</div>
                  </div>
                </div>
              </Card>

              {!pilot && <button className="link" onClick={reset}><RotateCcw size={12} style={{ verticalAlign: -2 }} /> Reset demo data (for rehearsals)</button>}
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
      toast('Downloaded: a punch list and the photos, ready for Procore')
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not prepare the download', 'error')
    } finally {
      setBusy(false)
    }
  }
  const open = queue.filter((t) => t.status !== 'closed').length
  return (
    <div className="to-procore">
      <div className="small"><b>To Procore</b> · a punch list (CSV) with each ticket's photos. Copy the columns into your project's Procore import template, then type each item's number on its ticket below.</div>
      <div className="btn-row">
        <select value={which} onChange={(e) => setWhich(e.target.value as 'new' | 'open' | 'all')} aria-label="Which tickets">
          <option value="new">New since the last download</option>
          <option value="open">All open ({open})</option>
          <option value="all">All ({queue.length})</option>
        </select>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={download}><Download size={14} /> Download for Procore</button>
      </div>
    </div>
  )
}

/** Pilot: the Procore item number, written on the ticket (the owner's home log shows SDP logged it). */
function ProcoreNumber({ ticket, onChange }: { ticket: WarrantyTicket; onChange: () => void }) {
  const toast = useToast()
  const pilot = usePilot()
  const [ref, setRef] = useState(ticket.procore_ref ?? '')
  async function save() {
    try {
      await api.linkProcore(ticket.id, ref.trim(), pilot?.me.name ?? '')
      toast(`Procore item ${ref.trim()} linked to ticket #${String(ticket.id).padStart(3, '0')}`)
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', 'error')
    }
  }
  return (
    <div className="procore-number">
      <label className="field">Procore item no.
        <input value={ref} maxLength={40} placeholder="e.g. 457" onChange={(e) => setRef(e.target.value)} />
      </label>
      <button className="btn btn-sm" disabled={!ref.trim() || ref.trim() === (ticket.procore_ref ?? '')} onClick={save}><Link2 size={14} /> Link</button>
    </div>
  )
}

function QueueItem({ ticket, onChange }: { ticket: WarrantyTicket; onChange: () => void }) {
  const toast = useToast()
  const pilot = usePilot()
  const [sub, setSub] = useState(pilot ? '' : SUBCONTRACTORS[0])
  const [busy, setBusy] = useState(false)

  // Pilot: the subcontractor's own photo of the finished repair, checked against the pre-work photo.
  async function upload(file: File) {
    setBusy(true)
    try {
      const t = await api.submitRepair(ticket.id, sub.trim(), file)
      toast(t.repair_check?.verdict === 'restored' ? 'Repair submitted · matches pre-work photo' : 'Repair submitted · marks still detected')
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not submit', 'error')
    } finally {
      setBusy(false)
    }
  }
  const ceiling = ticket.subject.toLowerCase().startsWith('ceiling')

  async function submit(quality: 'good' | 'poor') {
    setBusy(true)
    try {
      const t = await api.submitDemoRepair(ticket.id, `${ceiling ? 'ceiling' : 'wall'}_repair_${quality}`, sub)
      toast(t.repair_check?.verdict === 'restored' ? 'Repair submitted · matches pre-work photo' : 'Repair submitted · marks still detected')
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not submit', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="queue-item">
      <div className="card-row">
        <img className="thumb" style={{ width: 64, height: 48 }} src={(ticket.repair_photo ?? ticket.defect_photo).thumb_url} alt="" loading="lazy" />
        <div className="grow">
          <div className="mono muted">#{String(ticket.id).padStart(3, '0')} · {ticket.unit_label}{ticket.procore_ref ? ` · ${ticket.procore_ref}` : ''}</div>
          <div className="card-title" style={{ fontSize: 14 }}>{ticket.subject}</div>
          {ticket.reopen_count > 0 && <div className="small" style={{ color: 'var(--red)' }}>Owner rejected: “{ticket.owner_note}”</div>}
        </div>
        {ticketBadge(tEn, ticket.status)}
      </div>
      <WarrantyClock clock={ticket.clock} closed={ticket.status === 'closed'} compact />
      {pilot && <ProcoreNumber key={ticket.procore_ref ?? ''} ticket={ticket} onChange={onChange} />}
      {ticket.status === 'open' && (
        <>
          {pilot ? (
            <>
              <label className="field">Subcontractor
                <input value={sub} maxLength={80} onChange={(e) => setSub(e.target.value)} placeholder="Company that did the repair" />
              </label>
              <label className={`btn btn-sm btn-primary file-btn ${!sub.trim() || busy ? 'disabled' : ''}`}>
                <Camera size={13} /> Upload the repair photo
                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={!sub.trim() || busy}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f) }} />
              </label>
            </>
          ) : (
            <>
              <label className="field">Subcontractor (Procore)
                <select value={sub} onChange={(e) => setSub(e.target.value)}>{SUBCONTRACTORS.map((s) => <option key={s}>{s}</option>)}</select>
              </label>
              <div className="btn-row">
                <button className="btn btn-sm" onClick={() => submit('poor')} disabled={busy}><Sparkles size={13} /> Sample: poor patch</button>
                <button className="btn btn-sm" onClick={() => submit('good')} disabled={busy}><Sparkles size={13} /> Sample: proper repair</button>
              </div>
            </>
          )}
          <div className="mono muted">SDP CAN SUBMIT A REPAIR · ONLY THE OWNER CAN CLOSE IT</div>
        </>
      )}
      {ticket.status === 'repair_submitted' && (
        <div className="small dim" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {ticket.repair_check?.verdict === 'restored' ? <ShieldCheck size={14} color="var(--accent)" /> : <ShieldX size={14} color="var(--red)" />}
          Waiting for {ticket.resident_name} to confirm · auto-check: {ticket.repair_check?.verdict.replace('_', ' ')}
        </div>
      )}
      {ticket.status === 'closed' && <Badge tone="brand">Closed by {ticket.resident_name}</Badge>}
    </div>
  )
}

function ReportItem({ report: r, onChange }: { report: ModerationReport; onChange: () => void }) {
  const toast = useToast()
  async function review(outcome: 'warned' | 'dismissed') {
    await api.reviewReport(r.id, outcome)
    toast(outcome === 'warned' ? `${r.message.from_name} warned privately` : 'Report dismissed')
    onChange()
  }
  return (
    <div className="queue-item">
      <div className="card-row">
        <Flag size={16} color="var(--amber)" />
        <div className="grow">
          <div className="mono muted">#{String(r.id).padStart(3, '0')} · {r.reason.toUpperCase()} · reported {formatDate(r.created_at)}</div>
          <div className="small">From {r.message.from_name} ({r.message.from_label})</div>
        </div>
        <Badge tone={r.status === 'open' ? 'amber' : r.status === 'warned' ? 'red' : 'neutral'}>{r.status}</Badge>
      </div>
      {r.message.kind === 'voice' ? (
        r.message.voice_url ? (
          <div className="report-voice">
            <span className="mono muted">VOICE · {r.message.duration ?? '?'}S · KEPT UNTIL REVIEWED</span>
            <audio controls preload="none" src={r.message.voice_url} />
          </div>
        ) : (
          <div className="voice-gone"><MicOff size={14} /> Voice message deleted after review (30-day rule)</div>
        )
      ) : (
        <blockquote className="report-quote">“{r.message.text}”</blockquote>
      )}
      {r.status === 'open' && (
        <div className="btn-row">
          <button className="btn btn-sm" onClick={() => review('dismissed')}>Dismiss</button>
          <button className="btn btn-sm btn-danger" onClick={() => review('warned')}>Warn sender privately</button>
        </div>
      )}
    </div>
  )
}

/** Who a notice goes to, from the phase's own streets and blocks. */
function audiences(place: Place): Record<string, string> {
  return Object.fromEntries([['phase', 'Whole township'], ...place.streets.map((s) => [`street:${s}`, s]),
    ...place.blocks.map((b) => [`block:${b}`, `Block ${b}`])])
}

/** Ring 3: one-way notices to a street, a block or the whole township. Residents can't reply-all. */
function NoticeDesk({ notices, onChange }: { notices: Notice[]; onChange: () => void }) {
  const toast = useToast()
  const AUDIENCE = audiences(usePlace())
  const [audience, setAudience] = useState(() => Object.keys(AUDIENCE).find((k) => k.startsWith('block:')) ?? 'phase')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  async function post() {
    try {
      await api.postNotice(audience, title, body)
      toast(`Notice posted to ${AUDIENCE[audience]}`)
      setTitle('')
      setBody('')
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not post', 'error')
    }
  }
  return (
    <Card>
      <CardHead icon={<Megaphone size={16} />} tone="blue" title="Community notices" sub="One-way, to a street, a block or the whole township. No replies to everyone, so no group arguments." />
      <div className="grid-2">
        <label className="field">Audience
          <select value={audience} onChange={(e) => setAudience(e.target.value)}>
            {Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">Title<input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lift servicing" /></label>
      </div>
      <textarea className="input" rows={3} maxLength={400} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What, where, when, and what residents should do" />
      <button className="btn btn-primary" disabled={title.trim().length < 3 || body.trim().length < 3} onClick={post}><Send size={14} /> Post notice</button>
      {notices.map((n) => (
        <div key={n.id} className="notice-item">
          <div className="notice-item-top"><b>{n.title}</b><span className="mono muted">{AUDIENCE[n.audience] ?? n.audience}</span></div>
          <p>{n.body}</p>
          <small>{n.author} · {formatDate(n.created_at)}</small>
        </div>
      ))}
    </Card>
  )
}
