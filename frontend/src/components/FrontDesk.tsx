import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ClipboardPen, Eye, KeyRound, Printer, QrCode, Send, Smartphone, UserCheck, UserPlus, UserX } from 'lucide-react'
import { api, type FrontDesk as Desk, type PaperNotice, type UnitInfo, type WelcomeCard } from '../api'
import { EnglishOnly, useDates, useT } from '../i18n'
import { usePilot } from '../features'
import { joinKey } from '../screens/JoinView'
import RenovationWizard from '../screens/RenovationWizard'
import { Badge, Card, CardHead, Empty, Sheet, Skeleton, useToast } from '../ui'
import PaperNoticeSheet from './PaperNotice'
import WelcomeSheet from './WelcomeSheet'
import { NotificationsCard } from './Notifications'
import { remember, remembered } from '../storage'

function storedStaff(): string {
  return remembered('staff') || 'Aishah'
}

// The label is a key in i18n-sdp-fd.ts, looked up with t inside the component.
const PAPER_BADGE: Record<PaperNotice['status'], { tone: 'amber' | 'blue' | 'brand' | 'neutral'; label: string }> = {
  to_print: { tone: 'amber', label: 'sdp.fd.badge.toPrint' },
  printed: { tone: 'blue', label: 'sdp.fd.badge.printed' },
  delivered: { tone: 'brand', label: 'sdp.fd.badge.delivered' },
  superseded: { tone: 'neutral', label: 'sdp.fd.badge.inApp' },
}

/** The estate office counter: join codes at handover, paper notices, and help for owners who aren't online. */
export default function FrontDesk({ version, onChange, onViewAs }: { version: number; onChange: () => void; onViewAs?: (unitId: string) => void }) {
  const t = useT()
  const { date, range } = useDates()
  const toast = useToast()
  const pilot = usePilot()
  const [desk, setDesk] = useState<Desk | null>(null)
  const [units, setUnits] = useState<UnitInfo[]>([])
  const [typedStaff, setStaff] = useState(storedStaff)
  // Pilot: records are signed with the signed-in staff member's own name (the server checks it).
  const staff = pilot?.me.name ?? typedStaff
  const [code, setCode] = useState<{ kind: 'join' | 'reentry' | 'staff'; unit: string; label: string; token: string; expires: string; qr: string } | null>(null)
  const [printing, setPrinting] = useState<PaperNotice | null>(null)
  const [owner, setOwner] = useState(pilot ? '' : 'T-20')
  const [lost, setLost] = useState('')
  const [colleague, setColleague] = useState('')
  const [role, setRole] = useState<'estate' | 'sdp'>('estate')
  const [signed, setSigned] = useState(false)
  const [wizard, setWizard] = useState(false)
  // Pilot: welcome-pack cards for every home still to join, or those whose keys are handed over in a date range.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [confirmPacks, setConfirmPacks] = useState(false)
  // Pilot: an owner asks at the counter to close their account (after an ID check).
  const [closing, setClosing] = useState('')
  const [idChecked, setIdChecked] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [sheet, setSheet] = useState<{ phase: string; codes: WelcomeCard[] } | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([api.frontDesk(), api.units()]).then(([d, u]) => {
      if (!live) return
      setDesk(d)
      setUnits(u)
    }).catch(() => live && setDesk(null))
    return () => {
      live = false
    }
  }, [version])

  const saveStaff = (v: string) => {
    setStaff(v)
    remember('staff', v)
  }
  const staffOk = staff.trim().length >= 2

  // A QR the phone's camera opens straight away: Keynection's address with the one-time code, nothing else.
  const qrFor = (param: 'join' | 'code', token: string) =>
    QRCode.toDataURL(`${window.location.origin}/?${param}=${token}`, { margin: 1, width: 280, errorCorrectionLevel: 'M', color: { dark: '#0b1220', light: '#ffffff' } })

  async function issue(unit: string, label: string) {
    try {
      const r = await api.issueJoinCode(unit)
      setCode({ kind: 'join', unit, label, token: r.token, expires: r.expires_at, qr: await qrFor('join', r.token) })
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('sdp.fd.toast.issue'), 'error')
    }
  }

  // A household lost its phone: after checking ID, a one-time code that retires every old key of that home.
  async function reentry() {
    const unit = units.find((u) => u.id === lost)
    if (!unit) return
    try {
      const r = await api.reentryCode(unit.id)
      setCode({ kind: 'reentry', unit: unit.id, label: unit.label, token: r.token, expires: r.expires_at, qr: await qrFor('code', r.token) })
      setLost('')
    } catch (e) {
      toast(e instanceof Error ? e.message : t('sdp.fd.toast.issue'), 'error')
    }
  }

  async function addColleague() {
    try {
      const r = await api.addStaff(colleague.trim(), role)
      setCode({ kind: 'staff', unit: '', label: colleague.trim(), token: r.token, expires: r.expires_at, qr: await qrFor('code', r.token) })
      setColleague('')
    } catch (e) {
      toast(e instanceof Error ? e.message : t('sdp.fd.toast.colleague'), 'error')
    }
  }

  function openAsResident() {
    if (!code) return
    try { sessionStorage.setItem(joinKey(code.unit), code.token) } catch { /* private window */ }
    setCode(null)
    onViewAs?.(code.unit)
  }

  async function step(n: PaperNotice, s: 'printed' | 'delivered') {
    try {
      await api.paperStep(n.id, s, staff.trim())
      toast(s === 'delivered' ? t('sdp.fd.toast.delivered', { label: n.unit_label }) : t('sdp.fd.toast.printed'))
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('sdp.fd.toast.update'), 'error')
    }
  }

  async function makePacks() {
    setConfirmPacks(false)
    try {
      const r = await api.welcomeSheet(from || undefined, to || undefined)
      setSheet(r)
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('sdp.fd.toast.cards'), 'error')
    }
  }

  async function closeAccount() {
    const unit = units.find((u) => u.id === closing)
    if (!unit) return
    try {
      await api.estateCloseAccount(unit.id, staff.trim(), idChecked)
      toast(t('sdp.fd.toast.closed', { label: unit.label }))
      setClosing('')
      setIdChecked(false)
      setConfirmClose(false)
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('sdp.fd.toast.close'), 'error')
    }
  }

  if (!desk) return <Card><Skeleton lines={5} /></Card>
  const packs = units.filter((u) => !u.joined && (!from || u.handover_date >= from) && (!to || u.handover_date <= to)).length
  const owners = units.filter((u) => u.joined)
  const ownerUnit = units.find((u) => u.id === (owner || owners[0]?.id))
  const names = Object.fromEntries(units.map((u) => [u.id, u.resident_name]))
  // The staff name sits in bold inside the sentence, wherever the language puts it.
  const [signedBefore, signedAfter] = t('sdp.fd.signedIn', { staff: '\u0000' }).split('\u0000')

  return (
    <>
      <Card>
        <CardHead icon={<UserCheck size={16} />} tone="blue" title={t('sdp.fd.title')} sub={t('sdp.fd.sub', { joined: desk.joined, n: desk.households })} />
        {pilot ? <div className="small">{signedBefore}<b>{staff}</b>{signedAfter}</div> : (
          <label className="field">{t('sdp.fd.onDuty')}
            <input value={typedStaff} maxLength={40} onChange={(e) => saveStaff(e.target.value)} />
          </label>
        )}
      </Card>
      {pilot && <NotificationsCard staff />}

      {pilot && (
        <Card>
          <CardHead icon={<Printer size={16} />} title={t('sdp.fd.packs.title')}
            sub={t('sdp.fd.packs.sub')} />
          <div className="grid-2">
            <label className="field">{t('sdp.fd.packs.from')}<input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setConfirmPacks(false) }} /></label>
            <label className="field">{t('sdp.fd.packs.until')}<input type="date" value={to} onChange={(e) => { setTo(e.target.value); setConfirmPacks(false) }} /></label>
          </div>
          {confirmPacks ? (
            <div className="confirm-row">
              <span className="small">{t('sdp.fd.packs.confirm', { n: packs })}</span>
              <span className="btn-row">
                <button className="btn btn-sm btn-primary" onClick={makePacks}><Printer size={14} /> {t('sdp.fd.packs.make', { n: packs })}</button>
                <button className="btn btn-sm" onClick={() => setConfirmPacks(false)}>{t('btn.cancel')}</button>
              </span>
            </div>
          ) : (
            <button className="btn btn-sm btn-primary" disabled={packs === 0} onClick={() => setConfirmPacks(true)}>
              <Printer size={14} /> {packs === 0 ? t('sdp.fd.packs.none') : t('sdp.fd.packs.button', { n: packs })}
            </button>
          )}
        </Card>
      )}

      <Card>
        <CardHead icon={<KeyRound size={16} />} title={t('sdp.fd.join.title')} sub={t('sdp.fd.join.sub')} />
        {desk.not_joined.length === 0 ? <div className="small muted">{t('sdp.fd.join.all')}</div> : desk.not_joined.map((u) => (
          <div key={u.id} className="desk-row">
            <span className="unit-chip">{u.label.replace('No. ', '')}</span>
            <span className="grow"><b>{u.label}</b><small>{u.code_expires_at ? t('sdp.fd.join.issued', { date: date(u.code_expires_at) }) : t('sdp.fd.join.none')}</small></span>
            <button className="btn btn-sm" onClick={() => issue(u.id, u.label)}><QrCode size={14} /> {t(u.code_expires_at ? 'sdp.fd.join.new' : 'sdp.fd.join.issue')}</button>
          </div>
        ))}
      </Card>

      <Card>
        <CardHead icon={<Printer size={16} />} title={t('sdp.fd.paper.title')} sub={t('sdp.fd.paper.sub')} />
        {desk.paper_notices.length === 0 ? (
          <Empty art="inbox" title={t('sdp.fd.paper.emptyTitle')}>{t('sdp.fd.paper.emptyBody')}</Empty>
        ) : desk.paper_notices.map((n) => (
          <div key={n.id} className="desk-row paper-row">
            <span className="grow">
              <b>{t('sdp.fd.paper.row', { label: n.unit_label, name: n.from_name, from: n.from_label })}</b>
              <small>{n.renovation ? `${n.renovation.scope} · ${range(n.renovation.start, n.renovation.end)}` : t('sdp.fd.paper.notice')}{n.delivered_by ? ` · ${n.delivered_by}` : ''}</small>
            </span>
            <Badge tone={PAPER_BADGE[n.status].tone}>{t(PAPER_BADGE[n.status].label)}</Badge>
            {(n.status === 'to_print' || n.status === 'printed') && (
              <span className="btn-row">
                <button className="btn btn-sm" onClick={() => setPrinting(n)}><Printer size={14} /> {t('sdp.fd.paper.print')}</button>
                <button className="btn btn-sm btn-primary" disabled={!staffOk} onClick={() => step(n, 'delivered')}><Send size={14} /> {t('sdp.fd.paper.delivered')}</button>
              </span>
            )}
          </div>
        ))}
      </Card>

      <Card>
        <CardHead icon={<ClipboardPen size={16} />} title={t('sdp.fd.reno.title')} sub={t('sdp.fd.reno.sub')} />
        <div className="grid-2">
          <label className="field">{t('sdp.ch.app.owner')}
            <select value={ownerUnit?.id ?? ''} onChange={(e) => setOwner(e.target.value)}>
              {owners.map((u) => <option key={u.id} value={u.id}>{u.label} · {u.resident_name}</option>)}
            </select>
          </label>
          <label className="switch-row consent desk-signed"><input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} /> {t('sdp.fd.reno.signed')}</label>
        </div>
        <button className="btn btn-sm btn-primary" disabled={!signed || !staffOk || !ownerUnit} onClick={() => setWizard(true)}><ClipboardPen size={14} /> {t('sdp.fd.reno.open')}</button>
        <div className="small muted">{t('sdp.fd.reno.mustJoin')}</div>
      </Card>

      {pilot && (
        <Card>
          <CardHead icon={<Smartphone size={16} />} title={t('sdp.fd.lost.title')} sub={t('sdp.fd.lost.sub')} />
          <div className="grid-2">
            <label className="field">{t('sdp.fd.household')}
              <select value={lost} onChange={(e) => setLost(e.target.value)}>
                <option value="">{t('reno.choose')}</option>
                {owners.map((u) => <option key={u.id} value={u.id}>{u.label}{u.resident_name ? ` · ${u.resident_name}` : ''}</option>)}
              </select>
            </label>
            <button className="btn btn-sm btn-primary desk-signed" disabled={!lost} onClick={reentry}><KeyRound size={14} /> {t('sdp.fd.lost.issue')}</button>
          </div>
        </Card>
      )}
      {pilot && (
        <Card>
          <CardHead icon={<UserX size={16} />} tone="red" title={t('sdp.fd.close.title')}
            sub={t('sdp.fd.close.sub')} />
          <div className="grid-2">
            <label className="field">{t('sdp.fd.household')}
              <select value={closing} onChange={(e) => { setClosing(e.target.value); setConfirmClose(false) }}>
                <option value="">{t('reno.choose')}</option>
                {owners.map((u) => <option key={u.id} value={u.id}>{u.label}{u.resident_name ? ` · ${u.resident_name}` : ''}</option>)}
              </select>
            </label>
            <label className="switch-row consent desk-signed"><input type="checkbox" checked={idChecked} onChange={(e) => setIdChecked(e.target.checked)} /> {t('sdp.fd.close.idChecked')}</label>
          </div>
          {confirmClose ? (
            <div className="confirm-row">
              <span className="small">{t('sdp.fd.close.confirm')}</span>
              <span className="btn-row">
                <button className="btn btn-sm btn-danger" onClick={closeAccount}><UserX size={14} /> {t('sdp.fd.close.button')}</button>
                <button className="btn btn-sm" onClick={() => setConfirmClose(false)}>{t('btn.cancel')}</button>
              </span>
            </div>
          ) : (
            <button className="btn btn-sm" disabled={!closing || !idChecked} onClick={() => setConfirmClose(true)}><UserX size={14} /> {t('sdp.fd.close.open')}</button>
          )}
        </Card>
      )}
      {pilot && (
        <Card>
          <CardHead icon={<UserPlus size={16} />} title={t('sdp.fd.colleague.title')} sub={t('sdp.fd.colleague.sub')} />
          <div className="grid-2">
            <label className="field">{t('helpers.name')}<input value={colleague} maxLength={40} onChange={(e) => setColleague(e.target.value)} /></label>
            <label className="field">{t('sdp.fd.colleague.role')}
              <select value={role} onChange={(e) => setRole(e.target.value as 'estate' | 'sdp')}>
                <option value="estate">{t('sdp.fd.colleague.estate')}</option>
                <option value="sdp">SDP</option>
              </select>
            </label>
          </div>
          <button className="btn btn-sm btn-primary" disabled={colleague.trim().length < 2} onClick={addColleague}><UserPlus size={14} /> {t('sdp.fd.colleague.add')}</button>
        </Card>
      )}

      {code && (
        <Sheet open onClose={() => setCode(null)}>
          <div className="eyebrow">{t(code.kind === 'join' ? 'join.paste' : code.kind === 'reentry' ? 'sdp.fd.code.reentry' : 'sdp.fd.code.staff')} · {code.label}</div>
          <div className="pass-qr"><img src={code.qr} alt={t('sdp.fd.code.alt', { label: code.label })} /></div>
          <div className="small muted">
            {t(code.kind === 'join' ? 'sdp.fd.code.shownJoin' : 'sdp.fd.code.shownScan')}
            {t('sdp.fd.code.valid', { date: date(code.expires) })}
          </div>
          {pilot && <div className="mono small code-text">{code.token}</div>}
          {!pilot && code.kind === 'join' && <button className="btn btn-primary btn-block" onClick={openAsResident}><Eye size={15} /> {t('sdp.fd.code.openAs', { label: code.label })}</button>}
        </Sheet>
      )}
      {sheet && <WelcomeSheet phase={sheet.phase} cards={sheet.codes} onClose={() => setSheet(null)} />}
      {printing && <PaperNoticeSheet notice={printing} onClose={() => setPrinting(null)}
        onPrinted={() => { if (printing.status === 'to_print' && staffOk) step(printing, 'printed') }} />}
      {wizard && ownerUnit && (
        <EnglishOnly>
          <RenovationWizard open onClose={() => setWizard(false)} me={ownerUnit} units={units} names={names}
            estate={{ staff: staff.trim() }} onSent={() => { setSigned(false); onChange() }} />
        </EnglishOnly>
      )}
    </>
  )
}
