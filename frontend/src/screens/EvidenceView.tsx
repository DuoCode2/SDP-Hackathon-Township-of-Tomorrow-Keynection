import { useEffect, useRef, useState } from 'react'
import { BellRing, Camera, FileSearch, Fingerprint, Focus, Hammer, ImagePlus, MapPinOff, ScanSearch, ShieldCheck, Sparkles, Sun, Wrench } from 'lucide-react'
import { api, MAX_PHOTO_BYTES, type Evidence, type Incident, type Photo, type RenovationTask, type UnitInfo, type WarrantyTicket } from '../api'
import { subjectText, useDates, useT } from '../i18n'
import { Badge, Card, CardHead, Empty, Metric, ScreenTitle, Skeleton, useToast } from '../ui'
import CaseView, { caseBadge, caseRole } from './CaseView'
import RepairView, { ticketBadge } from './RepairView'
import WarrantyClock from '../components/WarrantyClock'
import { usePilot } from '../features'

interface Props {
  me: UnitInfo
  version: number
  onChange: () => void
}

const isCeiling = (subject: string) => subject.toLowerCase().startsWith('ceiling')

export default function EvidenceView({ me, version, onChange }: Props) {
  const t = useT()
  const { date } = useDates()
  const [data, setData] = useState<Evidence | null>(null)
  const [tickets, setTickets] = useState<WarrantyTicket[]>([])
  const [openCase, setOpenCase] = useState<Incident | null>(null)
  const [openTicket, setOpenTicket] = useState<WarrantyTicket | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([api.evidence(me.id), api.myWarranty(me.id)]).then(([d, w]) => {
      if (!live) return
      setData(d)
      setTickets(w)
      // The case or ticket open on screen is read again from the fresh lists, so a change made on the other
      // side of the wall shows here at once (every pane reloads after a write); one that is gone closes.
      setOpenCase((c) => (c ? d.incidents.find((x) => x.id === c.id) ?? null : null))
      setOpenTicket((x) => (x ? w.find((y) => y.id === x.id) ?? null : null))
    })
    return () => {
      live = false
    }
  }, [me.id, version])

  if (openCase) {
    return <CaseView me={me} incident={openCase} onBack={() => setOpenCase(null)} onDecided={(u) => { setOpenCase(u); onChange() }} />
  }
  if (openTicket) {
    return <RepairView me={me} ticket={openTicket} onBack={() => setOpenTicket(null)} onChanged={(u) => { setOpenTicket(u); onChange() }} />
  }

  // My own works first (my side of the wall, before they start), then the neighbours' works that need my photo.
  const mine = data ? data.renovations.filter((x) => x.mine) : []
  const tasks = data ? data.renovations.filter((x) => !x.mine).sort((a, b) => Number(b.needs_photo) - Number(a.needs_photo)) : []
  const waiting = tickets.filter((x) => x.status === 'repair_submitted')
  // A neighbour says my renovation caused a change: nothing is settled until I answer.
  const toAnswer = data?.incidents.filter((c) => c.status === 'proposed' && caseRole(c, me) === 'renovating_owner') ?? []
  const others = tickets.filter((x) => x.status !== 'repair_submitted')
  const sealed = data?.renovations.filter((x) => x.baseline).length ?? 0

  return (
    <section className="screen">
      <ScreenTitle eyebrow={t('ev.eyebrow', { label: me.label })} title={t('nav.evidence')} subtitle={t('ev.subtitle')}
        aside={data && (
          <div className="metrics">
            <Metric value={sealed} label={t('ev.sealed')} tone="brand" />
            <Metric value={data.incidents.length} label={t('ev.cases')} />
            <Metric value={tickets.filter((x) => x.status !== 'closed').length} label={t('ev.openRepairs')} tone={waiting.length ? 'amber' : undefined} />
          </div>
        )} />

      {!data && <Card><Skeleton lines={4} /></Card>}

      {waiting.map((w) => (
        <button key={w.id} className="case attention" onClick={() => setOpenTicket(w)}>
          <img src={w.repair_photo?.thumb_url} alt="" loading="lazy" decoding="async" />
          <div className="grow">
            <div className="mono" style={{ color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 6 }}><BellRing size={12} /> {t('ev.actionNeeded')}</div>
            <div className="card-title" style={{ fontSize: 14 }}>{t('ev.sdpDone')}</div>
            <div className="muted small">{t('ev.onlyYou', { subject: subjectText(t, w.subject) })}</div>
          </div>
          {ticketBadge(t, w.status)}
        </button>
      ))}

      {toAnswer.map((c) => (
        <button key={`answer-${c.id}`} className="case attention" onClick={() => setOpenCase(c)}>
          <img src={c.images?.overlay ?? c.followup.thumb_url} alt="" loading="lazy" decoding="async" />
          <div className="grow">
            <div className="mono" style={{ color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 6 }}><BellRing size={12} /> {t('ev.answerNeeded')}</div>
            <div className="card-title" style={{ fontSize: 14 }}>{t('cs.blamed', { who: t('who', { name: c.reporter_name, label: c.reporter_label }) })}</div>
            <div className="muted small">{t('ev.blamedSub', { subject: subjectText(t, c.baseline.subject) })}</div>
          </div>
          {caseBadge(t, c, me)}
        </button>
      ))}

      {data && mine.length === 0 && tasks.length === 0 && data.incidents.length === 0 && tickets.length === 0 && (
        <Card>
          <Empty art="camera" icon={<Camera size={24} />} title={t('ev.nothingTitle')}>{t('ev.nothingBody')}</Empty>
        </Card>
      )}

      {data && (mine.length > 0 || tasks.length > 0 || data.incidents.length > 0 || others.length > 0) && (
      <div className={mine.length > 0 || tasks.length > 0 ? 'cols' : 'stack'}>
      {(mine.length > 0 || tasks.length > 0) && (
        <div className="col">
          {mine.length > 0 && <div className="section-label">{t('ev.yourWorks')}</div>}
          {mine.map((x) => <TaskCard key={x.intro_id} me={me} task={x} onChange={onChange} onCase={setOpenCase} />)}
          {tasks.length > 0 && <div className="section-label">{t('ev.renoNextDoor')}</div>}
          {tasks.map((x) => <TaskCard key={x.intro_id} me={me} task={x} onChange={onChange} onCase={setOpenCase} />)}
        </div>
      )}

      <div className="col sticky">
      <div className="section-label">{t('ev.yourRecords')}</div>
      <Card>
      <CardHead icon={<FileSearch size={16} />} title={t('ev.casesRepairs')} sub={t('ev.casesRepairsSub')} />
      {data.incidents.length === 0 && others.length === 0 && (
        <div className="small muted">{t('ev.nothingYet')}</div>
      )}
      {data.incidents.length > 0 && <div className="section-label">{t('ev.cases')}</div>}
      {data.incidents.map((c) => (
        <button key={c.id} className="case" onClick={() => setOpenCase(c)}>
          <img src={c.images?.overlay ?? c.followup.thumb_url} alt="" loading="lazy" decoding="async" />
          <div className="grow">
            <div className="mono muted">{t('case.no', { n: String(c.id).padStart(3, '0') })}</div>
            <div className="card-title" style={{ fontSize: 14 }}>{subjectText(t, c.baseline.subject)}</div>
            <div className="muted small">{t('ev.reportedBy', { label: c.reporter_label, date: date(c.created_at) })}</div>
            {/* What the rule found and what it means for this reader, so a case is never just a label and a question mark. */}
            <div className="small case-meaning">{c.hint.codes ? t(`hint.${c.hint.suggestion}`) : c.hint.headline}{caseMeaning(t, c, me)}</div>
          </div>
          {caseBadge(t, c, me)}
        </button>
      ))}

      {others.length > 0 && <div className="section-label">{t('ev.warrantyRepairs')}</div>}
      {others.map((w) => (
        <button key={w.id} className="case" onClick={() => setOpenTicket(w)}>
          <img src={(w.repair_photo ?? w.defect_photo).thumb_url} alt="" loading="lazy" decoding="async" />
          <div className="grow">
            <div className="mono muted"><Wrench size={11} style={{ verticalAlign: -1 }} /> {t('ev.warrantyNo', { n: String(w.id).padStart(3, '0') })}</div>
            <div className="card-title" style={{ fontSize: 14 }}>{subjectText(t, w.subject)}</div>
            <div className="muted small">{t('ev.opened', { date: date(w.opened_at) })}{w.reopen_count ? t('ev.rejectedN', { n: w.reopen_count }) : ''}</div>
            <WarrantyClock clock={w.clock} closed={w.status === 'closed'} compact />
          </div>
          {ticketBadge(t, w.status)}
        </button>
      ))}
      </Card>
      </div>
      </div>
      )}
    </section>
  )
}

/** One line on what a case means for the reader: the renovating owner learns at once whether anything is asked of
 *  them, the reporter what happens next. Decided cases say so. */
function caseMeaning(t: ReturnType<typeof useT>, c: Incident, me: UnitInfo): string {
  if (c.status === 'decided') return ' · ' + t('ev.meaning.decided')
  const role = caseRole(c, me)
  if (role === 'renovating_owner') {
    if (c.status === 'proposed') return ' · ' + t('ev.meaning.answer')
    if (c.hint.suggestion === 'renovation') return ' · ' + t('ev.meaning.mayAsk')
    return ' · ' + t('ev.meaning.nothing')
  }
  if (role === 'reporter' && c.status === 'open') return ' · ' + t('ev.meaning.decide')
  return ''
}

function TaskCard({ me, task, onChange, onCase }: {
  me: UnitInfo
  task: RenovationTask
  onChange: () => void
  onCase: (incident: Incident) => void
}) {
  const t = useT()
  const { date, range } = useDates()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const baselineInput = useRef<HTMLInputElement>(null)
  const followupInput = useRef<HTMLInputElement>(null)
  const subject = task.suggested_subject  // stored in English: it is part of the record
  const ceiling = isCeiling(subject)
  const own = task.mine  // my own renovation: my side of the shared walls, before the contractor starts

  async function run<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
    setBusy(label)
    try {
      return await work()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('task.wentWrong'), 'error')
    } finally {
      setBusy(null)
    }
  }

  const tooBig = (file: File) => {
    if (file.size > MAX_PHOTO_BYTES) {
      toast(t('task.tooBig'), 'error')
      return true
    }
    return false
  }

  const pilot = usePilot()  // the pilot takes real photos only: the drawn samples are for the demo

  async function saveBaseline(source: File | 'sample') {
    if (source !== 'sample' && tooBig(source)) return
    const photo = await run(t('task.busyPrint'), () =>
      source === 'sample'
        ? api.useDemoPhoto(me.id, ceiling ? 'ceiling_before' : 'wall_before', 'baseline', subject, task.intro_id)
        : api.uploadPhoto(me.id, source, 'baseline', subject, task.intro_id),
    )
    if (photo) {
      toast(t(photo.quality.ok ? 'task.savedOk' : 'task.savedWarn'))
      onChange()
    }
  }

  async function reportChange(source: File | 'sample-change' | 'sample-same', baseline: Photo) {
    if (source instanceof File && tooBig(source)) return
    const incident = await run(t('task.busyCompare'), async () => {
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
      <CardHead icon={<Hammer size={16} />} tone="amber" title={own ? t('task.ownTitle') : `${task.from_name} · ${task.from_label}`}
        sub={own ? `${r.scope} · ${range(r.start, r.end)} · ${t(task.baseline ? 'task.ownSealedSub' : 'task.ownSub')}` : `${r.scope} · ${range(r.start, r.end)}`}
        right={task.needs_photo ? <Badge tone={task.baseline ? 'brand' : 'amber'}>{t(task.baseline ? 'task.sealed' : 'task.photoNeeded')}</Badge> : <Badge>{t('task.optional')}</Badge>} />
      <div className="subject"><Camera size={14} /> {subjectText(t, subject)}</div>

      {busy && <div className="busy"><span className="spinner" /> {busy}…</div>}

      {!task.baseline && !busy && (
        <>
          <div className="tips">
            <div className="tip"><ScanSearch size={15} />{t('task.tipBack', { what: t(ceiling ? 'task.ceilingArea' : 'task.wall') })}</div>
            <div className="tip"><Focus size={15} />{t('task.tipFixed', { what: t(ceiling ? 'task.fixedCeiling' : 'task.fixedWall') })}</div>
            <div className="tip"><Sun size={15} />{t('task.tipLight')}</div>
            <div className="tip"><MapPinOff size={15} />{t('task.tipLocation')}</div>
          </div>
          <input ref={baselineInput} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) saveBaseline(f) }} />
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => baselineInput.current?.click()}><Camera size={16} /> {t('task.take')}</button>
            {!pilot && <button className="btn" onClick={() => saveBaseline('sample')}><Sparkles size={16} /> {t('task.sample')}</button>}
          </div>
        </>
      )}

      {task.baseline && !busy && (
        <>
          <div className="photo-row">
            <img className="thumb thumb-lg" src={task.baseline.thumb_url} alt="" loading="lazy" decoding="async" />
            <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="checks">
                <Badge tone={task.baseline.quality.checks.sharp ? 'brand' : 'red'}>{t('task.sharp')}</Badge>
                <Badge tone={task.baseline.quality.checks.well_lit ? 'brand' : 'red'}>{t('task.lit')}</Badge>
                <Badge tone={task.baseline.quality.checks.resolution ? 'brand' : 'red'}>{t('task.res')}</Badge>
              </div>
              <span className="seal"><Fingerprint size={13} /> <span className="mono">{task.baseline.sha256.slice(0, 16)}…</span></span>
              <span className="seal"><ShieldCheck size={13} /> {t('task.sealedOn', { date: date(task.baseline.created_at) })}</span>
            </div>
          </div>
          <div className="small muted">{t('task.spotted')}</div>
          <input ref={followupInput} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) reportChange(f, task.baseline!) }} />
          <div className="btn-row">
            <button className="btn" onClick={() => followupInput.current?.click()}><ImagePlus size={16} /> {t('task.followup')}</button>
            {!pilot && <button className="btn" onClick={() => reportChange('sample-change', task.baseline!)}><Sparkles size={16} /> {t(ceiling ? 'task.sampleStain' : 'task.sampleCrack')}</button>}
          </div>
          {!ceiling && !pilot && <button className="link" onClick={() => reportChange('sample-same', task.baseline!)}>{t('task.sampleSame')}</button>}
        </>
      )}
    </Card>
  )
}
