import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Drama } from 'lucide-react'
import type { UnitInfo } from '../api'
import { Avatar } from '../ui'

// The people the demo story is told through. Everyone else in the phase is one click away below them.
export const CAST: { id: string; role: string; story: string }[] = [
  { id: 'T-12', role: 'Renovating owner', story: 'Extending the kitchen at No. 12' },
  { id: 'T-11', role: 'Next-door neighbour', story: 'Shares a wall with No. 12' },
  { id: 'T-22', role: 'Across the road', story: 'Faces No. 12, hears the noise' },
  { id: 'A-15-3', role: 'Upstairs owner', story: 'Re-tiling a bathroom on level 15' },
  { id: 'A-14-3', role: 'Downstairs neighbour', story: 'Ceiling below A-15-3' },
]

export const LANG_TAG: Record<string, string> = { en: 'EN', ms: 'BM', zh: '中' }

export function roleOf(unitId: string): string {
  return CAST.find((c) => c.id === unitId)?.role ?? 'Resident'
}

/** Who am I in the demo? A chip that opens the cast. */
export default function CastPicker({ units, me, onPick, compact = false }: {
  units: UnitInfo[]
  me: string
  onPick: (unitId: string) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const current = units.find((u) => u.id === me)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  if (!current) return null
  const pick = (id: string) => {
    onPick(id)
    setOpen(false)
  }

  return (
    <div className={`cast ${compact ? 'compact' : ''}`} ref={box}>
      <button className={`cast-chip ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Choose whose screen you are seeing">
        <Avatar name={current.resident_name} size={compact ? 24 : 28} />
        <span className="cast-who">
          <b>{current.resident_name} <i>· {current.label}</i></b>
          {!compact && <small>{roleOf(current.id)}</small>}
        </span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="cast-panel" role="dialog" aria-label="Demo cast">
          <div className="cast-title"><Drama size={14} /> Demo cast · whose screen are you seeing?</div>
          <div className="cast-cards">
            {CAST.map((c) => {
              const u = units.find((x) => x.id === c.id)
              if (!u) return null
              return (
                <button key={c.id} className={`cast-card ${c.id === me ? 'on' : ''}`} onClick={() => pick(c.id)}>
                  <Avatar name={u.resident_name} size={34} />
                  <span className="grow">
                    <b>{u.resident_name} <i>· {u.label}</i></b>
                    <small>{c.role}</small>
                    <em>{c.story}</em>
                  </span>
                  <span className="lang-tag">{LANG_TAG[u.lang]}</span>
                </button>
              )
            })}
          </div>
          <div className="cast-title">Everyone else in Taman Demo</div>
          <div className="cast-grid">
            {units.filter((u) => !CAST.some((c) => c.id === u.id)).map((u) => (
              <button key={u.id} className={u.id === me ? 'on' : ''} onClick={() => pick(u.id)} title={`${u.label} · ${u.resident_name}`}>
                {u.kind === 'terrace' ? u.label.replace('No. ', '') : u.label.slice(2)}
                <small>{u.resident_name}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
