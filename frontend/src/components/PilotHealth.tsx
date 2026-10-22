import { useEffect, useState } from 'react'
import { CircleCheck, HardDrive, Stethoscope, TriangleAlert } from 'lucide-react'
import { api, type PilotStatus } from '../api'
import { useDates, useT } from '../i18n'
import { Card, CardHead } from '../ui'

/** Pilot, for staff: is the pilot healthy? What setup still needs, the last backup, sign-ups. Numbers only. */
export default function PilotHealth({ version }: { version: number }) {
  const t = useT()
  const { date, time } = useDates()
  const [s, setS] = useState<PilotStatus | null>(null)
  useEffect(() => {
    let live = true
    api.pilotStatus().then((x) => live && setS(x)).catch(() => live && setS(null))
    return () => { live = false }
  }, [version])
  if (!s) return null
  const when = (iso: string) => `${date(iso)}, ${time(new Date(iso))}`
  return (
    <Card className="pilot-health">
      <CardHead icon={<Stethoscope size={16} />} tone={s.checks.length ? 'amber' : 'brand'} title={t('sdp.health.title')}
        sub={s.checks.length ? t('sdp.health.todo', { n: s.checks.length }) : t('sdp.health.ok')} />
      {s.checks.length > 0 ? (
        <ul className="health-checks">{s.checks.map((c) => <li key={c}><TriangleAlert size={14} /> {c}</li>)}</ul>
      ) : <div className="import-ok"><CircleCheck size={15} /> {t('sdp.health.nothing')}</div>}
      <dl className="health-grid">
        <div><dt><HardDrive size={12} /> {t('sdp.health.backup')}</dt><dd>{s.last_backup ? t('sdp.health.backupKept', { when: when(s.last_backup), n: s.backups }) : t('sdp.health.none')}</dd></div>
        <div><dt>{t('sdp.health.swept')}</dt><dd>{s.records_swept_at ? when(s.records_swept_at) : t('sdp.health.notYet')}</dd></div>
        <div><dt>{t('sdp.health.joined')}</dt><dd>{t('sdp.health.of', { a: s.joined, b: s.homes })}</dd></div>
        <div><dt>{t('sdp.health.phones')}</dt><dd>{s.phones}</dd></div>
        <div><dt>{t('join.p5t')}</dt><dd>{s.ai ? t('sdp.health.on') : t('sdp.health.off')}</dd></div>
        <div><dt>{t('sdp.health.address')}</dt><dd className="mono">{s.origin ?? t('sdp.health.notSet')}</dd></div>
      </dl>
    </Card>
  )
}
