import { useEffect, useState, type ReactNode } from 'react'
import { Camera, CircleCheck, FileWarning, Hammer, House, KeyRound, MessageCircle, RotateCcw, ShieldCheck, ShieldX, Sparkles, Wrench } from 'lucide-react'
import { api, type Dashboard, type WarrantyTicket } from '../api'
import { Badge, Card, CountUp, Ring, ScreenTitle, Skeleton, useToast } from '../ui'
import { TICKET_BADGE } from './RepairView'

const SUBCONTRACTORS = ['Jaya Plaster Sdn Bhd', 'Kemas Waterproofing', 'Bina Teguh Builders']

export default function DashboardView({ version, onChange }: { version: number; onChange: () => void }) {
  const toast = useToast()
  const [d, setD] = useState<Dashboard | null>(null)
  const [queue, setQueue] = useState<WarrantyTicket[]>([])

  useEffect(() => {
    let live = true
    Promise.all([api.dashboard(), api.warrantyQueue()]).then(([dash, q]) => {
      if (!live) return
      setD(dash)
      setQueue(q)
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
      <ScreenTitle eyebrow="SDP · Taman Demo" title="Command view" subtitle="What SDP's handover, warranty and estate teams would see in PACC." />
      {!d ? (
        <Skeleton lines={6} />
      ) : (
        <>
          <div className="mono accent" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="pulse" /> LIVE · {d.households} HOUSEHOLDS</div>
          <div className="rings">
            <Ring value={d.reply_rate} label="Reply rate" />
            <Ring value={ratio(d.renovations_with_prework_photos, d.renovations_registered)} label="Pre-work photo coverage" />
            <Ring value={ratio(d.warranty_closed, d.warranty_closed + d.warranty_open)} label="Repairs closed by owner" />
          </div>

          <div className="section-label">Activity</div>
          <div className="kpis">
            <Kpi icon={<MessageCircle size={14} />} label="Introductions" value={d.intros_sent} />
            <Kpi icon={<House size={14} />} label="Know a neighbour" value={d.households_with_a_known_neighbour} />
            <Kpi icon={<Hammer size={14} />} label="Renovations" value={d.renovations_registered} />
            <Kpi icon={<Camera size={14} />} label="Pre-work photos" value={d.baseline_photos} />
            <Kpi icon={<FileWarning size={14} />} label="Cases" value={d.incidents} sub={`${d.incidents_decided} decided`} />
            <Kpi icon={<KeyRound size={14} />} label="Gate scans" value={d.gate_allowed + d.gate_denied} sub={`${d.gate_denied} refused`} />
          </div>

          <div className="section-label">Warranty queue</div>
          {queue.length === 0 ? (
            <Card><div className="small dim">No tickets. Building-defect decisions from neighbour cases land here automatically, with photos attached.</div></Card>
          ) : (
            queue.map((t) => <QueueItem key={t.id} ticket={t} onChange={onChange} />)
          )}
          <div className="kpis">
            <Kpi icon={<Wrench size={14} />} label="Open tickets" value={d.warranty_open} />
            <Kpi icon={<CircleCheck size={14} />} label="Closed by owners" value={d.warranty_closed} sub={`${d.repairs_rejected} repair(s) rejected`} />
          </div>

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
