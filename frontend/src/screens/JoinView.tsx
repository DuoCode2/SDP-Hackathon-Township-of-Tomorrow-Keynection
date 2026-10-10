import { useEffect, useState } from 'react'
import { Check, Hand, House, KeyRound, Lock, ShieldCheck, Sparkles } from 'lucide-react'
import { api, ApiError, type JoinInfo, type Lang, type UnitInfo } from '../api'
import { refusal, tIn, useDates, useT } from '../i18n'
import { LANGS } from '../messages'
import { useAi } from '../features'
import { Logo } from '../components/Art'
import { Card, Steps, useCelebrate, useToast } from '../ui'
import { replayWelcome } from './CircleView'


// The demo keeps an issued code in this browser tab only, the way a resident would scan it from the welcome pack.
export const joinKey = (unitId: string) => `j5join:${unitId}`
function storedCode(unitId: string): string | null {
  try {
    return sessionStorage.getItem(joinKey(unitId))
  } catch {
    return null
  }
}
function forget(unitId: string) {
  try {
    sessionStorage.removeItem(joinKey(unitId))
  } catch {
    /* storage blocked */
  }
}

/** A household that hasn't joined: scan the handover code, choose a name and language, agree to the privacy notice. */
export default function JoinView({ me, onJoined }: { me: UnitInfo; onJoined: () => void }) {
  const t = useT()
  const dates = useDates()
  const toast = useToast()
  const celebrate = useCelebrate()
  const ai = useAi()
  const [token, setToken] = useState<string | null>(() => storedCode(me.id))
  const [typed, setTyped] = useState('')
  const [info, setInfo] = useState<JoinInfo | null>(null)
  const [expired, setExpired] = useState(false)
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [lang, setLang] = useState<Lang>('en')
  const [easy, setEasy] = useState(false)
  const [consent, setConsent] = useState(false)
  const [wa, setWa] = useState(true)
  const [why, setWhy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    let live = true
    api.joinLookup(token).then((x) => {
      if (!live) return
      setInfo(x)
      setName(x.suggested_name)
      setLang(x.lang)
      setExpired(false)
    }).catch(() => {
      if (!live) return
      setExpired(true)
      setToken(null)
      forget(me.id)
    })
    return () => {
      live = false
    }
  }, [token, me.id])

  async function demoCode() {
    try {
      const r = await api.issueJoinCode(me.id)
      try { sessionStorage.setItem(joinKey(me.id), r.token) } catch { /* private window */ }
      setToken(r.token)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not get a code', 'error')
    }
  }

  async function finish() {
    if (!token) return
    setBusy(true)
    setWhy(null)
    try {
      const u = await api.join({ token, display_name: name.trim(), lang, consent, whatsapp_alerts: wa, easy_mode: easy })
      forget(me.id)
      replayWelcome()  // the first thing a new member sees is the homes around theirs
      celebrate('🏡', t('join.done', { name: u.resident_name }))
      onJoined()
    } catch (e) {
      if (refusal(e)) { setWhy(refusal(e)); setStep(1) }
      else if (e instanceof ApiError && e.status === 404) { setExpired(true); setToken(null); setInfo(null); forget(me.id) }
      else toast(e instanceof Error ? e.message : 'Could not join', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!info) {
    return (
      <section className="screen join">
        <div className="join-hero">
          <div className="welcome-logo"><Logo size={44} /></div>
          <div className="eyebrow">{t('join.eyebrow', { phase: 'Taman Demo' })}</div>
          <h1>{t('join.title', { label: me.label })}</h1>
          <p>{t('join.lead')}</p>
        </div>
        <Card className="join-card">
          {expired && <div className="tone-check"><Lock size={15} /><div>{t('join.expired')}</div></div>}
          <label className="field">{t('join.paste')}
            <input value={typed} onChange={(e) => setTyped(e.target.value.trim())} maxLength={64} autoComplete="off" spellCheck={false} />
          </label>
          <div className="btn-row">
            <button className="btn btn-primary" disabled={typed.length < 20} onClick={() => setToken(typed)}><KeyRound size={15} /> {t('join.use')}</button>
            <button className="btn" onClick={demoCode}><Sparkles size={15} /> {t('join.demo')}</button>
          </div>
        </Card>
      </section>
    )
  }

  const steps = [t('join.steps.home'), t('join.steps.you'), t('join.steps.privacy')]
  const tp = tIn(lang)
  return (
    <section className="screen join">
      <div className="join-hero compact">
        <div className="eyebrow">{t('join.eyebrow', { phase: info.phase.replace(' (fictional phase)', '') })}</div>
        <Steps steps={steps} current={step} onJump={(i) => i < step && setStep(i)} />
      </div>
      <Card className="join-card">
        {step === 0 && (
          <div className="join-step">
            <div className="join-home"><House size={22} /><b>{t('join.homeTitle', { label: info.label, phase: info.phase.replace(' (fictional phase)', '') })}</b></div>
            <p>{t('join.homeBody', { n: info.circle_size })}</p>
            <ul className="join-list">
              <li><Hand size={15} /> {t('join.b1')}</li>
              <li><ShieldCheck size={15} /> {t('join.b2')}</li>
              <li><Check size={15} /> {t('join.b3')}</li>
            </ul>
            <small className="muted">{t('join.expires', { date: dates.date(info.expires_at) })}</small>
          </div>
        )}
        {step === 1 && (
          <div className="join-step">
            <label className="field">{t('join.name')}
              <input value={name} maxLength={30} onChange={(e) => { setName(e.target.value); setWhy(null) }} />
            </label>
            <small className="muted">{t('join.nameHint')}</small>
            {why && <div className="tone-check"><Lock size={15} /><div><b>{t(`${why}.title`)}</b>{t(`${why}.body`)}</div></div>}
            <label className="field">{t('join.lang')}
              <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </label>
            <label className="switch-row consent"><input type="checkbox" checked={easy} onChange={(e) => setEasy(e.target.checked)} /><span>{t('join.easy')}</span></label>
          </div>
        )}
        {step === 2 && (
          // What the household agrees to is shown in the language it just chose to read (Tamil included).
          <div className="join-step" lang={lang}>
            <b className="join-ptitle"><Lock size={15} /> {tp('join.privacyTitle')}</b>
            <dl className="join-privacy">
              <div><dt>{tp('join.p1t')}</dt><dd>{tp('join.p1')}</dd></div>
              <div><dt>{tp('join.p2t')}</dt><dd>{tp('join.p2')}</dd></div>
              <div><dt>{tp('join.p3t')}</dt><dd>{tp('join.p3')}</dd></div>
              <div><dt>{tp('join.p4t')}</dt><dd>{tp('join.p4')}</dd></div>
              {ai?.on && <div><dt>{tp('join.p5t')}</dt><dd>{tp('join.p5')}</dd></div>}
            </dl>
            <label className="switch-row consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>{tp('join.consent', { version: info.consent_version })}</span></label>
            <label className="switch-row consent"><input type="checkbox" checked={wa} onChange={(e) => setWa(e.target.checked)} /><span>{tp('join.wa')}</span></label>
          </div>
        )}
        <div className="wizard-foot">
          <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>{t('btn.back')}</button>
          {step < 2 ? (
            <button className="btn btn-primary" disabled={step === 1 && name.trim().length < 2} onClick={() => setStep(step + 1)}>{t('btn.next')}</button>
          ) : (
            <button className="btn btn-primary" disabled={!consent || busy || name.trim().length < 2} onClick={finish}><Check size={15} /> {t('join.finish')}</button>
          )}
        </div>
      </Card>
    </section>
  )
}
