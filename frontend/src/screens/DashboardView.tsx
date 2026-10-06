import { useEffect, useState, type ReactNode } from 'react'
import { Activity, Building2, Clock4, Flag, Handshake, House, Inbox, KeyRound, MessageCircle, MessagesSquare, RotateCcw, ShieldCheck, ShieldX, Sparkles, Wrench } from 'lucide-react'
import { api, type Concern, type Dashboard, type ModerationReport, type WarrantyTicket } from '../api'
import ConcernCard from '../components/ConcernCard'
import WarrantyClock from '../components/WarrantyClock'
import { Badge, Card, CardHead, CountUp, Empty, formatDate, Ring, ScreenTitle, Segmented, Skeleton, useToast } from '../ui'
import { TICKET_BADGE } from './RepairView'

const SUBCONTRACTORS = ['Jaya Plaster Sdn Bhd', 'Kemas Waterproofing', 'Bina Teguh Builders']

export default function DashboardView({ version, onChange }: { version: number; onChange: () => void }) {
  const toast = useToast()
  const [d, setD] = useState<Dashboard | null>(null)
  const [queue, setQueue] = useState<WarrantyTicket[]>([])
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [reports, setReports] = useState<ModerationReport[]>([])
  const [desk, setDesk] = useState<'warranty' | 'estate' | 'safety'>('warranty')

  useEffect(() => {
    let live = true
    Promise.all([api.dashboard(), api.warrantyQueue(), api.estateConcerns(), api.reports()]).then(([dash, q, c, r]) => {
      if (!live) return
      setD(dash)
      setQueue(q)
      setConcerns(c)
      setReports(r)
    })
    return () => {
      live = false
    }
  }, [version])

  async function reset() {
    await api.resetDemo()
    try {
      Object.keys(sessionStorage).filter((k) => k.startsWith('j5pass:')).forEach((k) => sessionStorage.removeItem(k))
    } catch {
      /* storage blocked */
    }
    toast('Demo data reset')
    onChange()
  }

  const ratio = (a: number, b: number) => (b ? a / b : null)

  return (
    <section className="screen">
      <ScreenTitle eyebrow="SDP · Taman Demo" title="Command view" subtitle="What SDP's handover, warranty and estate teams would see in PACC."
        aside={d && <div className="live-pill quiet"><span className="pulse" /> LIVE · {d.households} households</div>} />
      {!d ? (
        <Skeleton lines={6} />
      ) : (
        <>
          <div className="kpi-strip">
            <Kpi icon={<House size={14} />} label="Know a neighbour" value={d.households_with_a_known_neighbour} sub={`of ${d.households} homes`} />
            <Kpi icon={<MessagesSquare size={14} />} label="Messages" value={d.messages_sent} sub={`${d.intros_sent} intros · ${d.contacts_shared} numbers shared`} />
            <Kpi icon={<Handshake size={14} />} label="Settled by neighbours" value={d.concerns_settled_by_neighbours} sub={`of ${d.concerns_raised} concerns`} />
            <Kpi icon={<Building2 size={14} />} label="With estate team" value={d.concerns_with_estate} sub={`${d.concerns_escalated} escalated in total`} />
            <Kpi icon={<Clock4 size={14} />} label="Repairs overdue" value={d.warranty_overdue} sub={`${d.warranty_open} open · ${d.warranty_closed} closed`} />
            <Kpi icon={<KeyRound size={14} />} label="Gate scans" value={d.gate_allowed + d.gate_denied} sub={`${d.gate_denied} refused`} />
          </div>

          <div className="cols">
            <div className="col">
              <Segmented value={desk} onChange={setDesk} options={[
                { id: 'warranty', label: `Warranty · ${d.warranty_open}` },
                { id: 'estate', label: `Estate · ${d.concerns_with_estate}` },
                { id: 'safety', label: `Safety · ${d.reports_open}` },
              ]} />
              {desk === 'warranty' && (
                <Card>
                  <CardHead icon={<Wrench size={16} />} tone="blue" title="Warranty queue" sub="Building-defect decisions land here with the photos attached"
                    right={<div className="head-badges"><Badge tone="blue">{d.warranty_open} open</Badge><Badge tone="brand">{d.warranty_closed} closed</Badge></div>} />
                  {queue.length === 0 ? (
                    <Empty icon={<Inbox size={22} />} title="No tickets yet">When neighbours agree a change is a building defect, the ticket appears here automatically.</Empty>
                  ) : (
                    queue.map((t) => <QueueItem key={t.id} ticket={t} onChange={onChange} />)
                  )}
                  {d.repairs_rejected > 0 && <div className="mono muted">{d.repairs_rejected} REPAIR(S) SENT BACK BY OWNERS</div>}
                </Card>
              )}
              {desk === 'estate' && (
                <Card>
                  <CardHead icon={<Building2 size={16} />} tone="red" title="Estate team: neighbour concerns" sub="Escalated concerns first. The rest are still being handled between neighbours." />
                  {concerns.length === 0 ? (
                    <Empty icon={<Handshake size={22} />} title="No concerns">Concerns start between neighbours. Only the ones they can't settle are escalated here.</Empty>
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
                    <Empty icon={<ShieldCheck size={22} />} title="Nothing reported">Residents can report any message sent to them from the chat.</Empty>
                  ) : (
                    reports.map((r) => <ReportItem key={r.id} report={r} onChange={onChange} />)
                  )}
                </Card>
              )}
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

              <Card className="glow">
                <div className="card-row">
                  <ShieldCheck size={22} color="var(--accent)" />
                  <div className="grow">
                    <div className="card-title" style={{ fontSize: 14 }}>Home logs verified · {d.home_histories_verified}/{d.households}</div>
                    <div className="muted small">No record in any home has been edited or deleted.</div>
                  </div>
                </div>
              </Card>

              <button className="link" onClick={reset}><RotateCcw size={12} style={{ verticalAlign: -2 }} /> Reset demo data (for rehearsals)</button>
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

function QueueItem({ ticket, onChange }: { ticket: WarrantyTicket; onChange: () => void }) {
  const toast = useToast()
  const [sub, setSub] = useState(SUBCONTRACTORS[0])
  const [busy, setBusy] = useState(false)
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
        {TICKET_BADGE[ticket.status]}
      </div>
      <WarrantyClock clock={ticket.clock} closed={ticket.status === 'closed'} compact />
      {ticket.status === 'open' && (
        <>
          <label className="field">Subcontractor (Procore)
            <select value={sub} onChange={(e) => setSub(e.target.value)}>{SUBCONTRACTORS.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <div className="btn-row">
            <button className="btn btn-sm" onClick={() => submit('poor')} disabled={busy}><Sparkles size={13} /> Sample: poor patch</button>
            <button className="btn btn-sm" onClick={() => submit('good')} disabled={busy}><Sparkles size={13} /> Sample: proper repair</button>
          </div>
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
      <blockquote className="report-quote">“{r.message.text}”</blockquote>
      {r.status === 'open' && (
        <div className="btn-row">
          <button className="btn btn-sm" onClick={() => review('dismissed')}>Dismiss</button>
          <button className="btn btn-sm btn-danger" onClick={() => review('warned')}>Warn sender privately</button>
        </div>
      )}
    </div>
  )
}
