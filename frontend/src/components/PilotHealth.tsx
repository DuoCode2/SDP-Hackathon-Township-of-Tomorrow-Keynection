import { useEffect, useState } from 'react'
import { CircleCheck, HardDrive, Stethoscope, TriangleAlert } from 'lucide-react'
import { api, type PilotStatus } from '../api'
import { Card, CardHead, count, formatDate } from '../ui'

const when = (iso: string) => `${formatDate(iso)}, ${new Date(iso).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}`

/** Pilot, for staff: is the pilot healthy? What setup still needs, the last backup, sign-ups. Numbers only. */
export default function PilotHealth({ version }: { version: number }) {
  const [s, setS] = useState<PilotStatus | null>(null)
  useEffect(() => {
    let live = true
    api.pilotStatus().then((x) => live && setS(x)).catch(() => live && setS(null))
    return () => { live = false }
  }, [version])
  if (!s) return null
  return (
    <Card className="pilot-health">
      <CardHead icon={<Stethoscope size={16} />} tone={s.checks.length ? 'amber' : 'brand'} title="Pilot health"
        sub={s.checks.length ? `${count(s.checks.length, 'thing')} to sort out` : 'Set up and running'} />
      {s.checks.length > 0 ? (
        <ul className="health-checks">{s.checks.map((c) => <li key={c}><TriangleAlert size={14} /> {c}</li>)}</ul>
      ) : <div className="import-ok"><CircleCheck size={15} /> Nothing left to set up.</div>}
      <dl className="health-grid">
        <div><dt><HardDrive size={12} /> Last backup</dt><dd>{s.last_backup ? `${when(s.last_backup)} · ${s.backups} kept` : 'None yet'}</dd></div>
        <div><dt>Old records cleared</dt><dd>{s.records_swept_at ? when(s.records_swept_at) : 'Not yet'}</dd></div>
        <div><dt>Homes joined</dt><dd>{s.joined} of {s.homes}</dd></div>
        <div><dt>Phones with notifications</dt><dd>{s.phones}</dd></div>
        <div><dt>AI translation</dt><dd>{s.ai ? 'On' : 'Off (no key set)'}</dd></div>
        <div><dt>Address</dt><dd className="mono">{s.origin ?? 'Not set'}</dd></div>
      </dl>
    </Card>
  )
}
