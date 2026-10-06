import { useEffect, useState } from 'react'
import { Bath, Building, Drill, Lock, Paintbrush, Send, ShieldCheck } from 'lucide-react'
import { api, type ImpactItem, type Renovation, type UnitInfo, type WorksType } from '../api'
import { LANGS, introTemplate, type Lang } from '../messages'
import PlanMap from '../components/PlanMap'
import { useT } from '../i18n'
import { useHelper } from '../helper'
import { Sheet, shortRange, Steps, useToast } from '../ui'

/** A local calendar date n days from today, as YYYY-MM-DD. */
function daysFromToday(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const STEPS = ['reno.steps.type', 'reno.steps.who', 'reno.steps.when', 'reno.steps.approvals', 'reno.steps.review']

// Title and detail come from the dictionary (works.<id>, works.<id>.d). The scope is the owner's own words, sent as typed.
const WORKS: { id: WorksType; icon: typeof Bath; scope: string }[] = [
  { id: 'wet', icon: Bath, scope: 'Re-tile bathroom' },
  { id: 'hacking', icon: Drill, scope: 'Hack and re-tile living room' },
  { id: 'structural', icon: Building, scope: 'Extend kitchen (rear wall)' },
  { id: 'light', icon: Paintbrush, scope: 'Repaint and fit wardrobes' },
]

/** Register a renovation. Who gets the notice is worked out from the plan, not chosen by the owner. */
export default function RenovationWizard({ open, onClose, me, units, names, onSent }: {
  open: boolean
  onClose: () => void
  me: UnitInfo
  units: UnitInfo[]
  names: Record<string, string>
  onSent: () => void
}) {
  const t = useT()
  const toast = useToast()
  const helper = useHelper(me.id)
  const strata = me.kind === 'apartment'
  const [step, setStep] = useState(0)
  const [works, setWorks] = useState<WorksType>(strata ? 'wet' : 'structural')
  const [zone, setZone] = useState<ImpactItem[] | null>(null)
  const [lang, setLang] = useState<Lang>(me.lang)
  const [draft, setDraft] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [reno, setReno] = useState<Renovation>({
    scope: WORKS.find((w) => w.id === (strata ? 'wet' : 'structural'))!.scope,
    start: daysFromToday(7),
    end: daysFromToday(21),
    noisy_hours: '',
    noisy_from: '09:00',
    noisy_to: '17:00',
    weekdays_only: true,
    contractor: 'ABC Renovation',
    contractor_cidb_registered: true,
    council_permit: strata ? 'not_needed' : 'approved',
    permit_ref: strata ? '' : 'PBT/2026/0412',
    management_approval: strata ? 'approved' : null,
  })

  useEffect(() => {
    if (!open) return
    let live = true
    setZone(null)
    api.impact(me.id, works).then((z) => live && setZone(z))
    return () => {
      live = false
    }
  }, [open, me.id, works])

  const hours = `${reno.weekdays_only ? 'weekdays' : 'Mon–Sat'} ${reno.noisy_from}–${reno.noisy_to}${reno.weekdays_only ? ', no weekends' : ''}`
  const full: Renovation = {
    ...reno, works_type: works, noisy_hours: hours,
    permit_ref: reno.council_permit === 'not_needed' ? null : reno.permit_ref || null,
    management_approval: strata ? reno.management_approval : null,
  }
  const message = draft ?? introTemplate(lang, me.resident_name, me.label, full)
  const set = (k: keyof Renovation) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setReno({ ...reno, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value })
    setDraft(null)
  }
  const pickWorks = (w: WorksType) => {
    setWorks(w)
    setReno((r) => ({ ...r, scope: WORKS.find((x) => x.id === w)!.scope, council_permit: w === 'structural' ? 'approved' : r.council_permit }))
    setDraft(null)
  }
  const blocked = works === 'structural' && (strata ? reno.management_approval !== 'approved' : reno.council_permit !== 'approved')

  async function send() {
    setSending(true)
    try {
      const r = await api.sendIntro({ from_unit_id: me.id, message, lang, renovation: full, delegate_id: helper?.id })
      toast(t('reno.sent', { n: r.recipients.length }))
      onSent()
      close()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send', 'error')
    } finally {
      setSending(false)
    }
  }

  function close() {
    setStep(0)
    setDraft(null)
    onClose()
  }

  return (
    <Sheet open={open} onClose={close} wide>
      <div className="wizard-head">
        <div>
          <div className="eyebrow">{t('reno.eyebrow')}</div>
          <div className="card-title" style={{ fontSize: 19 }}>{t('reno.title')}</div>
        </div>
        <Steps steps={STEPS.map((k) => t(k))} current={step} onJump={setStep} />
      </div>

      {step === 0 && (
        <div className="wizard-body">
          <div className="works-grid">
            {WORKS.map((w) => {
              const Icon = w.icon
              return (
                <button key={w.id} className={`works-card ${works === w.id ? 'on' : ''}`} onClick={() => pickWorks(w.id)}>
                  <Icon size={20} />
                  <b>{t(`works.${w.id}`)}</b>
                  <small>{t(`works.${w.id}.d`)}</small>
                </button>
              )
            })}
          </div>
          <label className="field">{t('reno.describe')}<input value={reno.scope} onChange={set('scope')} maxLength={120} /></label>
        </div>
      )}

      {step === 1 && (
        <div className="wizard-body two">
          <div className="plan-frame">
            <PlanMap units={units} me={me} circle={[]} names={names} view={me.kind} impact={zone?.map((z) => z.id) ?? []} />
          </div>
          <div className="stack">
            <div className="wizard-lead">{t('reno.lead')}</div>
            <ol className="zone-list">
              {!zone && <li className="muted">{t('reno.working')}</li>}
              {zone?.map((z) => (
                <li key={z.id}>
                  <b>{z.label}</b>
                  <span>{z.resident_name ?? t('reno.hidden')}</span>
                  <small>{t(`reason.${z.reason_key}`)}</small>
                </li>
              ))}
              {zone?.length === 0 && <li className="muted">{t('reno.none')}</li>}
            </ol>
            <div className="wizard-note"><Lock size={13} /> {t('reno.noRemove')}</div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-body">
          <div className="grid-2">
            <label className="field">{t('reno.start')}<input type="date" value={reno.start} onChange={set('start')} /></label>
            <label className="field">{t('reno.end')}<input type="date" value={reno.end} min={reno.start} onChange={set('end')} /></label>
          </div>
          <div className="grid-2">
            <label className="field">{t('reno.noisyFrom')}<input type="time" value={reno.noisy_from} onChange={set('noisy_from')} /></label>
            <label className="field">{t('reno.noisyTo')}<input type="time" value={reno.noisy_to} onChange={set('noisy_to')} /></label>
          </div>
          <label className="switch-row"><input type="checkbox" checked={!!reno.weekdays_only} onChange={set('weekdays_only')} /> {t('reno.weekends')}</label>
          <div className="wizard-note"><ShieldCheck size={13} /> {t('reno.rules')}</div>
        </div>
      )}

      {step === 3 && (
        <div className="wizard-body">
          <label className="field">{t('reno.contractor')}<input value={reno.contractor ?? ''} onChange={set('contractor')} maxLength={80} /></label>
          <label className="switch-row"><input type="checkbox" checked={!!reno.contractor_cidb_registered} onChange={set('contractor_cidb_registered')} /> {t('reno.cidb')}</label>
          {strata && (
            <label className="field">{t('reno.jmb')}
              <select value={reno.management_approval ?? 'pending'} onChange={set('management_approval')}>
                <option value="approved">{t('reno.jmbApproved')}</option>
                <option value="pending">{t('reno.jmbPending')}</option>
              </select>
            </label>
          )}
          <div className="grid-2">
            <label className="field">{t('reno.permit')}
              <select value={reno.council_permit ?? 'not_needed'} onChange={set('council_permit')}>
                <option value="approved">{t('reno.permitApproved')}</option>
                <option value="applied">{t('reno.permitApplied')}</option>
                <option value="not_needed">{t('reno.permitNone')}</option>
              </select>
            </label>
            <label className="field">{t('reno.permitRef')}
              <input value={reno.permit_ref ?? ''} onChange={set('permit_ref')} maxLength={40} disabled={reno.council_permit === 'not_needed'} placeholder="e.g. PBT/2026/0412" />
            </label>
          </div>
          {blocked && <div className="tone-check"><ShieldCheck size={15} /><div><b>{t('reno.approvalFirst')}</b>{t(strata ? 'reno.blockedStrata' : 'reno.blockedTerrace')}</div></div>}
        </div>
      )}

      {step === 4 && (
        <div className="wizard-body two">
          <dl className="notice-grid">
            <div><dt>{t('reno.work')}</dt><dd>{reno.scope}</dd></div>
            <div><dt>{t('reno.dates')}</dt><dd>{shortRange(reno.start, reno.end)}</dd></div>
            <div><dt>{t('reno.noisy')}</dt><dd>{hours}</dd></div>
            <div><dt>{t('reno.contractor')}</dt><dd>{reno.contractor || '–'}{reno.contractor_cidb_registered ? ' · CIDB ✓' : ''}</dd></div>
            <div><dt>{t('reno.notified')}</dt><dd>{t('reno.homes', { n: zone?.length ?? '–' })}</dd></div>
            <div><dt>{t('reno.approvals')}</dt><dd>{strata
              ? `JMB/MC · ${t(reno.management_approval === 'approved' ? 'reno.jmbApproved' : 'reno.jmbPending')}`
              : `PBT · ${t(reno.council_permit === 'approved' ? 'reno.permitApproved' : reno.council_permit === 'applied' ? 'reno.permitApplied' : 'reno.permitNone')}`}</dd></div>
          </dl>
          <div className="composer-message">
            <label className="field">{t('intro.language')}
              <select value={lang} onChange={(e) => { setLang(e.target.value as Lang); setDraft(null) }}>
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </label>
            <div className="wa-preview">
              <textarea value={message} maxLength={1000} onChange={(e) => setDraft(e.target.value)} aria-label="Notice message" />
              <span className="wa-preview-meta">{message.length}/1000</span>
            </div>
          </div>
        </div>
      )}

      <div className="wizard-foot">
        <button className="btn" onClick={step === 0 ? close : () => setStep(step - 1)}>{t(step === 0 ? 'btn.cancel' : 'btn.back')}</button>
        <span className="muted small">{t('reno.step', { n: step + 1, m: STEPS.length })}</span>
        {step < STEPS.length - 1 ? (
          <button className="btn btn-primary" disabled={(step === 3 && blocked) || !reno.scope.trim()} onClick={() => setStep(step + 1)}>{t('btn.next')}</button>
        ) : (
          <button className="btn btn-primary" disabled={sending || blocked} onClick={send}><Send size={15} /> {sending ? t('btn.sending') : t('reno.send')}</button>
        )}
      </div>
    </Sheet>
  )
}
