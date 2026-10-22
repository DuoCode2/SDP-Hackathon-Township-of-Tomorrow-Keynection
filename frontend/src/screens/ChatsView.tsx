import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft, BadgeCheck, Ban, Building2, CalendarCheck, CalendarX, Car, Check, CheckCheck, CircleHelp, Flag, Hammer, Hand, HardHat, House, Languages, Lock, Megaphone,
  MessageSquareWarning, Mic, MicOff, MoreHorizontal, Pause, Phone, PhoneCall, Play, SendHorizontal, ShieldCheck, Smile, Sparkles, Trash2,
  TriangleAlert, Volume2, X,
} from 'lucide-react'
import {
  api, ApiError, type ChatIntro, type ChatMessage, type ChatWave, type ConcernCategory, type Conversation, type Notice, type Official, type Preview,
  type Thread, type UnitInfo,
} from '../api'
import { byWho, noisyHours, readLang, refusal, subjectText, useDates, useLang, useT, type Translate } from '../i18n'
import { useHelper } from '../helper'
import { useAi, usePilot, usePlace } from '../features'
import { LANG_TAG } from '../components/Cast'
import ConcernCard from '../components/ConcernCard'
import { Avatar, Empty, Sheet, Skeleton, Stamp, useCelebrate, useToast } from '../ui'
import { holdWake } from '../wake'

const langName = (t: Translate, code: string) => t(`lang.${code}`)

/** An automatic notice in the reader's language. Notices from before codes existed show their English record.
 *  A case notice names the home by unit; its name comes from names (the households the reader sees now), so a home
 *  that closed its account, or one not in names, shows as its unit only. */
function systemText(t: Translate, m: Pick<ChatMessage, 'code' | 'values' | 'text'>, names: Record<string, string> = {}): string {
  if (!m.code) return m.text
  const v = m.values ?? {}
  const name = (v.unit && names[v.unit]) || v.name  // older notices carried the name itself
  const home = name && name !== v.label ? t('who', { name, label: v.label ?? '' }) : v.label  // a closed account's name is its unit
  const who = home ? home + (v.helper ? t('sys.helper', { name: byWho(t, v.helper) }) : '') : ''
  return t(`sys.${m.code}`, {
    ...v,
    who: v.both ? t('sys.bothOwners') : who,
    what: v.category ? t(`cat.${v.category}`) : '',
    // The estate notices add an optional "Note: …"; a disagreement quotes the reason itself.
    note: m.code.startsWith('estate_') ? (v.note ? t('sys.note', { note: v.note }) : '') : (v.note ?? ''),
    subject: v.subject ? subjectText(t, v.subject) : '',
    outcome: v.outcome ? t(`lg.out.${v.outcome}`) : '',
  })
}

const ESTATE_AUTHOR = 'SDP Estate Team'

/** The last item of a chat, for the chat list, in the reader's language. */
function previewText(t: Translate, p: Preview | null, names: Record<string, string>): string | null {
  if (!p) return null
  switch (p.kind) {
    case 'renovation': return t('pv.renovation')
    case 'wave': return t('pv.wave')
    case 'voice': return t('pv.voice', { n: p.duration })
    case 'concern': return t('pv.concern', { what: t(`cat.${p.category}`) })
    case 'system': return systemText(t, p, names)
    case 'text': return p.text
  }
}
const CATEGORY_ICON: Record<ConcernCategory, typeof Volume2> = {
  noise_hours: Volume2, debris: Trash2, access: Car, damage: House, workers: HardHat, other: CircleHelp,
}
const REACTIONS = ['👍', '❤️', '🙏', '😂', '😮']
const ESTATE = '__estate'
const DAY = 86_400_000

export default function ChatsView({ me, version, onChange, peer, onPeer }: {
  me: UnitInfo
  version: number
  onChange: () => void
  peer?: string
  onPeer: (id?: string) => void
}) {
  const t = useT()
  const dates = useDates()
  const root = useRef<HTMLElement>(null)
  const [wide, setWide] = useState(false)
  const [convos, setConvos] = useState<Conversation[] | null>(null)
  // The circle first (newest talk first within it), then homes only a renovation notice connects you with, then
  // contacts by request: each group under its own label on the list.
  const rank = (c: Conversation) => (c.relation === 'behind' ? 1 : c.relation === 'contact' ? 2 : 0)
  const ordered = convos ? [...convos].sort((a, b) => rank(a) - rank(b)) : null
  const [official, setOfficial] = useState<Official | null>(null)
  const reads = readLang(useLang().lang, me)  // the estate notices arrive in the language the screens are in

  const load = useCallback(() => {
    api.conversations(me.id).then(setConvos).catch(() => setConvos([]))
    api.official(me.id, reads).then(setOfficial).catch(() => setOfficial(null))
  }, [me.id, reads])
  useEffect(() => { load() }, [load, version])

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 700))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const selected = peer ?? (wide ? convos?.[0]?.id ?? ESTATE : undefined)
  const latest = official?.notices[0]

  return (
    <section ref={root} className={`chat ${wide ? 'wide' : ''} ${selected ? 'has-thread' : ''}`}>
      <aside className="chat-list">
        <div className="chat-list-head">
          <div>
            <div className="eyebrow">{t('chats.eyebrow')}</div>
            <h2>{t('chats.title')}</h2>
          </div>
          <span className="lang-tag" title={t('profile.reads', { lang: langName(t, me.lang) })}>{LANG_TAG[me.lang]}</span>
        </div>
        <div className="chat-privacy"><Lock size={12} /> {t('chats.privacy')}</div>

        <button className={`chat-row official ${selected === ESTATE ? 'on' : ''}`} onClick={() => onPeer(ESTATE)}>
          <span className="official-avatar"><Building2 size={18} /></span>
          <span className="grow">
            <span className="chat-row-top">
              <b>{t('estate.name')} <BadgeCheck size={13} className="verified" /></b>
              {latest && <small>{dates.date(latest.created_at)}</small>}
            </span>
            <span className="chat-row-rel">{t('estate.readonly')}</span>
            <span className="chat-row-last">{latest ? latest.title : t('estate.none')}</span>
          </span>
          <span className="chat-row-flags">{official && official.unread > 0 && <span className="unread">{official.unread}</span>}</span>
        </button>

        {!convos && <div style={{ padding: 14 }}><Skeleton lines={5} /></div>}
        {/* The circle first; then homes a renovation notice connects you with (behind the back fence), then contacts
            by request: the list says why each person is here, so it never contradicts the five on Neighbours. */}
        {ordered?.map((c, i) => [
          i === ordered.findIndex((x) => x.relation === 'behind') && <div key="told" className="chat-list-label">{t('chats.alsoTold')}</div>,
          i === ordered.findIndex((x) => x.relation === 'contact') && <div key="req" className="chat-list-label">{t('chats.byRequest')}</div>,
          <button key={c.id} className={`chat-row ${c.id === selected ? 'on' : ''}`} onClick={() => onPeer(c.id)}>
            <Avatar name={c.resident_name} size={38} />
            <span className="grow">
              <span className="chat-row-top">
                <b>{c.resident_name} <i>· {c.label}</i></b>
                {c.last_at && <small>{dates.time(new Date(c.last_at))}</small>}
              </span>
              <span className="chat-row-rel">{t(`rel.${c.relation}`)}{c.relation === 'left' || c.relation === 'right' ? ` · ${t('share.wallShort')}` : c.relation === 'above' || c.relation === 'below' ? ` · ${t('share.slab')}` : ''}</span>
              <span className="chat-row-last">{c.blocked ? t('chats.blocked') : previewText(t, c.last_preview, { [c.id]: c.resident_name }) ?? c.last ?? t('chats.sayHello')}</span>
            </span>
            <span className="chat-row-flags">
              {c.unread > 0 && <span className="unread">{c.unread}</span>}
              {c.renovating && <Hammer size={13} className="flag-works" aria-label={t('chat.renovating')} />}
              {c.open_concerns > 0 && <MessageSquareWarning size={13} className="flag-concern" aria-label={t('chat.openConcern')} />}
              {c.contact === 'mutual' && <Phone size={12} className="flag-phone" aria-label="Numbers shared" />}
            </span>
          </button>,
        ])}
      </aside>

      <div className="chat-main">
        {selected === ESTATE ? (
          <OfficialThread key={`${me.id}-estate`} me={me} data={official} onRead={load} onBack={wide ? undefined : () => onPeer(undefined)} />
        ) : selected ? (
          <ChatThread key={`${me.id}-${selected}`} me={me} other={selected} version={version} onChange={onChange} onRead={load}
            onBack={wide ? undefined : () => onPeer(undefined)} />
        ) : (
          <div className="chat-empty">
            <Empty art="chat" title={t('chats.pick')}>{t('chats.pickBody')}</Empty>
          </div>
        )}
      </div>
    </section>
  )
}

// ---------- the estate office: read-only, like a WhatsApp channel ----------

function OfficialThread({ me, data, onRead, onBack }: { me: UnitInfo; data: Official | null; onRead: () => void; onBack?: () => void }) {
  const t = useT()
  const dates = useDates()
  const place = usePlace()
  useEffect(() => {
    if (data && data.unread > 0) api.officialRead(me.id).then(onRead).catch(() => {})
  }, [data, me.id, onRead])
  return (
    <div className="thread">
      <header className="thread-head">
        {onBack && <button className="icon-btn" onClick={onBack} aria-label={t('thread.back')}><ArrowLeft size={16} /></button>}
        <span className="official-avatar lg"><Building2 size={20} /></span>
        <div className="grow">
          <b>{t('estate.full', { place: place.name })} <BadgeCheck size={14} className="verified" /></b>
          <small><Megaphone size={11} /> {t('estate.sub', { place: t(me.kind === 'terrace' ? 'place.lorong' : 'place.blockWord') })}</small>
        </div>
      </header>
      <div className="thread-body">
        <div className="sys-note"><ShieldCheck size={12} /> {t('estate.verified')}</div>
        {!data && <Skeleton lines={4} />}
        {data?.notices.slice().reverse().map((n) => (
          <div key={n.id} className="official-notice">
            <div className="official-notice-top">
              <Stamp tone="blue" tilt={0}>{n.audience === 'phase' ? t('audience.phase') : n.audience.startsWith('street:') ? n.audience.slice(7) : t('place.block', { b: n.audience.slice(6) })}</Stamp>
              <small>{dates.date(n.created_at)} · {dates.time(new Date(n.created_at))}</small>
            </div>
            <OfficialNotice n={n} />
          </div>
        ))}
      </div>
      <div className="composer-blocked readonly"><Lock size={14} /> {t('estate.footer')}</div>
    </div>
  )
}

/** One estate notice in the reader's language; when it is a translation, the English record is one tap away. */
function OfficialNotice({ n }: { n: Notice }) {
  const t = useT()
  const [original, setOriginal] = useState(false)
  const shown = original && n.original ? n.original : n
  return (
    <>
      <b>{shown.title}</b>
      <p>{shown.body}</p>
      {n.translated && (
        <button className={`msg-tr notice-tr ${n.by_ai ? 'by-ai' : ''}`} onClick={() => setOriginal((o) => !o)}>
          {n.by_ai ? <><Sparkles size={11} /> {t(original ? 'thread.originalAi' : 'thread.byAi')}</>
            : t(original ? 'thread.original' : 'thread.translated', { lang: t('lang.en') })}
        </button>
      )}
    </>
  )
}

// ---------- one-to-one thread ----------

function ChatThread({ me, other, version, onChange, onRead, onBack }: {
  me: UnitInfo
  other: string
  version: number
  onChange: () => void
  onRead: () => void
  onBack?: () => void
}) {
  const tr = useT()
  const dates = useDates()
  const toast = useToast()
  const celebrate = useCelebrate()
  const helper = useHelper(me.id)
  const ai = useAi()
  const pilot = usePilot()
  const [t, setT] = useState<Thread | null>(null)
  const [text, setText] = useState('')
  const [tone, setTone] = useState<string | null>(null)
  // AI's calmer wording for what was just typed. hard: an insult, which is never sent as it was.
  const [calmer, setCalmer] = useState<{ said: string; suggestion: string; hard: boolean } | null>(null)
  const [sending, setSending] = useState(false)
  const [concernOpen, setConcernOpen] = useState(false)
  const [reporting, setReporting] = useState<ChatMessage | null>(null)
  const [menu, setMenu] = useState(false)
  const [picker, setPicker] = useState<number | null>(null)
  const [showOriginal, setShowOriginal] = useState<Set<number>>(new Set())
  const body = useRef<HTMLDivElement>(null)

  const sendVoice = async (blob: Blob, seconds: number) => {
    try {
      await api.sendVoice(me.id, other, blob, seconds, helper?.id)
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : tr('err.tryAgain'), 'error')
    }
  }
  const rec = useRecorder(sendVoice, (msg) => toast(msg, 'error'))

  useEffect(() => {
    let live = true
    api.thread(me.id, other).then((x) => {
      if (!live) return
      setT(x)
      // Something was just read: tell the app, so the sender's pane (in the split view) turns its tick into two.
      // A second pass marks nothing, so this never loops.
      api.markRead(me.id, other).then((r) => { onRead(); if (r.marked > 0) onChange() }).catch(() => {})
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
  const wavedToday = t.items.some((i) => i.type === 'wave' && i.from_unit_id === me.id && Date.now() - new Date(i.created_at).getTime() < DAY)

  async function send(msg: { body?: string; quick_key?: string; keep_tone?: boolean }) {
    setSending(true)
    setTone(null)
    setCalmer(null)
    try {
      await api.sendMessage(me.id, other, msg, helper?.id)
      if (msg.body) setText('')
      onChange()
    } catch (e) {
      if (e instanceof ApiError && e.suggestion && (e.code === 'calmer' || e.code === 'tone')) {
        setCalmer({ said: msg.body ?? '', suggestion: e.suggestion, hard: e.code === 'tone' })
      } else if (refusal(e)) setTone(refusal(e))
      else toast(e instanceof Error ? e.message : tr('err.tryAgain'), 'error')
    } finally {
      setSending(false)
    }
  }

  async function waveAt() {
    try {
      await api.wave(me.id, other)
      celebrate('👋', tr('celebrate.wave', { name: n.resident_name }))
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : tr('err.tryAgain'), 'error')
    }
  }

  async function react(id: number, emoji: string) {
    setPicker(null)
    await api.react(id, me.id, emoji)
    onChange()
  }

  async function ackIntro(introId: number) {
    await api.waveBack(introId, me.id)
    toast(tr('wave.backDone'))
    onChange()
  }

  async function contact() {
    const r = await api.shareContact(me.id, other)
    toast(r.contact === 'mutual' ? tr('thread.exchanged') : tr('thread.willAsk', { name: n.resident_name }))
    onChange()
  }

  async function block(on: boolean) {
    await api.setBlock(me.id, other, on)
    setMenu(false)
    toast(tr(on ? 'thread.blockedToast' : 'me.unblocked', { name: n.resident_name }))
    onChange()
  }

  let lastDay = ''
  return (
    <div className="thread" onClick={() => picker !== null && setPicker(null)}>
      <header className="thread-head">
        {onBack && <button className="icon-btn" onClick={onBack} aria-label={tr('thread.back')}><ArrowLeft size={16} /></button>}
        <Avatar name={n.resident_name} size={40} />
        <div className="grow">
          <b>{n.resident_name} <i>· {n.label}</i></b>
          <small><Languages size={11} /> {tr('thread.reads', { lang: langName(tr, n.lang) })} · {tr(`rel.${n.relation}`)}</small>
        </div>
        <button className="icon-btn wave-btn" onClick={waveAt} disabled={wavedToday || t.blocked} aria-label={wavedToday ? tr('thread.wavedToday') : tr('btn.wave')} title={wavedToday ? tr('thread.wavedToday') : tr('thread.waveAt', { name: n.resident_name })}>👋</button>
        {t.contact === 'mutual' ? (
          <span className="contact-ok"><PhoneCall size={13} /> {tr('thread.numbersShared')}</span>
        ) : t.contact === 'requested_by_me' ? (
          <span className="contact-wait">{tr('thread.waiting', { name: n.resident_name })}</span>
        ) : (
          <button className={`btn btn-sm ${t.contact === 'requested_by_them' ? 'btn-primary' : ''}`} onClick={contact} disabled={t.blocked}>
            <Phone size={13} /> {tr(t.contact === 'requested_by_them' ? 'thread.acceptExchange' : 'thread.exchange')}
          </button>
        )}
        <div className="menu-wrap">
          <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="More"><MoreHorizontal size={16} /></button>
          {menu && (
            <div className="menu">
              <button onClick={() => block(!t.blocked)}><Ban size={14} /> {tr(t.blocked ? 'thread.unblock' : 'thread.block', { name: n.resident_name })}</button>
              <p>{tr('thread.blockNote')}</p>
            </div>
          )}
        </div>
      </header>

      <div className="thread-body" ref={body}>
        <div className="sys-note"><ShieldCheck size={12} /> {tr('thread.private')}</div>
        {t.items.length === 0 && <div className="sys-note">{tr('thread.empty')}</div>}
        {t.items.map((item) => {
          const day = dates.date(item.created_at)
          const sep = day !== lastDay ? <div className="day-sep"><span>{day}</span></div> : null
          lastDay = day
          const key = `${item.type}-${item.id}`
          const wrap = (node: ReactNode) => <Fragment key={key}>{sep}{node}</Fragment>
          if (item.type === 'concern') return wrap(<ConcernCard concern={item} viewer={me.id} onChanged={onChange} />)
          if (item.type === 'intro') return wrap(<IntroCard item={item} mine={item.from_unit_id === me.id} waved={wavedToday} onWave={() => ackIntro(item.id)} />)
          if (item.type === 'wave') return wrap(<WaveItem item={item} mine={item.from_unit_id === me.id} name={n.resident_name} canWaveBack={!wavedToday && !t.blocked} onWaveBack={waveAt} />)
          if (item.kind === 'system') {
            return wrap(
              <div className="sys-msg">
                <Stamp tone="ink" tilt={0}>{item.author === ESTATE_AUTHOR ? tr('author.estate') : item.author ?? 'Keynection'}</Stamp>
                <p>{systemText(tr, item, { [n.id]: n.resident_name })}</p>
                <small>{dates.time(new Date(item.created_at))}</small>
              </div>,
            )
          }
          const mine = item.from_unit_id === me.id
          const original = showOriginal.has(item.id)
          const counts = REACTIONS.map((e) => ({ e, n: item.reactions.filter((r) => r.emoji === e).length, me: item.reactions.some((r) => r.emoji === e && r.unit_id === me.id) })).filter((x) => x.n > 0)
          return wrap(
            <div className={`msg ${mine ? 'mine' : 'theirs'}`}>
              <div className="msg-col">
                <div className="msg-bubble">
                  {item.kind === 'voice' ? (
                    item.expired ? (
                      <div className="voice-gone"><MicOff size={14} /> {tr('thread.voiceExpired')}</div>
                    ) : (
                      <VoiceNote src={api.voiceUrl(item.id, me.id)} duration={item.duration ?? 0} seed={item.id} />
                    )
                  ) : (
                    <p>{original && item.original ? item.original : item.text}</p>
                  )}
                  <div className="msg-meta">
                    {(item.kind === 'quick' || item.by_ai) && (
                      item.translated ? (
                        <button className={`msg-tr ${item.by_ai ? 'by-ai' : ''}`} onClick={() => setShowOriginal((s) => { const x = new Set(s); if (x.has(item.id)) x.delete(item.id); else x.add(item.id); return x })}>
                          {item.by_ai ? <Sparkles size={11} /> : <Languages size={11} />}{' '}
                          {item.by_ai
                            ? tr(original ? 'thread.originalAi' : 'thread.byAi')
                            : tr(original ? 'thread.original' : 'thread.translated', { lang: langName(tr, item.lang) })}
                        </button>
                      ) : <span className="msg-tr"><Sparkles size={11} /> {tr('thread.quick')}</span>
                    )}
                    {item.sent_by && <span className="msg-by">{tr('thread.sentBy', { who: byWho(tr, item.sent_by) })}</span>}
                    <span>{dates.time(new Date(item.created_at))}</span>
                    {mine && (
                      <span className={`msg-ticks ${item.read_at ? 'read' : ''}`} role="img" aria-label={tr(item.read_at ? 'msg.read' : 'msg.sent')} title={tr(item.read_at ? 'msg.read' : 'msg.sent')}>
                        {item.read_at ? <CheckCheck size={12} /> : <Check size={12} />}
                      </span>
                    )}
                  </div>
                </div>
                {counts.length > 0 && (
                  <div className="reactions">
                    {counts.map((c) => <button key={c.e} className={c.me ? 'mine' : ''} onClick={() => react(item.id, c.e)}>{c.e}{c.n > 1 ? ` ${c.n}` : ''}</button>)}
                  </div>
                )}
              </div>
              <div className="msg-tools">
                <button className="msg-tool" onClick={(e) => { e.stopPropagation(); setPicker(picker === item.id ? null : item.id) }} aria-label={tr('msg.react')}><Smile size={13} /></button>
                {!mine && !item.expired && <button className="msg-tool report" onClick={() => setReporting(item)} title={tr('msg.report')} aria-label={tr('msg.report')}><Flag size={12} /></button>}
                {picker === item.id && (
                  <div className="react-picker" onClick={(e) => e.stopPropagation()}>
                    {REACTIONS.map((e) => <button key={e} onClick={() => react(item.id, e)}>{e}</button>)}
                  </div>
                )}
              </div>
            </div>,
          )
        })}
      </div>

      {t.blocked ? (
        <div className="composer-blocked">
          <Ban size={15} /> {tr('thread.youBlocked', { name: n.resident_name })}
          <button className="btn btn-sm" onClick={() => block(false)}>{tr('btn.unblock')}</button>
        </div>
      ) : (
        <div className="chat-composer">
          {tone && (
            <div className="tone-check">
              <TriangleAlert size={15} />
              <div><b>{tr(`${tone}.title`)}</b>{tr(`${tone}.body`)}</div>
              <button className="icon-btn" onClick={() => setTone(null)} aria-label="Dismiss">×</button>
            </div>
          )}
          {calmer && (
            <div className="calmer">
              <div className="calmer-head">
                <Sparkles size={15} />
                <b>{tr(calmer.hard ? 'tone.title' : 'calmer.title')}</b>
                <button className="icon-btn" onClick={() => setCalmer(null)} aria-label="Dismiss">×</button>
              </div>
              {calmer.hard && <p>{tr('tone.body')}</p>}
              <small>{tr(calmer.hard ? 'tone.suggest' : 'calmer.body')}</small>
              <blockquote>{calmer.suggestion}</blockquote>
              <div className="btn-row">
                <button className="btn btn-sm btn-primary" disabled={sending} onClick={() => send({ body: calmer.suggestion })}>{tr('calmer.use')}</button>
                {!calmer.hard && <button className="btn btn-sm" disabled={sending} onClick={() => send({ body: calmer.said, keep_tone: true })}>{tr('calmer.keep')}</button>}
              </div>
            </div>
          )}
          <div className="quick-row">
            {t.quick_replies.map((q) => (
              <button key={q.key} className="quick" disabled={sending} onClick={() => send({ quick_key: q.key })} title={q.arrives ? tr('thread.arrives', { name: n.resident_name, text: q.arrives }) : langName(tr, n.lang)}>{q.text}</button>
            ))}
          </div>
          {/* Demo only: one tap puts the judge route's sharp Malay line in the box; sending it runs the usual calmer check. */}
          {!pilot && <button type="button" className="btn btn-sm demo-link" style={{ alignSelf: 'flex-start' }} onClick={() => { setText('Rumah awak bising macam kilang! Tak reti hormat jiran ke?'); setTone(null); setCalmer(null) }}>{tr('thread.tryHeated')}</button>}
          {rec.state === 'recording' ? (
            <div className="compose-row recording">
              <button className="icon-btn" onClick={rec.cancel} aria-label={tr('voice.cancelRec')}><X size={16} /></button>
              <span className="rec-dot" />
              <span className="rec-time">{Math.floor(rec.secs / 60)}:{String(Math.floor(rec.secs % 60)).padStart(2, '0')} / 1:00</span>
              <span className="grow rec-hint">{tr('thread.recording')}</span>
              <button className="send-btn" onClick={rec.stop} aria-label={tr('voice.send')}><SendHorizontal size={17} /></button>
            </div>
          ) : (
            <div className="compose-row">
              {t.their_renovations.length > 0 && (
                <button className="btn btn-sm concern-btn" onClick={() => setConcernOpen(true)}><MessageSquareWarning size={14} /> {tr('thread.concern')}</button>
              )}
              {/* Read-only (not disabled) while a send is in flight: nothing can be typed or re-sent, but focus stays in the box. */}
              <textarea className="compose-input" rows={1} maxLength={500} placeholder={tr('thread.placeholder', { name: n.resident_name })} value={text} readOnly={sending}
                onChange={(e) => { setText(e.target.value); setTone(null); setCalmer(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && text.trim() && !sending) { e.preventDefault(); send({ body: text }) } }} />
              {text.trim() ? (
                <button className="send-btn" disabled={sending} onClick={() => send({ body: text })} aria-label="Send"><SendHorizontal size={17} /></button>
              ) : (
                <button className="send-btn mic" onClick={rec.begin} aria-label={tr('thread.record')} title={tr('thread.recordTitle')}><Mic size={17} /></button>
              )}
            </div>
          )}
          <div className={`compose-foot ${ai?.on ? 'by-ai' : ''}`}>
            {ai?.on ? <Sparkles size={11} /> : <Languages size={11} />}{' '}
            {sending && ai?.on && text.trim() ? tr('thread.translating')
              : tr(ai?.on ? 'thread.footAi' : 'thread.foot', { lang: langName(tr, n.lang), name: n.resident_name })}
          </div>
        </div>
      )}

      <ConcernSheet open={concernOpen} onClose={() => setConcernOpen(false)} me={me} t={t} helperId={helper?.id} onRaised={onChange} />
      <ReportSheet message={reporting} me={me} name={n.resident_name} onClose={() => setReporting(null)} />
    </div>
  )
}

function WaveItem({ item, mine, name, canWaveBack, onWaveBack }: { item: ChatWave; mine: boolean; name: string; canWaveBack: boolean; onWaveBack: () => void }) {
  const t = useT()
  const dates = useDates()
  return (
    <div className={`wave-item ${mine ? 'mine' : ''}`}>
      <span className="wave-hand" aria-hidden>👋</span>
      <span className="grow"><b>{t(mine ? 'wave.mine' : 'wave.theirs', { name })}</b><small>{dates.time(new Date(item.created_at))}</small></span>
      {!mine && canWaveBack && <button className="btn btn-sm" onClick={onWaveBack}>{t('wave.back')}</button>}
    </div>
  )
}

/** Voice note player: play/pause, simple bars, duration. */
function VoiceNote({ src, duration, seed }: { src: string; duration: number; seed: number }) {
  const t = useT()
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const bars = Array.from({ length: 24 }, (_, i) => 30 + ((seed * 37 + i * 53) % 70))
  const toggle = () => {
    const a = audio.current
    if (!a) return
    if (a.paused) a.play().catch(() => setPlaying(false))
    else a.pause()
  }
  return (
    <div className="voice">
      <button className="voice-play" onClick={toggle} aria-label={t(playing ? 'voice.pause' : 'voice.play')}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
      <div className="voice-bars" aria-hidden>
        {bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} className={i / bars.length < progress ? 'on' : ''} />)}
      </div>
      <span className="voice-len">0:{String(duration).padStart(2, '0')}</span>
      <audio ref={audio} src={src} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0) }}
        onTimeUpdate={(e) => { const a = e.currentTarget; setProgress(a.duration && isFinite(a.duration) ? a.currentTime / a.duration : a.currentTime / Math.max(duration, 1)) }} />
    </div>
  )
}

/** Record up to a minute with the browser's own recorder. Nothing is kept unless it's sent. */
function useRecorder(onDone: (blob: Blob, seconds: number) => void, onError: (message: string) => void) {
  const t = useT()
  const [state, setState] = useState<'idle' | 'recording'>('idle')
  const [secs, setSecs] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const started = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const cancelled = useRef(false)

  useEffect(() => () => {
    cancelled.current = true
    if (rec.current?.state === 'recording') rec.current.stop()
    window.clearInterval(timer.current)
    holdWake('voice-note', false)
  }, [])

  async function begin() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError(t('voice.unsupported'))
      return
    }
    let stream: MediaStream
    holdWake('voice-note', true)  // a voice note saying "hello neighbour" is for the neighbour, not the assistant
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      holdWake('voice-note', false)
      onError(t('voice.noMic'))
      return
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((x) => MediaRecorder.isTypeSupported(x))
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    chunks.current = []
    cancelled.current = false
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
    r.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      holdWake('voice-note', false)
      window.clearInterval(timer.current)
      const seconds = (Date.now() - started.current) / 1000
      setState('idle')
      setSecs(0)
      if (!cancelled.current && seconds >= 0.8) onDone(new Blob(chunks.current, { type: (r.mimeType || 'audio/webm').split(';')[0] }), seconds)
    }
    r.start()
    rec.current = r
    started.current = Date.now()
    setState('recording')
    timer.current = window.setInterval(() => {
      const s = (Date.now() - started.current) / 1000
      setSecs(s)
      if (s >= 60 && r.state === 'recording') r.stop()
    }, 200)
  }

  const stop = () => { if (rec.current?.state === 'recording') rec.current.stop() }
  const cancel = () => { cancelled.current = true; stop() }
  return { state, secs, begin, stop, cancel }
}

// `waved`: the reader already waved today (from the wave bubble, say), so the card doesn't offer a second "Wave back".
function IntroCard({ item, mine, waved, onWave }: { item: ChatIntro; mine: boolean; waved?: boolean; onWave: () => void }) {
  const t = useT()
  const dates = useDates()
  const [original, setOriginal] = useState(false)
  const r = item.renovation
  return (
    <div className={`notice ${mine ? 'mine' : ''}`}>
      <div className="notice-head">
        <Stamp tone={r ? 'amber' : 'brand'} tilt={-2}>{t(r ? 'notice.reno' : 'notice.intro')}</Stamp>
        <small>{t(mine ? 'notice.mine' : 'notice.theirs')} · {dates.time(new Date(item.created_at))}{item.sent_by ? ` · ${t('thread.sentBy', { who: byWho(t, item.sent_by) })}` : ''}</small>
      </div>
      <p>{original && item.original ? item.original : item.text}</p>
      {item.translated && (
        <button className="msg-tr by-ai notice-tr" onClick={() => setOriginal((o) => !o)}>
          <Sparkles size={11} /> {t(original ? 'thread.originalAi' : 'thread.byAi')}
        </button>
      )}
      {r && (
        <dl className="notice-grid">
          <div><dt>{t('reno.work')}</dt><dd>{original && item.original_scope ? item.original_scope : r.scope}</dd></div>
          <div><dt>{t('reno.dates')}</dt><dd>{dates.range(r.start, r.end)}</dd></div>
          <div><dt>{t('reno.noisy')}</dt><dd>{noisyHours(t, r)}</dd></div>
          <div><dt>{t('reno.contractor')}</dt><dd>{r.contractor || '–'}{r.contractor_cidb_registered ? ' · CIDB ✓' : ''}</dd></div>
          {r.management_approval && <div><dt>{t('notice.jmb')}</dt><dd>{t(r.management_approval === 'approved' ? 'notice.approved' : 'notice.waiting')}</dd></div>}
          {r.council_permit && <div className={r.management_approval ? '' : 'wide'}><dt>{t('notice.permit')}</dt><dd>{t(`permit.${r.council_permit}`)}{r.permit_ref ? ` · ${r.permit_ref}` : ''}</dd></div>}
        </dl>
      )}
      {!mine && item.quiet && (
        <div className={`notice-quiet ${item.quiet}`}>
          {item.quiet === 'avoided' ? <CalendarCheck size={14} /> : <CalendarX size={14} />} {t(`quiet.${item.quiet}`)}
        </div>
      )}
      {!mine && (item.acked_at || waved ? (
        <div className="notice-done"><Hand size={13} /> {t('wave.backDone')}</div>
      ) : (
        <button className="btn btn-sm" onClick={onWave}><Hand size={14} /> {t('wave.back')}</button>
      ))}
    </div>
  )
}

function ConcernSheet({ open, onClose, me, t, helperId, onRaised }: {
  open: boolean
  onClose: () => void
  me: UnitInfo
  t: Thread
  helperId?: number
  onRaised: () => void
}) {
  const tr = useT()
  const dates = useDates()
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
      await api.raiseConcern(me.id, reno.intro_id, category, note, helperId)
      toast(tr('concern.sent', { name: t.neighbour.resident_name }))
      setNote('')
      onClose()
      onRaised()
    } catch (e) {
      if (refusal(e)) setTone(refusal(e))
      else toast(e instanceof Error ? e.message : tr('err.tryAgain'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="eyebrow">{tr('concern.eyebrow')}</div>
      <div className="card-title" style={{ fontSize: 18 }}>{tr('concern.title', { name: t.neighbour.resident_name })}</div>
      <ol className="ladder-intro">
        <li><b>1</b> {tr('concern.s1', { name: t.neighbour.resident_name })}</li>
        <li><b>2</b> {tr('concern.s2')}</li>
        <li><b>3</b> {tr('concern.s3')}</li>
      </ol>
      {t.their_renovations.length > 1 && (
        <label className="field">{tr('concern.about')}
          <select value={reno?.intro_id} onChange={(e) => setIntroId(Number(e.target.value))}>
            {t.their_renovations.map((r) => <option key={r.intro_id} value={r.intro_id}>{r.scope} · {dates.range(r.start, r.end)}</option>)}
          </select>
        </label>
      )}
      <div className="category-grid">
        {(Object.keys(t.concern_categories) as ConcernCategory[]).map((k) => {
          const Icon = CATEGORY_ICON[k]
          return (
            <button key={k} className={`category ${category === k ? 'on' : ''}`} onClick={() => setCategory(k)}>
              <Icon size={18} />
              <span>{tr(`cat.${k}`)}</span>
            </button>
          )
        })}
      </div>
      {category === 'damage' && (
        <div className="hint-inline"><House size={14} /> {tr('concern.damageHint')}</div>
      )}
      <textarea className="input" rows={3} maxLength={300} placeholder={tr('concern.placeholder')}
        value={note} onChange={(e) => { setNote(e.target.value); setTone(null) }} />
      {tone && <div className="tone-check"><TriangleAlert size={15} /><div><b>{tr(`${tone}.title`)}</b>{tr(`${tone}.body`)}</div></div>}
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy || !reno}>
        <MessageSquareWarning size={16} /> {busy ? tr('btn.sending') : tr('concern.send', { name: t.neighbour.resident_name })}
      </button>
    </Sheet>
  )
}

const REPORT_REASONS = ['harassment', 'threat', 'spam', 'privacy', 'other']

function ReportSheet({ message, me, name, onClose }: { message: ChatMessage | null; me: UnitInfo; name: string; onClose: () => void }) {
  const t = useT()
  const toast = useToast()
  const [reason, setReason] = useState('harassment')
  async function submit() {
    if (!message) return
    try {
      await api.reportMessage(message.id, me.id, reason)
      toast(t('report.sent', { name }))
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('err.tryAgain'), 'error')
    }
  }
  return (
    <Sheet open={!!message} onClose={onClose}>
      <div className="eyebrow">{t('report.eyebrow')}</div>
      <blockquote className="report-quote">{message?.kind === 'voice' ? t('report.voice') : `“${message?.text}”`}</blockquote>
      <div className="choices">
        {REPORT_REASONS.map((r) => (
          <button key={r} className={`choice ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>
            <Flag size={16} /><span>{t(`report.${r}`)}</span>
          </button>
        ))}
      </div>
      <div className="small dim">{t('report.note', { name })}</div>
      <button className="btn btn-danger btn-block" onClick={submit}><Flag size={15} /> {t('report.send')}</button>
    </Sheet>
  )
}
