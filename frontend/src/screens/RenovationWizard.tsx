import { useEffect, useState } from 'react'
import { Bath, Building, CalendarClock, Drill, Lock, Paintbrush, Send, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react'
import { api, ApiError, type ImpactItem, type QuietPlan, type Renovation, type RenovationDraft, type UnitInfo, type WorksType } from '../api'
import { LANGS, introTemplate, type Lang } from '../messages'
import PlanMap from '../components/PlanMap'
import { noisyHours, useDates, useT } from '../i18n'
import { useHelper } from '../helper'
import { useAi } from '../features'
import { Segmented, Sheet, Steps, useToast } from '../ui'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** A local calendar date n days from today, as YYYY-MM-DD. */
function daysFromToday(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return ymd(d)
}

/** n days after a YYYY-MM-DD date. */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return ymd(d)
}
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000)

const STEPS = ['reno.steps.type', 'reno.steps.who', 'reno.steps.when', 'reno.steps.approvals', 'reno.steps.review']

// Title and detail come from the dictionary (works.<id>, works.<id>.d). The scope is the owner's own words, sent as typed.
// The suggested description is in the owner's language (they can edit it); neighbours see it as written.
const WORKS: { id: WorksType; icon: typeof Bath }[] = [
  { id: 'wet', icon: Bath },
  { id: 'hacking', icon: Drill },
  { id: 'structural', icon: Building },
  { id: 'light', icon: Paintbrush },
]

/** Register a renovation. Who gets the notice is worked out from the plan, not chosen by the owner. */
export default function RenovationWizard({ open, onClose, me, units, names, onSent, estate }: {
  open: boolean
  onClose: () => void
  me: UnitInfo
  units: UnitInfo[]
  names: Record<string, string>
  onSent: () => void
  /** Set when the estate office registers the renovation for an owner who signed the paper form. */
  estate?: { staff: string }
}) {
  const t = useT()
  const dates = useDates()
  const toast = useToast()
  const helper = useHelper(me.id)
  const strata = me.kind === 'apartment'
  const [step, setStep] = useState(0)
  const [works, setWorks] = useState<WorksType>(strata ? 'wet' : 'structural')
  const [zone, setZone] = useState<ImpactItem[] | null>(null)
  const [lang, setLang] = useState<Lang>(me.lang)
  const [draft, setDraft] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const ai = useAi()
  const [said, setSaid] = useState('')
  const [reading, setReading] = useState(false)
  const [filled, setFilled] = useState<RenovationDraft | null>(null)
  const [aiNote, setAiNote] = useState<string | null>(null)
  // Noisy hours planned around the quiet times of the homes the works reach (worked out on the server, which never
  // says whose they are). The owner can keep their own hours instead; the notice then says whose quiet time it crosses.
  const [plan, setPlan] = useState<QuietPlan | null>(null)
  const [usePlan, setUsePlan] = useState(true)
  const [reno, setReno] = useState<Renovation>({
    scope: t(`works.${strata ? 'wet' : 'structural'}.scope`),
    start: daysFromToday(7),
    end: daysFromToday(21),
    noisy_hours: '',
    noisy_from: '09:00',
    noisy_to: '17:00',
    weekdays_only: true,
    // Approvals and the CIDB tick are the owner's own statements, shown to every neighbour: never pre-filled.
    contractor: '',
    contractor_cidb_registered: false,
    council_permit: strata ? 'not_needed' : null,
    permit_ref: '',
    management_approval: null,
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

  useEffect(() => {
    if (!open || !reno.start || !reno.end || reno.end < reno.start || (reno.noisy_to ?? '17:00') <= (reno.noisy_from ?? '09:00')) return
    let live = true
    const timer = window.setTimeout(() => {
      api.quietPlan(me.id, { works_type: works, start: reno.start, end: reno.end, noisy_from: reno.noisy_from ?? '09:00', noisy_to: reno.noisy_to ?? '17:00' })
        .then((p) => live && setPlan(p)).catch(() => live && setPlan(null))
    }, 250)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [open, me.id, works, reno.start, reno.end, reno.noisy_from, reno.noisy_to])
  const planned = usePlan && plan && plan.homes_with_quiet_times > 0 ? plan : null

  const timed = planned ? { noisy_from: planned.noisy_from, noisy_to: planned.noisy_to, quiet_breaks: planned.quiet_breaks }
    : { noisy_from: reno.noisy_from, noisy_to: reno.noisy_to, quiet_breaks: [] }
  // The English record of the hours; every reader sees them built from the fields in their own language.
  const hours = `${reno.weekdays_only ? 'weekdays' : 'Mon–Sat'} ${timed.noisy_from}–${timed.noisy_to}${reno.weekdays_only ? ', no weekends' : ''}`
    + timed.quiet_breaks.map((b) => `, quiet ${b.start}–${b.end}`).join('')
  const full: Renovation = {
    ...reno, ...timed, works_type: works, noisy_hours: hours,
    contractor: reno.contractor?.trim() || null,
    council_permit: reno.council_permit || null,  // '' = not chosen yet
    permit_ref: reno.council_permit === 'not_needed' ? null : reno.permit_ref || null,
    management_approval: strata ? reno.management_approval || null : null,
  }
  const message = draft ?? introTemplate(lang, me.resident_name, me.label, full)
  const set = (k: keyof Renovation) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setReno({ ...reno, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value })
    setDraft(null)
  }
  const pickWorks = (w: WorksType) => {
    setWorks(w)
    setReno((r) => ({ ...r, scope: t(`works.${w}.scope`) }))
    setDraft(null)
  }
  const blocked = works === 'structural' && (strata ? reno.management_approval !== 'approved' : reno.council_permit !== 'approved')

  /** The owner's one sentence fills in the steps; whatever AI left empty keeps what was there. Nothing is sent. */
  async function fillIn() {
    setReading(true)
    setAiNote(null)
    setFilled(null)
    try {
      const d = await api.renovationDraft(me.id, said.trim())
      setWorks(d.works_type)
      setReno((r) => {
        const start = d.start ?? r.start
        const end = d.end ?? r.end
        return {
          ...r, scope: d.scope ?? t(`works.${d.works_type}.scope`), start, end: end < start ? start : end,
          noisy_from: d.noisy_from ?? r.noisy_from, noisy_to: d.noisy_to ?? r.noisy_to,
          weekdays_only: d.weekdays_only ?? r.weekdays_only, contractor: d.contractor ?? r.contractor,
        }
      })
      setLang(d.language)  // the notice is written in the language the owner used; each neighbour gets their own
      setDraft(null)
      setFilled(d)
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined
      setAiNote(code === 'ai_off' ? t('ai.off') : code === 'ai_busy' || !(e instanceof Error) ? t('ai.busy') : e.message)
    } finally {
      setReading(false)
    }
  }

  async function send() {
    setSending(true)
    try {
      const r = estate
        ? await api.estateRenovation({ unit_id: me.id, staff_name: estate.staff, owner_signed: true, message, lang, renovation: full })
        : await api.sendIntro({ from_unit_id: me.id, message, lang, renovation: full, delegate_id: helper?.id })
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
    setSaid('')
    setFilled(null)
    setAiNote(null)
    onClose()
  }

  return (
    <Sheet open={open} onClose={close} wide>
      <div className="wizard-head">
        <div>
          <div className="eyebrow">{estate ? `Estate office · for ${me.resident_name} (${me.label})` : t('reno.eyebrow')}</div>
          <div className="card-title" style={{ fontSize: 19 }}>{t('reno.title')}</div>
        </div>
        <Steps steps={STEPS.map((k) => t(k))} current={step} onJump={setStep} />
      </div>

      {step === 0 && (
        <div className="wizard-body">
          {ai?.on && (
            <div className="ai-box">
              <div className="ai-box-head"><Sparkles size={15} /> <b>{t('ai.reno.title')}</b></div>
              <small className="muted">{t('ai.reno.hint')}</small>
              <div className="ai-box-row">
                <textarea rows={2} maxLength={500} value={said} onChange={(e) => setSaid(e.target.value)} placeholder={t('ai.reno.placeholder')}
                  aria-label={t('ai.reno.title')} />
                <button className="btn btn-primary" disabled={!said.trim() || reading} onClick={fillIn}>
                  <Sparkles size={14} /> {reading ? t('ai.reno.working') : t('ai.reno.fill')}
                </button>
              </div>
              {aiNote && <div className="ai-note">{aiNote}</div>}
              {filled && (
                <div className="ai-filled">
                  <b><Sparkles size={13} /> {t('ai.reno.done')}</b>
                  {filled.why && <p>{filled.why}</p>}
                  {filled.unsure.map((u) => <p key={u} className="warn">{t(`ai.unsure.${u}`)}</p>)}
                  {filled.missing.length > 0 && (
                    <>
                      <p>{t('ai.reno.missing')}</p>
                      <ul>{filled.missing.map((m) => <li key={m}>{m}</li>)}</ul>
                    </>
                  )}
                  <small><ShieldCheck size={12} /> {t('ai.reno.yours')}</small>
                </div>
              )}
            </div>
          )}
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
                  <span>{z.joined === false ? t('nj.status') : z.resident_name ?? t('reno.hidden')}</span>
                  <small>{t(`reason.${z.reason_key}`)}{z.joined === false ? ` · ${t('nj.paper')}` : ''}</small>
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
          {plan && plan.homes_with_quiet_times > 0 && (
            <div className="qplan-card">
              <div className="qplan-head"><CalendarClock size={15} /> <b>{t('plan.title')}</b></div>
              <p>{t('plan.avoids', { hours: noisyHours(t, { ...reno, ...plan }), n: plan.avoided })}</p>
              {plan.not_avoided > 0 && <p className="warn">{t('plan.notAvoided', { n: plan.not_avoided, h: 4 })}</p>}
              <Segmented value={usePlan ? 'plan' : 'own'} onChange={(v) => { setUsePlan(v === 'plan'); setDraft(null) }}
                options={[{ id: 'plan', label: t('plan.use') }, { id: 'own', label: t('plan.own') }]} />
              {!usePlan && <small>{t('plan.ownNote')}</small>}
            </div>
          )}
          {plan?.double_works && (
            <div className="tone-check">
              <TriangleAlert size={15} />
              <div>{t('plan.double', { n: plan.double_works.homes })}</div>
              <button className="btn btn-sm" onClick={() => {
                const clear = plan.double_works!.clear_from
                setReno({ ...reno, start: clear, end: addDays(clear, daysBetween(reno.start, reno.end)) })
                setDraft(null)
              }}>{t('plan.moveTo', { date: dates.date(plan.double_works.clear_from) })}</button>
            </div>
          )}
          <div className="wizard-note"><ShieldCheck size={13} /> {t('reno.rules')}</div>
        </div>
      )}

      {step === 3 && (
        <div className="wizard-body">
          <label className="field">{t('reno.contractor')}<input value={reno.contractor ?? ''} onChange={set('contractor')} maxLength={80} placeholder="e.g. ABC Renovation" /></label>
          <label className="switch-row"><input type="checkbox" checked={!!reno.contractor_cidb_registered} onChange={set('contractor_cidb_registered')} /> {t('reno.cidb')}</label>
          {strata && (
            <label className="field">{t('reno.jmb')}
              <select value={reno.management_approval ?? ''} onChange={set('management_approval')}>
                <option value="" disabled>{t('reno.choose')}</option>
                <option value="approved">{t('reno.jmbApproved')}</option>
                <option value="pending">{t('reno.jmbPending')}</option>
              </select>
            </label>
          )}
          <div className="grid-2">
            <label className="field">{t('reno.permit')}
              <select value={reno.council_permit ?? ''} onChange={set('council_permit')}>
                <option value="" disabled>{t('reno.choose')}</option>
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
            <div><dt>{t('reno.dates')}</dt><dd>{dates.range(reno.start, reno.end)}</dd></div>
            <div><dt>{t('reno.noisy')}</dt><dd>{noisyHours(t, full)}</dd></div>
            <div><dt>{t('reno.contractor')}</dt><dd>{reno.contractor || '–'}{reno.contractor_cidb_registered ? ' · CIDB ✓' : ''}</dd></div>
            <div><dt>{t('reno.notified')}</dt><dd>{t('reno.homes', { n: zone?.length ?? '–' })}</dd></div>
            <div><dt>{t('reno.approvals')}</dt><dd>{strata
              ? `JMB/MC · ${t(!reno.management_approval ? 'reno.notStated' : reno.management_approval === 'approved' ? 'reno.jmbApproved' : 'reno.jmbPending')}`
              : `PBT · ${t(!reno.council_permit ? 'reno.notStated' : reno.council_permit === 'approved' ? 'reno.permitApproved' : reno.council_permit === 'applied' ? 'reno.permitApplied' : 'reno.permitNone')}`}</dd></div>
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
