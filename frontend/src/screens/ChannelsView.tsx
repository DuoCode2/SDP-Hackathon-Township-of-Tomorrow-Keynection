import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { BadgeCheck, Bell, CheckCheck, ChevronDown, ChevronLeft, Clock3, DoorOpen, FileWarning, House, KeyRound, Megaphone, MessageSquare, Network, Printer, Smartphone } from 'lucide-react'
import { api, type Conversation, type Lang, type Official, type Preview, type UnitInfo, type WhatsAppOutbox } from '../api'
import type { TabId } from '../guide'
import { dateIn, tIn, useT, type Translate } from '../i18n'
import { Avatar, Badge, ScreenTitle, Skeleton } from '../ui'

// The page speaks the language the screens are in; the two phones show what the household itself would see, so they
// are in its reading language (WhatsApp alerts arrive in it; the SDP App illustration uses it, English for Tamil).
const TIME_LOCALE: Record<Lang, string> = { en: 'en-MY', ms: 'ms-MY', zh: 'zh-CN', ta: 'ta-MY' }
const timeIn = (lang: Lang, iso: string) => new Date(iso).toLocaleTimeString(TIME_LOCALE[lang], { hour: '2-digit', minute: '2-digit' })

/** A chat's last line on the SDP App illustration, in the phone's language. */
function lastLine(tr: Translate, p: Preview | null, me: string, record: string | null): string {
  if (!p) return tr('chats.sayHello')
  switch (p.kind) {
    case 'renovation': return tr('pv.renovation')
    case 'wave': return tr(p.from && p.from !== me ? 'pv.waveTheirs' : 'pv.waveMine')
    case 'voice': return tr('pv.voice', { n: p.duration })
    case 'concern': return tr('pv.concern', { what: tr(`cat.${p.category}`) })
    case 'text': return p.text
    default: return record ?? ''
  }
}

/** How Keynection reaches residents, in two steps. Step one needs no change to the SDP App: the one-time code comes
 *  with the keys, Keynection opens in the phone's browser, and alerts arrive on WhatsApp. Step two, after the pilot,
 *  makes it a module inside the SDP App with the owner's existing sign-in (integration is SDP's stated direction). */
export default function ChannelsView({ me, version, onGo }: { me: UnitInfo; version: number; onGo?: (tab: TabId, peer?: string) => void }) {
  const t = useT()
  const appLang: Lang = me.lang === 'ta' ? 'en' : me.lang  // the SDP App illustration has no Tamil
  const tr = tIn(me.lang)  // the household's own WhatsApp
  const ta = tIn(appLang)  // the household's own SDP App
  const [convos, setConvos] = useState<Conversation[] | null>(null)
  const [official, setOfficial] = useState<Official | null>(null)
  const [wa, setWa] = useState<WhatsAppOutbox | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [inside, setInside] = useState(false)  // the SDP App phone shows Keynection itself
  // The two steps read as three headings; their paragraphs open on request, so the phones are on the first screen.
  const [more, setMore] = useState(false)

  useEffect(() => {
    let live = true
    api.whatsapp(me.id).then((x) => live && setWa(x)).catch(() => live && setWa(null))
    if (me.joined) {
      api.conversations(me.id).then((x) => live && setConvos(x)).catch(() => live && setConvos([]))
      api.official(me.id).then((x) => live && setOfficial(x)).catch(() => live && setOfficial(null))
    } else {
      setConvos([])
      setOfficial(null)
    }
    return () => {
      live = false
    }
  }, [me.id, me.joined, version])

  // The welcome-pack card drawn here is an illustration: its code opens this site. A real card carries that home's
  // own one-time code (Front desk → Welcome packs).
  useEffect(() => {
    let live = true
    QRCode.toDataURL(`${window.location.origin}/`, { margin: 1, width: 160, errorCorrectionLevel: 'M', color: { dark: '#0b1220', light: '#ffffff' } })
      .then((url) => live && setQr(url)).catch(() => live && setQr(null))
    return () => {
      live = false
    }
  }, [])

  const who = me.joined ? `${me.resident_name} (${me.label})` : me.label
  const unread = (convos ?? []).reduce((n, c) => n + c.unread, 0) + (official?.unread ?? 0)
  return (
    <section className="screen">
      <ScreenTitle eyebrow={t('sdp.ch.eyebrow')} title={t('sdp.ch.title')} subtitle={t('sdp.ch.subtitle', { who })}
        aside={<button className="btn btn-sm" onClick={() => setMore((m) => !m)} aria-expanded={more}>{t(more ? 'sdp.ch.less' : 'sdp.ch.more')} <ChevronDown size={14} className={more ? 'flip' : ''} /></button>} />

      <div className={`reach-steps ${more ? '' : 'compact'}`}>
        <div className="reach-step">
          <div className="reach-when"><KeyRound size={14} /> {t('sdp.ch.s1.when')}</div>
          <b>{t('sdp.ch.s1.title')}</b>
          {more && <>
            <p>{t('sdp.ch.s1.body')}</p>
            <div className="reach-card">
              {qr ? <img src={qr} alt="" /> : <span className="reach-qr-blank" aria-hidden />}
              <span><b>Keynection · {me.label}</b><small>{t('sdp.ch.s1.scan')}</small><small>{t('sdp.ch.s1.illustration')}</small></span>
            </div>
          </>}
        </div>
        <div className="reach-step">
          <div className="reach-when"><MessageSquare size={14} /> {t('sdp.ch.s2.when')}</div>
          <b>{t('sdp.ch.s2.title')}</b>
          {more && <p>{t('sdp.ch.s2.body')}</p>}
        </div>
        <div className="reach-step later">
          <div className="reach-when"><DoorOpen size={14} /> {t('sdp.ch.s3.when')}</div>
          <b>{t('sdp.ch.s3.title')}</b>
          {more && <p>{t('sdp.ch.s3.body')}</p>}
        </div>
      </div>

      <div className="phones">
        <figure className="phone-wrap">
          <Badge tone="blue">{t('sdp.ch.badge.s1')}</Badge>
          <small className="phone-lang">{t('sdp.ch.phoneLang', { who, lang: t(`lang.${me.lang}`) })}</small>
          <div className="phone wa">
            <div className="phone-status dark"><span>9:41</span><span>●●● ▮</span></div>
            <div className="wa-head">
              <ChevronLeft size={18} />
              <span className="wa-avatar"><Network size={16} /></span>
              <span className="grow"><b>{wa?.business_name ?? 'Keynection · Taman Demo'} <BadgeCheck size={13} /></b><small>{tr('sdp.ch.wa.business')}</small></span>
            </div>
            <div className="wa-body">
              {!wa ? <Skeleton lines={4} /> : wa.channel === 'paper' ? (
                <div className="wa-note"><Printer size={16} /> {t('sdp.ch.wa.paper')}</div>
              ) : wa.channel === 'app' ? (
                <div className="wa-note"><Bell size={16} /> {t('sdp.ch.wa.app')}</div>
              ) : wa.messages.length === 0 ? (
                <div className="wa-note">{t('sdp.ch.wa.none')}</div>
              ) : (
                wa.messages.map((m, i) => (
                  <div key={i} className={`wa-msg ${m.scheduled ? 'scheduled' : ''}`}>
                    {(i === 0 || dateIn(me.lang, wa.messages[i - 1].at) !== dateIn(me.lang, m.at)) && <div className="wa-day">{dateIn(me.lang, m.at)}</div>}
                    <div className="wa-bubble">
                      <p>{m.text}</p>
                      <small>
                        {m.scheduled ? <><Clock3 size={11} /> {t('sdp.ch.wa.scheduled', { time: timeIn(me.lang, m.at) })}</> : <>{timeIn(me.lang, m.at)} <CheckCheck size={12} /></>}
                      </small>
                    </div>
                    {m.buttons.length > 0 && (
                      <div className="wa-buttons">
                        {m.buttons.map((b) => {
                          const to = opens(m, convos ?? [])
                          return <button key={b} type="button" disabled={!onGo} onClick={() => onGo?.(to.tab, to.peer)}>{b}</button>
                        })}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          <figcaption><b>{t('sdp.ch.wa.captionTitle')}</b> {t('sdp.ch.wa.caption')}</figcaption>
        </figure>

        <figure className="phone-wrap">
          <Badge tone="blue">{t('sdp.ch.badge.s2')}</Badge>
          <small className="phone-lang">{t('sdp.ch.appLang', { who, lang: t(`lang.${appLang}`) })}</small>
          <div className={`phone sdp-app ${inside ? 'inside' : ''}`}>
            <div className="phone-status">
              {inside ? <button type="button" className="phone-back" onClick={() => setInside(false)}><ChevronLeft size={13} /> SDP App</button> : <span>9:41</span>}
              <span>●●● ▮</span>
            </div>
            {inside ? (
              <iframe className="phone-app" src={`/?embed=1&me=${encodeURIComponent(me.id)}`} title={t('sdp.ch.app.iframe')} />
            ) : <>
            <div className="app-head">
              <div className="app-brand"><House size={16} /> SDP App</div>
              <Bell size={16} />
            </div>
            <div className="app-hello">
              <small>{ta('sdp.ch.app.morning')}</small>
              <b>{me.joined ? me.resident_name : ta('sdp.ch.app.owner')} · {me.label}</b>
            </div>
            <button type="button" className="app-tile keynection" onClick={() => setInside(true)} disabled={!me.joined}>
              <Network size={20} />
              <span className="grow"><b>{ta('sdp.ch.app.tile')}</b><small>{me.joined ? ta('sdp.ch.app.new', { n: unread }) : ta('sdp.ch.app.join')}</small></span>
              {unread > 0 && <span className="unread">{unread}</span>}
            </button>
            <div className="app-tiles">
              <div className="app-tile"><House size={18} /><b>{ta('sdp.ch.app.home')}</b></div>
              <div className="app-tile"><FileWarning size={18} /><b>{ta('sdp.ch.app.defects')}</b></div>
              <div className="app-tile"><Megaphone size={18} /><b>{ta('sdp.ch.app.news')}</b></div>
              <div className="app-tile"><Smartphone size={18} /><b>{ta('sdp.ch.app.help')}</b></div>
            </div>
            <div className="app-section">{ta('sdp.ch.app.recent')}</div>
            {!convos ? <Skeleton lines={3} /> : convos.slice(0, 3).map((c) => (
              <div key={c.id} className="app-row">
                <Avatar name={c.resident_name} size={28} />
                <span className="grow"><b>{c.resident_name}</b><small>{lastLine(ta, c.last_preview, me.id, c.last)}</small></span>
                {c.unread > 0 && <span className="unread">{c.unread}</span>}
              </div>
            ))}
            {convos?.length === 0 && <div className="app-empty">{ta(me.joined ? 'sdp.ch.app.noChats' : 'nj.status')}</div>}
            </>}
          </div>
          <figcaption><b>{t('sdp.ch.app.captionTitle')}</b> {t('sdp.ch.app.caption')}</figcaption>
        </figure>
      </div>
    </section>
  )
}

type Alert = WhatsAppOutbox['messages'][number]
const EVIDENCE_ALERTS = ['reno_photo', 'reno_done', 'repair']
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where a tap on an alert leads, as on the phone: the kind of alert decides the screen, and a chat opens on the
 *  neighbour the alert names by unit number (No. 12), or on the estate office for one of its notices. */
function opens(m: Alert, convos: Conversation[]): { tab: TabId; peer?: string } {
  if (EVIDENCE_ALERTS.includes(m.kind)) return { tab: 'evidence' }
  if (m.kind === 'reno_done_owner') return { tab: 'works' }
  if (m.kind === 'request') return { tab: 'circle' }
  if (m.kind === 'notice') return { tab: 'chats', peer: '__estate' }
  const named = convos.find((c) => new RegExp(`${escape(c.label)}(?!\\d)`).test(m.text))
  return { tab: 'chats', peer: named?.id }
}
