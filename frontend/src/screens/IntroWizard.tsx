import { useState } from 'react'
import { Check, EyeOff, Hand, Languages, Lock, Send, UserRound } from 'lucide-react'
import { api, type Neighbour, type UnitInfo } from '../api'
import { LANGS, introTemplate, type Lang } from '../messages'
import { useT } from '../i18n'
import { useHelper } from '../helper'
import { Avatar, Sheet, Steps, useToast } from '../ui'

type Member = Neighbour & { known: boolean }

/** Say hello, step by step. Only the homes in the circle; anyone else needs a contact request. */
export default function IntroWizard({ open, onClose, me, circle, onSent, pick }: {
  open: boolean
  onClose: () => void
  me: UnitInfo
  circle: Member[]
  onSent: () => void
  /** Homes the assistant heard named: ticked instead of everyone not met yet. */
  pick?: string[]
}) {
  const t = useT()
  const toast = useToast()
  const helper = useHelper(me.id)
  const [step, setStep] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(circle.filter((n) => n.joined && (pick?.length ? pick.includes(n.id) : !n.known)).map((n) => n.id)))
  const [lang, setLang] = useState<Lang>(me.lang)
  const [draft, setDraft] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const message = draft ?? introTemplate(lang, me.resident_name, me.label)
  const steps = [t('intro.steps.who'), t('intro.steps.message'), t('intro.steps.share')]

  const toggle = (id: string) => setPicked((s) => {
    const x = new Set(s)
    if (x.has(id)) x.delete(id)
    else x.add(id)
    return x
  })

  async function send() {
    setSending(true)
    try {
      const r = await api.sendIntro({ from_unit_id: me.id, message, lang, to_unit_ids: [...picked], delegate_id: helper?.id })
      toast(t('intro.sent', { n: r.recipients.length }))
      onSent()
      close()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('err.tryAgain'), 'error')
    } finally {
      setSending(false)
    }
  }

  function close() {
    setStep(0)
    setDraft(null)
    setConsent(false)
    onClose()
  }

  return (
    <Sheet open={open} onClose={close} wide>
      <div className="wizard-head">
        <div>
          <div className="eyebrow">{t('btn.introduce')}</div>
          <div className="card-title" style={{ fontSize: 19 }}>{t('intro.title')}</div>
        </div>
        <Steps steps={steps} current={step} onJump={setStep} />
      </div>

      {step === 0 && (
        <div className="wizard-body">
          <p className="wizard-lead">{t('intro.lead')}</p>
          <div className="pick-list">
            {circle.map((n) => (
              <button key={n.id} className={`pick ${picked.has(n.id) ? 'on' : ''}`} onClick={() => toggle(n.id)} aria-pressed={picked.has(n.id)} disabled={!n.joined}>
                <span className="pick-box">{picked.has(n.id) && <Check size={12} strokeWidth={3} />}</span>
                <Avatar name={n.resident_name} size={32} />
                <span className="grow">
                  <b>{n.joined ? <>{n.resident_name} <i>· {n.label}</i></> : n.label}</b>
                  <small>{t(`rel.${n.relation}`)}{!n.joined ? ` · ${t('nj.status')}` : n.known ? ` · ${t('intro.met')}` : ''}</small>
                </span>
              </button>
            ))}
          </div>
          <div className="wizard-note"><Lock size={13} /> {t('intro.further')}</div>
        </div>
      )}

      {step === 1 && (
        <div className="wizard-body two">
          <div className="stack">
            <label className="field">{t('intro.language')}
              <select value={lang} onChange={(e) => { setLang(e.target.value as Lang); setDraft(null) }}>
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </label>
            <div className="wizard-note"><Languages size={13} /> {t('intro.replies')}</div>
          </div>
          <div className="composer-message">
            <div className="field">{t('intro.editable')}</div>
            <div className="wa-preview">
              <textarea value={message} maxLength={1000} onChange={(e) => setDraft(e.target.value)} aria-label={t('intro.steps.message')} />
              <span className="wa-preview-meta">{message.length}/1000</span>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-body">
          <div className="share-grid">
            <div className="share yes"><UserRound size={16} /><div><b>{t('intro.shared')}</b>{t('intro.sharedBody')}</div></div>
            <div className="share no"><EyeOff size={16} /><div><b>{t('intro.notShared')}</b>{t('intro.notSharedBody')}</div></div>
            <div className="share yes"><Hand size={16} /><div><b>{t('intro.theyCan')}</b>{t('intro.theyCanBody')}</div></div>
          </div>
          <label className="switch-row consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t('intro.consent', { n: picked.size })}</span>
          </label>
        </div>
      )}

      <div className="wizard-foot">
        <button className="btn" onClick={step === 0 ? close : () => setStep(step - 1)}>{t(step === 0 ? 'btn.cancel' : 'btn.back')}</button>
        <span className="muted small">{t('intro.selected', { n: picked.size, m: circle.filter((n) => n.joined).length })}</span>
        {step < 2 ? (
          <button className="btn btn-primary" disabled={picked.size === 0} onClick={() => setStep(step + 1)}>{t('btn.next')}</button>
        ) : (
          <button className="btn btn-primary" disabled={!consent || sending || picked.size === 0} onClick={send}><Send size={15} /> {sending ? t('btn.sending') : t('intro.send')}</button>
        )}
      </div>
    </Sheet>
  )
}
