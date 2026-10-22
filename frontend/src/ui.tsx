import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { Art, DoorAvatar, type ArtKind } from './components/Art'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>
}

type Tone = 'neutral' | 'brand' | 'amber' | 'red' | 'blue' | 'violet'
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

/** Each household is shown by its own illustrated front door. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      <DoorAvatar name={name} size={size} />
    </span>
  )
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-group" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  )
}

export function ScreenTitle({ eyebrow, title, subtitle, aside }: { eyebrow?: string; title: string; subtitle?: string; aside?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="screen-title">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {aside && <div className="page-head-aside">{aside}</div>}
    </div>
  )
}

/** Card heading: icon tile, title, optional subline and something on the right. */
export function CardHead({ icon, title, sub, right, tone = 'brand' }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; tone?: 'brand' | 'amber' | 'red' | 'blue' | 'violet' }) {
  return (
    <div className="card-head">
      {icon && <div className={`card-icon tone-${tone}`}>{icon}</div>}
      <div className="grow">
        <div className="card-title">{title}</div>
        {sub && <div className="card-sub">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

export function Metric({ value, label, tone }: { value: ReactNode; label: string; tone?: 'brand' | 'amber' }) {
  return (
    <div className={`metric ${tone ? `metric-${tone}` : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

export function Empty({ icon, art, title, children }: { icon?: ReactNode; art?: ArtKind; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {art ? <Art kind={art} /> : <div className="empty-icon">{icon}</div>}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={o.id === value} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Animates a number from 0 on first show. Pure requestAnimationFrame, no library. */
export function CountUp({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    let frame = 0
    const start = performance.now()
    const tick = (t: number) => {
      const p = Math.min((t - start) / 700, 1)
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))))
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    // Animation frames pause in background tabs; make sure the real number always lands.
    const done = window.setTimeout(() => setShown(value), 800)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(done)
    }
  }, [value])
  return (
    <>
      {shown}
      {suffix}
    </>
  )
}

export function Ring({ value, label }: { value: number | null; label: string }) {
  const r = 31
  const c = 2 * Math.PI * r
  const [drawn, setDrawn] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(value ?? 0))
    return () => cancelAnimationFrame(id)
  }, [value])
  return (
    <div className="ring">
      <div className="ring-wrap">
        <svg viewBox="0 0 74 74" aria-hidden>
          <defs>
            <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--grad-a)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--grad-b)' }} />
            </linearGradient>
          </defs>
          <circle className="track" cx="37" cy="37" r={r} />
          <circle className="value" cx="37" cy="37" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - drawn)} />
        </svg>
        <b>{value === null ? '–' : `${Math.round(value * 100)}%`}</b>
      </div>
      <span>{label}</span>
    </div>
  )
}

export function Sheet({ open, onClose, children, wide = false }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  // Rendered at the top of the app so it covers the navigation and isn't trapped inside the animated screen.
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        {children}
      </div>
    </div>,
    document.getElementById('sheet-root') ?? document.body,
  )
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })
}


// ---------- toasts ----------

type Toast = { id: number; tone: 'ok' | 'error'; text: string }
const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {})

type Celebration = { id: number; emoji: string; label: string }
const CelebrateContext = createContext<(emoji: string, label: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [party, setParty] = useState<Celebration | null>(null)
  const next = useRef(0)
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++next.current
    setToasts((t) => [...t, { id, tone, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])
  const celebrate = useCallback((emoji: string, label: string) => {
    const id = ++next.current
    setParty({ id, emoji, label })
    setTimeout(() => setParty((p) => (p?.id === id ? null : p)), 1700)
  }, [])
  return (
    <ToastContext.Provider value={push}>
    <CelebrateContext.Provider value={celebrate}>
      {children}
      {party && (
        <div key={party.id} className="celebrate" aria-live="polite">
          <div className="celebrate-burst" aria-hidden>
            {Array.from({ length: 10 }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}
          </div>
          <div className="celebrate-emoji" aria-hidden>{party.emoji}</div>
          <div className="celebrate-label">{party.label}</div>
        </div>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.tone === 'ok' ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </CelebrateContext.Provider>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
/** A short, happy moment after reaching out to a neighbour. */
export const useCelebrate = () => useContext(CelebrateContext)

/** A rubber-stamp mark ("cop"), used where a record has been sealed, verified or closed. */
export function Stamp({ children, tone = 'brand', tilt = -4 }: { children: ReactNode; tone?: 'brand' | 'amber' | 'red' | 'blue' | 'ink'; tilt?: number }) {
  return (
    <span className={`stamp stamp-${tone}`} style={{ transform: `rotate(${tilt}deg)` }}>
      {children}
    </span>
  )
}

/** Numbered steps for guided flows. */
export function Steps({ steps, current, onJump }: { steps: string[]; current: number; onJump?: (i: number) => void }) {
  return (
    <ol className="steps">
      {steps.map((label, i) => (
        <li key={label} className={i === current ? 'on' : i < current ? 'done' : ''}>
          <button disabled={!onJump || i > current} onClick={() => onJump?.(i)}>
            <span>{i + 1}</span>
            {label}
          </button>
        </li>
      ))}
    </ol>
  )
}
