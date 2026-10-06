import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ClipboardPen, Eye, KeyRound, Printer, QrCode, Send, UserCheck } from 'lucide-react'
import { api, type FrontDesk as Desk, type PaperNotice, type UnitInfo } from '../api'
import { EnglishOnly } from '../i18n'
import { joinKey } from '../screens/JoinView'
import RenovationWizard from '../screens/RenovationWizard'
import { Badge, Card, CardHead, Empty, formatDate, Sheet, shortRange, Skeleton, useToast } from '../ui'
import PaperNoticeSheet from './PaperNotice'

const STAFF = 'jiran5.staff'
function storedStaff(): string {
  try {
    return localStorage.getItem(STAFF) || 'Aishah'
  } catch {
    return 'Aishah'
  }
}

const PAPER_BADGE: Record<PaperNotice['status'], { tone: 'amber' | 'blue' | 'brand' | 'neutral'; label: string }> = {
  to_print: { tone: 'amber', label: 'To print' },
  printed: { tone: 'blue', label: 'Printed' },
  delivered: { tone: 'brand', label: 'Delivered' },
  superseded: { tone: 'neutral', label: 'Now in the app' },
}

/** The estate office counter: join codes at handover, paper notices, and help for owners who aren't online. */
export default function FrontDesk({ version, onChange, onViewAs }: { version: number; onChange: () => void; onViewAs?: (unitId: string) => void }) {
  const toast = useToast()
  const [desk, setDesk] = useState<Desk | null>(null)
  const [units, setUnits] = useState<UnitInfo[]>([])
  const [staff, setStaff] = useState(storedStaff)
  const [code, setCode] = useState<{ unit: string; label: string; token: string; expires: string; qr: string } | null>(null)
  const [printing, setPrinting] = useState<PaperNotice | null>(null)
  const [owner, setOwner] = useState('T-20')
  const [signed, setSigned] = useState(false)
  const [wizard, setWizard] = useState(false)

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
    try { localStorage.setItem(STAFF, v) } catch { /* private window */ }
  }
  const staffOk = staff.trim().length >= 2

  async function issue(unit: string, label: string) {
    try {
      const r = await api.issueJoinCode(unit)
      // The QR carries only the code; the join page asks for nothing until the owner opens it.
      const qr = await QRCode.toDataURL(`J5JOIN:${r.token}`, { margin: 1, width: 280, errorCorrectionLevel: 'M', color: { dark: '#0b1220', light: '#ffffff' } })
      setCode({ unit, label, token: r.token, expires: r.expires_at, qr })
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not issue a code', 'error')
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
      toast(s === 'delivered' ? `Delivery to ${n.unit_label} recorded in both home logs` : 'Marked as printed')
      onChange()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update', 'error')
    }
  }

  if (!desk) return <Card><Skeleton lines={5} /></Card>
  const owners = units.filter((u) => u.joined)
  const ownerUnit = units.find((u) => u.id === owner)
  const names = Object.fromEntries(units.map((u) => [u.id, u.resident_name]))

  return (
    <>
      <Card>
        <CardHead icon={<UserCheck size={16} />} tone="blue" title="Front desk" sub={`${desk.joined} of ${desk.households} households have joined. Staff actions are recorded under your name.`} />
        <label className="field">Staff on duty
          <input value={staff} maxLength={40} onChange={(e) => saveStaff(e.target.value)} />
        </label>
      </Card>

      <Card>
        <CardHead icon={<KeyRound size={16} />} title="Handover · join codes" sub="One-time code for the welcome pack. Valid 14 days; a new code cancels the old one." />
        {desk.not_joined.length === 0 ? <div className="small muted">Every household has joined.</div> : desk.not_joined.map((u) => (
          <div key={u.id} className="desk-row">
            <span className="unit-chip">{u.label.replace('No. ', '')}</span>
            <span className="grow"><b>{u.label}</b><small>{u.code_expires_at ? `Code issued · valid until ${formatDate(u.code_expires_at)}` : 'No code yet'}</small></span>
            <button className="btn btn-sm" onClick={() => issue(u.id, u.label)}><QrCode size={14} /> {u.code_expires_at ? 'New code' : 'Issue code'}</button>
          </div>
        ))}
      </Card>

      <Card>
        <CardHead icon={<Printer size={16} />} title="Paper notices" sub="Renovation notices for households not on Jiran5. Delivery goes into both home logs." />
        {desk.paper_notices.length === 0 ? (
          <Empty art="inbox" title="Nothing to deliver">When a renovation notice includes a household that hasn't joined, it appears here to print.</Empty>
        ) : desk.paper_notices.map((n) => (
          <div key={n.id} className="desk-row paper-row">
            <span className="grow">
              <b>To {n.unit_label} · from {n.from_name} ({n.from_label})</b>
              <small>{n.renovation ? `${n.renovation.scope} · ${shortRange(n.renovation.start, n.renovation.end)}` : 'Notice'}{n.delivered_by ? ` · ${n.delivered_by}` : ''}</small>
            </span>
            <Badge tone={PAPER_BADGE[n.status].tone}>{PAPER_BADGE[n.status].label}</Badge>
            {(n.status === 'to_print' || n.status === 'printed') && (
              <span className="btn-row">
                <button className="btn btn-sm" onClick={() => setPrinting(n)}><Printer size={14} /> Print</button>
                <button className="btn btn-sm btn-primary" disabled={!staffOk} onClick={() => step(n, 'delivered')}><Send size={14} /> Delivered</button>
              </span>
            )}
          </div>
        ))}
      </Card>

      <Card>
        <CardHead icon={<ClipboardPen size={16} />} title="Register a renovation for an owner" sub="For owners who prefer paper. Same rules as the app: everyone affected is told, and your name goes on record." />
        <div className="grid-2">
          <label className="field">Owner
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              {owners.map((u) => <option key={u.id} value={u.id}>{u.label} · {u.resident_name}</option>)}
            </select>
          </label>
          <label className="switch-row consent desk-signed"><input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} /> The owner signed the paper renovation form</label>
        </div>
        <button className="btn btn-sm btn-primary" disabled={!signed || !staffOk || !ownerUnit} onClick={() => setWizard(true)}><ClipboardPen size={14} /> Open the form</button>
        <div className="small muted">Households that haven't joined must join first: Jiran5 needs their consent before it holds their renovation.</div>
      </Card>

      {code && (
        <Sheet open onClose={() => setCode(null)}>
          <div className="eyebrow">Join code · {code.label}</div>
          <div className="pass-qr"><img src={code.qr} alt={`Join code for ${code.label}`} /></div>
          <div className="small muted">Shown once: print it into the welcome pack. Valid once, until {formatDate(code.expires)}.</div>
          <button className="btn btn-primary btn-block" onClick={openAsResident}><Eye size={15} /> Open the join page as {code.label} (demo)</button>
        </Sheet>
      )}
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
