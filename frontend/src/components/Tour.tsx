import { useState, type ReactNode } from 'react'
import { Camera, Hammer, Lock, Sparkles } from 'lucide-react'
import type { Directory, UnitInfo } from '../api'
import type { TabId } from '../guide'
import { useDates, useT, type Translate } from '../i18n'
import { Avatar, Sheet } from '../ui'
import { Logo } from './Art'

type Member = Directory['circle'][number]

const SHARES: Record<string, string> = {
  left: 'share.wall', right: 'share.wall', above: 'share.above', below: 'share.below',
  'across-left': 'rel.across-left', across: 'rel.across', 'across-right': 'rel.across-right',
}
const shares = (t: Translate, relation: string) => t(SHARES[relation] ?? `rel.${relation}`)

/** The first-day tour: the homes around yours, then the three things the app is for, one card each and one tap
 *  from the screen it describes. A pilot household sees it once; anyone can open it again from Me or the Guide.
 *  Card one knows whether the hello is already out, so it never asks twice. */
export default function Tour({ me, circle, onClose, onIntro, onGo }: {
  me: UnitInfo
  circle: Member[]
  onClose: () => void
  onIntro: () => void
  onGo: (tab: TabId) => void
}) {
  const t = useT()
  const dates = useDates()
  const [step, setStep] = useState(0)
  const joined = circle.filter((n) => n.joined)
  const greeted = joined.filter((n) => n.known || n.hello_sent).length
  const helloOut = joined.length > 0 && greeted === joined.length
  const last = 3
  const go = (tab: TabId) => { onClose(); onGo(tab) }

  const cards = [
    <div key="hello" className="welcome">
      <div className="welcome-logo"><Logo size={44} /></div>
      <div className="eyebrow">{t('welcome.eyebrow')}</div>
      <h1>{t(helloOut ? 'welcome.sentTitle' : 'welcome.title', { name: me.resident_name })}</h1>
      <p>{helloOut ? t('welcome.sentBody', { n: greeted }) : t('welcome.body', { label: me.label, date: dates.date(me.handover_date), n: circle.length })}</p>
      <div className="welcome-doors">
        {circle.map((n, i) => (
          <div key={n.id} className={`welcome-door ${n.joined ? '' : 'off'}`} style={{ ['--i' as string]: i }}>
            <Avatar name={n.resident_name} size={64} />
            <b>{n.resident_name}</b>
            <small>{n.joined ? shares(t, n.relation) : t('nj.status')}</small>
          </div>
        ))}
      </div>
      {circle.some((n) => !n.joined) && <small className="welcome-nj">{t('nj.welcome', { n: circle.filter((n) => !n.joined).length })}</small>}
      <small className="welcome-privacy"><Lock size={12} /> {t('welcome.privacy')}</small>
    </div>,
    <TourCard key="works" icon={<Hammer size={26} />} tone="works" title={t('tour.works.title')} body={t('tour.works.body')} />,
    <TourCard key="photos" icon={<Camera size={26} />} tone="photos" title={t('tour.photos.title')} body={t('tour.photos.body')} />,
    <TourCard key="ask" icon={<Sparkles size={26} />} tone="ask" title={t('tour.ask.title')} body={t('tour.ask.body')} />,
  ]
  // The card's own action: say hello (or look around when it is out), or open the screen the card is about.
  const action = [
    helloOut ? null : <button key="a0" className="btn btn-primary" onClick={() => { onClose(); onIntro() }}>👋 {t('welcome.hello')}</button>,
    <button key="a1" className="btn btn-primary" onClick={() => go('works')}><Hammer size={15} /> {t('tour.works.go')}</button>,
    <button key="a2" className="btn btn-primary" onClick={() => go('evidence')}><Camera size={15} /> {t('tour.photos.go')}</button>,
    <button key="a3" className="btn btn-primary" onClick={() => go('me')}>{t('tour.ask.go')}</button>,
  ][step]

  return (
    <Sheet open onClose={onClose} wide>
      <div className="tour" aria-label={t('welcome.eyebrow')}>
        <div className="tour-top">
          <span className="tour-dots" role="tablist" aria-label={t('tour.step', { n: step + 1, m: last + 1 })}>
            {cards.map((_, i) => <button key={i} role="tab" aria-selected={i === step} className={i === step ? 'on' : ''} onClick={() => setStep(i)} aria-label={t('tour.step', { n: i + 1, m: last + 1 })} />)}
          </span>
          <button className="link tour-skip" onClick={onClose}>{t('tour.skip')}</button>
        </div>
        <div key={step} className="tour-card">{cards[step]}</div>
        <div className="tour-foot">
          {step === 0
            ? <button className="btn" onClick={onClose}>{t('welcome.later')}</button>
            : <button className="btn" onClick={() => setStep(step - 1)}>{t('btn.back')}</button>}
          <span className="muted small">{t('tour.step', { n: step + 1, m: last + 1 })}</span>
          <span className="tour-actions">
            {action}
            {step < last ? <button className="btn" onClick={() => setStep(step + 1)}>{t('btn.next')}</button> : <button className="btn" onClick={onClose}>{t('tour.done')}</button>}
          </span>
        </div>
      </div>
    </Sheet>
  )
}

function TourCard({ icon, tone, title, body }: { icon: ReactNode; tone: string; title: string; body: string }) {
  return (
    <div className="welcome tour-plain">
      <span className={`tour-icon ${tone}`}>{icon}</span>
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  )
}
