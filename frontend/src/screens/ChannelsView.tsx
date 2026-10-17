import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { BadgeCheck, Bell, CheckCheck, ChevronLeft, Clock3, DoorOpen, FileWarning, House, KeyRound, Megaphone, MessageSquare, Network, Printer, Smartphone } from 'lucide-react'
import { api, type Conversation, type Official, type UnitInfo, type WhatsAppOutbox } from '../api'
import { Avatar, Badge, formatDate, formatTime, ScreenTitle, Skeleton } from '../ui'

/** How Keynection reaches residents, in two steps. Step one needs no change to the SDP App: the one-time code comes
 *  with the keys, Keynection opens in the phone's browser, and alerts arrive on WhatsApp. Step two, after the pilot,
 *  makes it a module inside the SDP App with the owner's existing sign-in (integration is SDP's stated direction). */
export default function ChannelsView({ me, version }: { me: UnitInfo; version: number }) {
  const [convos, setConvos] = useState<Conversation[] | null>(null)
  const [official, setOfficial] = useState<Official | null>(null)
  const [wa, setWa] = useState<WhatsAppOutbox | null>(null)
  const [qr, setQr] = useState<string | null>(null)

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
      <ScreenTitle eyebrow="SDP · Channels" title="How Keynection reaches residents"
        subtitle={`Two steps. Step one needs no change to the SDP App: the code comes with the keys, Keynection opens in the phone's browser, and alerts arrive on WhatsApp. Step two makes it a module inside the SDP App, with the owner's existing sign-in. Showing what ${who} would see.`} />

      <div className="reach-steps">
        <div className="reach-step">
          <div className="reach-when"><KeyRound size={14} /> Step one · key day</div>
          <b>A one-time code in the welcome pack</b>
          <p>SDP already meets every owner at handover. Scan the code, choose a name and language, agree to the privacy notice: the five neighbours appear. Nothing in the SDP App has to change first.</p>
          <div className="reach-card">
            {qr ? <img src={qr} alt="" /> : <span className="reach-qr-blank" aria-hidden />}
            <span><b>Keynection · {me.label}</b><small>Scan to meet your five neighbours.</small><small>Illustration: the real card carries a one-time code for that home.</small></span>
          </div>
        </div>
        <div className="reach-step">
          <div className="reach-when"><MessageSquare size={14} /> Step one · every day</div>
          <b>WhatsApp alerts, in the reader's language</b>
          <p>Short alerts from pre-approved templates on the WhatsApp residents already use. Keynection itself is a web app: open it from the alert or from the Home Screen, no app store needed. In a pilot it also sends the phone's own notifications.</p>
        </div>
        <div className="reach-step later">
          <div className="reach-when"><DoorOpen size={14} /> Step two · after the pilot</div>
          <b>A module inside the SDP App</b>
          <p>The SDP App shows a “Neighbours” entry that opens Keynection with the owner's existing sign-in: one app and one sign-in for the owner, one set of data for SDP. Step one keeps working meanwhile, so the integration can take the time it needs.</p>
        </div>
      </div>

      <div className="phones">
        <figure className="phone-wrap">
          <div className="phone wa">
            <div className="phone-status dark"><span>9:41</span><span>●●● ▮</span></div>
            <div className="wa-head">
              <ChevronLeft size={18} />
              <span className="wa-avatar"><Network size={16} /></span>
              <span className="grow"><b>{wa?.business_name ?? 'Keynection · Taman Demo'} <BadgeCheck size={13} /></b><small>Business account</small></span>
            </div>
            <div className="wa-body">
              {!wa ? <Skeleton lines={4} /> : wa.channel === 'paper' ? (
                <div className="wa-note"><Printer size={16} /> Not on Keynection yet, so nothing is sent here. The estate office delivers formal notices on paper.</div>
              ) : wa.channel === 'app' ? (
                <div className="wa-note"><Bell size={16} /> WhatsApp alerts are switched off for this household. Everything stays in the app.</div>
              ) : wa.messages.length === 0 ? (
                <div className="wa-note">No alerts yet.</div>
              ) : (
                wa.messages.map((m, i) => (
                  <div key={i} className={`wa-msg ${m.scheduled ? 'scheduled' : ''}`}>
                    {(i === 0 || formatDate(wa.messages[i - 1].at) !== formatDate(m.at)) && <div className="wa-day">{formatDate(m.at)}</div>}
                    <div className="wa-bubble">
                      <p>{m.text}</p>
                      <small>
                        {m.scheduled ? <><Clock3 size={11} /> Scheduled · goes out by itself at {formatTime(m.at)}</> : <>{formatTime(m.at)} <CheckCheck size={12} /></>}
                      </small>
                    </div>
                    {m.buttons.length > 0 && <div className="wa-buttons">{m.buttons.map((b) => <span key={b}>{b}</span>)}</div>}
                  </div>
                ))
              )}
            </div>
          </div>
          <figcaption><b>On WhatsApp</b> Short alerts from pre-approved templates, in the reader's language. They never contain what neighbours wrote; tapping opens Keynection. Quiet mode holds back chat alerts, never formal notices. Alerts marked Scheduled go out by themselves: a reminder to photograph three days before works start, and a check the day after they end. Illustration.</figcaption>
        </figure>

        <figure className="phone-wrap">
          <Badge tone="blue">Step two · illustration</Badge>
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
            <div className="app-tile keynection">
              <Network size={20} />
              <span className="grow"><b>Neighbours · Keynection</b><small>{me.joined ? `${unread} new · your circle, chats and notices` : 'Join with the code in your welcome pack'}</small></span>
              {unread > 0 && <span className="unread">{unread}</span>}
            </div>
            <div className="app-tiles">
              <div className="app-tile"><House size={18} /><b>My home</b></div>
              <div className="app-tile"><FileWarning size={18} /><b>Defects &amp; warranty</b></div>
              <div className="app-tile"><Megaphone size={18} /><b>Announcements</b></div>
              <div className="app-tile"><Smartphone size={18} /><b>Help &amp; contact</b></div>
            </div>
            <div className="app-section">Recent in Keynection</div>
            {!convos ? <Skeleton lines={3} /> : convos.slice(0, 3).map((c) => (
              <div key={c.id} className="app-row">
                <Avatar name={c.resident_name} size={28} />
                <span className="grow"><b>{c.resident_name}</b><small>{c.last ?? 'Say hello'}</small></span>
                {c.unread > 0 && <span className="unread">{c.unread}</span>}
              </div>
            ))}
            {convos?.length === 0 && <div className="app-empty">{me.joined ? 'No chats yet' : 'Not on Keynection yet'}</div>}
          </div>
          <figcaption><b>Step two: a module inside the SDP App</b> A “Neighbours · Keynection” entry with the owner's existing sign-in, so the owner has one app and SDP has one set of data. Step one (welcome pack and WhatsApp) does not wait for it. Layout is an illustration, not SDP's actual app.</figcaption>
        </figure>
      </div>
    </section>
  )
}
