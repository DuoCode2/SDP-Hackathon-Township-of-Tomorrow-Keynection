import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, ChevronLeft, CircleCheck, Hammer, Lock, Sparkles } from 'lucide-react'
import type { Directory, UnitInfo } from '../api'
import type { TabId } from '../guide'
import { useDates, useT, type Translate } from '../i18n'
import { Avatar, Sheet } from '../ui'
import { openAssistant } from '../welcome'
import { Logo } from './Art'

type Member = Directory['circle'][number]

const SHARES: Record<string, string> = {
  left: 'share.wall', right: 'share.wall', above: 'share.above', below: 'share.below',
  'across-left': 'rel.across-left', across: 'rel.across', 'across-right': 'rel.across-right',
}
const shares = (t: Translate, relation: string) => t(SHARES[relation] ?? `rel.${relation}`)
// The surface a household photographs before works next door, named as the Photos screen names it.
const SURFACE: Record<string, string> = { left: 'subj.wall', right: 'subj.wall', above: 'subj.ceiling', below: 'subj.floor' }

/** The first-day tour: the homes around yours, then the three things the app is for, one card each with a small
 *  example of its screen, one tap from that screen. A pilot household sees it once; anyone can open it again from Me
 *  or the Guide. Card one knows whether the hello is already out, so it never asks twice. The buttons stay at the foot
 *  of the sheet on any phone, and the sheet keeps one height from card to card. */
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
  const wall = joined.find((n) => SURFACE[n.relation])
  // Each card opens at its top, even after card one was scrolled on a short screen.
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { root.current?.closest('.sheet')?.scrollTo({ top: 0 }) }, [step])

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
      <small className="welcome-privacy"><Lock size={12} /> {t('welcome.privacy')}</small>
    </div>,
    <TourCard key="works" title={t('tour.works.title')} body={t('tour.works.body')}>
      <div className="tour-sample" aria-hidden="true">
        <span className="tour-sample-icon works"><Hammer size={18} /></span>
        <span className="tour-sample-text">
          <small className="tour-sample-tag">{t('tour.example')}</small>
          <b>{t('tour.works.sample')}</b>
          <span>{t('hours.weekdays', { from: '09:00', to: '17:00' })}</span>
          <span className="tour-sample-ok"><CircleCheck size={13} /> {t('quiet.avoided')}</span>
        </span>
      </div>
    </TourCard>,
    <TourCard key="photos" title={t('tour.photos.title')} body={t('tour.photos.body')}>
      <div className="tour-sample" aria-hidden="true">
        <span className="tour-sample-photo"><Camera size={18} /></span>
        <span className="tour-sample-text">
          <small className="tour-sample-tag">{t('tour.example')}</small>
          <b>{wall ? t(SURFACE[wall.relation], { label: wall.label }) : t('subj.ownSide')}</b>
          <span className="tour-sample-ok"><Lock size={12} /> {t('task.sealed')} · {dates.date(new Date().toISOString())}</span>
        </span>
      </div>
    </TourCard>,
    <TourCard key="ask" title={t('tour.ask.title')} body={t('tour.ask.body')} note={t('tour.ask.easy')}>
      <div className="tour-sample tour-ask" aria-hidden="true">
        <span className="tour-sample-orb"><span className="orb"><i /><i /></span></span>
        <span className="tour-bubble">{t('tour.ask.example')}</span>
      </div>
    </TourCard>,
  ]
  // The card's own action: say hello (none once it is out), open the screen the card is about, or ask.
  const action = [
    helloOut ? null : <button key="a0" className="btn btn-primary" onClick={() => { onClose(); onIntro() }}>👋 {t('welcome.hello')}</button>,
    <button key="a1" className="btn btn-primary" onClick={() => go('works')}><Hammer size={15} /> {t('tour.works.go')}</button>,
    <button key="a2" className="btn btn-primary" onClick={() => go('evidence')}><Camera size={15} /> {t('tour.photos.go')}</button>,
    <button key="a3" className="btn btn-primary" onClick={() => { onClose(); openAssistant() }}><Sparkles size={15} /> {t('tour.ask.go')}</button>,
  ][step]

  return (
    <Sheet open onClose={onClose} wide>
      <div ref={root} className="tour" aria-label={t('tour.name')}>
        <div className="tour-top">
          <span className="tour-dots" role="tablist" aria-label={t('tour.step', { n: step + 1, m: last + 1 })}>
            {cards.map((_, i) => <button key={i} role="tab" aria-selected={i === step} className={i === step ? 'on' : ''} onClick={() => setStep(i)} aria-label={t('tour.step', { n: i + 1, m: last + 1 })} />)}
          </span>
          <button className="link tour-skip" onClick={onClose}>{t('tour.skip')}</button>
        </div>
        <div key={step} className="tour-card">{cards[step]}</div>
        <div className="tour-foot">
          {/* Kept in place on card one, so the buttons on the right never move. */}
          <button className="icon-btn tour-back" onClick={() => setStep(step - 1)} disabled={step === 0} aria-hidden={step === 0}
            aria-label={t('btn.back')} title={t('btn.back')}><ChevronLeft size={18} /></button>
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

function TourCard({ title, body, note, children }: { title: string; body: string; note?: string; children: ReactNode }) {
  return (
    <div className="welcome tour-plain">
      {children}
      <h1>{title}</h1>
      <p>{body}</p>
      {note && <small className="tour-note">{note}</small>}
    </div>
  )
}
