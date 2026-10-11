import { useEffect, useState } from 'react'
import { Bell, BellOff, Send, Smartphone, TriangleAlert, X } from 'lucide-react'
import { api } from '../api'
import { useT } from '../i18n'
import { pushState, turnOff, turnOn, type PushState } from '../push'
import { Card, CardHead, useToast } from '../ui'

function usePushState(): [PushState | null, (s: PushState) => void] {
  const [state, setState] = useState<PushState | null>(null)
  useEffect(() => {
    let live = true
    pushState().then((s) => live && setState(s)).catch(() => live && setState('unsupported'))
    return () => { live = false }
  }, [])
  return [state, setState]
}

function useTurnOn(setState: (s: PushState) => void) {
  const t = useT()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  async function on() {
    setBusy(true)
    try {
      const s = await turnOn()
      setState(s)
      if (s === 'on') {
        const r = await api.pushTest()
        toast(r.sent ? t('push.tested') : t('push.failed'), r.sent ? undefined : 'error')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : t('push.failed'), 'error')
    } finally {
      setBusy(false)
    }
  }
  return { on, busy }
}

/** Pilot: notifications on this phone. Turn them on, send a test, turn them off; on an iPhone, add Keynection to the
 *  Home Screen first. Staff get the estate office's alerts on the device they use. */
export function NotificationsCard({ staff = false }: { staff?: boolean }) {
  const t = useT()
  const toast = useToast()
  const [state, setState] = usePushState()
  const { on, busy } = useTurnOn(setState)

  async function test() {
    const r = await api.pushTest().catch(() => ({ sent: 0, failed: 1 }))
    toast(r.sent ? t('push.tested') : t('push.failed'), r.sent ? undefined : 'error')
    if (!r.sent) setState(await pushState())
  }

  async function off() {
    await turnOff().catch(() => {})
    setState(await pushState())
  }

  if (state === null) return null
  return (
    <Card>
      <CardHead icon={state === 'on' ? <Bell size={16} /> : <BellOff size={16} />} title={t(staff ? 'push.staffTitle' : 'push.title')}
        sub={state === 'on' ? t(staff ? 'push.staffOn' : 'push.on') : t('push.off')} />
      {state === 'install' && <div className="tone-check"><Smartphone size={15} /><div>{t('push.iphone')}</div></div>}
      {state === 'blocked' && <div className="tone-check"><TriangleAlert size={15} /><div>{t('push.blocked')}</div></div>}
      {state === 'unsupported' && <div className="tone-check"><TriangleAlert size={15} /><div>{t('push.unsupported')}</div></div>}
      <div className="btn-row">
        {state === 'off' && <button className="btn btn-sm btn-primary" disabled={busy} onClick={on}><Bell size={14} /> {t('push.turnOn')}</button>}
        {state === 'on' && (
          <>
            <button className="btn btn-sm" onClick={test}><Send size={14} /> {t('push.test')}</button>
            <button className="btn btn-sm" onClick={off}><BellOff size={14} /> {t('push.turnOff')}</button>
          </>
        )}
      </div>
      <small className="muted">{t('push.privacy')} {t('push.night')}</small>
    </Card>
  )
}

const ASKED = 'keynection.pushAsked'

/** Pilot, a household that hasn't turned notifications on yet: one gentle ask, at the top of its neighbours. */
export function NotificationsAsk() {
  const t = useT()
  const [state, setState] = usePushState()
  const { on, busy } = useTurnOn(setState)
  const [asked, setAsked] = useState(() => {
    try {
      return localStorage.getItem(ASKED) === '1'
    } catch {
      return false
    }
  })
  const later = () => {
    setAsked(true)
    try { localStorage.setItem(ASKED, '1') } catch { /* private window: asked again next time */ }
  }
  if (asked || (state !== 'off' && state !== 'install')) return null
  return (
    <div className="push-ask" role="note">
      <Bell size={18} />
      <div className="grow">
        <b>{t('push.ask')}</b>
        {state === 'install' && <small>{t('push.iphone')}</small>}
      </div>
      {state === 'off' && <button className="btn btn-sm btn-primary" disabled={busy} onClick={on}>{t('push.turnOn')}</button>}
      <button className="icon-btn" onClick={later} aria-label={t('push.later')} title={t('push.later')}><X size={16} /></button>
    </div>
  )
}
