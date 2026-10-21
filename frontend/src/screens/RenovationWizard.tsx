import { useEffect, useState } from 'react'
import { Bath, Building, CalendarClock, Drill, Landmark, Lock, Paintbrush, Send, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react'
import { api, ApiError, type ImpactItem, type QuietPlan, type Renovation, type RenovationDraft, type UnitInfo, type WorksType } from '../api'
import { LANGS, introTemplate, type Lang } from '../messages'
import PlanMap from '../components/PlanMap'
import { noisyHours, useDates, useT } from '../i18n'
import { useHelper } from '../helper'
import { useAi } from '../features'
import { Segmented, Sheet, Steps, useToast } from '../ui'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// KPKT circular Bil. 3/2026, the national renovation guideline every council follows since 1 April 2026.
const GUIDELINE_URL = 'https://www.kpkt.gov.my/kpkt/resources/user_1/MENGENAI%20KPKT/PEKELILING/2026/PK_KSU_KPKT_Bil.3_Tahun_2026_GP_Kerja_Ubahsuai_Bangunan.pdf'

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

/** The coming Monday (a week away when today is Monday), as YYYY-MM-DD. */
function nextMonday(): string {
  return daysFromToday((8 - new Date().getDay()) % 7 || 7)
}

/** The first day of next month, as YYYY-MM-DD. */
function firstOfNextMonth(): string {
  const d = new Date()
  return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 1))
}

// What an example fills in when AI is off: the kind of work, a short description in that language, dates worked out
// from today, and the contractor named in the sentence.
type Preset = { works: WorksType; scope: string; lang: Lang; start: () => string; days: number; contractor: string }

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
export default function RenovationWizard({ open, onClose, me, units, names, onSent, estate, preset, fromAssistant }: {
  open: boolean
  onClose: () => void
  me: UnitInfo
  units: UnitInfo[]
  names: Record<string, string>
  onSent: () => void
  /** Set when the estate office registers the renovation for an owner who signed the paper form. */
  estate?: { staff: string }
  /** Demo quick example: start filled in with the bathroom story (the English example), on the When step. */
  preset?: 'bathroom'
  /** The assistant's reading of one sentence: the fields AI filled in (null without AI), and the sentence itself. */
  fromAssistant?: { said: string; renovation: RenovationDraft | null }
}) {
  const t = useT()
  const dates = useDates()
  const toast = useToast()
  const helper = useHelper(me.id)
  const strata = me.kind === 'apartment'
  const [step, setStep] = useState(0)
  // Every home starts on wet work: the first card, and the only kind that never needs an approval before Next.
  const [works, setWorks] = useState<WorksType>('wet')
  const [zone, setZone] = useState<ImpactItem[] | null>(null)
  const [tapped, setTapped] = useState<string | null>(null)  // a home tapped on the plan: why it is told
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
    scope: t('works.wet.scope'),
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
  // The owner's own hours must sit inside the house rule (09:00–18:00), checked before Next; planned hours always do.
  const from = reno.noisy_from ?? '', to = reno.noisy_to ?? ''
  const hoursOk = !!planned || (from >= '09:00' && to <= '18:00' && from < to)

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

  // One sentence in each language a judge can try without typing; each is a different kind of work, so the
  // notice list on the next step changes with it. Without AI the same button applies the preset beside it, on this
  // device, so the example still fills in the steps. Nothing is sent either way.
  const EXAMPLES: { label: string; text: string; preset: Preset }[] = [
    { label: 'English', text: 'Retiling the master bathroom from next Monday for two weeks, ABC Renovation, weekdays 9 to 6',
      preset: { works: 'wet', scope: 'Retile the master bathroom', lang: 'en', start: nextMonday, days: 14, contractor: 'ABC Renovation' } },
    { label: 'Bahasa Melayu', text: 'Nak pecah jubin dapur dan gerudi dinding mulai Isnin depan selama tiga minggu, Kontraktor Maju, Isnin hingga Jumaat 9 pagi hingga 6 petang',
      preset: { works: 'hacking', scope: 'Pecah jubin dapur dan gerudi dinding', lang: 'ms', start: nextMonday, days: 21, contractor: 'Kontraktor Maju' } },
    { label: '中文', text: '下个月初开始油漆和做木工，大概一个星期，承包商是兴隆装修，平日早上九点到下午六点',
      preset: { works: 'light', scope: '油漆和做木工', lang: 'zh', start: firstOfNextMonth, days: 7, contractor: '兴隆装修' } },
  ]

  /** Without AI, an example fills in the steps from its preset: weekdays 9 to 6, the owner's language. Nothing is sent. */
  function applyPreset(p: Preset) {
    const start = p.start()
    setWorks(p.works)
    setReno((r) => ({ ...r, scope: p.scope, start, end: addDays(start, p.days - 1), noisy_from: '09:00', noisy_to: '18:00', weekdays_only: true, contractor: p.contractor }))
    setLang(p.lang)
    setDraft(null)
    setFilled(null)
    setAiNote(t('ai.reno.example'))
  }

  // The quick example: the same local preset as the English example, then straight to the planned hours. No AI either way.
  useEffect(() => {
    if (open && preset === 'bathroom') {
      applyPreset(EXAMPLES[0].preset)
      setStep(2)
    }
  }, [open, preset])

  /** What AI read from the owner's sentence, onto the steps; whatever it left empty keeps what was there. */
  function applyDraft(d: RenovationDraft) {
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
  }

  // From the assistant: a sentence AI read lands on the review, or on the step that still needs the owner (approvals
  // for structural work, hours outside the house rule). Without AI the sentence waits on the first step. Nothing is sent.
  useEffect(() => {
    if (!open || !fromAssistant) return
    const d = fromAssistant.renovation
    setSaid(fromAssistant.said)
    if (!d) {
      setStep(0)
      return
    }
    applyDraft(d)
    const outside = (d.noisy_from ?? '09:00') < '09:00' || (d.noisy_to ?? '18:00') > '18:00'
    setStep(d.works_type === 'structural' ? 3 : outside ? 2 : 4)
  }, [open, fromAssistant])
  // With AI off there is no sentence box, so the sentence becomes the description (known once the AI status is in).
  useEffect(() => {
    if (open && fromAssistant && !fromAssistant.renovation && ai && !ai.on) setReno((r) => ({ ...r, scope: fromAssistant.said.slice(0, 120) }))
  }, [open, fromAssistant, ai])

  /** The owner's one sentence fills in the steps; whatever AI left empty keeps what was there. Nothing is sent. */
  async function fillIn(text?: string) {
    const what = (text ?? said).trim()
    if (text !== undefined) setSaid(text)
    setReading(true)
    setAiNote(null)
    setFilled(null)
    try {
      applyDraft(await api.renovationDraft(me.id, what))
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
          {ai && (
            <div className="ai-box">
              <div className="ai-box-head"><Sparkles size={15} /> <b>{t(ai.on ? 'ai.reno.title' : 'ai.reno.offTitle')}</b></div>
              <small className="muted">{t(ai.on ? 'ai.reno.hint' : 'ai.reno.offHint')}</small>
              {ai.on && (
                <div className="ai-box-row">
                  <textarea rows={2} maxLength={500} value={said} onChange={(e) => setSaid(e.target.value)} placeholder={t('ai.reno.placeholder')}
                    aria-label={t('ai.reno.title')} />
                  <button className="btn btn-primary" disabled={!said.trim() || reading} onClick={() => fillIn()}>
                    <Sparkles size={14} /> {reading ? t('ai.reno.working') : t('ai.reno.fill')}
                  </button>
                </div>
              )}
              <div className="ai-examples">
                <small className="muted">{t(ai.on ? 'ai.reno.try' : 'ai.reno.offTry')}</small>
                {EXAMPLES.map((x) => (
                  <button key={x.label} type="button" className="btn btn-sm" disabled={reading} onClick={() => (ai.on ? fillIn(x.text) : applyPreset(x.preset))}>{x.label}</button>
                ))}
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
                  <small>{t(!strata && (w.id === 'wet' || w.id === 'hacking') ? `works.${w.id}.d.landed` : `works.${w.id}.d`)}</small>
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
            <PlanMap units={units} me={me} circle={[]} names={names} view={me.kind} impact={zone?.map((z) => z.id) ?? []} worksType={works}
              selected={tapped} onSelect={setTapped}
              explain={Object.fromEntries((zone ?? []).map((z) => [z.id, `${z.label} · ${t(`rel.${z.relation}`)}: ${t(`reason.${z.reason_key}`)}`]))} />
          </div>
          <div className="stack">
            <div className="wizard-lead">{t('reno.lead')}</div>
            <ol className="zone-list">
              {!zone && <li className="muted">{t('reno.working')}</li>}
              {zone?.map((z) => (
                <li key={z.id}>
                  <b>{z.label}</b>
                  <span>{z.joined === false ? t('nj.status') : z.relation === 'behind' ? t('rel.behind') : z.resident_name ?? t('reno.hidden')}</span>
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
          {/* The house rule's hours (LEGAL_FROM/LEGAL_TO in quiet.py): the server refuses a notice outside them.
              Planned hours replace the owner's own inputs, so only one set of hours is on screen. */}
          {planned ? (
            <HoursBar plan={planned} legend={t('plan.avoids', { hours: noisyHours(t, { ...reno, ...planned }), n: planned.avoided })} />
          ) : (
            <div className="grid-2">
              <label className="field">{t('reno.noisyFrom')}<input type="time" value={reno.noisy_from} min="09:00" max="18:00" onChange={set('noisy_from')} /></label>
              <label className="field">{t('reno.noisyTo')}<input type="time" value={reno.noisy_to} min="09:00" max="18:00" onChange={set('noisy_to')} /></label>
            </div>
          )}
          <small className={hoursOk ? undefined : 'warn'}>{t('reno.hoursRule')}</small>
          <label className="switch-row"><input type="checkbox" checked={!!reno.weekdays_only} onChange={set('weekdays_only')} /> {t('reno.weekends')}</label>
          {plan && plan.homes_with_quiet_times > 0 && (
            <div className="qplan-card">
              <div className="qplan-head"><CalendarClock size={15} /> <b>{t('plan.title')}</b></div>
              {!usePlan && <p>{t('plan.avoids', { hours: noisyHours(t, { ...reno, ...plan }), n: plan.avoided })}</p>}
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
          <div className="wizard-note permit-guide">
            <Landmark size={13} />
            <div>
              <b>{t('permit.guide.title')}</b> {t(`permit.guide.${works}`)} {t('permit.guide.how')}{' '}
              <a href={GUIDELINE_URL} target="_blank" rel="noreferrer">{t('permit.guide.link')}</a>
            </div>
          </div>
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
          {!strata && reno.council_permit === 'not_needed' && works !== 'light' && (
            <div className="tone-check"><TriangleAlert size={15} /><div>{t('permit.guide.check')}</div></div>
          )}
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
              : `PBT · ${t(!reno.council_permit ? (works === 'light' ? 'reno.notStated' : 'reno.notStatedNeeded') : reno.council_permit === 'approved' ? 'reno.permitApproved' : reno.council_permit === 'applied' ? 'reno.permitApplied' : 'reno.permitNone')}`}</dd></div>
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
          <button className="btn btn-primary" disabled={(step === 3 && blocked) || (step === 2 && !hoursOk) || !reno.scope.trim()} onClick={() => setStep(step + 1)}>{t('btn.next')}</button>
        ) : (
          <button className="btn btn-primary" disabled={sending || blocked} onClick={send}><Send size={15} /> {sending ? t('btn.sending') : t('reno.send')}</button>
        )}
      </div>
    </Sheet>
  )
}

// The house rule's working day, 09:00–18:00, in minutes.
const DAY_FROM = 9 * 60
const DAY_TO = 18 * 60
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const place = (from: string, to: string) => ({
  left: `${((minutes(from) - DAY_FROM) / (DAY_TO - DAY_FROM)) * 100}%`,
  width: `${((minutes(to) - minutes(from)) / (DAY_TO - DAY_FROM)) * 100}%`,
})

/** The planned hours on the 09:00–18:00 day: noisy work solid, quiet breaks striped, the plan's sentence below. */
function HoursBar({ plan, legend }: { plan: QuietPlan; legend: string }) {
  return (
    <div className="hours-bar">
      <div className="hours-track" role="img" aria-label={legend}>
        <span className="noisy" style={place(plan.noisy_from, plan.noisy_to)} title={`${plan.noisy_from}–${plan.noisy_to}`} />
        {plan.quiet_breaks.map((b) => <span key={b.start} className="quiet" style={place(b.start, b.end)} title={`${b.start}–${b.end}`} />)}
      </div>
      <div className="hours-axis"><span>09:00</span><span>18:00</span></div>
      <small>{legend}</small>
    </div>
  )
}
