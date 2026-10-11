import { api } from './api'

/** Pilot: notifications on this phone (web push), the browser's own notifications: no app store, no SMS.
 *  'install': an iPhone shows them only for Keynection opened from the Home Screen, so add it there first. */
export type PushState = 'unsupported' | 'install' | 'blocked' | 'off' | 'on'

const iPhone = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const fromHomeScreen = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function current(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/')
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return iPhone() && !fromHomeScreen() ? 'install' : 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return (await current()) ? 'on' : 'off'
}

/** Ask the phone for permission, then give Keynection's server this phone's address and keys. */
export async function turnOn(): Promise<PushState> {
  const reg = await navigator.serviceWorker.register('/sw.js')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'
  const { key } = await api.pushKey()
  let sub = await reg.pushManager.getSubscription()
  const theirs = sub?.options.applicationServerKey
  if (sub && theirs && !sameKey(new Uint8Array(theirs), keyBytes(key))) {
    await sub.unsubscribe()  // made for another server key (a new database): start again
    sub = null
  }
  sub ??= await (await navigator.serviceWorker.ready).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
  await api.pushSubscribe(sub.toJSON())
  return 'on'
}

function sameKey(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/** This phone stops getting alerts (turned off, or signing out). */
export async function turnOff(): Promise<void> {
  const sub = await current()
  if (!sub) return
  await api.pushUnsubscribe(sub.endpoint).catch(() => {})
  await sub.unsubscribe()
}

export async function forgetThisPhone(): Promise<void> {
  if (pushSupported()) await turnOff().catch(() => {})
}

/** On opening the app: the server keeps this phone's address under whoever is signed in now. */
export async function syncPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return
  const sub = await current().catch(() => null)
  if (sub) await api.pushSubscribe(sub.toJSON()).catch(() => {})
}

/** A tap on a notification opens a screen: '#tab=chats' in the address, or a message from the service worker. */
export function onOpenTab(open: (tab: string) => void): () => void {
  const fromHash = (hash: string) => {
    const tab = new URLSearchParams(hash.replace(/^#/, '')).get('tab')
    if (tab) open(tab)
  }
  fromHash(window.location.hash)
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search)
  const listener = (e: MessageEvent) => {
    if (e.data?.type === 'keynection-open') fromHash(String(e.data.hash ?? ''))
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', listener)
  return () => { if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', listener) }
}
