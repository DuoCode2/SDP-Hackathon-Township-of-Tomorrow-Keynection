import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Hammer, Send } from 'lucide-react'
import { api, type Neighbour, type Renovation, type UnitInfo } from '../api'
import { LANGS, RELATION_LABEL, introTemplate, type Lang } from '../messages'
import { Avatar, Badge, Card, CountUp, ScreenTitle, Skeleton, useToast } from '../ui'

type CardNeighbour = Neighbour & { known: boolean }

interface Props {
  me: UnitInfo
  units: UnitInfo[]
  version: number
  onChange: () => void
  onPick: (unitId: string) => void
}

export default function CircleView({ me, units, version, onChange, onPick }: Props) {
  const [circle, setCircle] = useState<CardNeighbour[] | null>(null)

  useEffect(() => {
    let live = true
    api.card(me.id).then((c) => live && setCircle(c.neighbours))
    return () => {
      live = false
    }
  }, [me.id, version])

  const known = circle?.filter((n) => n.known).length ?? 0

  return (
    <section className="screen">
      <ScreenTitle eyebrow={`${me.kind === 'terrace' ? 'Terrace' : 'Apartment'} · ${me.label}`} title={`Hi, ${me.resident_name}`}
        subtitle="Your five closest neighbours, worked out from the floor plan the day you got your keys." />

      <div className="stat-grid">
        <div className="stat"><b>{circle ? <CountUp value={circle.length} /> : '–'}</b><span>In circle</span></div>
        <div className="stat"><b className="accent">{circle ? <CountUp value={known} /> : '–'}</b><span>Known</span></div>
        <div className="stat"><b>{circle ? <CountUp value={circle.length - known} /> : '–'}</b><span>To meet</span></div>
      </div>

      <Card>
        <PhaseMap units={units} meId={me.id} circleIds={circle?.map((n) => n.id) ?? []} onPick={onPick} />
      </Card>

      <div className="section-label">Neighbour circle</div>
      <Card>
        {!circle ? (
          <Skeleton lines={4} />
        ) : (
          <div className="people">
            {circle.map((n) => (
              <div key={n.id} className="person">
                <Avatar name={n.resident_name} />
                <div className="grow">
                  <div className="person-name">
                    {n.resident_name} <span className="muted">· {n.label}</span>
                  </div>
                  <div className="person-rel">{RELATION_LABEL[n.relation].toUpperCase()}</div>
                </div>
                {n.known ? <Badge tone="brand">Known</Badge> : <Badge>Pending</Badge>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {circle && <IntroComposer me={me} recipients={circle.length} onSent={onChange} />}
    </section>
  )
}

function PhaseMap({ units, meId, circleIds, onPick }: {
  units: UnitInfo[]
  meId: string
  circleIds: string[]
  onPick: (unitId: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const cells = useRef(new Map<string, HTMLButtonElement>())
  const [links, setLinks] = useState<{ id: string; x1: number; y1: number; x2: number; y2: number }[]>([])
  const key = circleIds.join(',')

  // Draw a line from my home to each neighbour; recomputed when the layout changes size.
  useLayoutEffect(() => {
    const measure = () => {
      const root = box.current?.getBoundingClientRect()
      const mine = cells.current.get(meId)?.getBoundingClientRect()
      if (!root || !mine) return
      const centre = (r: DOMRect) => ({ x: r.left - root.left + r.width / 2, y: r.top - root.top + r.height / 2 })
      const a = centre(mine)
      setLinks(circleIds.flatMap((id) => {
        const el = cells.current.get(id)
        if (!el) return []
        const b = centre(el.getBoundingClientRect())
        return [{ id, x1: a.x, y1: a.y, x2: b.x, y2: b.y }]
      }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [meId, key])

  const cell = (u: UnitInfo) => (
    <button
      key={u.id}
      ref={(el) => { if (el) cells.current.set(u.id, el); else cells.current.delete(u.id) }}
      className={`cell ${u.id === meId ? 'me' : circleIds.includes(u.id) ? 'circle' : ''}`}
      onClick={() => onPick(u.id)}
      title={`${u.label} · ${u.resident_name}`}
    >
      {u.kind === 'terrace' ? u.label.replace('No. ', '') : `${u.floor}-${u.pos}`}
    </button>
  )
  const row = (name: string) => units.filter((u) => u.row === name).sort((a, b) => a.pos - b.pos)
  const floor = (f: number) => units.filter((u) => u.block === 'A' && u.floor === f).sort((a, b) => a.pos - b.pos)

  return (
    <div className="map" ref={box}>
      <svg className="map-links" aria-hidden>
        {links.map((l) => <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />)}
      </svg>
      <div className="map-label">Terrace · Jalan Demo 1</div>
      <div className="map-row">{row('north').map(cell)}</div>
      <div className="road" />
      <div className="map-row">{row('south').map(cell)}</div>
      <div className="map-label" style={{ marginTop: 6 }}>Block A · Floors 13–15</div>
      {[15, 14, 13].map((f) => (
        <div key={f} className="map-row apt">{floor(f).map(cell)}</div>
      ))}
      <div className="legend">
        <span><i className="lg-me" />YOU</span>
        <span><i className="lg-circle" />CIRCLE</span>
        <span>TAP A HOME TO SWITCH</span>
      </div>
    </div>
  )
}

function IntroComposer({ me, recipients, onSent }: { me: UnitInfo; recipients: number; onSent: () => void }) {
  const toast = useToast()
  const [lang, setLang] = useState<Lang>('en')
  const [renovating, setRenovating] = useState(false)
  const [reno, setReno] = useState<Renovation>({
    scope: me.kind === 'terrace' ? 'Extend kitchen (rear wall)' : 'Re-tile bathroom',
    start: '2026-10-15',
    end: '2026-10-30',
    noisy_hours: 'weekdays 9am-5pm, no weekends',
    noisy_from: '09:00',
    noisy_to: '17:00',
    weekdays_only: true,
    contractor: 'ABC Renovation',
    contractor_cidb_registered: true,
  })
  const [draft, setDraft] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const hours = `${reno.weekdays_only ? 'weekdays' : 'Mon–Sat'} ${reno.noisy_from}–${reno.noisy_to}${reno.weekdays_only ? ', no weekends' : ''}`
  const full: Renovation = { ...reno, noisy_hours: hours }
  const message = draft ?? introTemplate(lang, me.resident_name, me.label, renovating ? full : undefined)
  const set = (k: keyof Renovation) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setReno({ ...reno, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
    setDraft(null)
  }

  async function send() {
    setSending(true)
    try {
      const res = await api.sendIntro({ from_unit_id: me.id, message, lang, renovation: renovating ? full : undefined })
      toast(`Delivered to ${res.recipients.length} neighbours`)
      setDraft(null)
      onSent()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <Card className="glow">
      <div className="card-title">Say hello to your {recipients} neighbours</div>
      <label className="field">
        Language
        <select value={lang} onChange={(e) => { setLang(e.target.value as Lang); setDraft(null) }}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </label>
      <label className="switch-row">
        <input type="checkbox" checked={renovating} onChange={(e) => { setRenovating(e.target.checked); setDraft(null) }} />
        <span>
          <strong style={{ color: 'var(--text)' }}><Hammer size={13} style={{ verticalAlign: -2 }} /> I'm planning renovation</strong>
          <br />
          Neighbours get the dates and quiet-hour rules. Logged in your home record.
        </span>
      </label>
      {renovating && (
        <>
          <label className="field">Work<input value={reno.scope} onChange={set('scope')} maxLength={120} /></label>
          <div className="grid-2">
            <label className="field">Start<input type="date" value={reno.start} onChange={set('start')} /></label>
            <label className="field">End<input type="date" value={reno.end} min={reno.start} onChange={set('end')} /></label>
          </div>
          <div className="grid-2">
            <label className="field">Noisy from<input type="time" value={reno.noisy_from} onChange={set('noisy_from')} /></label>
            <label className="field">Noisy until<input type="time" value={reno.noisy_to} onChange={set('noisy_to')} /></label>
          </div>
          <label className="switch-row">
            <input type="checkbox" checked={!!reno.weekdays_only} onChange={set('weekdays_only')} />
            No noisy work on weekends
          </label>
          <label className="field">Contractor<input value={reno.contractor ?? ''} onChange={set('contractor')} maxLength={80} /></label>
          <label className="switch-row">
            <input type="checkbox" checked={!!reno.contractor_cidb_registered} onChange={set('contractor_cidb_registered')} />
            Contractor is CIDB-registered (check simulated in the prototype)
          </label>
        </>
      )}
      <textarea className="input" rows={5} value={message} maxLength={1000} onChange={(e) => setDraft(e.target.value)} />
      <button className="btn btn-primary btn-block" onClick={send} disabled={recipients === 0 || sending}>
        <Send size={16} /> {sending ? 'Sending…' : 'Send on WhatsApp'}
      </button>
    </Card>
  )
}
