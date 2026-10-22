import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowRight, Hammer, ScanLine } from 'lucide-react'
import { api, type Directory, type UnitInfo } from '../api'
import { CAST, roleOf } from '../components/Cast'
import { Logo } from '../components/Art'
import PlanMap from '../components/PlanMap'
import { useT } from '../i18n'
import { Avatar, useCelebrate, useToast } from '../ui'

/** Key day, the demo's first minute: the card that came with the keys, who you are, and the homes around you lighting
 *  up on the plan. Shown once per browser (opening.done); Skip is always there. A pilot has the real join page instead. */
export default function OpeningView({ units, onPick, onDone, onNext }: {
  units: UnitInfo[]
  /** The household the judge picked: the app opens as them. */
  onPick: (unitId: string) => void
  onDone: () => void
  /** After the first wave: straight to the renovation notice, the route's second step. */
  onNext: () => void
}) {
  const t = useT()
  const toast = useToast()
  const celebrate = useCelebrate()
  const [step, setStep] = useState<'card' | 'who' | 'reveal' | 'next'>('card')
  const [qr, setQr] = useState<string | null>(null)
  const [me, setMe] = useState<UnitInfo | null>(null)
  const [dir, setDir] = useState<Directory | null>(null)

  // The card's code opens this site; a real welcome pack carries that home's own one-time code.
  useEffect(() => {
    let live = true
    QRCode.toDataURL(`${window.location.origin}/`, { margin: 1, width: 200, errorCorrectionLevel: 'M', color: { dark: '#0b1220', light: '#ffffff' } })
      .then((url) => live && setQr(url)).catch(() => live && setQr(null))
    return () => {
      live = false
    }
  }, [])

  const pick = (u: UnitInfo) => {
    setMe(u)
    setDir(null)
    onPick(u.id)
    setStep('reveal')
    api.directory(u.id).then(setDir).catch(() => setDir(null))
  }

  // The first neighbour not met yet gets the wave (for Aiman, Siti next door).
  const first = dir?.circle.find((n) => n.joined && !n.known)
  async function wave() {
    if (!me || !first) return
    try {
      await api.wave(me.id, first.id)
      celebrate('👋', t('celebrate.wave', { name: first.resident_name }))
    } catch (e) {
      toast(e instanceof Error ? e.message : t('err.tryAgain'), 'error')
    }
    // The hello is sent; one card says where the story goes next, so nobody has to find the Guide to learn it.
    setStep('next')
  }

  return (
    <div className="opening" role="dialog" aria-modal aria-label={t('open.label')}>
      <button className="btn btn-sm opening-skip" onClick={onDone}>{t('open.skip')}</button>

      {step === 'card' && (
        <div className="opening-step">
          {/* A judge arrives with nothing to scan: say what this is before showing the card. */}
          <h1 className="opening-tagline">{t('open.tagline')}</h1>
          <p className="muted opening-tagline-sub">{t('open.taglineSub')}</p>
          <div className="opening-card">
            {qr ? <img src={qr} alt="" /> : <span className="reach-qr-blank" aria-hidden />}
            <span>
              <span className="opening-brand"><span className="brand-mark"><Logo size={20} /></span> Keynection</span>
              <b>{t('open.cardTitle')}</b>
              <small>{t('open.cardBody')}</small>
            </span>
          </div>
          <button className="btn btn-primary" onClick={() => setStep('who')}><ScanLine size={16} /> {t('open.scan')}</button>
          <small className="muted">{t('open.cardNote')}</small>
        </div>
      )}

      {step === 'who' && (
        <div className="opening-step">
          <h1>{t('open.who')}</h1>
          <p className="muted">{t('open.whoSub')}</p>
          <div className="opening-cast">
            {CAST.map((id) => {
              const u = units.find((x) => x.id === id)
              if (!u) return null
              return (
                <button key={id} className={id === 'T-12' ? 'lead' : ''} onClick={() => pick(u)}>
                  <Avatar name={u.resident_name} size={44} />
                  <span className="grow">
                    <b>{u.resident_name} <i>· {u.label}</i></b>
                    <small>{roleOf(id, t)}</small>
                    <em>{t(`story.${id}`)}</em>
                  </span>
                  {id === 'T-12' && <span className="start-here">{t('open.startHere')}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {step === 'next' && me && (
        <div className="opening-step">
          <div className="opening-next">
            <span className="opening-next-icon"><Hammer size={22} /></span>
            <h1>{t('open.next')}</h1>
            <p className="muted">{t('open.nextSub')}</p>
          </div>
          <div className="opening-actions">
            <button className="btn btn-primary" onClick={onNext}>{t('open.nextGo')} <ArrowRight size={16} /></button>
            <button className="btn" onClick={onDone}>{t('open.nextStay')}</button>
          </div>
        </div>
      )}

      {step === 'reveal' && me && (
        <div className="opening-step wide">
          <div className="opening-plan">
            {dir && (
              <PlanMap intro units={units} me={me} view={me.kind} names={{ [me.id]: me.resident_name, ...Object.fromEntries(dir.circle.map((n) => [n.id, n.resident_name])) }}
                circle={dir.circle.map((n) => ({ id: n.id, relation: n.relation }))} />
            )}
          </div>
          {dir && (
            <div className="opening-hi">
              <b>{t(me.kind === 'apartment' ? 'open.hiApartment' : 'open.hi', { name: me.resident_name, n: dir.circle.length })}</b>
              <div className="opening-actions">
                {first && <button className="btn btn-primary" onClick={wave}>{t('open.wave', { name: first.resident_name })}</button>}
                <button className={`btn ${first ? '' : 'btn-primary'}`} onClick={onDone}>{t('welcome.later')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
