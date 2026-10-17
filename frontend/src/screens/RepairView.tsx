import { useState, type ReactNode } from 'react'
import { ChevronLeft, CircleCheck, CircleX, HelpCircle, ThumbsDown, ThumbsUp } from 'lucide-react'
import { api, type UnitInfo, type WarrantyTicket } from '../api'
import Compare from '../components/Compare'
import WarrantyClock from '../components/WarrantyClock'
import { useHelper } from '../helper'
import { subjectText, useDates, useT, type Translate } from '../i18n'
import { Badge, Card, useToast } from '../ui'

const TICKET_TONE: Record<WarrantyTicket['status'], 'blue' | 'amber' | 'brand'> = { open: 'blue', repair_submitted: 'amber', closed: 'brand' }

export function ticketBadge(t: Translate, status: WarrantyTicket['status']): ReactNode {
  return <Badge tone={TICKET_TONE[status]}>{t(`tk.${status}`)}</Badge>
}

export default function RepairView({ me, ticket, onBack, onChanged }: {
  me: UnitInfo
  ticket: WarrantyTicket
  onBack: () => void
  onChanged: (t: WarrantyTicket) => void
}) {
  const t = useT()
  const { date } = useDates()
  const w = ticket
  const check = w.repair_check
  const isOwner = w.unit_id === me.id

  return (
    <section className="screen">
      <button className="back" onClick={onBack}><ChevronLeft size={18} /> {t('nav.evidence')}</button>
      <div className="screen-title">
        <div className="eyebrow">{t('ev.warrantyNo', { n: String(w.id).padStart(3, '0') })}{w.procore_ref ? ` · ${t(w.procore_demo ? 'ev.procoreDemo' : 'ev.procore', { ref: w.procore_ref })}` : ''}</div>
        <h1>{subjectText(t, w.subject)}</h1>
        <p>{t('rp.opened', { label: w.unit_label, date: date(w.opened_at) })}{w.subcontractor ? t('rp.repairedBy', { who: w.subcontractor }) : ''}</p>
      </div>

      <div className="cols">
      <div className="col">
      <div className="triptych">
        <figure>{w.baseline_photo ? <img src={w.baseline_photo.thumb_url} alt="" /> : <div className="thumb" />}<figcaption>{t('case.preWork')}</figcaption></figure>
        <figure><img src={w.defect_photo.thumb_url} alt="" /><figcaption>{t('rp.damage')}</figcaption></figure>
        <figure>{w.repair_photo ? <img src={w.repair_photo.thumb_url} alt="" /> : <div className="thumb" style={{ width: '100%', aspectRatio: '4/3' }} />}<figcaption>{t('rp.repair')}</figcaption></figure>
      </div>

      {check && w.status === 'open' && <div className="section-label">{t('rp.lastRejected')}</div>}
      {check && w.images && (
        <Compare before={w.images.before} after={w.images.after} overlay={w.images.overlay} regions={check.regions}
          scan={w.status === 'repair_submitted'} leftLabel={t('case.preWork')} rightLabel={t('rp.afterRepair')} />
      )}
      </div>

      <div className="col sticky">
      <WarrantyClock clock={w.clock} closed={w.status === 'closed'} />
      {w.status === 'open' && (
        <Card>
          <div className="card-title">{t('rp.waiting')}</div>
          <div className="small dim">
            {w.reopen_count ? t('rp.waitingRejected', { note: w.owner_note || t('rp.noNote') }) : t('rp.waitingFirst')}
          </div>
        </Card>
      )}

      {check && (
        <div className={`verdict ${check.verdict === 'restored' ? 'ok' : check.verdict === 'still_changed' ? 'bad' : 'unk'}`}>
          {check.verdict === 'restored' ? <CircleCheck size={26} /> : check.verdict === 'still_changed' ? <CircleX size={26} /> : <HelpCircle size={26} />}
          <div>
            <strong>
              {check.verdict === 'restored' ? t('rp.matches') : check.verdict === 'still_changed' ? t('rp.stillMarks', { n: check.regions.length }) : t('rp.unverified')}
            </strong>
            <span>{t(check.compared_with === 'pre-work photo' ? 'rp.comparedPre' : 'rp.comparedDefect')}</span>
          </div>
        </div>
      )}

      {w.status === 'repair_submitted' && (isOwner ? <OwnerDecision me={me} ticket={w} onChanged={onChanged} /> : (
        <Card><div className="small dim">{t('rp.onlyOwner', { label: w.unit_label })}</div></Card>
      ))}

      {w.status === 'closed' && (
        <Card className="glow">
          <div className="card-row">
            <CircleCheck size={22} color="var(--accent)" />
            <div className="grow">
              <div className="card-title">{t('rp.closedByOwner')}</div>
              <div className="muted small">{t('rp.closedMeta', { date: date(w.closed_at!) })}{w.reopen_count ? t('rp.afterRejections', { n: w.reopen_count }) : ''}</div>
            </div>
          </div>
          {w.owner_note && <div className="small dim">“{w.owner_note}”</div>}
        </Card>
      )}
      </div>
      </div>
    </section>
  )
}

function OwnerDecision({ me, ticket, onChanged }: { me: UnitInfo; ticket: WarrantyTicket; onChanged: (t: WarrantyTicket) => void }) {
  const t = useT()
  const toast = useToast()
  const helper = useHelper(me.id)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function respond(decision: 'accept' | 'reject') {
    if (decision === 'reject' && !note.trim()) {
      toast(t('rp.sayWhat'), 'error')
      return
    }
    setSaving(true)
    try {
      const updated = await api.respondToRepair(ticket.id, me.id, decision, note, helper?.id)
      toast(t(decision === 'accept' ? 'rp.accepted' : 'rp.sentBack'))
      onChanged(updated)
    } catch (e) {
      toast(e instanceof Error ? e.message : t('df.couldNotSave'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="alert">
      <div className="card-title">{t('rp.isDone')}</div>
      <div className="small dim">{t('rp.onlyYou')}</div>
      <textarea className="input" rows={2} maxLength={300} placeholder={t('rp.notePh')}
        value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="btn-row">
        <button className="btn btn-danger" onClick={() => respond('reject')} disabled={saving}><ThumbsDown size={16} /> {t('rp.notFixed')}</button>
        <button className="btn btn-primary" onClick={() => respond('accept')} disabled={saving}><ThumbsUp size={16} /> {t('rp.accept')}</button>
      </div>
    </Card>
  )
}
