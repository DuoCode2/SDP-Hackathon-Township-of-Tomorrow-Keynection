import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Drama } from 'lucide-react'
import type { UnitInfo } from '../api'
import { tEn, useT, type Translate } from '../i18n'
import { Avatar } from '../ui'

// The people the demo story is told through. Everyone else in the phase is one click away below them.
// Their role and story text live in the dictionary under role.<id> and story.<id>.
export const CAST: string[] = ['T-12', 'T-11', 'T-22', 'A-15-3', 'A-14-3', 'A-13-3']

export const LANG_TAG: Record<string, string> = { en: 'EN', ms: 'BM', zh: '中' }

export function roleOf(unitId: string, t: Translate = tEn): string {
  return t(CAST.includes(unitId) ? `role.${unitId}` : 'role.resident')
}

/** Who am I in the demo? A chip that opens the cast. */
export default function CastPicker({ units, me, onPick, compact = false }: {
  units: UnitInfo[]
  me: string
  onPick: (unitId: string) => void
  compact?: boolean
}) {
  const t = useT()
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
      <button className={`cast-chip ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t('cast.title')}>
        <Avatar name={current.resident_name} size={compact ? 24 : 28} />
        <span className="cast-who">
          <b>{current.resident_name} <i>· {current.label}</i></b>
          {!compact && <small>{roleOf(current.id, t)}</small>}
        </span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="cast-panel" role="dialog" aria-label={t('cast.title')}>
          <div className="cast-title"><Drama size={14} /> {t('cast.title')}</div>
          <div className="cast-cards">
            {CAST.map((id) => {
              const u = units.find((x) => x.id === id)
              if (!u) return null
              return (
                <button key={id} className={`cast-card ${id === me ? 'on' : ''}`} onClick={() => pick(id)}>
                  <Avatar name={u.resident_name} size={34} />
                  <span className="grow">
                    <b>{u.resident_name} <i>· {u.label}</i></b>
                    <small>{t(`role.${id}`)}</small>
                    <em>{t(`story.${id}`)}</em>
                  </span>
                  <span className="lang-tag">{LANG_TAG[u.lang]}</span>
                </button>
              )
            })}
          </div>
          <div className="cast-title">{t('cast.others')}</div>
          <div className="cast-grid">
            {units.filter((u) => !CAST.includes(u.id)).map((u) => (
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
