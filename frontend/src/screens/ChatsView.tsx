import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft, Ban, Car, Flag, Hammer, Hand, HardHat, House, Languages, Lock, MessageSquareWarning, MoreHorizontal,
  Phone, PhoneCall, SendHorizontal, ShieldCheck, Sparkles, Trash2, Volume2, CircleHelp, TriangleAlert,
} from 'lucide-react'
import { api, ApiError, type ChatIntro, type ChatMessage, type ConcernCategory, type Conversation, type Thread, type UnitInfo } from '../api'
import { RELATION_LABEL } from '../messages'
import { LANG_TAG } from '../components/Cast'
import ConcernCard from '../components/ConcernCard'
import { Avatar, Empty, formatDate, formatTime, Sheet, shortRange, Skeleton, Stamp, useToast } from '../ui'

const LANG_NAME: Record<string, string> = { en: 'English', ms: 'Bahasa Melayu', zh: '中文' }
const CATEGORY_ICON: Record<ConcernCategory, typeof Volume2> = {
  noise_hours: Volume2, debris: Trash2, access: Car, damage: House, workers: HardHat, other: CircleHelp,
}
const PERMIT: Record<string, string> = { approved: 'Council permit approved', applied: 'Council permit applied for', not_needed: 'No council permit needed' }

export default function ChatsView({ me, version, onChange, peer, onPeer }: {
  me: UnitInfo
  version: number
  onChange: () => void
  peer?: string
  onPeer: (id?: string) => void
}) {
  const root = useRef<HTMLElement>(null)
  const [wide, setWide] = useState(false)
  const [convos, setConvos] = useState<Conversation[] | null>(null)

  const load = useCallback(() => api.conversations(me.id).then(setConvos).catch(() => setConvos([])), [me.id])
  useEffect(() => { load() }, [load, version])

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 700))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const selected = peer ?? (wide ? convos?.[0]?.id : undefined)

  return (
    <section ref={root} className={`chat ${wide ? 'wide' : ''} ${selected ? 'has-thread' : ''}`}>
      <aside className="chat-list">
        <div className="chat-list-head">
          <div>
            <div className="eyebrow">Layer 1 · Know & talk</div>
            <h2>Your circle</h2>
          </div>
          <span className="lang-tag" title={`You read ${LANG_NAME[me.lang]}`}>{LANG_TAG[me.lang]}</span>
        </div>
        <div className="chat-privacy"><Lock size={12} /> Alerts arrive on WhatsApp. Your number stays private until you both agree.</div>
        {!convos && <div style={{ padding: 14 }}><Skeleton lines={5} /></div>}
        {convos?.map((c) => (
          <button key={c.id} className={`chat-row ${c.id === selected ? 'on' : ''}`} onClick={() => onPeer(c.id)}>
            <Avatar name={c.resident_name} size={38} />
            <span className="grow">
              <span className="chat-row-top">
                <b>{c.resident_name} <i>· {c.label}</i></b>
                {c.last_at && <small>{formatTime(c.last_at)}</small>}
              </span>
              <span className="chat-row-rel">{RELATION_LABEL[c.relation]}{c.relation === 'left' || c.relation === 'right' ? ' · shared wall' : c.relation === 'above' || c.relation === 'below' ? ' · shared slab' : ''}</span>
              <span className="chat-row-last">{c.blocked ? 'Blocked' : c.last ?? 'Say hello'}</span>
            </span>
            <span className="chat-row-flags">
              {c.unread > 0 && <span className="unread">{c.unread}</span>}
              {c.renovating && <Hammer size={13} className="flag-works" aria-label="Renovating" />}
              {c.open_concerns > 0 && <MessageSquareWarning size={13} className="flag-concern" aria-label="Open concern" />}
              {c.contact === 'mutual' && <Phone size={12} className="flag-phone" aria-label="Numbers shared" />}
            </span>
          </button>
        ))}
      </aside>

      <div className="chat-main">
        {selected ? (
          <ChatThread key={`${me.id}-${selected}`} me={me} other={selected} version={version} onChange={onChange} onRead={load}
            onBack={wide ? undefined : () => onPeer(undefined)} />
        ) : (
          <div className="chat-empty">
            <Empty icon={<Hand size={24} />} title="Pick a neighbour">Talk, agree on renovation hours, or raise a concern. Everything important is kept on record.</Empty>
          </div>
        )}
      </div>
    </section>
  )
}

function ChatThread({ me, other, version, onChange, onRead, onBack }: {
  me: UnitInfo
  other: string
  version: number
  onChange: () => void
  onRead: () => void
  onBack?: () => void
}) {
  const toast = useToast()
  const [t, setT] = useState<Thread | null>(null)
  const [text, setText] = useState('')
  const [tone, setTone] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [concernOpen, setConcernOpen] = useState(false)
  const [reporting, setReporting] = useState<ChatMessage | null>(null)
  const [menu, setMenu] = useState(false)
  const [showOriginal, setShowOriginal] = useState<Set<number>>(new Set())
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    api.thread(me.id, other).then((x) => {
      if (!live) return
      setT(x)
      api.markRead(me.id, other).then(onRead).catch(() => {})
    })
    return () => {
      live = false
    }
  }, [me.id, other, version, onRead])

  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight
  }, [t?.items.length])

  if (!t) return <div style={{ padding: 18 }}><Skeleton lines={6} /></div>
  const n = t.neighbour

  async function send(msg: { body?: string; quick_key?: string }) {
    setSending(true)
    setTone(null)
    try {
      await api.sendMessage(me.id, other, msg)
      if (msg.body) setText('')
      onChange()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'tone') setTone(e.message)
      else toast(e instanceof Error ? e.message : 'Could not send', 'error')
    } finally {
      setSending(false)
    }
  }

  async function wave(introId: number) {
    await api.waveBack(introId, me.id)
    toast(`You waved back to ${n.resident_name}`)
    onChange()
  }

  async function contact() {
    const r = await api.shareContact(me.id, other)
    toast(r.contact === 'mutual' ? 'Numbers exchanged' : `${n.resident_name} will be asked to agree`)
    onChange()
  }

  async function block(on: boolean) {
    await api.setBlock(me.id, other, on)
    setMenu(false)
    toast(on ? `${n.resident_name} is blocked. They won't be told.` : `${n.resident_name} is unblocked`)
    onChange()
  }

  let lastDay = ''
  return (
    <div className="thread">
      <header className="thread-head">
        {onBack && <button className="icon-btn" onClick={onBack} aria-label="Back to list"><ArrowLeft size={16} /></button>}
        <Avatar name={n.resident_name} size={40} />
        <div className="grow">
          <b>{n.resident_name} <i>· {n.label}</i></b>
          <small><Languages size={11} /> Reads {LANG_NAME[n.lang]} · {RELATION_LABEL[n.relation]}</small>
        </div>
        {t.contact === 'mutual' ? (
          <span className="contact-ok"><PhoneCall size={13} /> Numbers shared</span>
        ) : t.contact === 'requested_by_me' ? (
          <span className="contact-wait">Waiting for {n.resident_name}</span>
        ) : (
          <button className={`btn btn-sm ${t.contact === 'requested_by_them' ? 'btn-primary' : ''}`} onClick={contact} disabled={t.blocked}>
            <Phone size={13} /> {t.contact === 'requested_by_them' ? 'Accept number exchange' : 'Exchange numbers'}
          </button>
        )}
        <div className="menu-wrap">
          <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="More"><MoreHorizontal size={16} /></button>
          {menu && (
            <div className="menu">
              <button onClick={() => block(!t.blocked)}><Ban size={14} /> {t.blocked ? `Unblock ${n.resident_name}` : `Block ${n.resident_name}`}</button>
              <p>Blocking is silent. Formal notices and concerns stay on record either way.</p>
            </div>
          )}
        </div>
      </header>

      <div className="thread-body" ref={body}>
        <div className="sys-note"><ShieldCheck size={12} /> Private between you two. Notices, concerns and decisions are also written to both home logs.</div>
        {t.items.length === 0 && <div className="sys-note">No messages yet. A quick hello goes a long way.</div>}
        {t.items.map((item) => {
          const day = formatDate(item.created_at)
          const sep = day !== lastDay ? <div className="day-sep"><span>{day}</span></div> : null
          lastDay = day
          const key = `${item.type}-${item.id}`
          const wrap = (node: ReactNode) => <Fragment key={key}>{sep}{node}</Fragment>
          if (item.type === 'concern') return wrap(<ConcernCard concern={item} viewer={me.id} onChanged={onChange} />)
          if (item.type === 'intro') return wrap(<IntroCard item={item} mine={item.from_unit_id === me.id} onWave={() => wave(item.id)} />)
          if (item.kind === 'system') {
            return wrap(
              <div className="sys-msg">
                <Stamp tone="ink" tilt={0}>{item.author ?? 'System'}</Stamp>
                <p>{item.text}</p>
                <small>{formatTime(item.created_at)}</small>
              </div>,
            )
          }
          const mine = item.from_unit_id === me.id
          const original = showOriginal.has(item.id)
          return wrap(
            <div className={`msg ${mine ? 'mine' : 'theirs'}`}>
              <div className="msg-bubble">
                <p>{original && item.original ? item.original : item.text}</p>
                <div className="msg-meta">
                  {item.kind === 'quick' && (
                    item.translated ? (
                      <button className="msg-tr" onClick={() => setShowOriginal((s) => { const x = new Set(s); if (x.has(item.id)) x.delete(item.id); else x.add(item.id); return x })}>
                        <Languages size={11} /> {original ? `Original · ${LANG_NAME[item.lang]}` : `Translated from ${LANG_NAME[item.lang]}`}
                      </button>
                    ) : <span className="msg-tr"><Sparkles size={11} /> Quick reply</span>
                  )}
                  <span>{formatTime(item.created_at)}</span>
                </div>
              </div>
              {!mine && (
                <button className="msg-report" onClick={() => setReporting(item)} title="Report this message" aria-label="Report this message"><Flag size={12} /></button>
              )}
            </div>,
          )
        })}
      </div>

      {t.blocked ? (
        <div className="composer-blocked">
          <Ban size={15} /> You blocked {n.resident_name}.
          <button className="btn btn-sm" onClick={() => block(false)}>Unblock</button>
        </div>
      ) : (
        <div className="chat-composer">
          {tone && (
            <div className="tone-check">
              <TriangleAlert size={15} />
              <div><b>Tone check</b>{tone}</div>
              <button className="icon-btn" onClick={() => setTone(null)} aria-label="Dismiss">×</button>
            </div>
          )}
          <div className="quick-row">
            {t.quick_replies.map((q) => (
              <button key={q.key} className="quick" disabled={sending} onClick={() => send({ quick_key: q.key })} title={`Arrives in ${LANG_NAME[n.lang]}`}>{q.text}</button>
            ))}
          </div>
          <div className="compose-row">
            {t.their_renovations.length > 0 && (
              <button className="btn btn-sm concern-btn" onClick={() => setConcernOpen(true)}><MessageSquareWarning size={14} /> Raise a concern</button>
            )}
            <textarea className="compose-input" rows={1} maxLength={500} placeholder={`Message ${n.resident_name}…`} value={text}
              onChange={(e) => { setText(e.target.value); setTone(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && text.trim()) { e.preventDefault(); send({ body: text }) } }} />
            <button className="send-btn" disabled={!text.trim() || sending} onClick={() => send({ body: text })} aria-label="Send"><SendHorizontal size={17} /></button>
          </div>
          <div className="compose-foot"><Languages size={11} /> Quick replies arrive in {LANG_NAME[n.lang]}. Typed messages are sent as written.</div>
        </div>
      )}

      <ConcernSheet open={concernOpen} onClose={() => setConcernOpen(false)} me={me} t={t} onRaised={onChange} />
      <ReportSheet message={reporting} me={me} name={n.resident_name} onClose={() => setReporting(null)} />
    </div>
  )
}

function IntroCard({ item, mine, onWave }: { item: ChatIntro; mine: boolean; onWave: () => void }) {
  const r = item.renovation
  return (
    <div className={`notice ${mine ? 'mine' : ''}`}>
      <div className="notice-head">
        <Stamp tone={r ? 'amber' : 'brand'} tilt={-2}>{r ? 'Renovation notice' : 'Introduction'}</Stamp>
        <small>{mine ? 'You sent this' : 'Sent to your circle'} · {formatTime(item.created_at)}</small>
      </div>
      <p>{item.text}</p>
      {r && (
        <dl className="notice-grid">
          <div><dt>Work</dt><dd>{r.scope}</dd></div>
          <div><dt>Dates</dt><dd>{shortRange(r.start, r.end)}</dd></div>
          <div><dt>Noisy work</dt><dd>{r.noisy_hours}</dd></div>
          <div><dt>Contractor</dt><dd>{r.contractor || '–'}{r.contractor_cidb_registered ? ' · CIDB ✓' : ''}</dd></div>
          {r.council_permit && <div className="wide"><dt>Permit</dt><dd>{PERMIT[r.council_permit]}{r.permit_ref ? ` · ${r.permit_ref}` : ''}</dd></div>}
        </dl>
      )}
      {!mine && (item.acked_at ? (
        <div className="notice-done"><Hand size={13} /> You waved back</div>
      ) : (
        <button className="btn btn-sm" onClick={onWave}><Hand size={14} /> Wave back</button>
      ))}
    </div>
  )
}

function ConcernSheet({ open, onClose, me, t, onRaised }: { open: boolean; onClose: () => void; me: UnitInfo; t: Thread; onRaised: () => void }) {
  const toast = useToast()
  const [category, setCategory] = useState<ConcernCategory>('noise_hours')
  const [note, setNote] = useState('')
  const [introId, setIntroId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [tone, setTone] = useState<string | null>(null)
  const reno = t.their_renovations.find((r) => r.intro_id === introId) ?? t.their_renovations[0]

  async function submit() {
    if (!reno) return
    setBusy(true)
    setTone(null)
    try {
      await api.raiseConcern(me.id, reno.intro_id, category, note)
      toast(`Sent privately to ${t.neighbour.resident_name}`)
      setNote('')
      onClose()
      onRaised()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'tone') setTone(e.message)
      else toast(e instanceof Error ? e.message : 'Could not send', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="eyebrow">Raise a concern</div>
      <div className="card-title" style={{ fontSize: 18 }}>Tell {t.neighbour.resident_name} first</div>
      <ol className="ladder-intro">
        <li><b>1</b> {t.neighbour.resident_name} hears it privately, not in a group chat.</li>
        <li><b>2</b> They reply or fix it. Most things end here.</li>
        <li><b>3</b> Still not sorted? Hand it to SDP’s estate team with the full record.</li>
      </ol>
      {t.their_renovations.length > 1 && (
        <label className="field">About
          <select value={reno?.intro_id} onChange={(e) => setIntroId(Number(e.target.value))}>
            {t.their_renovations.map((r) => <option key={r.intro_id} value={r.intro_id}>{r.scope} · {shortRange(r.start, r.end)}</option>)}
          </select>
        </label>
      )}
      <div className="category-grid">
        {(Object.keys(t.concern_categories) as ConcernCategory[]).map((k) => {
          const Icon = CATEGORY_ICON[k]
          return (
            <button key={k} className={`category ${category === k ? 'on' : ''}`} onClick={() => setCategory(k)}>
              <Icon size={18} />
              <span>{t.concern_categories[k]}</span>
            </button>
          )
        })}
      </div>
      {category === 'damage' && (
        <div className="hint-inline"><House size={14} /> For cracks or leaks, also use <b>Evidence</b>: it compares your pre-work photo and can open an SDP warranty ticket.</div>
      )}
      <textarea className="input" rows={3} maxLength={300} placeholder="What happened, and when? e.g. drilling at 7.30pm on Tuesday"
        value={note} onChange={(e) => { setNote(e.target.value); setTone(null) }} />
      {tone && <div className="tone-check"><TriangleAlert size={15} /><div><b>Tone check</b>{tone}</div></div>}
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy || !reno}>
        <MessageSquareWarning size={16} /> {busy ? 'Sending…' : `Send to ${t.neighbour.resident_name}`}
      </button>
    </Sheet>
  )
}

const REASONS = [
  { id: 'harassment', label: 'Harassment or insults' },
  { id: 'threat', label: 'Threat or intimidation' },
  { id: 'spam', label: 'Spam or selling' },
  { id: 'privacy', label: 'Shares someone’s private information' },
  { id: 'other', label: 'Something else' },
]

function ReportSheet({ message, me, name, onClose }: { message: ChatMessage | null; me: UnitInfo; name: string; onClose: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('harassment')
  async function submit() {
    if (!message) return
    try {
      await api.reportMessage(message.id, me.id, reason)
      toast(`Reported to the SDP estate team. ${name} won't know it was you.`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not report', 'error')
    }
  }
  return (
    <Sheet open={!!message} onClose={onClose}>
      <div className="eyebrow">Report a message</div>
      <blockquote className="report-quote">“{message?.text}”</blockquote>
      <div className="choices">
        {REASONS.map((r) => (
          <button key={r.id} className={`choice ${reason === r.id ? 'on' : ''}`} onClick={() => setReason(r.id)}>
            <Flag size={16} /><span>{r.label}</span>
          </button>
        ))}
      </div>
      <div className="small dim">The estate team reviews reports within one working day. You can also block {name} from the ⋯ menu.</div>
      <button className="btn btn-danger btn-block" onClick={submit}><Flag size={15} /> Send report</button>
    </Sheet>
  )
}
