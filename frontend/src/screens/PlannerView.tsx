import { useEffect, useRef, useState } from 'react'
import { Building, Download, Grid3x3, Home, ListChecks, Timer, TriangleAlert } from 'lucide-react'
import { api, ApiError, type PhaseInfo, type PhaseLayout, type PhasePlan, type WorksType } from '../api'
import { usePilot } from '../features'
import PhaseImport from '../components/PhaseImport'
import { remember } from '../storage'
import { Card, CardHead, ScreenTitle, Segmented, Skeleton } from '../ui'

const PRESETS: { id: string; label: string; layout: PhaseLayout }[] = [
  { id: 'demo', label: 'Taman Demo (this prototype)', layout: { lorongs: 1, houses_per_row: 6, facing: true, blocks: 1, floors: 6, units_per_floor: 4 } },
  { id: 'landed', label: 'Landed phase', layout: { lorongs: 12, houses_per_row: 20, facing: true, blocks: 0, floors: 10, units_per_floor: 8 } },
  { id: 'mixed', label: 'Mixed phase', layout: { lorongs: 8, houses_per_row: 18, facing: true, blocks: 3, floors: 25, units_per_floor: 10 } },
]
const WORKS: { id: WorksType; label: string }[] = [
  { id: 'wet', label: 'Bathroom, kitchen, plumbing' }, { id: 'hacking', label: 'Hacking, drilling' },
  { id: 'structural', label: 'Extension, structural' }, { id: 'light', label: 'Painting, carpentry' },
]
export const PLANNER_HOMES = 'planner.homes'  // remembered (storage.ts)

/** SDP sets up a new phase from its site plan: every circle and notice zone, worked out with the live rules.
 *  Pilot: the real phase comes from SDP's handover list (import card on top); the layout explorer stays below. */
export default function PlannerView({ phases = [], current = null, onImported }: {
  phases?: PhaseInfo[]
  current?: PhaseInfo | null
  onImported?: (phaseId: string) => void
}) {
  const pilot = usePilot()
  const [preset, setPreset] = useState('mixed')
  const [layout, setLayout] = useState<PhaseLayout>(PRESETS[2].layout)
  const [plan, setPlan] = useState<PhasePlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      api.planPhase(layout).then((p) => {
        setPlan(p)
        setError(null)
        remember(PLANNER_HOMES, String(p.homes))
      }).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not work out this layout'))
    }, 250)
    return () => window.clearTimeout(timer.current)
  }, [layout])

  const set = (k: keyof PhaseLayout, v: number | boolean) => { setLayout((l) => ({ ...l, [k]: v })); setPreset('custom') }
  const pick = (id: string) => { const p = PRESETS.find((x) => x.id === id); if (p) { setLayout(p.layout); setPreset(id) } }

  function downloadCsv() {
    if (!plan) return
    const rows = [['home', 'label', 'type', 'circle_size', 'circle'], ...plan.units.map((u) => [u.id, u.label, u.kind, String(u.circle.length), u.circle.join(' ')])]
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `keynection-phase-circles-${plan.homes}-homes.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const maxBar = plan ? Math.max(...Object.values(plan.circle_sizes)) : 1
  return (
    <section className="screen">
      <ScreenTitle eyebrow="SDP · New phase" title="Phase setup"
        subtitle={pilot
          ? 'Import SDP’s handover list to set up a real phase. Below, try a layout from the site plan before the list is ready: nothing there is saved.'
          : "Describe the layout from the site plan. Keynection works out every household's circle and who each kind of renovation must notify, with the same rules the app uses. Nothing is saved."} />
      {pilot && onImported && <PhaseImport phases={phases} current={current} onImported={onImported} />}
      <div className="cols">
        <div className="col">
          <Card>
            <CardHead icon={<Grid3x3 size={16} />} title="Layout" sub="Start from a preset, then adjust" />
            <Segmented value={preset} onChange={pick} options={PRESETS.map((p) => ({ id: p.id, label: p.label }))} />
            <div className="planner-form">
              <fieldset>
                <legend><Home size={14} /> Terrace lorongs</legend>
                <Num label="Lorongs" value={layout.lorongs} min={0} max={60} onChange={(v) => set('lorongs', v)} />
                <Num label="Houses per row" value={layout.houses_per_row} min={2} max={80} onChange={(v) => set('houses_per_row', v)} />
                <label className="switch-row"><input type="checkbox" checked={layout.facing} onChange={(e) => set('facing', e.target.checked)} /> Two rows face each other across the road</label>
              </fieldset>
              <fieldset>
                <legend><Building size={14} /> Apartment blocks</legend>
                <Num label="Blocks" value={layout.blocks} min={0} max={12} onChange={(v) => set('blocks', v)} />
                <Num label="Residential floors" value={layout.floors} min={1} max={60} onChange={(v) => set('floors', v)} />
                <Num label="Units per floor" value={layout.units_per_floor} min={2} max={20} onChange={(v) => set('units_per_floor', v)} />
              </fieldset>
            </div>
            {error && <div className="tone-check"><TriangleAlert size={15} /><div>{error}</div></div>}
          </Card>
          {plan && <Diagram plan={plan} layout={layout} />}
        </div>

        <div className="col sticky">
          {!plan ? <Card><Skeleton lines={6} /></Card> : (
            <>
              <div className="kpi-mini">
                <div><b>{plan.homes.toLocaleString('en-MY')}</b><span>homes · {plan.terrace_homes} landed, {plan.apartment_homes} strata</span></div>
                <div><b>{plan.avg_circle}</b><span>neighbours in an average circle</span></div>
                <div><b>{plan.fewer_neighbours.toLocaleString('en-MY')}</b><span>with fewer (end lots, corners, top and lowest floors)</span></div>
                <div><b><Timer size={15} /> {plan.took_ms < 1000 ? 'under 1 s' : `${(plan.took_ms / 1000).toFixed(1)} s`}</b><span>to set up the whole phase{plan.took_ms < 1000 ? ` (${Math.round(plan.took_ms)} ms)` : ''}</span></div>
              </div>
              <Card>
                <CardHead icon={<Home size={16} />} title="Circle sizes" sub="How many homes each household gets to know" />
                <div className="bars">
                  {Object.entries(plan.circle_sizes).map(([size, n]) => (
                    <div key={size} className="bar-row">
                      <span>{size} neighbours</span>
                      <i style={{ width: `${(n / maxBar) * 100}%` }} />
                      <b>{n.toLocaleString('en-MY')}</b>
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHead icon={<Building size={16} />} title="Who a renovation notifies" sub="Average and largest notice list, by type of work" />
                <table className="zone-table">
                  <tbody>
                    {WORKS.map((w) => (
                      <tr key={w.id}><td>{w.label}</td><td>{plan.notice_zone[w.id].avg}</td><td className="muted">max {plan.notice_zone[w.id].max}</td></tr>
                    ))}
                  </tbody>
                </table>
                <div className="mono muted">ABOUT {Math.round(plan.avg_ring2)} MORE HOMES PER LORONG OR BLOCK ARE REACHABLE BY REQUEST</div>
              </Card>
              <Card>
                <CardHead icon={<ListChecks size={16} />} title="Before the pilot" />
                <ul className="plain-list">{plan.checks.map((c) => <li key={c}>{c}</li>)}</ul>
                <button className="btn btn-sm" onClick={downloadCsv}><Download size={14} /> Download household list (CSV)</button>
                <div className="small muted">One row per home with its circle, for the estate office to check. No resident data: homes only.</div>
              </Card>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <div className="stepper">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>−</button>
        <input type="number" value={value} min={min} max={max}
          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, Math.round(v)))) }} />
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>+</button>
      </div>
    </label>
  )
}

/** The first lorong and the first block, shaded by circle size: end lots and corners stand out. */
function Diagram({ plan, layout }: { plan: PhasePlan; layout: PhaseLayout }) {
  const size = new Map(plan.units.map((u) => [u.id, u.circle.length]))
  const shade = (n: number | undefined, full: number) => (n === undefined ? 'none' : n >= full ? 'full' : n >= full - 1 ? 'most' : 'few')
  const houses = Math.min(layout.houses_per_row, 30)
  const floors = Math.min(layout.floors, 12)  // the top floors are enough to show the pattern
  return (
    <Card className="drawing">
      <CardHead icon={<Grid3x3 size={16} />} title="Sample: first lorong and first block" sub="Darker = fewer neighbours. These are the circles the estate office checks by hand." />
      {layout.lorongs > 0 && (
        <div className="plan-grid terrace" style={{ ['--cols' as string]: houses }}>
          {(layout.facing ? ['L1B', 'road', 'L1A'] : ['L1A']).map((row) => row === 'road'
            ? <div key="road" className="plan-road">ROAD</div>
            : Array.from({ length: houses }, (_, i) => <span key={`${row}-${i}`} className={`cell ${shade(size.get(`${row}-${i + 1}`), 5)}`} title={`${row}-${i + 1}: ${size.get(`${row}-${i + 1}`)} neighbours`} />))}
        </div>
      )}
      {layout.blocks > 0 && (
        <div className="plan-grid block" style={{ ['--cols' as string]: layout.units_per_floor }}>
          {Array.from({ length: floors }, (_, k) => layout.floors - k).map((f) => Array.from({ length: layout.units_per_floor }, (_, i) => (
            <span key={`A-${f}-${i + 1}`} className={`cell ${shade(size.get(`A-${f}-${i + 1}`), 4)}`} title={`A-${f}-${i + 1}: ${size.get(`A-${f}-${i + 1}`)} neighbours`} />
          )))}
        </div>
      )}
      {(layout.houses_per_row > houses || layout.floors > floors) && <div className="mono muted">SHOWING PART OF THE LAYOUT</div>}
      <div className="legend">
        <span><i className="cell full" />Full circle</span><span><i className="cell most" />One fewer</span><span><i className="cell few" />Two or more fewer</span>
      </div>
    </Card>
  )
}
