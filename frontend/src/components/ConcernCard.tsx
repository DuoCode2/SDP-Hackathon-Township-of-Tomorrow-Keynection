import { useState } from 'react'
import { BellRing, Building2, Check, CircleCheck, MessageSquareWarning, Send } from 'lucide-react'
import { api, type Concern } from '../api'
import { formatDate, formatTime, Stamp, useToast } from '../ui'

const STATUS: Record<Concern['status'], { label: string; tone: 'amber' | 'blue' | 'brand' | 'red' | 'ink' }> = {
  open: { label: 'Waiting for reply', tone: 'amber' },
  acknowledged: { label: 'Owner responded', tone: 'blue' },
  resolved: { label: 'Sorted by neighbours', tone: 'brand' },
  escalated: { label: 'With SDP estate team', tone: 'red' },
  closed_by_estate: { label: 'Closed by estate team', tone: 'ink' },
}

/** One concern and its ladder: neighbour first, then the renovating owner, then (only if needed) SDP's estate team. */
export default function ConcernCard({ concern: c, viewer, estate = false, onChanged }: {
  concern: Concern
  viewer?: string
  estate?: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const isOwner = viewer === c.to_unit_id
  const isRaiser = viewer === c.from_unit_id

  async function act(work: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await work()
      toast(done)
      setNote('')
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update', 'error')
    } finally {
      setBusy(false)
    }
  }

  const steps = [
    { label: 'Raised', at: c.created_at, done: true },
    { label: 'Owner replied', at: c.acknowledged_at, done: !!c.acknowledged_at || c.status === 'resolved' },
    c.escalated_at
      ? { label: 'SDP estate team', at: c.escalated_at, done: true, alert: true }
      : { label: 'Sorted', at: c.resolved_at, done: c.status === 'resolved' },
    ...(c.escalated_at ? [{ label: 'Closed', at: c.closed_at, done: c.status === 'closed_by_estate' }] : []),
  ]
  const s = STATUS[c.status]

  return (
    <div className={`concern concern-${c.status}`}>
      <div className="concern-head">
        <MessageSquareWarning size={16} />
        <div className="grow">
          <div className="concern-kicker">Concern · {c.from_name} ({c.from_label}) → {c.to_name} ({c.to_label})</div>
          <div className="concern-title">{c.category_label}</div>
        </div>
        <Stamp tone={s.tone} tilt={-3}>{s.label}</Stamp>
      </div>
      {c.note && <p className="concern-note">“{c.note}”</p>}
      <ol className="ladder">
        {steps.map((st, i) => (
          <li key={i} className={`${st.done ? 'done' : ''} ${'alert' in st && st.alert ? 'alert' : ''}`}>
            <span className="ladder-dot">{st.done ? <Check size={10} strokeWidth={3} /> : i + 1}</span>
            <b>{st.label}</b>
            <small>{st.at ? `${formatDate(st.at)} · ${formatTime(st.at)}` : '—'}</small>
          </li>
        ))}
      </ol>
      {c.response_note && <div className="concern-reply"><b>{c.to_name}:</b> {c.response_note}</div>}
      {c.estate_note && <div className="concern-reply estate"><b>Estate team:</b> {c.estate_note}</div>}
      {c.reminders > 0 && <div className="concern-meta"><BellRing size={12} /> Estate team sent {c.reminders} reminder(s) to {c.to_label}</div>}

      {!estate && isOwner && (c.status === 'open' || c.status === 'acknowledged') && (
        <div className="concern-actions">
          <input className="concern-input" maxLength={300} placeholder="Reply to your neighbour (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="btn-row">
            {c.status === 'open' && (
              <button className="btn btn-sm" disabled={busy} onClick={() => act(() => api.concernStep(c.id, 'acknowledge', viewer!, note), 'Reply sent')}>
                <Send size={13} /> Reply & look into it
              </button>
            )}
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act(() => api.concernStep(c.id, 'resolve', viewer!, note), 'Marked as sorted')}>
              <CircleCheck size={13} /> It's sorted
            </button>
          </div>
        </div>
      )}

      {!estate && isRaiser && ['open', 'acknowledged', 'resolved'].includes(c.status) && (
        <div className="concern-actions">
          <div className="concern-hint">
            {c.status === 'resolved' ? 'Still happening? You can still involve the estate team.' : 'Not sorted? Hand it to SDP’s estate team. Everything above goes with it.'}
            <span className="mono"> In a pilot: available after 24 h without a reply.</span>
          </div>
          <button className="btn btn-sm btn-danger" disabled={busy}
            onClick={() => act(() => api.concernStep(c.id, 'escalate', viewer!), 'Sent to the SDP estate team')}>
            <Building2 size={13} /> Escalate to SDP estate team
          </button>
        </div>
      )}

      {estate && c.status === 'escalated' && (
        <div className="concern-actions">
          <input className="concern-input" maxLength={300} placeholder="Note for both households (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="btn-row">
            <button className="btn btn-sm" disabled={busy} onClick={() => act(() => api.estateAction(c.id, 'remind', note), `Reminder sent to ${c.to_label}`)}>
              <BellRing size={13} /> Remind owner of house rules
            </button>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act(() => api.estateAction(c.id, 'resolve', note), 'Concern closed')}>
              <CircleCheck size={13} /> Close concern
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
