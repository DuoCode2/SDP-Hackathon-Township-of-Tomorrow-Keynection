import { CalendarClock, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { WarrantyClock as Clock } from '../api'
import { formatDate } from '../ui'

// Housing Development Act (Schedules G/H): defects reported within 24 months of vacant possession are repaired by
// the developer within 30 days of the owner's written notice. The clock keeps running if a repair is rejected.
export default function WarrantyClock({ clock, closed, compact = false }: { clock: Clock; closed: boolean; compact?: boolean }) {
  const day = Math.max(1, Math.min(clock.days_elapsed + 1, clock.repair_days))
  const tone = closed ? (clock.closed_on_time ? 'ok' : 'late') : clock.overdue ? 'late' : clock.days_left <= 7 ? 'soon' : 'ok'
  const label = closed
    ? clock.closed_on_time ? `Closed on day ${clock.days_elapsed + 1} of ${clock.repair_days}` : `Closed after ${clock.days_elapsed} days`
    : clock.overdue ? `Overdue by ${-clock.days_left} day(s)` : `Day ${clock.days_elapsed + 1} of ${clock.repair_days}`
  return (
    <div className={`wclock ${tone} ${compact ? 'compact' : ''}`}>
      <div className="wclock-top">
        {tone === 'late' ? <TriangleAlert size={14} /> : <CalendarClock size={14} />}
        <b>{label}</b>
        {!closed && !clock.overdue && <span>repair due {formatDate(clock.repair_due)}</span>}
      </div>
      <div className="wclock-bar" aria-hidden>
        <i style={{ width: `${(day / clock.repair_days) * 100}%` }} />
        {[7, 14, 21, 28].map((d) => <s key={d} style={{ left: `${(d / clock.repair_days) * 100}%` }} />)}
      </div>
      {!compact && (
        <div className="wclock-foot">
          <ShieldCheck size={12} />
          {clock.within_dlp
            ? `Within the 24-month defect liability period · ${clock.dlp_months_left} months left (ends ${formatDate(clock.dlp_ends)})`
            : `Reported after the defect liability period ended on ${formatDate(clock.dlp_ends)}`}
          <span className="wclock-law">HDA Sch. G/H</span>
        </div>
      )}
    </div>
  )
}
