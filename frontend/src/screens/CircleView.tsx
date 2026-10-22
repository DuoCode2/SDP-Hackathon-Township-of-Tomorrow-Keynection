import { useEffect, useState } from 'react'
import { Camera, Eye, Hammer, Languages, Lock, Map as MapIcon, MessagesSquare, UserPlus, Users, X } from 'lucide-react'
import type { TabId } from '../guide'
import { api, type ContactRequest, type Directory, type Lang, type NearbyHome, type RenovationTask, type UnitInfo } from '../api'
import { bioFor, readLang, refusal, useLang, useT, type Translate } from '../i18n'
import PlanMap from '../components/PlanMap'
import { LANG_TAG, roleOf } from '../components/Cast'
import { Avatar, Badge, Card, CardHead, ScreenTitle, Segmented, Sheet, Skeleton, useCelebrate, useToast } from '../ui'
import Tour from '../components/Tour'
import IntroWizard from './IntroWizard'
import QuietTimesCard from '../components/QuietTimes'
import { usePilot, useShowAll } from '../features'
import { NotificationsAsk } from '../components/Notifications'
import { markWelcomeSeen, welcomeDue } from '../welcome'

interface Props {
  me: UnitInfo
  units: UnitInfo[]
  version: number
  onChange: () => void
  onViewAs: (unitId: string) => void
  onOpenChat: (unitId: string) => void
  onOpenEvidence: () => void
  /** The tour's cards open the screen they describe. */
  onGo: (tab: TabId) => void
}

/** Whole days from today (Malaysian calendar) to an ISO date. */
function daysUntil(iso: string): number {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
  today.setHours(0, 0, 0, 0)
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86_400_000)
}

/** Work next door that hasn't started yet and still needs this household's pre-work photo: the most
 *  time-sensitive thing on the page, because once work begins the photo can no longer show "before". */
function photoTasksDue(tasks: RenovationTask[]): (RenovationTask & { days: number })[] {
  return tasks
    .filter((x) => !x.mine && x.needs_photo && !x.baseline)  // my own works have their card on Photos & repairs
    .map((x) => ({ ...x, days: daysUntil(x.renovation.start) }))
    .filter((x) => x.days >= 0)
    .sort((a, b) => a.days - b.days)
}

type Member = Directory['circle'][number] & { waved_today?: boolean; allow_waves?: boolean }

const SHARES: Record<string, string> = {
  left: 'share.wall', right: 'share.wall', above: 'share.above', below: 'share.below',
  'across-left': 'rel.across-left', across: 'rel.across', 'across-right': 'rel.across-right',
}
const REASONS = ['parking', 'noise', 'leak', 'delivery', 'safety', 'other']

/** How this home relates to yours, in the reader's language. */
const shares = (t: Translate, relation: string) => t(SHARES[relation] ?? `rel.${relation}`)
const langName = (t: Translate, code: string) => t(`lang.${code}`)

// The welcome's helpers live in welcome.ts; the join page and the demo reset still reach replayWelcome through here.
export { replayWelcome } from '../welcome'

/** Who lives around you and who you can talk to: people first, the plan one tap away. */
export default function CircleView({ me, units, version, onChange, onViewAs, onOpenChat, onOpenEvidence, onGo }: Props) {
  const t = useT()
  const reads = readLang(useLang().lang, me)  // bios arrive in this language
  // The street or block beyond the circle, named in the reader's language ("A 栋"); a street keeps its own name.
  const nearPlace = me.kind === 'terrace' ? me.street ?? '' : t('place.block', { b: me.block ?? '' })
  const showAll = useShowAll()  // contact requests beyond the five homes are an extra, shown on request
  const toast = useToast()
  const celebrate = useCelebrate()
  const pilot = usePilot()
  const [welcome, setWelcome] = useState(() => welcomeDue(me.id, !!pilot))  // a pilot household once; the demo never by itself
  const [dir, setDir] = useState<Directory | null>(null)
  const [reqs, setReqs] = useState<{ incoming: ContactRequest[]; outgoing: ContactRequest[] } | null>(null)
  const [mode, setMode] = useState<'people' | 'map'>('people')
  // The plan drawing is of the demo's own layout; a real phase shows its people only.
  const drawn = !pilot
  const [view, setView] = useState<'terrace' | 'apartment'>(me.kind)
  const [selected, setSelected] = useState<string | null>(null)
  const [profile, setProfile] = useState<Member | null>(null)
  const [introOpen, setIntroOpen] = useState(false)
  const [requestFor, setRequestFor] = useState<NearbyHome | null>(null)
  const [photoTasks, setPhotoTasks] = useState<ReturnType<typeof photoTasksDue>>([])

  useEffect(() => {
    let live = true
    Promise.all([api.directory(me.id), api.contactRequests(me.id)]).then(([d, r]) => {
      if (!live) return
      setDir(d)
      setReqs(r)
    })
    api.evidence(me.id).then((e) => live && setPhotoTasks(photoTasksDue(e.renovations))).catch(() => live && setPhotoTasks([]))
    return () => {
      live = false
    }
  }, [me.id, version])

  const circle = (dir?.circle ?? []) as Member[]
  const nearby = dir?.nearby ?? []
  // A block lists every other home on it (Sofia sees 19): the nearest levels first, the rest behind one button.
  // Anyone already in touch stays in view. A terrace row is short enough to show whole.
  const [allNearby, setAllNearby] = useState(false)
  const nearLevel = (h: NearbyHome) => me.kind !== 'apartment' || h.contact !== 'none' || (h.floor != null && me.floor != null && Math.abs(h.floor - me.floor) <= 1)
  const nearbyShown = allNearby ? nearby : nearby.filter(nearLevel)
  const nearbyHidden = nearby.length - nearbyShown.length
  const works = new Set(dir?.works ?? [])
  const names: Record<string, string> = { [me.id]: me.resident_name }
  circle.forEach((n) => { names[n.id] = n.resident_name })
  nearby.forEach((n) => { if (n.resident_name) names[n.id] = n.resident_name })
  const unknown = circle.filter((n) => n.joined && !n.known).length
  // Every neighbour not yet known has already had my hello: the banner says so instead of asking again.
  const waiting = unknown > 0 && circle.every((n) => !n.joined || n.known || n.hello_sent)
  const pendingIn = reqs?.incoming.filter((r) => r.status === 'pending') ?? []

  async function wave(n: Member) {
    try {
      await api.wave(me.id, n.id)
      celebrate('👋', t('celebrate.wave', { name: n.resident_name }))
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('err.tryAgain'), 'error')
    }
  }

  async function respond(r: ContactRequest, accept: boolean) {
    await api.respondContact(r.id, me.id, accept)
    if (accept) celebrate('🤝', t('celebrate.connected', { label: r.from.label }))
    else toast(t('request.declined'))
    onChange()
  }

  const pick = (id: string) => {
    setSelected(id)
    const u = units.find((x) => x.id === id)
    if (u && u.kind !== view) setView(u.kind)
  }

  return (
    <section className="screen">
      <ScreenTitle eyebrow={`${me.label} · ${me.kind === 'terrace' ? me.street ?? '' : t('place.block', { b: me.block ?? '' })}`} title={t('circle.title')}
        subtitle={t('circle.subtitle')}
        aside={drawn && <span className="hide-easy"><Segmented value={mode} onChange={setMode} options={[{ id: 'people', label: t('circle.people') }, { id: 'map', label: t('circle.map') }]} /></span>} />
      {!drawn && <NotificationsAsk />}

      {!dir ? <Card><Skeleton lines={6} /></Card> : mode === 'people' ? (
        <>
          <div className="stories" role="list" aria-label={t('circle.list')}>
            {circle.map((n) => (
              <button key={n.id} role="listitem" className={`story ${!n.joined ? 'off' : works.has(n.id) ? 'works' : n.known ? 'known' : 'new'}`} onClick={() => setProfile(n)}>
                <span className="story-ring"><Avatar name={n.resident_name} size={58} /></span>
                <b>{n.resident_name}</b>
                <small>{!n.joined ? t('nj.story') : works.has(n.id) ? t('story.renovating') : n.known ? t('story.known') : n.hello_sent ? t('story.helloSent') : t('story.sayHi')}</small>
              </button>
            ))}
          </div>

          {photoTasks.map((x) => (
            <Card key={x.intro_id} className="alert photo-due">
              <CardHead icon={<Camera size={16} />} tone="amber"
                title={t('photo.title', { name: x.from_name, label: x.from_label,
                  when: x.days === 0 ? t('photo.today') : x.days === 1 ? t('photo.tomorrow') : t('photo.inDays', { n: x.days }) })}
                sub={t('photo.sub')} />
              <button className="btn btn-primary" onClick={onOpenEvidence}><Camera size={16} /> {t('photo.cta')}</button>
            </Card>
          ))}

          {pendingIn.length > 0 && (
            <Card className="alert">
              <CardHead icon={<UserPlus size={16} />} tone="amber" title={t('req.title', { n: pendingIn.length })} sub={t('req.sub')} />
              {pendingIn.map((r) => (
                <div key={r.id} className="request">
                  <div className="request-top"><b>{t('req.resident', { label: r.from.label })}</b><Badge tone="amber">{t(`reason.${r.reason}`)}</Badge></div>
                  {r.note && <p>“{r.note}”</p>}
                  <div className="btn-row">
                    <button className="btn btn-sm" onClick={() => respond(r, false)}>{t('btn.decline')}</button>
                    <button className="btn btn-sm btn-primary" onClick={() => respond(r, true)}>{t('btn.accept')}</button>
                  </div>
                </div>
              ))}
            </Card>
          )}

          {unknown > 0 && (
            <div className="say-hi">
              <span className="say-hi-hand" aria-hidden>👋</span>
              <div className="grow"><b>{t(waiting ? 'sayhi.waiting' : 'sayhi.title', { n: unknown })}</b><small>{t(waiting ? 'sayhi.waitingSub' : 'sayhi.sub')}</small></div>
              {!waiting && <button className="link" onClick={() => setIntroOpen(true)}>{t('btn.introduce')}</button>}
            </div>
          )}

          <div className="section-label">{t('section.nextDoor')}</div>
          <div className="people-grid">
            {circle.map((n) => !n.joined ? (
              <article key={n.id} className="person-card off">
                <button className="person-card-top" onClick={() => setProfile(n)}>
                  <Avatar name={n.resident_name} size={46} />
                  <span className="grow">
                    <b>{n.label}</b>
                    <small>{shares(t, n.relation)}</small>
                  </span>
                </button>
                <div className="person-status">{t('nj.status')}</div>
                <p className="person-bio muted">{t('nj.note')}</p>
              </article>
            ) : (
              <article key={n.id} className={`person-card ${works.has(n.id) ? 'works' : ''}`}>
                <button className="person-card-top" onClick={() => setProfile(n)}>
                  <Avatar name={n.resident_name} size={46} />
                  <span className="grow">
                    <b>{n.resident_name}</b>
                    <small>{n.label} · {shares(t, n.relation)}</small>
                  </span>
                  <span className="lang-tag">{LANG_TAG[n.lang]}</span>
                </button>
                <Bio n={n} lang={reads} />
                <div className={`person-status ${works.has(n.id) ? 'works' : n.known ? 'known' : ''}`}>
                  {works.has(n.id) ? <><Hammer size={12} /> {t('status.renovating')}</> : t(n.known ? 'status.known' : n.hello_sent ? 'status.helloSent' : 'status.notMet')}
                </div>
                <div className="btn-row">
                  {/* Not met yet: a wave is the easy first step, so it leads. Once you know each other, you talk. */}
                  <button className={`btn btn-sm ${n.known ? 'btn-primary' : ''}`} onClick={() => onOpenChat(n.id)}><MessagesSquare size={14} /> {t('btn.message')}</button>
                  {!n.known && (
                    <button className="btn btn-sm btn-primary" disabled={n.waved_today || n.allow_waves === false} onClick={() => wave(n)}
                      title={n.allow_waves === false ? t('wave.off') : undefined}>
                      👋 {t(n.waved_today ? 'btn.waved' : 'btn.wave')}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>

          <QuietTimesCard unitId={me.id} />

          {showAll && <>
          <div className="section-label ring2-label">{t('section.ring2', { place: nearPlace })}</div>
          <p className="ring2-note"><Lock size={12} /> {t('ring2.note')}</p>
          {nearbyHidden > 0 && <div className="section-sub">{t('ring2.nearLevels')}</div>}
          <div className="nearby-grid">
            {nearbyShown.map((h) => (
              <div key={h.id} className={`nearby ${h.contact}`}>
                <span className="unit-chip">{h.kind === 'terrace' ? h.label.replace('No. ', '') : `${h.floor}-${h.pos}`}</span>
                <span className="grow">
                  <b>{h.resident_name ?? t('req.resident', { label: h.label })}</b>
                  <small>{t(`hint.${h.hint_key}`, { n: h.hint_n })}</small>
                </span>
                {h.contact === 'none' && <button className="btn btn-sm" onClick={() => setRequestFor(h)}><UserPlus size={13} /> {t('btn.request')}</button>}
                {h.contact === 'requested' && <span className="mono muted">{t('status.requested')}</span>}
                {h.contact === 'incoming' && <span className="mono accent">{t('status.wantsConnect')}</span>}
                {h.contact === 'connected' && <button className="btn btn-sm" onClick={() => onOpenChat(h.id)}><MessagesSquare size={13} /> {t('btn.message')}</button>}
                {h.contact === 'declined' && <span className="mono muted">{t('status.closed')}</span>}
              </div>
            ))}
          </div>
          {(nearbyHidden > 0 || (allNearby && me.kind === 'apartment' && nearby.some((h) => !nearLevel(h)))) && (
            <button className="btn btn-sm nearby-more" onClick={() => setAllNearby((v) => !v)} aria-expanded={allNearby}>
              {allNearby ? t('ring2.less') : t('ring2.more', { n: nearby.length, place: dir.ring2_label })}
            </button>
          )}
          </>}
        </>
      ) : (
        <div className="cols">
          <Card className="drawing">
            <div className="plan-head">
              <CardHead icon={<MapIcon size={16} />} title={t('place.demoPhase')} sub={t('map.sub')} />
              <Segmented value={view} onChange={setView} options={[{ id: 'terrace', label: 'Jalan Demo 1' }, { id: 'apartment', label: t('place.block', { b: 'A' }) }]} />
            </div>
            <PlanMap units={units} me={me} circle={circle} ring2={nearby.map((n) => n.id)} names={names} works={dir.works}
              selected={selected} onSelect={pick} view={view} />
            <div className="legend">
              <span><i className="lg-me" />{t('legend.you')}</span>
              <span><i className="lg-circle" />{t('legend.circle')}</span>
              <span><i className="lg-ring2" />{nearPlace}</span>
              <span><i className="lg-wall" />{t('legend.wall')}</span>
              <span><i className="lg-works" />{t('legend.works')}</span>
            </div>
            <div className="privacy-strip"><Lock size={12} /> {t('map.privacy')}</div>
          </Card>
          <div className="col sticky">
            {selected ? (
              <HomePanel key={selected} id={selected} me={me} units={units} dir={dir} reqs={reqs} works={works}
                onClose={() => setSelected(null)} onMessage={onOpenChat} onViewAs={onViewAs} onRequest={setRequestFor} onRespond={respond} />
            ) : (
              <Card>
                <CardHead icon={<Users size={16} />} title={t('map.tap')} sub={t('map.tapSub')} />
              </Card>
            )}
          </div>
        </div>
      )}

      {profile && (
        <ProfileSheet n={profile} lang={reads} works={works.has(profile.id)} onClose={() => setProfile(null)}
          onMessage={() => { setProfile(null); onOpenChat(profile.id) }} onWave={() => wave(profile)} onViewAs={() => { setProfile(null); onViewAs(profile.id) }} />
      )}
      {introOpen && <IntroWizard open onClose={() => setIntroOpen(false)} me={me} circle={circle} onSent={() => { celebrate('👋', t('celebrate.hello')); onChange() }} />}
      {welcome && dir && (
        <Tour me={me} circle={circle} onClose={() => { markWelcomeSeen(me.id); setWelcome(false) }} onIntro={() => setIntroOpen(true)} onGo={onGo} />
      )}
      {requestFor && <RequestSheet home={requestFor} me={me} onClose={() => setRequestFor(null)} onSent={onChange} />}
    </section>
  )
}

/** A neighbour's one-line bio in the reader's language, saying where the wording came from when it is a translation. */
function Bio({ n, lang, quote }: { n: Member; lang: Lang; quote?: boolean }) {
  const t = useT()
  const { text, from } = bioFor(n, lang)
  if (!text) return null
  return (
    <>
      <p className={quote ? 'profile-bio' : 'person-bio'}>{quote ? `“${text}”` : text}</p>
      {from && <small className="bio-from">{t(n.bio_by_ai ? 'bio.byAi' : 'bio.translated', { lang: t(`lang.${from}`) })}</small>}
    </>
  )
}

/** A neighbour's mini profile, like tapping someone's picture in a social app. */
function ProfileSheet({ n, lang, works, onClose, onMessage, onWave, onViewAs }: {
  n: Member
  lang: Lang
  works: boolean
  onClose: () => void
  onMessage: () => void
  onWave: () => void
  onViewAs: () => void
}) {
  const t = useT()
  const pilot = usePilot()
  if (!n.joined) {
    return (
      <Sheet open onClose={onClose}>
        <div className="profile-hero">
          <span className="story-ring big off"><Avatar name={n.resident_name} size={84} /></span>
          <h2>{n.label}</h2>
          <div className="profile-sub">{shares(t, n.relation)} · {t('nj.status')}</div>
        </div>
        <div className="wizard-note"><Lock size={13} /> {t('nj.note')}</div>
        {!pilot && <button className="link-btn demo-link" onClick={onViewAs}><Eye size={13} /> {t('panel.viewAs')}</button>}
      </Sheet>
    )
  }
  return (
    <Sheet open onClose={onClose}>
      <div className="profile-hero">
        <span className={`story-ring big ${works ? 'works' : n.known ? 'known' : 'new'}`}><Avatar name={n.resident_name} size={84} /></span>
        <h2>{n.resident_name}</h2>
        <div className="profile-sub">{n.label} · {shares(t, n.relation)}</div>
        <Bio n={n} lang={lang} quote />
        <div className="profile-facts">
          <span><Languages size={13} /> {t('profile.reads', { lang: langName(t, n.lang) })}</span>
          <span>{t(n.known ? 'status.known' : 'status.notMet')}</span>
          {works && <span className="works"><Hammer size={13} /> {t('story.renovating')}</span>}
        </div>
      </div>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={onMessage}><MessagesSquare size={15} /> {t('btn.message')}</button>
        <button className="btn" disabled={n.waved_today || n.allow_waves === false} onClick={onWave}>👋 {t(n.waved_today ? 'profile.wavedToday' : 'btn.wave')}</button>
      </div>
      <div className="wizard-note"><Lock size={13} /> {t('profile.privacy')}</div>
      {!pilot && <button className="link-btn demo-link" onClick={onViewAs}><Eye size={13} /> {t('profile.viewAs', { name: n.resident_name })}</button>}
    </Sheet>
  )
}

function HomePanel({ id, me, units, dir, reqs, works, onClose, onMessage, onViewAs, onRequest, onRespond }: {
  id: string
  me: UnitInfo
  units: UnitInfo[]
  dir: Directory
  reqs: { incoming: ContactRequest[]; outgoing: ContactRequest[] } | null
  works: Set<string>
  onClose: () => void
  onMessage: (id: string) => void
  onViewAs: (id: string) => void
  onRequest: (home: NearbyHome) => void
  onRespond: (r: ContactRequest, accept: boolean) => void
}) {
  const t = useT()
  const pilot = usePilot()
  const unit = units.find((u) => u.id === id)
  const member = dir.circle.find((n) => n.id === id)
  const near = dir.nearby.find((n) => n.id === id)
  if (!unit) return null
  const incoming = reqs?.incoming.find((r) => r.from.id === id && r.status === 'pending')
  const short = unit.kind === 'terrace' ? unit.label.replace('No. ', '') : `${unit.floor}-${unit.pos}`

  let body
  if (id === me.id) {
    body = <div className="home-panel-body"><b>{t('panel.you')}</b><small>{t('demo.role', { role: roleOf(me.id, t) })} · {t('panel.reads', { lang: langName(t, me.lang) })}</small></div>
  } else if (member && !member.joined) {
    body = (
      <>
        <div className="home-panel-who">
          <span className="unit-chip">{short}</span>
          <div className="grow"><b>{member.label}</b><small>{shares(t, member.relation)} · {t('nj.status')}</small></div>
          <Badge tone="brand">{t('badge.circle')}</Badge>
        </div>
        <p className="home-panel-note">{t('nj.note')}</p>
      </>
    )
  } else if (member) {
    body = (
      <>
        <div className="home-panel-who">
          <Avatar name={member.resident_name} size={40} />
          <div className="grow">
            <b>{member.resident_name} <i>· {member.label}</i></b>
            <small>{shares(t, member.relation)} · <Languages size={11} style={{ verticalAlign: -1 }} /> {langName(t, member.lang)}</small>
          </div>
          <Badge tone="brand">{t('badge.circle')}</Badge>
        </div>
        {works.has(id) && <div className="permit permit-applied"><Hammer size={13} /> {t('panel.renovating')}</div>}
        <div className="btn-row"><button className="btn btn-sm btn-primary" onClick={() => onMessage(id)}><MessagesSquare size={14} /> {t('btn.message')}</button></div>
      </>
    )
  } else if (near) {
    body = (
      <>
        <div className="home-panel-who">
          <span className="unit-chip">{short}</span>
          <div className="grow"><b>{near.resident_name ?? t('req.resident', { label: unit.label })}</b><small>{t(`hint.${near.hint_key}`, { n: near.hint_n })} · {dir.ring2_label}</small></div>
          <Badge tone="blue">{t('badge.request')}</Badge>
        </div>
        {near.contact === 'none' && <div className="btn-row"><button className="btn btn-sm btn-primary" onClick={() => onRequest(near)}><UserPlus size={14} /> {t('panel.requestBtn')}</button></div>}
        {near.contact === 'requested' && <div className="permit permit-not_needed">{t('panel.requested')}</div>}
        {near.contact === 'incoming' && incoming && (
          <div className="btn-row">
            <button className="btn btn-sm" onClick={() => onRespond(incoming, false)}>{t('btn.decline')}</button>
            <button className="btn btn-sm btn-primary" onClick={() => onRespond(incoming, true)}>{t('panel.acceptTheirs')}</button>
          </div>
        )}
        {near.contact === 'connected' && <div className="btn-row"><button className="btn btn-sm btn-primary" onClick={() => onMessage(id)}><MessagesSquare size={14} /> {t('btn.message')}</button></div>}
        {near.contact === 'declined' && <div className="permit permit-not_needed">{t('panel.closed')}</div>}
      </>
    )
  } else {
    body = (
      <>
        <div className="home-panel-who">
          <span className="unit-chip">{short}</span>
          <div className="grow"><b>{t('req.resident', { label: unit.label })}</b><small>{t('panel.outside')}</small></div>
          <Badge>{t('badge.township')}</Badge>
        </div>
        <p className="home-panel-note">{t('panel.far')}</p>
      </>
    )
  }

  return (
    <Card className="home-panel">
      <button className="icon-btn home-panel-close" onClick={onClose} aria-label={t('common.close')}><X size={14} /></button>
      {body}
      {id !== me.id && <button className="link-btn demo-link" onClick={() => onViewAs(id)}><Eye size={13} /> {t('panel.viewAs')}</button>}
    </Card>
  )
}

function RequestSheet({ home, me, onClose, onSent }: { home: NearbyHome; me: UnitInfo; onClose: () => void; onSent: () => void }) {
  const t = useT()
  const toast = useToast()
  const [reason, setReason] = useState('parking')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [tone, setTone] = useState<string | null>(null)

  async function send() {
    setBusy(true)
    setTone(null)
    try {
      await api.requestContact(me.id, home.id, reason, note)
      toast(t('request.sent', { label: home.label }))
      onSent()
      onClose()
    } catch (e) {
      if (refusal(e)) setTone(refusal(e))
      else toast(e instanceof Error ? e.message : t('err.tryAgain'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <div className="eyebrow">{t('request.eyebrow')}</div>
      <div className="card-title" style={{ fontSize: 18 }}>{t('request.title', { label: home.label })}</div>
      <ol className="ladder-intro">
        <li><b>1</b> {t('request.s1', { label: me.label })}</li>
        <li><b>2</b> {t('request.s2')}</li>
        <li><b>3</b> {t('request.s3')}</li>
      </ol>
      <div className="category-grid">
        {REASONS.map((r) => (
          <button key={r} className={`category ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}><span>{t(`reason.${r}`)}</span></button>
        ))}
      </div>
      <textarea className="input" rows={3} maxLength={200} placeholder={t('request.placeholder')}
        value={note} onChange={(e) => { setNote(e.target.value); setTone(null) }} />
      {tone && <div className="tone-check"><Lock size={15} /><div><b>{t(`${tone}.title`)}</b>{t(`${tone}.body`)}</div></div>}
      <button className="btn btn-primary btn-block" disabled={busy} onClick={send}><UserPlus size={15} /> {busy ? t('btn.sending') : t('request.send')}</button>
    </Sheet>
  )
}
