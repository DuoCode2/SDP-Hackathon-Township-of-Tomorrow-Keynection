import { useState, type ReactNode } from 'react'
import { Building2, ChevronLeft, CircleCheck, Hammer, Hourglass, MessageSquareX, ScanSearch, Sparkles, UserCheck } from 'lucide-react'
import { api, type Decision, type Incident, type Suggestion, type TriageCode, type UnitInfo } from '../api'
import Compare from '../components/Compare'
import { useHelper } from '../helper'
import { subjectText, useDates, useT, type Translate } from '../i18n'
import { Badge, Card, useToast } from '../ui'

const SUGGESTION_TONE: Record<Suggestion, 'amber' | 'blue' | 'brand' | undefined> = {
  renovation: 'amber', warranty: 'blue', inspect: undefined, no_change: 'brand', retake: undefined,
}

type Role = 'reporter' | 'renovating_owner' | 'viewer'
type Choice = Decision | 'dispute'

export function caseRole(c: Incident, me: UnitInfo): Role {
  if (c.reporter_unit_id === me.id) return 'reporter'
  if (c.renovation?.from_unit_id === me.id) return 'renovating_owner'
  return 'viewer'
}

/** The badge in the Evidence list: what the case is waiting for, from this household's side. */
export function caseBadge(t: Translate, c: Incident, me: UnitInfo): ReactNode {
  const role = caseRole(c, me)
  if (c.status === 'decided') return <Badge tone="brand">{t('cb.decided')}</Badge>
  if (c.status === 'proposed') return role === 'renovating_owner' ? <Badge tone="amber">{t('cb.answer')}</Badge> : <Badge>{t('cb.waiting')}</Badge>
  if (c.status === 'disputed') return <Badge tone="amber">{t('cb.disputed')}</Badge>
  return <Badge tone={SUGGESTION_TONE[c.hint.suggestion]}>{t(`sg.${c.hint.suggestion}`)}</Badge>
}

/** The rule's reasons in the reader's language. Older cases have no codes: their English record is shown. */
function reasonsText(t: Translate, date: (iso: string) => string, c: Incident): string[] {
  if (!c.hint.codes?.length) return c.hint.reasons
  const found = (x: TriageCode) => (x.shapes ?? []).map((s) => t(`shape.${s}`)).join(t('shape.and'))
  return c.hint.codes.map((x) => t(`why.${x.code}`, {
    found: found(x), label: x.label ?? '', scope: x.scope ?? '',
    taken: x.taken ? date(x.taken) : '', seen: x.seen ? date(x.seen) : '', start: x.start ? date(x.start) : '',
  }))
}

export default function CaseView({ me, incident, onBack, onDecided }: {
  me: UnitInfo
  incident: Incident
  onBack: () => void
  onDecided: (updated: Incident) => void
}) {
  const t = useT()
  const { date } = useDates()
  const c = incident
  const regions = c.comparison.regions
  const role = caseRole(c, me)
  const neighbour = c.renovation ? t('who', { name: c.renovation.from_name, label: c.renovation.from_label }) : ''
  const reporter = t('who', { name: c.reporter_name, label: c.reporter_label })
  const decidedBy = c.decided_by === 'both_owners' ? t('by.both')
    : c.decided_by === 'renovating_owner' ? t('by.renovating', { who: neighbour }) : t('by.reporter', { who: reporter })
  return (
    <section className="screen">
      <button className="back" onClick={onBack}><ChevronLeft size={18} /> {t('nav.evidence')}</button>
      <div className="screen-title">
        <div className="eyebrow">{t('case.no', { n: String(c.id).padStart(3, '0') })}</div>
        <h1>{subjectText(t, c.baseline.subject)}</h1>
        <p>{t('case.reportedBy', { name: c.reporter_name, label: c.reporter_label })}{c.renovation ? t('case.renoAt', { label: c.renovation.from_label }) : ''}</p>
      </div>

      <div className="cols">
      <div className="col">
      {c.images ? (
        <Compare before={c.images.before} after={c.images.after} overlay={c.images.overlay} regions={regions} scan={c.status === 'open'}
          leftLabel={`${t('case.preWork')} · ${date(c.baseline.created_at)}`} rightLabel={`${t('case.now')} · ${date(c.followup.created_at)}`} />
      ) : (
        <div className="triptych" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <figure><img src={c.baseline.thumb_url} alt="" /><figcaption>{t('case.preWork')}</figcaption></figure>
          <figure><img src={c.followup.thumb_url} alt="" /><figcaption>{t('case.followup')}</figcaption></figure>
        </div>
      )}

      {c.comparison.aligned && (
        <div className="stat-grid">
          <div className="stat"><b className={regions.length ? '' : 'accent'}>{regions.length}</b><span>{t('case.changes')}</span></div>
          <div className="stat"><b>{c.comparison.change_ratio !== null ? `${(c.comparison.change_ratio * 100).toFixed(2)}%` : '–'}</b><span>{t('case.area')}</span></div>
          <div className="stat"><b className="accent">OK</b><span>{t('case.aligned')}</span></div>
        </div>
      )}
      </div>

      <div className="col sticky">

      <div className={`hint hint-${c.hint.suggestion}`}>
        <div className="eyebrow" style={{ color: 'var(--violet)' }}><Sparkles size={11} /> {t('case.ruleBased')}</div>
        <h3>{c.hint.codes ? t(`hint.${c.hint.suggestion}`) : c.hint.headline}</h3>
        <ul>{reasonsText(t, date, c).map((r) => <li key={r}>{r}</li>)}</ul>
        <div className="disclaimer">{t('case.suggestionOnly')}</div>
      </div>

      <CaseStatus c={c} role={role} />

      {c.status === 'decided' ? (
        <Card className="glow">
          <div className="card-row">
            <UserCheck size={22} color="var(--accent)" />
            <div className="grow">
              <div className="card-title">{t(`dec.${c.decision}`)}</div>
              <div className="muted small">{decidedBy} · {date(c.decided_at!)} · {t('case.writtenBoth')}</div>
            </div>
          </div>
          {c.decision_note && <div className="small dim">{c.reporter_name}: “{c.decision_note}”</div>}
          {c.response_note && c.renovation && <div className="small dim">{c.renovation.from_name}: “{c.response_note}”</div>}
        </Card>
      ) : (
        // Keyed by status so the form starts empty after each step (the choices change with the status).
        role !== 'viewer' && c.hint.suggestion !== 'retake' && <DecisionForm key={`${c.id}-${c.status}`} me={me} incident={c} role={role} onDecided={onDecided} />
      )}
      </div>
      </div>
    </section>
  )
}

/** Where a case stands while the two households are still answering each other. */
function CaseStatus({ c, role }: { c: Incident; role: Role }) {
  const t = useT()
  if (!c.renovation || (c.status !== 'proposed' && c.status !== 'disputed')) return null
  const neighbour = t('who', { name: c.renovation.from_name, label: c.renovation.from_label })
  const reporter = t('who', { name: c.reporter_name, label: c.reporter_label })
  if (c.status === 'proposed') {
    return (
      <Card className={role === 'renovating_owner' ? 'alert' : ''}>
        <div className="card-row">
          <Hourglass size={20} color="var(--amber)" />
          <div className="grow">
            <div className="card-title">{role === 'renovating_owner' ? t('cs.blamed', { who: reporter }) : t('cs.waitingFor', { who: neighbour })}</div>
            <div className="muted small">{t(role === 'renovating_owner' ? 'cs.blamedNote' : 'cs.askedNote')}</div>
          </div>
        </div>
        {c.decision_note && <div className="small dim">{c.reporter_name}: “{c.decision_note}”</div>}
      </Card>
    )
  }
  return (
    <Card>
      <div className="card-row">
        <MessageSquareX size={20} color="var(--amber)" />
        <div className="grow">
          <div className="card-title">{role === 'renovating_owner' ? t('cs.youDisagreed') : t('cs.theyDisagree', { who: neighbour })}</div>
          <div className="muted small">{role === 'renovating_owner' ? t('cs.youDisagreedNote', { who: reporter }) : t('cs.theyDisagreeNote')}</div>
        </div>
      </div>
      {c.response_note && <div className="small dim">{c.renovation.from_name}: “{c.response_note}”</div>}
    </Card>
  )
}

function choicesFor(t: Translate, c: Incident, role: Role): { id: Choice; title: string; detail: string; icon: ReactNode }[] {
  const warranty = { id: 'warranty' as const, title: t('ch.warranty'), detail: t('ch.warranty.d'), icon: <Building2 size={18} /> }
  const inspect = { id: 'inspect' as const, title: t('ch.inspect'), detail: t('ch.inspect.d'), icon: <ScanSearch size={18} /> }
  const none = { id: 'no_action' as const, title: t('ch.none'), detail: t('ch.none.d'), icon: <CircleCheck size={18} /> }
  if (role === 'reporter') {
    const blame = { id: 'renovation' as const, title: t('ch.blame'), detail: t('ch.blame.d', { label: c.renovation?.from_label ?? '' }), icon: <Hammer size={18} /> }
    if (c.status === 'open' && c.renovation) return [blame, warranty, inspect, none]
    if (c.status === 'disputed') return [inspect, warranty, none]
    return [warranty, inspect, none]
  }
  const accept = { id: 'renovation' as const, title: t(c.status === 'proposed' ? 'ch.acceptAgree' : 'ch.accept'), detail: t('ch.accept.d'), icon: <Hammer size={18} /> }
  const dispute = { id: 'dispute' as const, title: t('ch.dispute'), detail: t('ch.dispute.d'), icon: <MessageSquareX size={18} /> }
  return c.status === 'proposed' ? [accept, dispute, inspect] : [accept, inspect]
}

function DecisionForm({ me, incident, role, onDecided }: {
  me: UnitInfo
  incident: Incident
  role: Exclude<Role, 'viewer'>
  onDecided: (updated: Incident) => void
}) {
  const t = useT()
  const toast = useToast()
  const helper = useHelper(me.id)
  const choices = choicesFor(t, incident, role)
  // Nothing is pre-selected: the rule-based suggestion above must not become the answer by default.
  const [choice, setChoice] = useState<Choice | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const needsNote = choice === 'dispute' && !note.trim()
  const asking = role === 'reporter' && choice === 'renovation'
  const label = incident.renovation?.from_label ?? ''

  async function save() {
    if (!choice) return
    setSaving(true)
    try {
      const updated = await api.decide(incident.id, me.id, choice, note, helper?.id)
      toast(
        updated.status === 'proposed' ? t('df.sentToConfirm', { label })
          : updated.status === 'disputed' ? t('df.answerSent')
          : choice === 'warranty' ? t('df.ticketOpened') : t('df.written'),
      )
      onDecided(updated)
    } catch (e) {
      toast(e instanceof Error ? e.message : t('df.couldNotSave'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <div className="card-title">{t(role === 'reporter' ? 'df.whatDo' : 'df.yourAnswer')}</div>
      <div className="choices">
        {choices.map((d) => (
          <button key={d.id} className={`choice ${choice === d.id ? 'on' : ''}`} onClick={() => setChoice(d.id)} aria-pressed={choice === d.id}>
            {d.icon}
            <span>{d.title}<small>{d.detail}</small></span>
          </button>
        ))}
      </div>
      <textarea className="input" rows={2} maxLength={300}
        placeholder={t(choice === 'dispute' ? 'df.disputePh' : 'df.notePh')}
        value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={saving || !choice || needsNote}>
        {saving ? t('df.saving') : asking ? t('df.ask', { label }) : choice === 'dispute' ? t('df.sendAnswer') : t('df.record')}
      </button>
    </Card>
  )
}
