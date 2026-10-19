import { useState } from 'react'
import { Calculator, Clock4, Info, MessageSquareWarning, Scale, Users, Wallet } from 'lucide-react'
import { Card, CardHead, ScreenTitle } from '../ui'
import { PLANNER_HOMES } from './PlannerView'
import { remembered } from '../storage'

// Two parts. The main measure, neighbour connection, starts from real census data and uses the census's own question,
// so the pilot can be compared with it. The cost lines below it are an illustrative model, not a forecast: every one
// of them is an assumption to be replaced with SDP's own numbers during the pilot.

// DOSM, Banci Malaysia 2020: Kesejahteraan Penduduk (Hubungan Sosial), Table 1, released 21 Sep 2023. Residents aged
// 15+ asked how often they had face-to-face contact with a neighbour in the past month.
const CENSUS_SOURCE = 'https://www.dosm.gov.my/portal-main/downloads-log?id=7189'
const CENSUS = [
  { key: 'selangor', label: 'Selangor', never: 13.2, daily: 27.9 },
  { key: 'kl', label: 'Kuala Lumpur', never: 13.9, daily: 19.9 },
  { key: 'n9', label: 'Negeri Sembilan', never: 5.6, daily: 37.2 },
  { key: 'johor', label: 'Johor', never: 7.7, daily: 33.4 },
  { key: 'malaysia', label: 'Malaysia (all states)', never: 6.5, daily: 41.4 },
] as const

type Input = { key: string; label: string; unit: string; value: number; min: number; max: number; step: number; note: string }

const INPUTS: Input[] = [
  { key: 'homes', label: 'Homes in the phase', unit: 'homes', value: 1000, min: 10, max: 5000, step: 10, note: 'From Phase setup, or type your own' },
  { key: 'cut', label: 'Cut in "no contact with a neighbour"', unit: '%', value: 50, min: 0, max: 100, step: 5, note: 'Pilot target, to be replaced by the survey result; checked with the census question at handover and six months later' },
  { key: 'disputes', label: 'Defect claims where the cause is disputed, per 100 homes', unit: 'claims', value: 3, min: 0, max: 50, step: 1, note: 'Assumption: “my neighbour’s works or a building defect?”' },
  { key: 'disputeHours', label: 'Staff time per disputed claim', unit: 'hours', value: 8, min: 0, max: 80, step: 1, note: 'Assumption' },
  { key: 'photoShare', label: 'Disputes settled quickly thanks to pre-work photos', unit: '%', value: 50, min: 0, max: 100, step: 1, note: 'Assumption: measured in the pilot' },
  { key: 'renoRate', label: 'Homes renovating in the first two years', unit: '%', value: 40, min: 0, max: 100, step: 1, note: 'Assumption, no public source: check SDP’s renovation records' },
  { key: 'complaintRate', label: 'Renovations that lead to a neighbour complaint', unit: '%', value: 30, min: 0, max: 100, step: 1, note: 'Assumption' },
  { key: 'hoursToday', label: 'Estate staff time per complaint today', unit: 'hours', value: 3, min: 0, max: 40, step: 0.5, note: 'Assumption: only where SDP’s estate team handles complaints (to confirm with SDP)' },
  { key: 'settled', label: 'Complaints settled between neighbours with Keynection', unit: '%', value: 60, min: 0, max: 100, step: 1, note: 'Pilot target: measured live on the command view' },
  { key: 'faster', label: 'Less staff time on the rest (full record attached)', unit: '%', value: 30, min: 0, max: 100, step: 1, note: 'Assumption' },
  { key: 'rate', label: 'Staff cost per hour', unit: 'RM', value: 45, min: 0, max: 500, step: 1, note: 'Assumption' },
  { key: 'zone', label: 'Homes notified per renovation', unit: 'homes', value: 5, min: 1, max: 12, step: 0.5, note: 'From Phase setup (average notice list)' },
  { key: 'msgs', label: 'WhatsApp alerts per notified home', unit: 'alerts', value: 4, min: 0, max: 20, step: 1, note: 'Notice, reminder, updates' },
  { key: 'msgCost', label: 'Cost per WhatsApp alert', unit: 'RM', value: 0.06, min: 0, max: 1, step: 0.01, note: 'Assumption: check Meta’s current rate for Malaysia' },
]

function initial(): Record<string, number> {
  const v = Object.fromEntries(INPUTS.map((i) => [i.key, i.value]))
  try {
    const homes = Number(remembered(PLANNER_HOMES))
    if (homes > 0) v.homes = homes
  } catch {
    /* storage blocked: keep the default */
  }
  return v
}

const rm = (n: number) => `RM ${Math.round(n).toLocaleString('en-MY')}`
const num = (n: number) => Math.round(n).toLocaleString('en-MY')

/** What Keynection changes in a phase's first two years: neighbour connection first, then what it could save SDP. */
export default function ImpactView() {
  const [v, setV] = useState<Record<string, number>>(initial)
  const [state, setState] = useState<(typeof CENSUS)[number]['key']>('selangor')
  const p = (k: string) => v[k] / 100
  const census = CENSUS.find((c) => c.key === state) ?? CENSUS[0]

  // Connection: the census counts people aged 15+, applied here to households as an approximation. Whole households,
  // rounded before subtracting, so the three lines always add up.
  const noContactToday = Math.round(v.homes * (census.never / 100))
  const noContactAfter = Math.round(noContactToday * (1 - p('cut')))

  const disputes = (v.homes / 100) * v.disputes
  const disputeSaved = disputes * v.disputeHours * p('photoShare')
  const renovations = v.homes * p('renoRate')
  const complaints = renovations * p('complaintRate')
  const hoursToday = complaints * v.hoursToday
  const hoursWith = complaints * (1 - p('settled')) * v.hoursToday * (1 - p('faster'))
  const hoursSaved = hoursToday - hoursWith + disputeSaved
  const staffSaved = hoursSaved * v.rate
  const waCost = renovations * v.zone * v.msgs * v.msgCost
  const net = staffSaved - waCost

  return (
    <section className="screen">
      <ScreenTitle eyebrow="SDP · Pilot planning" title="Impact model"
        subtitle="Neighbour connection is the main measure, starting from real census data. The cost lines below it are assumptions you can change." />
      <div className="assumption-banner"><Info size={16} /> Only the census figures are measured data. Every line marked Assumption or Pilot target must be replaced with SDP’s own data during the pilot; the command view measures the real rates.</div>

      <Card className="connection-card">
        <CardHead icon={<Users size={16} />} title="Neighbour connection · main measure"
          sub={<>Census 2020, residents aged 15+: face-to-face contact with a neighbour in the past month. <a href={CENSUS_SOURCE} target="_blank" rel="noreferrer">DOSM, Table 1</a></>} />
        <div className="census-pick">
          <label className="assume">
            <span className="assume-label"><b>Township’s state</b><small>SDP’s townships are mostly in Selangor, then Negeri Sembilan and Johor</small></span>
            <span className="assume-input">
              <select value={state} onChange={(e) => setState(e.target.value as typeof state)}>
                {CENSUS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </span>
          </label>
        </div>
        <div className="kpi-mini census-kpis">
          <div><b>{census.never}%</b><span>no face-to-face contact with a neighbour in a month ({census.label}; Malaysia {CENSUS[4].never}%)</span></div>
          <div><b>{census.daily}%</b><span>talk to a neighbour every day ({census.label}; Malaysia {CENSUS[4].daily}%)</span></div>
        </div>
        <Line label="Households with no neighbour contact today" value={num(noContactToday)} formula="homes × census share (people 15+ applied to households)" />
        <Line label="After the pilot target" value={num(noContactAfter)} formula="today × (1 − target cut)" />
        <Line label="Households newly in touch with a neighbour" value={num(noContactToday - noContactAfter)} formula="today − after" strong />
        <p className="small muted census-note">Checked with the census’s own question at handover and six months later, so the pilot is comparable with the national figures. The command view also counts next-door pairs who know each other and days from handover to the first hello. Compared against a control: a sister phase handed over the same quarter without Keynection, or the same phase at 6 and 12 months.</p>
      </Card>

      <div className="cols">
        <div className="col">
          <Card>
            <CardHead icon={<Calculator size={16} />} title="Inputs" sub="Change any value; results update instantly" />
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
          {/* Connection on top: the census-question result, then the two rates the command view measures live (not fetched here). */}
          <div className="kpi-mini">
            <div style={{ gridColumn: '1 / -1' }}><b>{num(noContactToday - noContactAfter)}</b><span>households newly in touch (census question)</span></div>
            <div><b>—</b><span>next-door pairs who know each other · measured live in the command view</span></div>
            <div><b>—</b><span>days from keys to the first hello · measured live</span></div>
          </div>
          <Card>
            <CardHead icon={<Scale size={16} />} title="Disputed defect claims" sub="SDP’s own cost during the 24-month warranty" />
            <Line label="Claims where the cause is disputed" value={num(disputes)} formula="homes ÷ 100 × disputes per 100" />
            <Line label="Staff hours saved" value={`${num(disputeSaved)} h`} formula="disputes × hours × share settled by photos" />
          </Card>
          <Card>
            <CardHead icon={<MessageSquareWarning size={16} />} title="Neighbour complaints" sub="Only where SDP’s estate team handles them" />
            <Line label="Renovations" value={num(renovations)} formula="homes × renovating share" />
            <Line label="Complaints without Keynection" value={num(complaints)} formula="renovations × complaint share" />
            <Line label="Settled between neighbours" value={num(complaints * p('settled'))} formula="complaints × settled share" />
            <Compare a={hoursToday} b={hoursWith} />
          </Card>
          <Card>
            <CardHead icon={<Calculator size={16} />} title="What SDP could save (assumptions)" />
            <div className="kpi-mini">
              <div><b>{num(hoursSaved)} h</b><span>staff time saved over two years (assumptions)</span></div>
              <div><b>{rm(net)}</b><span>net saving after WhatsApp costs (assumptions)</span></div>
            </div>
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
              <li>Satisfaction during the warranty period: SDP’s public reports give it at key handover only.</li>
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
      <div className="with"><span>With Keynection</span><i style={{ width: `${(b / max) * 100}%` }} /><b>{num(b)} h</b></div>
      <small className="mono muted">WITH = UNSETTLED COMPLAINTS × HOURS × (1 − TIME SAVED)</small>
    </div>
  )
}
