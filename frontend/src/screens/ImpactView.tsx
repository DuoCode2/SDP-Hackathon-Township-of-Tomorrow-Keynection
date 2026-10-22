import { useEffect, useState } from 'react'
import { Calculator, Clock4, Info, MessageSquareWarning, Scale, Users, Wallet } from 'lucide-react'
import { api } from '../api'
import { useT } from '../i18n'
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
  { key: 'selangor', never: 13.2, daily: 27.9 },
  { key: 'kl', never: 13.9, daily: 19.9 },
  { key: 'n9', never: 5.6, daily: 37.2 },
  { key: 'johor', never: 7.7, daily: 33.4 },
  { key: 'malaysia', never: 6.5, daily: 41.4 },
] as const

// Each input's label and note are `sdp.im.in.<key>` and `sdp.im.in.<key>.note`; its unit is `sdp.im.unit.<unit>`.
type Input = { key: string; unit: 'homes' | 'pct' | 'claims' | 'hours' | 'rm' | 'alerts'; value: number; min: number; max: number; step: number }

const INPUTS: Input[] = [
  { key: 'homes', unit: 'homes', value: 1000, min: 10, max: 5000, step: 10 },
  { key: 'cut', unit: 'pct', value: 50, min: 0, max: 100, step: 5 },
  { key: 'disputes', unit: 'claims', value: 3, min: 0, max: 50, step: 1 },
  { key: 'disputeHours', unit: 'hours', value: 8, min: 0, max: 80, step: 1 },
  { key: 'photoShare', unit: 'pct', value: 50, min: 0, max: 100, step: 1 },
  { key: 'renoRate', unit: 'pct', value: 40, min: 0, max: 100, step: 1 },
  { key: 'complaintRate', unit: 'pct', value: 30, min: 0, max: 100, step: 1 },
  { key: 'hoursToday', unit: 'hours', value: 3, min: 0, max: 40, step: 0.5 },
  { key: 'settled', unit: 'pct', value: 60, min: 0, max: 100, step: 1 },
  { key: 'faster', unit: 'pct', value: 30, min: 0, max: 100, step: 1 },
  { key: 'rate', unit: 'rm', value: 45, min: 0, max: 500, step: 1 },
  { key: 'zone', unit: 'homes', value: 5, min: 1, max: 12, step: 0.5 },
  { key: 'msgs', unit: 'alerts', value: 4, min: 0, max: 20, step: 1 },
  { key: 'msgCost', unit: 'rm', value: 0.06, min: 0, max: 1, step: 0.01 },
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
  const t = useT()
  const [v, setV] = useState<Record<string, number>>(initial)
  // Without a Phase setup to go by, the model sizes itself to the phase on screen, so its household counts match the
  // command view (Taman Demo: 42 homes) instead of an example thousand.
  useEffect(() => {
    if (remembered(PLANNER_HOMES)) return
    let live = true
    api.units().then((u) => { if (live && u.length > 0) setV((x) => ({ ...x, homes: u.length })) }).catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const [state, setState] = useState<(typeof CENSUS)[number]['key']>('selangor')
  const p = (k: string) => v[k] / 100
  const census = CENSUS.find((c) => c.key === state) ?? CENSUS[0]
  const place = t(`sdp.im.state.${census.key}`)
  const hours = (n: number) => t('sdp.im.hours', { n: num(n) })

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
      <ScreenTitle eyebrow={t('sdp.im.eyebrow')} title={t('nav.impact')} subtitle={t('sdp.im.subtitle')} />
      <div className="assumption-banner"><Info size={16} /> {t('sdp.im.banner')}</div>

      <Card className="connection-card">
        <CardHead icon={<Users size={16} />} title={t('sdp.im.conn.title')}
          sub={<>{t('sdp.im.conn.sub')} <a href={CENSUS_SOURCE} target="_blank" rel="noreferrer">{t('sdp.im.conn.source')}</a></>} />
        <div className="census-pick">
          <label className="assume">
            <span className="assume-label"><b>{t('sdp.im.state')}</b><small>{t('sdp.im.state.note')}</small></span>
            <span className="assume-input">
              <select value={state} onChange={(e) => setState(e.target.value as typeof state)}>
                {CENSUS.map((c) => <option key={c.key} value={c.key}>{t(`sdp.im.state.${c.key}`)}</option>)}
              </select>
            </span>
          </label>
        </div>
        <div className="kpi-mini census-kpis">
          <div><b>{census.never}%</b><span>{t('sdp.im.kpi.never', { state: place, all: CENSUS[4].never })}</span></div>
          <div><b>{census.daily}%</b><span>{t('sdp.im.kpi.daily', { state: place, all: CENSUS[4].daily })}</span></div>
        </div>
        <Line label={t('sdp.im.l.today')} value={num(noContactToday)} formula={t('sdp.im.f.today')} />
        <Line label={t('sdp.im.l.after')} value={num(noContactAfter)} formula={t('sdp.im.f.after')} />
        <Line label={t('sdp.im.l.newly')} value={num(noContactToday - noContactAfter)} formula={t('sdp.im.f.newly')} strong />
        <p className="small muted census-note">{t('sdp.im.conn.note')}</p>
      </Card>

      <div className="cols">
        <div className="col">
          <Card>
            <CardHead icon={<Calculator size={16} />} title={t('sdp.im.inputs')} sub={t('sdp.im.inputs.sub')} />
            <div className="inputs">
              {INPUTS.map((i) => (
                <label key={i.key} className="assume">
                  <span className="assume-label"><b>{t(`sdp.im.in.${i.key}`)}</b><small>{t(`sdp.im.in.${i.key}.note`)}</small></span>
                  <span className="assume-input">
                    <input type="number" value={v[i.key]} min={i.min} max={i.max} step={i.step}
                      onChange={(e) => { const x = Number(e.target.value); if (Number.isFinite(x)) setV((s) => ({ ...s, [i.key]: Math.min(i.max, Math.max(i.min, x)) })) }} />
                    <em>{t(`sdp.im.unit.${i.unit}`)}</em>
                  </span>
                </label>
              ))}
            </div>
            <button className="link" onClick={() => setV(Object.fromEntries(INPUTS.map((i) => [i.key, i.value])))}>{t('sdp.im.reset')}</button>
          </Card>
        </div>

        <div className="col sticky">
          {/* Connection on top: the census-question result, then the two rates the command view measures live (not fetched here). */}
          <div className="kpi-mini">
            <div style={{ gridColumn: '1 / -1' }}><b>{num(noContactToday - noContactAfter)}</b><span>{t('sdp.im.kpi.newly')}</span></div>
            <div><b>—</b><span>{t('sdp.im.kpi.pairs')}</span></div>
            <div><b>—</b><span>{t('sdp.im.kpi.days')}</span></div>
          </div>
          <Card>
            <CardHead icon={<Scale size={16} />} title={t('sdp.im.disputes')} sub={t('sdp.im.disputes.sub')} />
            <Line label={t('sdp.im.l.disputed')} value={num(disputes)} formula={t('sdp.im.f.disputed')} />
            <Line label={t('sdp.im.l.hoursSaved')} value={hours(disputeSaved)} formula={t('sdp.im.f.hoursSaved')} />
          </Card>
          <Card>
            <CardHead icon={<MessageSquareWarning size={16} />} title={t('sdp.im.complaints')} sub={t('sdp.im.complaints.sub')} />
            <Line label={t('sdp.im.l.renovations')} value={num(renovations)} formula={t('sdp.im.f.renovations')} />
            <Line label={t('sdp.im.l.complaints')} value={num(complaints)} formula={t('sdp.im.f.complaints')} />
            <Line label={t('sdp.im.l.settled')} value={num(complaints * p('settled'))} formula={t('sdp.im.f.settled')} />
            <Compare a={hoursToday} b={hoursWith} hours={hours} labels={[t('sdp.im.cmp.today'), t('sdp.im.cmp.with'), t('sdp.im.cmp.formula')]} />
          </Card>
          <Card>
            <CardHead icon={<Calculator size={16} />} title={t('sdp.im.save')} />
            <div className="kpi-mini">
              <div><b>{hours(hoursSaved)}</b><span>{t('sdp.im.save.hours')}</span></div>
              <div><b>{rm(net)}</b><span>{t('sdp.im.save.net')}</span></div>
            </div>
          </Card>
          <Card>
            <CardHead icon={<Wallet size={16} />} title={t('sdp.im.money')} />
            <Line label={t('sdp.im.l.staffSaved')} value={rm(staffSaved)} formula={t('sdp.im.f.staffSaved')} />
            <Line label={t('sdp.im.l.wa')} value={`− ${rm(waCost)}`} formula={t('sdp.im.f.wa')} />
            <Line label={t('sdp.im.l.net')} value={rm(net)} formula={t('sdp.im.f.net')} strong />
          </Card>
          <Card>
            <CardHead icon={<Clock4 size={16} />} title={t('sdp.im.notCounted')} />
            <ul className="plain-list">
              <li>{t('sdp.im.nc.1')}</li>
              <li>{t('sdp.im.nc.2')}</li>
              <li>{t('sdp.im.nc.3')}</li>
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

function Compare({ a, b, hours, labels }: { a: number; b: number; hours: (n: number) => string; labels: [string, string, string] }) {
  const max = Math.max(a, b, 1)
  return (
    <div className="compare-bars">
      <div><span>{labels[0]}</span><i style={{ width: `${(a / max) * 100}%` }} /><b>{hours(a)}</b></div>
      <div className="with"><span>{labels[1]}</span><i style={{ width: `${(b / max) * 100}%` }} /><b>{hours(b)}</b></div>
      <small className="mono muted">{labels[2]}</small>
    </div>
  )
}
