import { useEffect, useState, type ReactNode } from 'react'
import { Ban, Camera, CircleCheck, FileWarning, Gavel, Hammer, KeyRound, ShieldAlert, ShieldCheck, StickyNote, ThumbsDown, Ticket, Wrench } from 'lucide-react'
import { api, type HistoryEvent, type UnitInfo } from '../api'
import { CountUp, formatDate, ScreenTitle, shortRange, Skeleton } from '../ui'

const DECISION_TEXT: Record<string, string> = {
  renovation: 'Agreed: caused by the renovation',
  warranty: 'Agreed: building defect → SDP warranty',
  inspect: 'Agreed: SDP inspector to check',
  no_action: 'Agreed: no action needed',
}

function describe(e: HistoryEvent): { icon: ReactNode; title: string; detail?: string; photo?: string } {
  const p = e.payload as Record<string, unknown>
  const s = (k: string) => String(p[k] ?? '')
  switch (e.type) {
    case 'handover':
      return { icon: <KeyRound size={17} />, title: 'Handover', detail: 'SDP handover inspection recorded' }
    case 'renovation_registered':
      return { icon: <Hammer size={17} />, title: 'Renovation registered', detail: `${s('scope')} · ${shortRange(s('start'), s('end'))} · ${(p.neighbours_notified as string[] | undefined)?.length ?? 0} neighbours notified` }
    case 'photo_baseline':
      return { icon: <Camera size={17} />, title: 'Pre-work photo sealed', detail: `${s('subject')}${p.renovation_at ? ` · before work at ${s('renovation_at')}` : ''}`, photo: `/api/photos/${s('photo_id')}?size=thumb` }
    case 'incident':
      return { icon: <FileWarning size={17} />, title: `Change reported · case #${s('incident_id')}`, detail: `${s('regions')} change(s) flagged` }
    case 'triage':
      return { icon: <Gavel size={17} />, title: DECISION_TEXT[s('decision')] ?? 'Decision recorded', detail: p.note ? `“${s('note')}”` : undefined }
    case 'contractor_pass_issued':
      return { icon: <Ticket size={17} />, title: 'Contractor pass issued', detail: `${s('contractor')} · ${shortRange(s('valid_from'), s('valid_to'))}` }
    case 'contractor_pass_revoked':
      return { icon: <Ban size={17} />, title: 'Contractor pass revoked', detail: s('contractor') }
    case 'warranty_opened':
      return { icon: <Wrench size={17} />, title: `Warranty ticket #${s('ticket_id')} opened`, detail: s('subject') }
    case 'repair_submitted':
      return { icon: <Wrench size={17} />, title: 'SDP submitted a repair', detail: `${s('subcontractor')} · ${s('procore_ref')} · check: ${s('check').replace('_', ' ')}` }
    case 'warranty_closed_by_owner':
      return { icon: <CircleCheck size={17} />, title: 'Repair accepted by owner', detail: p.note ? `“${s('note')}”` : 'Ticket closed' }
    case 'repair_rejected_by_owner':
      return { icon: <ThumbsDown size={17} />, title: 'Repair rejected by owner', detail: p.note ? `“${s('note')}”` : undefined }
    default:
      return { icon: <StickyNote size={17} />, title: e.type }
  }
}

export default function HistoryView({ me, version }: { me: UnitInfo; version: number }) {
  const [data, setData] = useState<{ events: (HistoryEvent & { prev_hash?: string })[]; chain_ok: boolean } | null>(null)

  useEffect(() => {
    let live = true
    api.history(me.id).then((h) => live && setData(h))
    return () => {
      live = false
    }
  }, [me.id, version])

  return (
    <section className="screen">
      <ScreenTitle eyebrow="Tamper-evident record" title="Home log" subtitle={`Every record about ${me.label} is chained to the one before it with SHA-256.`} />
      {!data ? (
        <Skeleton lines={5} />
      ) : (
        <>
          <div className={`chain-banner ${data.chain_ok ? 'ok' : 'bad'}`}>
            {data.chain_ok ? <ShieldCheck size={30} /> : <ShieldAlert size={30} />}
            <div>
              <strong>{data.chain_ok ? 'CHAIN VERIFIED' : 'CHAIN BROKEN'}</strong>
              <p>{data.chain_ok ? <><CountUp value={data.events.length} /> records intact. Editing or deleting any one breaks every link after it.</> : 'A past record was changed or removed.'}</p>
            </div>
          </div>
          <ol className="blocks">
            {[...data.events].reverse().map((e, i, arr) => {
              const d = describe(e)
              return (
                <li key={e.id} className="block">
                  <div className="block-rail">
                    <div className="block-icon">{d.icon}</div>
                    {i < arr.length - 1 && <div className="block-link" />}
                  </div>
                  <div className="block-body">
                    <div className="card-row">
                      <div className="grow block-title">{d.title}</div>
                      <span className="mono muted">#{String(arr.length - i).padStart(3, '0')}</span>
                    </div>
                    {d.detail && <div className="small dim">{d.detail}</div>}
                    {d.photo && <img src={d.photo} alt="" loading="lazy" decoding="async" />}
                    <div className="block-hash">
                      <span>HASH <b>{e.hash.slice(0, 24)}…</b></span>
                      <span>PREV {(e.prev_hash ?? '').slice(0, 24)}…</span>
                      <span>{formatDate(e.created_at)}</span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </>
      )}
    </section>
  )
}
