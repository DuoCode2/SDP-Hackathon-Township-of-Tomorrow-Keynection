import { Printer } from 'lucide-react'
import type { PaperNotice } from '../api'
import { dateIn, noisyHours, tEn, tIn } from '../i18n'
import { usePlace } from '../features'
import { Sheet } from '../ui'

/** The notice the estate office prints for a household that isn't on Keynection: in its language, with English below. */
export default function PaperNoticeSheet({ notice, onClose, onPrinted }: { notice: PaperNotice; onClose: () => void; onPrinted: () => void }) {
  const t = tIn(notice.lang)
  const place = usePlace()
  const both = (key: string, vars?: Record<string, string | number>) => (
    notice.lang === 'en' ? <>{tEn(key, vars)}</> : <>{t(key, vars)}<span className="paper-en">{tEn(key, vars)}</span></>
  )
  const r = notice.renovation
  function print() {
    window.print()
    onPrinted()
  }
  return (
    <Sheet open onClose={onClose} wide>
      <div className="print-area paper">
        <div className="paper-head">
          <b>{both('paper.title')}</b>
          <span className="mono">#{String(notice.id).padStart(4, '0')} · {place.name}</span>
        </div>
        <p className="paper-to">{both('paper.to', { label: notice.unit_label })}</p>
        <p>{both('paper.from', { name: notice.from_name, label: notice.from_label })}</p>
        {notice.sent_by && <p className="paper-small">{both('paper.registered', { who: notice.sent_by })}</p>}
        {r && (
          <dl className="paper-grid">
            <div><dt>{both('reno.work')}</dt><dd>{r.scope}</dd></div>
            <div><dt>{both('reno.dates')}</dt><dd>{dateIn(notice.lang, r.start)} – {dateIn(notice.lang, r.end)}</dd></div>
            <div><dt>{both('reno.noisy')}</dt><dd>{noisyHours(t, r)}{notice.lang !== 'en' && <span className="paper-en">{noisyHours(tEn, r)}</span>}</dd></div>
            <div><dt>{both('reno.contractor')}</dt><dd>{r.contractor || '–'}{r.contractor_cidb_registered ? ' · CIDB ✓' : ''}</dd></div>
            {r.council_permit && <div><dt>{both('notice.permit')}</dt><dd>{both(`permit.${r.council_permit}`)}{r.permit_ref ? ` · ${r.permit_ref}` : ''}</dd></div>}
          </dl>
        )}
        <blockquote className="paper-message">“{notice.message}”</blockquote>
        {notice.translated && <p className="paper-small">{both('paper.byAi')}</p>}
        <ol className="paper-steps">
          <li>{both('paper.photo')}</li>
          <li>{both('paper.concern')}</li>
          <li>{both('paper.join')}</li>
        </ol>
        <div className="paper-foot">{both('paper.delivered')}: ____________ · ____ / ____ / ______</div>
      </div>
      <div className="btn-row no-print">
        <button className="btn btn-primary" onClick={print}><Printer size={15} /> Print notice</button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  )
}
