import { useEffect, useState } from 'react'
import { BadgeCheck, Bell, CheckCheck, ChevronLeft, FileWarning, House, Megaphone, Network, Printer, Smartphone } from 'lucide-react'
import { api, type Conversation, type Official, type UnitInfo, type WhatsAppOutbox } from '../api'
import { Avatar, formatDate, formatTime, ScreenTitle, Skeleton } from '../ui'

/** How residents actually meet Jiran5: inside the SDP App they already have, and through WhatsApp alerts. */
export default function ChannelsView({ me, version }: { me: UnitInfo; version: number }) {
  const [convos, setConvos] = useState<Conversation[] | null>(null)
  const [official, setOfficial] = useState<Official | null>(null)
  const [wa, setWa] = useState<WhatsAppOutbox | null>(null)

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

  const unread = (convos ?? []).reduce((n, c) => n + c.unread, 0) + (official?.unread ?? 0)
  return (
    <section className="screen">
      <ScreenTitle eyebrow="SDP · Channels" title="Where residents meet Jiran5"
        subtitle={`No new app to install: a module inside the SDP App, plus WhatsApp alerts. Showing what ${me.joined ? `${me.resident_name} (${me.label})` : me.label} would see.`} />
      <div className="phones">
        <figure className="phone-wrap">
          <div className="phone sdp-app">
            <div className="phone-status"><span>9:41</span><span>●●● ▮</span></div>
            <div className="app-head">
              <div className="app-brand"><House size={16} /> SDP App</div>
              <Bell size={16} />
            </div>
            <div className="app-hello">
              <small>Good morning</small>
              <b>{me.joined ? me.resident_name : 'Owner'} · {me.label}</b>
            </div>
            <div className="app-tile jiran">
              <Network size={20} />
              <span className="grow"><b>Neighbours · Jiran5</b><small>{me.joined ? `${unread} new · your circle, chats and notices` : 'Join with the code in your welcome pack'}</small></span>
              {unread > 0 && <span className="unread">{unread}</span>}
            </div>
            <div className="app-tiles">
              <div className="app-tile"><House size={18} /><b>My home</b></div>
              <div className="app-tile"><FileWarning size={18} /><b>Defects &amp; warranty</b></div>
              <div className="app-tile"><Megaphone size={18} /><b>Announcements</b></div>
              <div className="app-tile"><Smartphone size={18} /><b>Help &amp; contact</b></div>
            </div>
            <div className="app-section">Recent in Jiran5</div>
            {!convos ? <Skeleton lines={3} /> : convos.slice(0, 3).map((c) => (
              <div key={c.id} className="app-row">
                <Avatar name={c.resident_name} size={28} />
                <span className="grow"><b>{c.resident_name}</b><small>{c.last ?? 'Say hello'}</small></span>
                {c.unread > 0 && <span className="unread">{c.unread}</span>}
              </div>
            ))}
            {convos?.length === 0 && <div className="app-empty">{me.joined ? 'No chats yet' : 'Not on Jiran5 yet'}</div>}
          </div>
          <figcaption><b>Inside the SDP App</b> Jiran5 runs as a module with the same sign-in, so owners don't learn a new app. Layout is an illustration, not SDP's actual app.</figcaption>
        </figure>

        <figure className="phone-wrap">
          <div className="phone wa">
            <div className="phone-status dark"><span>9:41</span><span>●●● ▮</span></div>
            <div className="wa-head">
              <ChevronLeft size={18} />
              <span className="wa-avatar"><Network size={16} /></span>
              <span className="grow"><b>{wa?.business_name ?? 'Jiran5 · Taman Demo'} <BadgeCheck size={13} /></b><small>Business account</small></span>
            </div>
            <div className="wa-body">
              {!wa ? <Skeleton lines={4} /> : wa.channel === 'paper' ? (
                <div className="wa-note"><Printer size={16} /> Not on Jiran5 yet, so nothing is sent here. The estate office delivers formal notices on paper.</div>
              ) : wa.channel === 'app' ? (
                <div className="wa-note"><Bell size={16} /> WhatsApp alerts are switched off for this household. Everything stays in the app.</div>
              ) : wa.messages.length === 0 ? (
                <div className="wa-note">No alerts yet.</div>
              ) : (
                wa.messages.map((m, i) => (
                  <div key={i} className="wa-msg">
                    {(i === 0 || formatDate(wa.messages[i - 1].at) !== formatDate(m.at)) && <div className="wa-day">{formatDate(m.at)}</div>}
                    <div className="wa-bubble">
                      <p>{m.text}</p>
                      <small>{formatTime(m.at)} <CheckCheck size={12} /></small>
                    </div>
                    {m.buttons.length > 0 && <div className="wa-buttons">{m.buttons.map((b) => <span key={b}>{b}</span>)}</div>}
                  </div>
                ))
              )}
            </div>
          </div>
          <figcaption><b>On WhatsApp</b> Short alerts from pre-approved templates, in the reader's language. They never contain what neighbours wrote; tapping opens Jiran5. Quiet mode holds back chat alerts, never formal notices. Illustration.</figcaption>
        </figure>
      </div>
    </section>
  )
}
