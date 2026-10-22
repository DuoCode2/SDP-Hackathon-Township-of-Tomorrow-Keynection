import { useState } from 'react'
import { BellRing, Building2, Check, CircleCheck, Clock3, HandHeart, MessageSquareWarning, Send } from 'lucide-react'
import { api, type Concern } from '../api'
import { byWho, useDates, useT } from '../i18n'
import { Stamp, useToast } from '../ui'

const TONE: Record<Concern['status'], 'amber' | 'blue' | 'brand' | 'red' | 'ink'> = {
  open: 'amber', acknowledged: 'blue', resolved: 'brand', escalated: 'red', closed_by_estate: 'ink',
}

/** One concern and its ladder: neighbour first, then the renovating owner, then (only if needed) SDP's estate team. */
export default function ConcernCard({ concern: c, viewer, estate = false, onChanged }: {
  concern: Concern
  viewer?: string
  estate?: boolean
  onChanged: () => void
}) {
  const t = useT()  // the estate desk follows the interface language too; the concern's own words stay as written
  const dates = useDates()
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
      toast(e instanceof Error ? e.message : t('err.tryAgain'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const steps = [
    { label: t('cc.raised'), at: c.created_at, done: true },
    { label: t('cc.replied'), at: c.acknowledged_at, done: !!c.acknowledged_at || c.status === 'resolved' },
    c.escalated_at
      ? { label: t('cc.estate'), at: c.escalated_at, done: true, alert: true }
      : { label: t('cc.sorted'), at: c.resolved_at, done: c.status === 'resolved' },
    ...(c.escalated_at ? [{ label: t('cc.closed'), at: c.closed_at, done: c.status === 'closed_by_estate' }] : []),
  ]

  return (
    <div className={`concern concern-${c.status}`}>
      <div className="concern-head">
        <MessageSquareWarning size={16} />
        <div className="grow">
          <div className="concern-kicker">{t('cc.kicker', { from: t('who', { name: c.from_name, label: c.from_label }), to: t('who', { name: c.to_name, label: c.to_label }) })}</div>
          <div className="concern-title">{t(`cat.${c.category}`)}</div>
        </div>
        <Stamp tone={TONE[c.status]} tilt={-3}>{t(`cc.${c.status}`)}</Stamp>
      </div>
      {c.note && <p className="concern-note">“{c.note}”</p>}
      {/* A noise concern says at once where the moment fell against what was agreed in the notice. */}
      {c.category === 'noise_hours' && c.timing && (
        <div className={`concern-timing ${c.timing === 'within_hours' ? 'ok' : 'off'}`}><Clock3 size={12} /> {t(`timing.${c.timing}`)}</div>
      )}
      {c.acted_by && <div className="concern-meta"><HandHeart size={12} /> {t('cc.by', { who: byWho(t, c.acted_by) })}</div>}
      <ol className="ladder">
        {steps.map((st, i) => (
          <li key={i} className={`${st.done ? 'done' : ''} ${'alert' in st && st.alert ? 'alert' : ''}`}>
            <span className="ladder-dot">{st.done ? <Check size={10} strokeWidth={3} /> : i + 1}</span>
            <b>{st.label}</b>
            <small>{st.at ? `${dates.date(st.at)} · ${dates.time(new Date(st.at))}` : '—'}</small>
          </li>
        ))}
      </ol>
      {c.response_note && <div className="concern-reply"><b>{c.to_name}:</b> {c.response_note}</div>}
      {c.estate_note && <div className="concern-reply estate"><b>{t('cc.estateSays')}</b> {c.estate_note}</div>}
      {c.reminders > 0 && <div className="concern-meta"><BellRing size={12} /> {t('cc.reminders', { n: c.reminders, label: c.to_label })}</div>}

      {!estate && isOwner && (c.status === 'open' || c.status === 'acknowledged') && (
        <div className="concern-actions">
          <input className="concern-input" maxLength={300} placeholder={t('cc.replyPlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="btn-row">
            {c.status === 'open' && (
              <button className="btn btn-sm" disabled={busy} onClick={() => act(() => api.concernStep(c.id, 'acknowledge', viewer!, note), t('cc.toastReply'))}>
                <Send size={13} /> {t('cc.reply')}
              </button>
            )}
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act(() => api.concernStep(c.id, 'resolve', viewer!, note), t('cc.toastSorted'))}>
              <CircleCheck size={13} /> {t('cc.sortedBtn')}
            </button>
          </div>
        </div>
      )}

      {!estate && isRaiser && ['open', 'acknowledged', 'resolved'].includes(c.status) && (
        <div className="concern-actions">
          <div className="concern-hint">
            {t(c.status === 'resolved' ? 'cc.stillHappening' : 'cc.notSorted')}
            <span className="mono"> {t('cc.pilot')}</span>
          </div>
          <button className="btn btn-sm btn-danger" disabled={busy}
            onClick={() => act(() => api.concernStep(c.id, 'escalate', viewer!), t('cc.toastEscalated'))}>
            <Building2 size={13} /> {t('cc.escalate')}
          </button>
        </div>
      )}

      {estate && c.status === 'escalated' && (
        <div className="concern-actions">
          <input className="concern-input" maxLength={300} placeholder={t('cc.estateNote')} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="btn-row">
            <button className="btn btn-sm" disabled={busy} onClick={() => act(() => api.estateAction(c.id, 'remind', note), t('cc.toastReminded', { label: c.to_label }))}>
              <BellRing size={13} /> {t('cc.remind')}
            </button>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act(() => api.estateAction(c.id, 'resolve', note), t('cc.toastClosed'))}>
              <CircleCheck size={13} /> {t('cc.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
