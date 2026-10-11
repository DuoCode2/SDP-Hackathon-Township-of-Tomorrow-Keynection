import { useEffect, useRef, useState } from 'react'
import { Fingerprint, House, KeyRound, TriangleAlert } from 'lucide-react'
import { api, type AuthMe } from '../api'
import { useLang, type UiLang } from '../i18n'
import { cancelled, keysSupported, problem, signInWithKey } from '../passkey'
import { Logo } from '../components/Art'
import DigitalKeyStep from '../components/DigitalKey'
import { Card } from '../ui'
import JoinView from './JoinView'

const UI_LANGS: { code: UiLang; tag: string; name: string }[] = [
  { code: 'en', tag: 'EN', name: 'English' }, { code: 'ms', tag: 'BM', name: 'Bahasa Melayu' }, { code: 'zh', tag: '中', name: '中文' },
]

/** Pilot mode, nobody signed in on this phone: sign in with the phone's digital key, join with the welcome-pack
 * code, or use a one-time code from the estate office (a new phone, or a staff member's first sign-in). */
export default function SignInView({ initialJoin, initialCode, onSignedIn }: {
  initialJoin?: string
  initialCode?: string
  onSignedIn: () => void
}) {
  const { t, lang, setLang } = useLang()
  const [joining, setJoining] = useState(Boolean(initialJoin))
  const [code, setCode] = useState('')
  const [byCode, setByCode] = useState<AuthMe | null>(null)  // signed in by a code: next, make this phone's key
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const supported = keysSupported()
  // Just closed the account on this phone: say so once.
  const [closed] = useState(() => {
    try {
      const was = sessionStorage.getItem('keynection.closed') === '1'
      sessionStorage.removeItem('keynection.closed')
      return was
    } catch {
      return false
    }
  })

  async function redeem(token: string) {
    setBusy(true)
    setNote(null)
    try {
      setByCode(await api.redeemCode(token))
    } catch (e) {
      setNote(problem(e, t))
    } finally {
      setBusy(false)
    }
  }

  // A link from the estate office (?code=…) signs in straight away; the page has already taken it out of the address.
  const used = useRef(false)
  useEffect(() => {
    if (initialCode && !used.current) {
      used.current = true
      void redeem(initialCode)
    }
  })

  async function withKey() {
    setBusy(true)
    setNote(null)
    try {
      await signInWithKey()
      onSignedIn()
    } catch (e) {
      setNote(cancelled(e) ? null : problem(e, t))
    } finally {
      setBusy(false)
    }
  }

  if (joining) return <div className="signin"><JoinView pilot initialToken={initialJoin} onJoined={onSignedIn} onBack={() => setJoining(false)} /></div>
  if (byCode) return <div className="signin"><DigitalKeyStep onDone={onSignedIn} /></div>

  return (
    <div className="signin">
      <section className="screen join">
        <div className="signin-lang lang-switch" role="group" aria-label="Language">
          {UI_LANGS.map((l) => (
            <button key={l.code} className={lang === l.code ? 'on' : ''} aria-pressed={lang === l.code} onClick={() => setLang(l.code)} title={l.name}>{l.tag}</button>
          ))}
        </div>
        <div className="join-hero">
          <div className="welcome-logo"><Logo size={44} /></div>
          <div className="eyebrow">{t('si.pilot')}</div>
          <h1>{t('si.title')}</h1>
          <p>{t('si.lead')}</p>
        </div>
        {closed && <Card className="join-card"><b>{t('close.done')}</b><small className="muted">{t('close.again')}</small></Card>}
        <Card className="join-card">
          {!supported && <div className="tone-check"><TriangleAlert size={15} /><div>{t('si.unsupported')}</div></div>}
          {note && <div className="tone-check" role="alert"><TriangleAlert size={15} /><div>{note}</div></div>}
          <button className="btn btn-primary btn-block" disabled={busy || !supported} onClick={withKey}><Fingerprint size={17} /> {t('si.key')}</button>
          <small className="muted">{t('si.keyHint')}</small>
        </Card>
        <Card className="join-card">
          <button className="btn btn-block" onClick={() => setJoining(true)}><House size={16} /> {t('si.new')}</button>
        </Card>
        <Card className="join-card">
          <b>{t('si.codeTitle')}</b>
          <label className="field">{t('si.codeHint')}
            <input value={code} onChange={(e) => setCode(e.target.value.trim())} maxLength={64} autoComplete="off" spellCheck={false} />
          </label>
          <button className="btn btn-block" disabled={busy || code.length < 20} onClick={() => redeem(code)}><KeyRound size={16} /> {t('si.codeBtn')}</button>
          <small className="muted">{t('si.noKey')}</small>
        </Card>
      </section>
    </div>
  )
}
