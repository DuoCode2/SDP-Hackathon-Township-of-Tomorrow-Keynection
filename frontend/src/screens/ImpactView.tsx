import { useState } from 'react'
import { Calculator, Clock4, Info, MessageSquareWarning, Scale, Wallet } from 'lucide-react'
import { Card, CardHead, ScreenTitle } from '../ui'
import { PLANNER_HOMES } from './PlannerView'

// An illustrative model, not a forecast. Every input is an assumption to be replaced with SDP's own numbers
// during the pilot; nothing here is presented as measured data.
type Input = { key: string; label: string; unit: string; value: number; min: number; max: number; step: number; note: string }

const INPUTS: Input[] = [
  { key: 'homes', label: 'Homes in the phase', unit: 'homes', value: 1000, min: 10, max: 5000, step: 10, note: 'From Phase setup, or type your own' },
  { key: 'renoRate', label: 'Homes renovating in the first two years', unit: '%', value: 40, min: 0, max: 100, step: 1, note: 'Assumption: check SDP’s renovation permit records' },
  { key: 'complaintRate', label: 'Renovations that lead to a neighbour complaint', unit: '%', value: 30, min: 0, max: 100, step: 1, note: 'Assumption' },
  { key: 'hoursToday', label: 'Estate staff time per complaint today', unit: 'hours', value: 3, min: 0, max: 40, step: 0.5, note: 'Assumption: calls, site visits, follow-up' },
  { key: 'settled', label: 'Complaints settled between neighbours with Jiran5', unit: '%', value: 60, min: 0, max: 100, step: 1, note: 'Pilot target: measured live on the command view' },
  { key: 'faster', label: 'Less staff time on the rest (full record attached)', unit: '%', value: 30, min: 0, max: 100, step: 1, note: 'Assumption' },
  { key: 'disputes', label: 'Defect claims where the cause is disputed, per 100 homes', unit: 'claims', value: 3, min: 0, max: 50, step: 1, note: 'Assumption: “my neighbour’s works or a building defect?”' },
  { key: 'disputeHours', label: 'Staff time per disputed claim', unit: 'hours', value: 8, min: 0, max: 80, step: 1, note: 'Assumption' },
  { key: 'photoShare', label: 'Disputes settled quickly thanks to pre-work photos', unit: '%', value: 50, min: 0, max: 100, step: 1, note: 'Assumption: measured in the pilot' },
  { key: 'rate', label: 'Staff cost per hour', unit: 'RM', value: 45, min: 0, max: 500, step: 1, note: 'Assumption' },
  { key: 'zone', label: 'Homes notified per renovation', unit: 'homes', value: 5, min: 1, max: 12, step: 0.5, note: 'From Phase setup (average notice list)' },
  { key: 'msgs', label: 'WhatsApp alerts per notified home', unit: 'alerts', value: 4, min: 0, max: 20, step: 1, note: 'Notice, reminder, updates' },
  { key: 'msgCost', label: 'Cost per WhatsApp alert', unit: 'RM', value: 0.06, min: 0, max: 1, step: 0.01, note: 'Assumption: check Meta’s current rate for Malaysia' },
]

function initial(): Record<string, number> {
  const v = Object.fromEntries(INPUTS.map((i) => [i.key, i.value]))
  try {
    const homes = Number(localStorage.getItem(PLANNER_HOMES))
    if (homes > 0) v.homes = homes
  } catch {
    /* storage blocked: keep the default */
  }
  return v
}

const rm = (n: number) => `RM ${Math.round(n).toLocaleString('en-MY')}`
const num = (n: number) => Math.round(n).toLocaleString('en-MY')

/** What Jiran5 could save SDP over a phase's first two years, with every assumption visible and editable. */
export default function ImpactView() {
  const [v, setV] = useState<Record<string, number>>(initial)
  const p = (k: string) => v[k] / 100

  const renovations = v.homes * p('renoRate')
  const complaints = renovations * p('complaintRate')
  const hoursToday = complaints * v.hoursToday
  const hoursWith = complaints * (1 - p('settled')) * v.hoursToday * (1 - p('faster'))
  const disputes = (v.homes / 100) * v.disputes
  const disputeSaved = disputes * v.disputeHours * p('photoShare')
  const hoursSaved = hoursToday - hoursWith + disputeSaved
  const staffSaved = hoursSaved * v.rate
  const waCost = renovations * v.zone * v.msgs * v.msgCost
  const net = staffSaved - waCost

  return (
    <section className="screen">
      <ScreenTitle eyebrow="SDP · Pilot planning" title="Impact model"
        subtitle="What Jiran5 could save over a phase's first two years after handover. Every number on the left is an assumption you can change." />
      <div className="assumption-banner"><Info size={16} /> Illustrative model, not a forecast. Replace each assumption with SDP's own data during the pilot; the command view measures the real rates.</div>
      <div className="cols">
        <div className="col">
          <Card>
            <CardHead icon={<Calculator size={16} />} title="Assumptions" sub="Change any value; results update instantly" />
            <div className="inputs">
              {INPUTS.map((i) => (
                <label key={i.key} className="assume">
                  <span className="assume-label"><b>{i.label}</b><small>{i.note}</small></span>
                  <span className="assume-input">
                    <input type="number" value={v[i.key]} min={i.min} max={i.max} step={i.step}
                      onChange={(e) => { const x = Number(e.target.value); if (Number.isFinite(x)) setV((s) => ({ ...s, [i.key]: Math.min(i.max, Math.max(i.min, x)) })) }} />
                    <em>{i.unit}</em>
                  </span>
                </label>
              ))}
            </div>
            <button className="link" onClick={() => setV(Object.fromEntries(INPUTS.map((i) => [i.key, i.value])))}>Reset to the example values</button>
          </Card>
        </div>

        <div className="col sticky">
          <div className="kpi-mini">
            <div><b>{num(hoursSaved)} h</b><span>estate staff time saved over two years</span></div>
            <div><b>{rm(net)}</b><span>net saving after WhatsApp costs</span></div>
          </div>
          <Card>
            <CardHead icon={<MessageSquareWarning size={16} />} title="Neighbour complaints" />
            <Line label="Renovations" value={num(renovations)} formula="homes × renovating share" />
            <Line label="Complaints without Jiran5" value={num(complaints)} formula="renovations × complaint share" />
            <Line label="Settled between neighbours" value={num(complaints * p('settled'))} formula="complaints × settled share" />
            <Compare a={hoursToday} b={hoursWith} />
          </Card>
          <Card>
            <CardHead icon={<Scale size={16} />} title="Disputed defect claims" />
            <Line label="Claims where the cause is disputed" value={num(disputes)} formula="homes ÷ 100 × disputes per 100" />
            <Line label="Staff hours saved" value={`${num(disputeSaved)} h`} formula="disputes × hours × share settled by photos" />
          </Card>
          <Card>
            <CardHead icon={<Wallet size={16} />} title="Money" />
            <Line label="Staff time saved" value={rm(staffSaved)} formula="hours saved × cost per hour" />
            <Line label="WhatsApp alerts" value={`− ${rm(waCost)}`} formula="renovations × homes notified × alerts × cost" />
            <Line label="Net over two years" value={rm(net)} formula="staff time saved − WhatsApp" strong />
          </Card>
          <Card>
            <CardHead icon={<Clock4 size={16} />} title="Not counted above" />
            <ul className="plain-list">
              <li>Every affected home is told before work starts, by design.</li>
              <li>Possibly fewer Tribunal and council complaints, and fewer angry app reviews. Not estimated here.</li>
              <li>Neighbours who know each other: measured as “pairs who know each other” on the command view.</li>
            </ul>
          </Card>
        </div>
      </div>
    </section>
  )
}

function Line({ label, value, formula, strong = false }: { label: string; value: string; formula: string; strong?: boolean }) {
  return (
    <div className={`calc-line ${strong ? 'strong' : ''}`}>
      <span><b>{label}</b><small>{formula}</small></span>
      <em>{value}</em>
    </div>
  )
}

function Compare({ a, b }: { a: number; b: number }) {
  const max = Math.max(a, b, 1)
  return (
    <div className="compare-bars">
      <div><span>Staff hours today</span><i style={{ width: `${(a / max) * 100}%` }} /><b>{num(a)} h</b></div>
      <div className="with"><span>With Jiran5</span><i style={{ width: `${(b / max) * 100}%` }} /><b>{num(b)} h</b></div>
      <small className="mono muted">WITH = UNSETTLED COMPLAINTS × HOURS × (1 − TIME SAVED)</small>
    </div>
  )
}
