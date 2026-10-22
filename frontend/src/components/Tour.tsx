import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Camera, Hammer, Lock, Sparkles } from 'lucide-react'
import type { Directory, UnitInfo } from '../api'
import type { TabId } from '../guide'
import { useDates, useT, type Translate } from '../i18n'
import { Avatar, Sheet } from '../ui'
import { Logo } from './Art'
import { openAssistant } from './Assistant'

type Member = Directory['circle'][number]

const SHARES: Record<string, string> = {
  left: 'share.wall', right: 'share.wall', above: 'share.above', below: 'share.below',
  'across-left': 'rel.across-left', across: 'rel.across', 'across-right': 'rel.across-right',
}
const shares = (t: Translate, relation: string) => t(SHARES[relation] ?? `rel.${relation}`)

/** The first-day tour: the homes around yours, then the three things the app is for, one card each and one tap
 *  from what it describes. A pilot household sees it once; anyone can open it again from Me or the Guide.
 *  Card one knows whether the hello is already out, so it never asks twice. Every card is the same height and the
 *  buttons stay at the bottom of the sheet: on a screen too short for a card, the card scrolls under them. */
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
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { root.current?.closest('.sheet')?.scrollTo({ top: 0 }) }, [step])  // each card opens at its top
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
      {/* A home not on Keynection yet says so under its own door. */}
      <div className="welcome-doors">
        {circle.map((n, i) => (
          <div key={n.id} className={`welcome-door ${n.joined ? '' : 'off'}`} style={{ ['--i' as string]: i }}>
            <Avatar name={n.resident_name} size={64} />
            <b>{n.resident_name}</b>
            <small>{n.joined ? shares(t, n.relation) : t('nj.status')}</small>
          </div>
        ))}
      </div>
      <small className="welcome-privacy"><Lock size={12} /> {t('welcome.privacy')}</small>
    </div>,
    <TourCard key="works" icon={<Hammer size={26} />} tone="works" title={t('tour.works.title')} body={t('tour.works.body')} />,
    <TourCard key="photos" icon={<Camera size={26} />} tone="photos" title={t('tour.photos.title')} body={t('tour.photos.body')} />,
    <TourCard key="ask" icon={<Sparkles size={26} />} tone="ask" title={t('tour.ask.title')} body={t('tour.ask.body')} />,
  ]
  // The card's own action: say hello (none once it is out), open the screen the card is about, or the assistant.
  const action = [
    helloOut ? null : <button key="a0" className="btn btn-primary" onClick={() => { onClose(); onIntro() }}>👋 {t('welcome.hello')}</button>,
    <button key="a1" className="btn btn-primary" onClick={() => go('works')}><Hammer size={15} /> {t('tour.works.go')}</button>,
    <button key="a2" className="btn btn-primary" onClick={() => go('evidence')}><Camera size={15} /> {t('tour.photos.go')}</button>,
    <button key="a3" className="btn btn-primary" onClick={() => { onClose(); openAssistant() }}><Sparkles size={15} /> {t('tour.ask.go')}</button>,
  ][step]

  return (
    <Sheet open onClose={onClose} wide className="tour-sheet">
      <div ref={root} className="tour" aria-label={t('welcome.eyebrow')}>
        <div className="tour-top">
          <span className="tour-dots" role="tablist" aria-label={t('tour.step', { n: step + 1, m: last + 1 })}>
            {cards.map((_, i) => <button key={i} role="tab" aria-selected={i === step} className={i === step ? 'on' : ''} onClick={() => setStep(i)} aria-label={t('tour.step', { n: i + 1, m: last + 1 })} />)}
          </span>
          <button className="link tour-skip" onClick={onClose}>{t('tour.skip')}</button>
        </div>
        <div key={step} className="tour-card">{cards[step]}</div>
        {/* Skip, at the top, is the way out of card one: a second close button here read like a way on. */}
        <div className="tour-foot">
          {step > 0 && <button className="btn tour-back" aria-label={t('btn.back')} onClick={() => setStep(step - 1)}><ArrowLeft size={15} /><span>{t('btn.back')}</span></button>}
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
