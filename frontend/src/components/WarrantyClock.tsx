import { CalendarClock, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { WarrantyClock as Clock } from '../api'
import { useDates, useT } from '../i18n'

// Housing Development Act (Schedules G/H): defects reported within 24 months of vacant possession are repaired by
// the developer within 30 days of receiving the owner's written notice (served by hand or registered post, Sch. G
// cl. 29 / H cl. 32). The clock here starts at the ticket, so it tells the owner to serve a formal notice too.
// The clock keeps running if a repair is rejected.
export default function WarrantyClock({ clock, closed, compact = false }: { clock: Clock; closed: boolean; compact?: boolean }) {
  const t = useT()
  const { date } = useDates()
  const day = Math.max(1, Math.min(clock.days_elapsed + 1, clock.repair_days))
  const tone = closed ? (clock.closed_on_time ? 'ok' : 'late') : clock.overdue ? 'late' : clock.days_left <= 7 ? 'soon' : 'ok'
  const n = clock.repair_days
  const label = closed
    ? clock.closed_on_time ? t('wc.closedOnDay', { d: clock.days_elapsed + 1, n }) : t('wc.closedAfter', { d: clock.days_elapsed })
    : clock.overdue ? t('wc.overdue', { d: -clock.days_left }) : t('wc.day', { d: clock.days_elapsed + 1, n })
  return (
    <div className={`wclock ${tone} ${compact ? 'compact' : ''}`}>
      <div className="wclock-top">
        {tone === 'late' ? <TriangleAlert size={14} /> : <CalendarClock size={14} />}
        <b>{label}</b>
        {!closed && !clock.overdue && <span>{t('wc.due', { date: date(clock.repair_due) })}</span>}
      </div>
      <div className="wclock-bar" aria-hidden>
        <i style={{ width: `${(day / clock.repair_days) * 100}%` }} />
        {[7, 14, 21, 28].map((d) => <s key={d} style={{ left: `${(d / clock.repair_days) * 100}%` }} />)}
      </div>
      {!compact && (
        <div className="wclock-foot">
          <ShieldCheck size={12} />
          {clock.within_dlp
            ? t('wc.within', { m: clock.dlp_months_left, date: date(clock.dlp_ends) })
            : t('wc.after', { date: date(clock.dlp_ends) })}
          <span className="wclock-law">HDA Sch. G/H</span>
        </div>
      )}
      {!compact && !closed && <div className="wclock-notice small muted">{t('wc.notice')}</div>}
    </div>
  )
}
