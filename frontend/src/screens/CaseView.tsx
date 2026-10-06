import { useState, type ReactNode } from 'react'
import { Building2, ChevronLeft, CircleCheck, Hammer, ScanSearch, Sparkles, UserCheck } from 'lucide-react'
import { api, type Decision, type Incident, type Suggestion } from '../api'
import Compare from '../components/Compare'
import { Badge, Card, formatDate, useToast } from '../ui'

export const SUGGESTION_BADGE: Record<Suggestion, ReactNode> = {
  renovation: <Badge tone="amber">Renovation?</Badge>,
  warranty: <Badge tone="blue">Warranty?</Badge>,
  inspect: <Badge>Inspect</Badge>,
  no_change: <Badge tone="brand">No change</Badge>,
  retake: <Badge>Retake</Badge>,
}

const DECISIONS: { id: Decision; title: string; detail: string; icon: ReactNode }[] = [
  { id: 'renovation', title: 'Caused by the renovation', detail: 'Owner and contractor repair it (or the deposit pays)', icon: <Hammer size={18} /> },
  { id: 'warranty', title: 'Building defect', detail: 'Opens an SDP warranty ticket with these photos attached', icon: <Building2 size={18} /> },
  { id: 'inspect', title: 'Ask an SDP inspector', detail: "We can't agree from the photos alone", icon: <ScanSearch size={18} /> },
  { id: 'no_action', title: 'No action needed', detail: 'Minor or already fixed', icon: <CircleCheck size={18} /> },
]

const DECISION_LABEL: Record<Decision, string> = {
  renovation: 'Caused by the renovation',
  warranty: 'Building defect: SDP warranty ticket opened',
  inspect: 'SDP inspector to check',
  no_action: 'No action needed',
}

export default function CaseView({ incident, onBack, onDecided }: {
  incident: Incident
  onBack: () => void
  onDecided: (updated: Incident) => void
}) {
  const c = incident
  const regions = c.comparison.regions
  return (
    <section className="screen">
      <button className="back" onClick={onBack}><ChevronLeft size={18} /> Evidence</button>
      <div className="screen-title">
        <div className="eyebrow">Case #{String(c.id).padStart(3, '0')}</div>
        <h1>{c.baseline.subject}</h1>
        <p>Reported by {c.reporter_name} ({c.reporter_label}){c.renovation ? ` · renovation at ${c.renovation.from_label}` : ''}</p>
      </div>

      <div className="cols">
      <div className="col">
      {c.images ? (
        <Compare before={c.images.before} after={c.images.after} overlay={c.images.overlay} regions={regions} scan={c.status === 'open'}
          leftLabel={`Pre-work · ${formatDate(c.baseline.created_at)}`} rightLabel={`Now · ${formatDate(c.followup.created_at)}`} />
      ) : (
        <div className="triptych" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <figure><img src={c.baseline.thumb_url} alt="" /><figcaption>Pre-work</figcaption></figure>
          <figure><img src={c.followup.thumb_url} alt="" /><figcaption>Follow-up</figcaption></figure>
        </div>
      )}

      {c.comparison.aligned && (
        <div className="stat-grid">
          <div className="stat"><b className={regions.length ? '' : 'accent'}>{regions.length}</b><span>Changes</span></div>
          <div className="stat"><b>{c.comparison.change_ratio !== null ? `${(c.comparison.change_ratio * 100).toFixed(2)}%` : '–'}</b><span>Area</span></div>
          <div className="stat"><b className="accent">OK</b><span>Aligned</span></div>
        </div>
      )}
      </div>

      <div className="col sticky">

      <div className={`hint hint-${c.hint.suggestion}`}>
        <div className="eyebrow" style={{ color: 'var(--violet)' }}><Sparkles size={11} /> Rule-based suggestion</div>
        <h3>{c.hint.headline}</h3>
        <ul>{c.hint.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <div className="disclaimer">SUGGESTION ONLY · PEOPLE DECIDE BELOW</div>
      </div>

      {c.status === 'decided' ? (
        <Card className="glow">
          <div className="card-row">
            <UserCheck size={22} color="var(--accent)" />
            <div className="grow">
              <div className="card-title">{DECISION_LABEL[c.decision!]}</div>
              <div className="muted small">Decided {formatDate(c.decided_at!)} · written to both home logs</div>
            </div>
          </div>
          {c.decision_note && <div className="small dim">“{c.decision_note}”</div>}
        </Card>
      ) : (
        c.hint.suggestion !== 'retake' && <DecisionForm incident={c} onDecided={onDecided} />
      )}
      </div>
      </div>
    </section>
  )
}

function DecisionForm({ incident, onDecided }: { incident: Incident; onDecided: (updated: Incident) => void }) {
  const toast = useToast()
  const suggested: Decision = incident.hint.suggestion === 'no_change' ? 'no_action' : (incident.hint.suggestion as Decision)
  const [decision, setDecision] = useState<Decision>(suggested)
  const [by, setBy] = useState<'both_owners' | 'sdp_inspector'>('both_owners')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const updated = await api.decide(incident.id, decision, by, note)
      toast(decision === 'warranty' ? 'Warranty ticket opened for SDP' : 'Decision written to both home logs')
      onDecided(updated)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <div className="card-title">What did you agree?</div>
      <div className="choices">
        {DECISIONS.map((d) => (
          <button key={d.id} className={`choice ${decision === d.id ? 'on' : ''}`} onClick={() => setDecision(d.id)}>
            {d.icon}
            <span>{d.title}<small>{d.detail}</small></span>
          </button>
        ))}
      </div>
      <div className="toggle" style={{ alignSelf: 'flex-start' }}>
        <button className={by === 'both_owners' ? 'on' : ''} onClick={() => setBy('both_owners')}>Both owners</button>
        <button className={by === 'sdp_inspector' ? 'on' : ''} onClick={() => setBy('sdp_inspector')}>SDP inspector</button>
      </div>
      <textarea className="input" rows={2} maxLength={300} placeholder="Note (optional), e.g. contractor will patch on Saturday"
        value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Record decision'}</button>
    </Card>
  )
}
