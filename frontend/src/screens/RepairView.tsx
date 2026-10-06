import { useState, type ReactNode } from 'react'
import { ChevronLeft, CircleCheck, CircleX, HelpCircle, ThumbsDown, ThumbsUp } from 'lucide-react'
import { api, type UnitInfo, type WarrantyTicket } from '../api'
import Compare from '../components/Compare'
import WarrantyClock from '../components/WarrantyClock'
import { useHelper } from '../helper'
import { Badge, Card, formatDate, useToast } from '../ui'

export const TICKET_BADGE: Record<WarrantyTicket['status'], ReactNode> = {
  open: <Badge tone="blue">With SDP</Badge>,
  repair_submitted: <Badge tone="amber">Confirm</Badge>,
  closed: <Badge tone="brand">Closed</Badge>,
}

export default function RepairView({ me, ticket, onBack, onChanged }: {
  me: UnitInfo
  ticket: WarrantyTicket
  onBack: () => void
  onChanged: (t: WarrantyTicket) => void
}) {
  const t = ticket
  const check = t.repair_check
  const isOwner = t.unit_id === me.id

  return (
    <section className="screen">
      <button className="back" onClick={onBack}><ChevronLeft size={18} /> Evidence</button>
      <div className="screen-title">
        <div className="eyebrow">Warranty #{String(t.id).padStart(3, '0')}{t.procore_ref ? ` · Procore ${t.procore_ref}` : ''}</div>
        <h1>{t.subject}</h1>
        <p>{t.unit_label} · opened {formatDate(t.opened_at)}{t.subcontractor ? ` · repaired by ${t.subcontractor}` : ''}</p>
      </div>

      <div className="cols">
      <div className="col">
      <div className="triptych">
        <figure>{t.baseline_photo ? <img src={t.baseline_photo.thumb_url} alt="" /> : <div className="thumb" />}<figcaption>Pre-work</figcaption></figure>
        <figure><img src={t.defect_photo.thumb_url} alt="" /><figcaption>Damage</figcaption></figure>
        <figure>{t.repair_photo ? <img src={t.repair_photo.thumb_url} alt="" /> : <div className="thumb" style={{ width: '100%', aspectRatio: '4/3' }} />}<figcaption>Repair</figcaption></figure>
      </div>

      {check && t.status === 'open' && <div className="section-label">Last attempt · rejected</div>}
      {check && t.images && (
        <Compare before={t.images.before} after={t.images.after} overlay={t.images.overlay} regions={check.regions}
          scan={t.status === 'repair_submitted'} leftLabel="Pre-work" rightLabel="After repair" />
      )}
      </div>

      <div className="col sticky">
      <WarrantyClock clock={t.clock} closed={t.status === 'closed'} />
      {t.status === 'open' && (
        <Card>
          <div className="card-title">Waiting for SDP's repair</div>
          <div className="small dim">
            {t.reopen_count
              ? `You rejected the last repair (${t.owner_note || 'no note'}). SDP has been asked to fix it again.`
              : 'SDP\'s warranty team has the ticket with your photos. When they submit a repair photo, you decide whether it\'s done.'}
          </div>
        </Card>
      )}

      {check && (
        <div className={`verdict ${check.verdict === 'restored' ? 'ok' : check.verdict === 'still_changed' ? 'bad' : 'unk'}`}>
          {check.verdict === 'restored' ? <CircleCheck size={26} /> : check.verdict === 'still_changed' ? <CircleX size={26} /> : <HelpCircle size={26} />}
          <div>
            <strong>
              {check.verdict === 'restored' ? 'Matches the pre-work photo' : check.verdict === 'still_changed' ? `${check.regions.length} mark(s) still visible` : 'Could not verify automatically'}
            </strong>
            <span>Repair photo compared with the {check.compared_with}. You still decide.</span>
          </div>
        </div>
      )}

      {t.status === 'repair_submitted' && (isOwner ? <OwnerDecision me={me} ticket={t} onChanged={onChanged} /> : (
        <Card><div className="small dim">Only the homeowner ({t.unit_label}) can confirm or reject this repair.</div></Card>
      ))}

      {t.status === 'closed' && (
        <Card className="glow">
          <div className="card-row">
            <CircleCheck size={22} color="var(--accent)" />
            <div className="grow">
              <div className="card-title">Closed by the homeowner</div>
              <div className="muted small">{formatDate(t.closed_at!)} · written to the home log{t.reopen_count ? ` · after ${t.reopen_count} rejection(s)` : ''}</div>
            </div>
          </div>
          {t.owner_note && <div className="small dim">“{t.owner_note}”</div>}
        </Card>
      )}
      </div>
      </div>
    </section>
  )
}

function OwnerDecision({ me, ticket, onChanged }: { me: UnitInfo; ticket: WarrantyTicket; onChanged: (t: WarrantyTicket) => void }) {
  const toast = useToast()
  const helper = useHelper(me.id)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function respond(decision: 'accept' | 'reject') {
    if (decision === 'reject' && !note.trim()) {
      toast('Say what is still wrong so SDP can fix it', 'error')
      return
    }
    setSaving(true)
    try {
      const updated = await api.respondToRepair(ticket.id, me.id, decision, note, helper?.id)
      toast(decision === 'accept' ? 'Repair accepted: ticket closed' : 'Sent back to SDP with your note')
      onChanged(updated)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="alert">
      <div className="card-title">Is the repair done?</div>
      <div className="small dim">SDP can't close this ticket; only you can. Your answer is fingerprinted into your home log.</div>
      <textarea className="input" rows={2} maxLength={300} placeholder="Note (required if rejecting), e.g. crack still visible near the socket"
        value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="btn-row">
        <button className="btn btn-danger" onClick={() => respond('reject')} disabled={saving}><ThumbsDown size={16} /> Not fixed</button>
        <button className="btn btn-primary" onClick={() => respond('accept')} disabled={saving}><ThumbsUp size={16} /> Accept</button>
      </div>
    </Card>
  )
}
