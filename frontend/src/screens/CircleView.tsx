import { useEffect, useState } from 'react'
import { Eye, Hammer, Languages, Map as MapIcon, MessageSquareText, MessagesSquare, Send, Users } from 'lucide-react'
import { api, type Neighbour, type Renovation, type UnitInfo } from '../api'
import { LANGS, RELATION_LABEL, introTemplate, type Lang } from '../messages'
import PlanMap from '../components/PlanMap'
import { LANG_TAG, roleOf } from '../components/Cast'
import { Avatar, Badge, Card, CardHead, CountUp, Metric, ScreenTitle, Segmented, Skeleton, useToast } from '../ui'

type CardNeighbour = Neighbour & { known: boolean }

interface Props {
  me: UnitInfo
  units: UnitInfo[]
  version: number
  onChange: () => void
  onViewAs: (unitId: string) => void
  onOpenChat: (unitId: string) => void
}

const LANG_NAME: Record<string, string> = { en: 'English', ms: 'Bahasa Melayu', zh: '中文' }
const SHARES: Partial<Record<string, string>> = { left: 'Shares a wall with you', right: 'Shares a wall with you', above: 'Lives above you: shared slab', below: 'Lives below you: shared slab' }

export default function CircleView({ me, units, version, onChange, onViewAs, onOpenChat }: Props) {
  const [circle, setCircle] = useState<CardNeighbour[] | null>(null)
  const [view, setView] = useState<'terrace' | 'apartment'>(me.kind)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.card(me.id).then((c) => live && setCircle(c.neighbours))
    return () => {
      live = false
    }
  }, [me.id, version])

  const known = circle?.filter((n) => n.known).length ?? 0
  const pick = (id: string) => {
    setSelected(id)
    const u = units.find((x) => x.id === id)
    if (u && u.kind !== view) setView(u.kind)
  }
  const sel = units.find((u) => u.id === selected)
  const selN = circle?.find((n) => n.id === selected)

  return (
    <section className="screen">
      <ScreenTitle eyebrow={`Layer 1 · Know · ${me.kind === 'terrace' ? 'Terrace' : 'Apartment'} ${me.label}`} title={`Hi, ${me.resident_name}`}
        subtitle="Your five closest neighbours, worked out from the floor plan the day you got your keys."
        aside={
          <div className="metrics">
            <Metric value={circle ? <CountUp value={circle.length} /> : '–'} label="In circle" />
            <Metric value={circle ? <CountUp value={known} /> : '–'} label="Known" tone="brand" />
            <Metric value={circle ? <CountUp value={circle.length - known} /> : '–'} label="To meet" />
          </div>
        } />

      <div className="cols">
        <Card className="drawing">
          <div className="plan-head">
            <CardHead icon={<MapIcon size={16} />} title="Taman Demo · Phase 1" sub="Click a home to see who lives there" />
            <Segmented value={view} onChange={setView} options={[{ id: 'terrace', label: 'Jalan Demo 1' }, { id: 'apartment', label: 'Block A' }]} />
          </div>
          <PlanMap units={units} me={me} circle={circle ?? []} selected={selected} onSelect={pick} view={view} />
          <div className="legend">
            <span><i className="lg-me" />You</span>
            <span><i className="lg-circle" />Your circle</span>
            <span><i className="lg-wall" />Shared wall / slab</span>
            <span><i className="lg-works" />Renovation in progress</span>
          </div>
          {sel ? (
            <div className="home-detail">
              <Avatar name={sel.resident_name} size={40} />
              <div className="grow">
                <b>{sel.resident_name} <i>· {sel.label}</i></b>
                <small>
                  {sel.id === me.id ? 'This is you' : selN ? `${RELATION_LABEL[selN.relation]} · ${SHARES[selN.relation] ?? 'Across the road from you'}` : 'Not in your circle'}
                  {' · '}<Languages size={11} style={{ verticalAlign: -1 }} /> {LANG_NAME[sel.lang]}
                  {sel.renovating ? ' · renovating now' : ''}
                </small>
              </div>
              {selN && <button className="btn btn-sm" onClick={() => onOpenChat(sel.id)}><MessagesSquare size={14} /> Message</button>}
              {sel.id !== me.id && (
                <button className="btn btn-sm btn-ghost" onClick={() => onViewAs(sel.id)} title="Demo only: see the app as this household">
                  <Eye size={14} /> View as {sel.resident_name}
                </button>
              )}
            </div>
          ) : (
            <div className="home-detail empty">Tip: pick a highlighted home to message them, or use <b>View as</b> to see their side (demo only).</div>
          )}
        </Card>

        <Card>
          <CardHead icon={<Users size={16} />} title="Your circle" sub={me.kind === 'terrace' ? 'Left, right and three across the road' : 'Left, right, upstairs and downstairs'}
            right={circle && <span className="mono accent">{known}/{circle.length}</span>} />
          {circle && (
            <div className="progress" aria-hidden><i style={{ width: `${circle.length ? (known / circle.length) * 100 : 0}%` }} /></div>
          )}
          {!circle ? (
            <Skeleton lines={4} />
          ) : (
            <div className="people">
              {circle.map((n) => {
                const u = units.find((x) => x.id === n.id)
                return (
                  <button key={n.id} className={`person ${selected === n.id ? 'on' : ''}`} onClick={() => pick(n.id)}>
                    <Avatar name={n.resident_name} />
                    <span className="grow">
                      <span className="person-name">
                        {n.resident_name} <span className="muted">· {n.label}</span>
                        {u?.renovating && <Hammer size={12} className="flag-works" style={{ marginLeft: 6, verticalAlign: -1 }} />}
                      </span>
                      <span className="person-rel">{RELATION_LABEL[n.relation].toUpperCase()} · {LANG_TAG[n.lang]}</span>
                    </span>
                    {n.known ? <Badge tone="brand">Known</Badge> : <Badge>Pending</Badge>}
                  </button>
                )
              })}
            </div>
          )}
          <div className="small muted">You are <b>{roleOf(me.id).toLowerCase()}</b> in this demo. Only these five households can message you.</div>
        </Card>
      </div>

      {circle && <IntroComposer key={me.id} me={me} recipients={circle.length} onSent={onChange} />}
    </section>
  )
}

function IntroComposer({ me, recipients, onSent }: { me: UnitInfo; recipients: number; onSent: () => void }) {
  const toast = useToast()
  const [lang, setLang] = useState<Lang>(me.lang)
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
    council_permit: me.kind === 'terrace' ? 'approved' : 'not_needed',
    permit_ref: me.kind === 'terrace' ? 'PBT/2026/0412' : '',
  })
  const [draft, setDraft] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const hours = `${reno.weekdays_only ? 'weekdays' : 'Mon–Sat'} ${reno.noisy_from}–${reno.noisy_to}${reno.weekdays_only ? ', no weekends' : ''}`
  const full: Renovation = { ...reno, noisy_hours: hours }
  const message = draft ?? introTemplate(lang, me.resident_name, me.label, renovating ? full : undefined)
  const set = (k: keyof Renovation) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setReno({ ...reno, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
    setDraft(null)
  }

  async function send() {
    setSending(true)
    try {
      const renovation = renovating ? { ...full, permit_ref: full.council_permit === 'not_needed' ? null : full.permit_ref || null } : undefined
      const res = await api.sendIntro({ from_unit_id: me.id, message, lang, renovation })
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
      <CardHead icon={<MessageSquareText size={16} />} title={`Say hello to your ${recipients} neighbours`} sub="Sent on WhatsApp · logged in your home record" />
      <div className="composer">
        <div className="composer-form">
          <label className="field">
            Language
            <select value={lang} onChange={(e) => { setLang(e.target.value as Lang); setDraft(null) }}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </label>
          <label className={`switch-row option ${renovating ? 'on' : ''}`}>
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
              <div className="grid-2">
                <label className="field">Council (PBT) permit
                  <select value={reno.council_permit ?? 'not_needed'} onChange={set('council_permit')}>
                    <option value="approved">Approved</option>
                    <option value="applied">Applied, waiting</option>
                    <option value="not_needed">Not needed for this work</option>
                  </select>
                </label>
                <label className="field">Permit reference
                  <input value={reno.permit_ref ?? ''} onChange={set('permit_ref')} maxLength={40} disabled={reno.council_permit === 'not_needed'} placeholder="e.g. PBT/2026/0412" />
                </label>
              </div>
            </>
          )}
        </div>
        <div className="composer-message">
          <div className="field">Message · you can edit it</div>
          <div className="wa-preview">
            <textarea value={message} maxLength={1000} onChange={(e) => setDraft(e.target.value)} aria-label="Message" />
            <span className="wa-preview-meta">{message.length}/1000</span>
          </div>
          <button className="btn btn-primary btn-block" onClick={send} disabled={recipients === 0 || sending}>
            <Send size={16} /> {sending ? 'Sending…' : 'Send on WhatsApp'}
          </button>
        </div>
      </div>
    </Card>
  )
}
