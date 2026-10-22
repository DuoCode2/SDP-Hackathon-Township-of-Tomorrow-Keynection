import { useEffect, useRef, useState } from 'react'
import { Building, Download, Grid3x3, Home, ListChecks, Timer, TriangleAlert } from 'lucide-react'
import { api, ApiError, type PhaseInfo, type PhaseLayout, type PhasePlan, type WorksType } from '../api'
import { usePilot } from '../features'
import { useT } from '../i18n'
import PhaseImport from '../components/PhaseImport'
import { remember } from '../storage'
import { Card, CardHead, ScreenTitle, Segmented, Skeleton } from '../ui'

// Each preset's label is `sdp.ph.preset.<id>`; each type of work's label is `sdp.ph.works.<id>`.
const PRESETS: { id: string; layout: PhaseLayout }[] = [
  { id: 'demo', layout: { lorongs: 1, houses_per_row: 6, facing: true, blocks: 1, floors: 6, units_per_floor: 4 } },
  { id: 'landed', layout: { lorongs: 12, houses_per_row: 20, facing: true, blocks: 0, floors: 10, units_per_floor: 8 } },
  { id: 'mixed', layout: { lorongs: 8, houses_per_row: 18, facing: true, blocks: 3, floors: 25, units_per_floor: 10 } },
]
const WORKS: WorksType[] = ['wet', 'hacking', 'structural', 'light']
export const PLANNER_HOMES = 'planner.homes'  // remembered (storage.ts)
// The server's "before the pilot" checklist (planner.py), in the reader's language; a line it doesn't know shows as written.
const CHECKS: Record<string, string> = {
  'End and corner lots, top and ground floors get fewer neighbours automatically.': 'sdp.ph.check.lots',
  'Semi-Ds, shoplots and odd-shaped plots are not modelled: the estate office checks those circles by hand.': 'sdp.ph.check.irregular',
  'Lower floors of a block share the same rules; podium car parks and facilities floors should be left out.': 'sdp.ph.check.podium',
}

/** SDP sets up a new phase from its site plan: every circle and notice zone, worked out with the live rules.
 *  Pilot: the real phase comes from SDP's handover list (import card on top); the layout explorer stays below. */
export default function PlannerView({ phases = [], current = null, onImported }: {
  phases?: PhaseInfo[]
  current?: PhaseInfo | null
  onImported?: (phaseId: string) => void
}) {
  const pilot = usePilot()
  const t = useT()
  const [preset, setPreset] = useState('mixed')
  const [layout, setLayout] = useState<PhaseLayout>(PRESETS[2].layout)
  const [plan, setPlan] = useState<PhasePlan | null>(null)
  const [error, setError] = useState<string | null>(null)  // the server's reason, or '' when it gave none (worded when shown)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      api.planPhase(layout).then((p) => {
        setPlan(p)
        setError(null)
        remember(PLANNER_HOMES, String(p.homes))
      }).catch((e) => setError(e instanceof ApiError ? e.message : ''))
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
      <ScreenTitle eyebrow={t('sdp.ph.eyebrow')} title={t('nav.planner')}
        subtitle={pilot ? t('sdp.ph.subtitle.pilot') : t('sdp.ph.subtitle.demo')} />
      {pilot && onImported && <PhaseImport phases={phases} current={current} onImported={onImported} />}
      <div className="cols">
        <div className="col">
          <Card>
            <CardHead icon={<Grid3x3 size={16} />} title={t('sdp.ph.layout')} sub={t('sdp.ph.layout.sub')} />
            <Segmented value={preset} onChange={pick} options={PRESETS.map((p) => ({ id: p.id, label: t(`sdp.ph.preset.${p.id}`) }))} />
            <div className="planner-form">
              <fieldset>
                <legend><Home size={14} /> {t('sdp.ph.legend.terrace')}</legend>
                <Num label={t('sdp.ph.num.lorongs')} value={layout.lorongs} min={0} max={60} onChange={(v) => set('lorongs', v)} />
                <Num label={t('sdp.ph.num.houses')} value={layout.houses_per_row} min={2} max={80} onChange={(v) => set('houses_per_row', v)} />
                <label className="switch-row"><input type="checkbox" checked={layout.facing} onChange={(e) => set('facing', e.target.checked)} /> {t('sdp.ph.facing')}</label>
              </fieldset>
              <fieldset>
                <legend><Building size={14} /> {t('sdp.ph.legend.blocks')}</legend>
                <Num label={t('sdp.ph.num.blocks')} value={layout.blocks} min={0} max={12} onChange={(v) => set('blocks', v)} />
                <Num label={t('sdp.ph.num.floors')} value={layout.floors} min={1} max={60} onChange={(v) => set('floors', v)} />
                <Num label={t('sdp.ph.num.units')} value={layout.units_per_floor} min={2} max={20} onChange={(v) => set('units_per_floor', v)} />
              </fieldset>
            </div>
            {error !== null && <div className="tone-check"><TriangleAlert size={15} /><div>{error || t('sdp.ph.err.layout')}</div></div>}
          </Card>
          {plan && <Diagram plan={plan} layout={layout} />}
        </div>

        <div className="col sticky">
          {!plan ? <Card><Skeleton lines={6} /></Card> : (
            <>
              <div className="kpi-mini">
                <div><b>{plan.homes.toLocaleString('en-MY')}</b><span>{t('sdp.ph.kpi.homes', { a: plan.terrace_homes, b: plan.apartment_homes })}</span></div>
                <div><b>{plan.avg_circle}</b><span>{t('sdp.ph.kpi.avg')}</span></div>
                <div><b>{plan.fewer_neighbours.toLocaleString('en-MY')}</b><span>{t('sdp.ph.kpi.fewer')}</span></div>
                <div><b><Timer size={15} /> {plan.took_ms < 1000 ? t('sdp.ph.kpi.under1s') : t('sdp.ph.kpi.secs', { s: (plan.took_ms / 1000).toFixed(1) })}</b><span>{plan.took_ms < 1000 ? t('sdp.ph.kpi.tookMs', { ms: Math.round(plan.took_ms) }) : t('sdp.ph.kpi.took')}</span></div>
              </div>
              <Card>
                <CardHead icon={<Home size={16} />} title={t('sdp.ph.sizes')} sub={t('sdp.ph.sizes.sub')} />
                <div className="bars">
                  {Object.entries(plan.circle_sizes).map(([size, n]) => (
                    <div key={size} className="bar-row">
                      <span>{t('sdp.ph.sizes.n', { size })}</span>
                      <i style={{ width: `${(n / maxBar) * 100}%` }} />
                      <b>{n.toLocaleString('en-MY')}</b>
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHead icon={<Building size={16} />} title={t('sdp.ph.zone')} sub={t('sdp.ph.zone.sub')} />
                <table className="zone-table">
                  <tbody>
                    {WORKS.map((w) => (
                      <tr key={w}><td>{t(`sdp.ph.works.${w}`)}</td><td>{plan.notice_zone[w].avg}</td><td className="muted">{t('sdp.ph.zone.max', { n: plan.notice_zone[w].max })}</td></tr>
                    ))}
                  </tbody>
                </table>
                <div className="mono muted">{t('sdp.ph.zone.ring2', { n: Math.round(plan.avg_ring2) })}</div>
              </Card>
              <Card>
                <CardHead icon={<ListChecks size={16} />} title={t('sdp.ph.before')} />
                <ul className="plain-list">{plan.checks.map((c) => <li key={c}>{CHECKS[c] ? t(CHECKS[c]) : c}</li>)}</ul>
                <button className="btn btn-sm" onClick={downloadCsv}><Download size={14} /> {t('sdp.ph.csv')}</button>
                <div className="small muted">{t('sdp.ph.csv.note')}</div>
              </Card>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const t = useT()
  const what = label.toLowerCase()
  return (
    <label className="num-field">
      <span>{label}</span>
      <div className="stepper">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={t('sdp.ph.num.fewer', { what })}>−</button>
        <input type="number" value={value} min={min} max={max}
          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, Math.round(v)))) }} />
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={t('sdp.ph.num.more', { what })}>+</button>
      </div>
    </label>
  )
}

/** The first lorong and the first block, shaded by circle size: end lots and corners stand out. */
function Diagram({ plan, layout }: { plan: PhasePlan; layout: PhaseLayout }) {
  const t = useT()
  const size = new Map(plan.units.map((u) => [u.id, u.circle.length]))
  const shade = (n: number | undefined, full: number) => (n === undefined ? 'none' : n >= full ? 'full' : n >= full - 1 ? 'most' : 'few')
  const cell = (id: string, full: number) => <span key={id} className={`cell ${shade(size.get(id), full)}`} title={t('sdp.ph.diagram.cell', { id, n: String(size.get(id)) })} />
  const houses = Math.min(layout.houses_per_row, 30)
  const floors = Math.min(layout.floors, 12)  // the top floors are enough to show the pattern
  return (
    <Card className="drawing">
      <CardHead icon={<Grid3x3 size={16} />} title={t('sdp.ph.diagram')} sub={t('sdp.ph.diagram.sub')} />
      {layout.lorongs > 0 && (
        <div className="plan-grid terrace" style={{ ['--cols' as string]: houses }}>
          {(layout.facing ? ['L1B', 'road', 'L1A'] : ['L1A']).map((row) => row === 'road'
            ? <div key="road" className="plan-road">{t('sdp.ph.diagram.road')}</div>
            : Array.from({ length: houses }, (_, i) => cell(`${row}-${i + 1}`, 5)))}
        </div>
      )}
      {layout.blocks > 0 && (
        <div className="plan-grid block" style={{ ['--cols' as string]: layout.units_per_floor }}>
          {Array.from({ length: floors }, (_, k) => layout.floors - k).map((f) => Array.from({ length: layout.units_per_floor }, (_, i) => cell(`A-${f}-${i + 1}`, 4)))}
        </div>
      )}
      {(layout.houses_per_row > houses || layout.floors > floors) && <div className="mono muted">{t('sdp.ph.diagram.part')}</div>}
      <div className="legend">
        <span><i className="cell full" />{t('sdp.ph.diagram.full')}</span><span><i className="cell most" />{t('sdp.ph.diagram.one')}</span><span><i className="cell few" />{t('sdp.ph.diagram.two')}</span>
      </div>
    </Card>
  )
}
