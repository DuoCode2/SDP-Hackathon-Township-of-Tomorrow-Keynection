import { useEffect, useRef, useState } from 'react'
import { BellRing, Camera, Fingerprint, Focus, Hammer, ImagePlus, MapPinOff, ScanSearch, ShieldCheck, Sparkles, Sun, Wrench } from 'lucide-react'
import { api, MAX_PHOTO_BYTES, type Evidence, type Incident, type Photo, type RenovationTask, type UnitInfo, type WarrantyTicket } from '../api'
import { Badge, Card, Empty, formatDate, ScreenTitle, shortRange, Skeleton, useToast } from '../ui'
import CaseView, { SUGGESTION_BADGE } from './CaseView'
import RepairView, { TICKET_BADGE } from './RepairView'

interface Props {
  me: UnitInfo
  version: number
  onChange: () => void
}

const isCeiling = (subject: string) => subject.toLowerCase().startsWith('ceiling')

export default function EvidenceView({ me, version, onChange }: Props) {
  const [data, setData] = useState<Evidence | null>(null)
  const [tickets, setTickets] = useState<WarrantyTicket[]>([])
  const [openCase, setOpenCase] = useState<Incident | null>(null)
  const [openTicket, setOpenTicket] = useState<WarrantyTicket | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([api.evidence(me.id), api.myWarranty(me.id)]).then(([d, t]) => {
      if (!live) return
      setData(d)
      setTickets(t)
    })
    return () => {
      live = false
    }
  }, [me.id, version])

  if (openCase) {
    return <CaseView incident={openCase} onBack={() => setOpenCase(null)} onDecided={(u) => { setOpenCase(u); onChange() }} />
  }
  if (openTicket) {
    return <RepairView me={me} ticket={openTicket} onBack={() => setOpenTicket(null)} onChanged={(u) => { setOpenTicket(u); onChange() }} />
  }

  const tasks = data ? [...data.renovations].sort((a, b) => Number(b.needs_photo) - Number(a.needs_photo)) : []
  const waiting = tickets.filter((t) => t.status === 'repair_submitted')

  return (
    <section className="screen">
      <ScreenTitle eyebrow="Layers 3–4 · Prove & close" title="Evidence"
        subtitle="Pre-work photos are fingerprinted into your home log the moment they're saved. Location and camera data are stripped." />

      {!data && <Card><Skeleton lines={4} /></Card>}

      {waiting.map((t) => (
        <button key={t.id} className="case attention" onClick={() => setOpenTicket(t)}>
          <img src={t.repair_photo?.thumb_url} alt="" loading="lazy" decoding="async" />
          <div className="grow">
            <div className="mono" style={{ color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 6 }}><BellRing size={12} /> ACTION NEEDED</div>
            <div className="card-title" style={{ fontSize: 14 }}>SDP says the repair is done</div>
            <div className="muted small">{t.subject} · only you can close it</div>
          </div>
          {TICKET_BADGE[t.status]}
        </button>
      ))}

      {data && tasks.length === 0 && data.incidents.length === 0 && tickets.length === 0 && (
        <Card>
          <Empty icon={<Camera size={24} />} title="Nothing to photograph yet">
            When a neighbour in your circle registers renovation, you'll be asked for a 5-minute photo of the shared wall or
            ceiling before work starts.
          </Empty>
        </Card>
      )}

      {tasks.length > 0 && <div className="section-label">Renovation next door</div>}
      {tasks.map((t) => <TaskCard key={t.intro_id} me={me} task={t} onChange={onChange} onCase={setOpenCase} />)}

      {data && data.incidents.length > 0 && <div className="section-label">Cases</div>}
      {data?.incidents.map((c) => (
        <button key={c.id} className="case" onClick={() => setOpenCase(c)}>
          <img src={c.images?.overlay ?? c.followup.thumb_url} alt="" loading="lazy" decoding="async" />
          <div className="grow">
            <div className="mono muted">CASE #{String(c.id).padStart(3, '0')}</div>
            <div className="card-title" style={{ fontSize: 14 }}>{c.baseline.subject}</div>
            <div className="muted small">Reported by {c.reporter_label} · {formatDate(c.created_at)}</div>
          </div>
          {c.status === 'decided' ? <Badge tone="brand">Decided</Badge> : SUGGESTION_BADGE[c.hint.suggestion]}
        </button>
      ))}

      {tickets.filter((t) => t.status !== 'repair_submitted').length > 0 && <div className="section-label">Warranty repairs</div>}
      {tickets.filter((t) => t.status !== 'repair_submitted').map((t) => (
        <button key={t.id} className="case" onClick={() => setOpenTicket(t)}>
          <img src={(t.repair_photo ?? t.defect_photo).thumb_url} alt="" loading="lazy" decoding="async" />
          <div className="grow">
            <div className="mono muted"><Wrench size={11} style={{ verticalAlign: -1 }} /> WARRANTY #{String(t.id).padStart(3, '0')}</div>
            <div className="card-title" style={{ fontSize: 14 }}>{t.subject}</div>
            <div className="muted small">Opened {formatDate(t.opened_at)}{t.reopen_count ? ` · rejected ${t.reopen_count}×` : ''}</div>
          </div>
          {TICKET_BADGE[t.status]}
        </button>
      ))}
    </section>
  )
}

function TaskCard({ me, task, onChange, onCase }: {
  me: UnitInfo
  task: RenovationTask
  onChange: () => void
  onCase: (incident: Incident) => void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const baselineInput = useRef<HTMLInputElement>(null)
  const followupInput = useRef<HTMLInputElement>(null)
  const subject = task.suggested_subject
  const ceiling = isCeiling(subject)

  async function run<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
    setBusy(label)
    try {
      return await work()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong', 'error')
    } finally {
      setBusy(null)
    }
  }

  const tooBig = (file: File) => {
    if (file.size > MAX_PHOTO_BYTES) {
      toast('Photo is larger than 12 MB', 'error')
      return true
    }
    return false
  }

  async function saveBaseline(source: File | 'sample') {
    if (source !== 'sample' && tooBig(source)) return
    const photo = await run('Fingerprinting photo', () =>
      source === 'sample'
        ? api.useDemoPhoto(me.id, ceiling ? 'ceiling_before' : 'wall_before', 'baseline', subject, task.intro_id)
        : api.uploadPhoto(me.id, source, 'baseline', subject, task.intro_id),
    )
    if (photo) {
      toast(photo.quality.ok ? 'Pre-work photo sealed in your home log' : 'Saved, but check the photo quality tips')
      onChange()
    }
  }

  async function reportChange(source: File | 'sample-change' | 'sample-same', baseline: Photo) {
    if (source instanceof File && tooBig(source)) return
    const incident = await run('Aligning & comparing', async () => {
      const followup =
        source instanceof File
          ? await api.uploadPhoto(me.id, source, 'followup', subject)
          : await api.useDemoPhoto(me.id, source === 'sample-same' ? 'wall_after_same' : ceiling ? 'ceiling_after_stain' : 'wall_after_crack', 'followup', subject)
      return api.reportIncident(me.id, baseline.id, followup.id)
    })
    if (incident) {
      onChange()
      onCase(incident)
    }
  }

  const r = task.renovation
  return (
    <Card className={task.baseline ? '' : 'alert'}>
      <div className="card-row">
        <div className="grow">
          <div className="card-title"><Hammer size={15} style={{ verticalAlign: -2, color: 'var(--amber)' }} /> {task.from_name} · {task.from_label}</div>
          <div className="small dim">{r.scope} · {shortRange(r.start, r.end)}</div>
        </div>
        {task.needs_photo ? <Badge tone={task.baseline ? 'brand' : 'amber'}>{task.baseline ? 'Sealed' : 'Photo needed'}</Badge> : <Badge>Optional</Badge>}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{subject}</div>

      {busy && <div className="busy"><span className="spinner" /> {busy}…</div>}

      {!task.baseline && !busy && (
        <>
          <div className="tips">
            <div className="tip"><ScanSearch size={15} />Stand 1.5–2 m back so the whole {ceiling ? 'ceiling area' : 'wall'} fits</div>
            <div className="tip"><Focus size={15} />Include a fixed feature: {ceiling ? 'light, fan or vent' : 'corner, socket or switch'}</div>
            <div className="tip"><Sun size={15} />Lights on; avoid flash glare</div>
            <div className="tip"><MapPinOff size={15} />Location data removed automatically</div>
          </div>
          <input ref={baselineInput} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) saveBaseline(f) }} />
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => baselineInput.current?.click()}><Camera size={16} /> Take photo</button>
            <button className="btn" onClick={() => saveBaseline('sample')}><Sparkles size={16} /> Use sample</button>
          </div>
        </>
      )}

      {task.baseline && !busy && (
        <>
          <div className="photo-row">
            <img className="thumb" src={task.baseline.thumb_url} alt="Pre-work photo" loading="lazy" decoding="async" />
            <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="checks">
                <Badge tone={task.baseline.quality.checks.sharp ? 'brand' : 'red'}>Sharp</Badge>
                <Badge tone={task.baseline.quality.checks.well_lit ? 'brand' : 'red'}>Lit</Badge>
                <Badge tone={task.baseline.quality.checks.resolution ? 'brand' : 'red'}>Res</Badge>
              </div>
              <span className="seal"><Fingerprint size={13} /> <span className="mono">{task.baseline.sha256.slice(0, 16)}…</span></span>
              <span className="seal"><ShieldCheck size={13} /> Sealed {formatDate(task.baseline.created_at)} · stays with you</span>
            </div>
          </div>
          <div className="small muted">Spotted a new crack or stain? Photograph the same spot again; we'll align and compare.</div>
          <input ref={followupInput} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) reportChange(f, task.baseline!) }} />
          <div className="btn-row">
            <button className="btn" onClick={() => followupInput.current?.click()}><ImagePlus size={16} /> Follow-up</button>
            <button className="btn" onClick={() => reportChange('sample-change', task.baseline!)}><Sparkles size={16} /> Sample {ceiling ? 'stain' : 'crack'}</button>
          </div>
          {!ceiling && <button className="link" onClick={() => reportChange('sample-same', task.baseline!)}>Try a sample with no change</button>}
        </>
      )}
    </Card>
  )
}
