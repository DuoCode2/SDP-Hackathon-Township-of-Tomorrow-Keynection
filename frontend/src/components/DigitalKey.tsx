import { useState } from 'react'
import { Fingerprint, KeyRound, TriangleAlert } from 'lucide-react'
import { cancelled, keysSupported, makeKey, problem } from '../passkey'
import { useT } from '../i18n'
import { Card } from '../ui'

/** Pilot mode, right after joining or using a one-time code: this phone becomes the home's (or staff member's)
 * digital key. Skipping is allowed; signing in again on another day then needs a new code from the estate office. */
export default function DigitalKeyStep({ onDone }: { onDone: (made: boolean) => void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const supported = keysSupported()

  async function make() {
    setBusy(true)
    setNote(null)
    try {
      await makeKey()
      onDone(true)
    } catch (e) {
      setNote(cancelled(e) ? t('key.cancelled') : problem(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="screen join">
      <div className="join-hero">
        <div className="key-badge" aria-hidden><Fingerprint size={34} /></div>
        <h1>{t('key.title')}</h1>
        <p>{t('key.lead')}</p>
      </div>
      <Card className="join-card">
        {!supported && <div className="tone-check"><TriangleAlert size={15} /><div>{t('si.unsupported')}</div></div>}
        {note && <div className="tone-check"><TriangleAlert size={15} /><div>{note}</div></div>}
        <button className="btn btn-primary btn-block" disabled={busy || !supported} onClick={make}><KeyRound size={16} /> {t('key.make')}</button>
        <button className="btn btn-block" disabled={busy} onClick={() => onDone(false)}>{t('key.later')}</button>
        <small className="muted">{t('key.laterNote')}</small>
      </Card>
    </section>
  )
}
