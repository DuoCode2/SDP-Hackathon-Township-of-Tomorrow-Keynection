import type { Relation, UnitInfo } from '../api'

// The phase drawn the way SDP's own plans are: house footprints, party walls and floor slabs.
// The circle is literally "who you share a wall, a slab or a road with".

type Box = { x: number; y: number; w: number; h: number }
type Edge = { x1: number; y1: number; x2: number; y2: number }

const X0 = 60, W = 100, D = 86
const ROW_Y: Record<string, number> = { north: 52, south: 232 }
const AX0 = 150, AW = 120, AH = 84, AY0 = 62

const box = (u: UnitInfo): Box =>
  u.kind === 'terrace'
    ? { x: X0 + u.pos * W, y: ROW_Y[u.row ?? 'south'], w: W, h: D }
    : { x: AX0 + (u.pos - 1) * AW, y: AY0 + (15 - (u.floor ?? 15)) * AH, w: AW, h: AH }

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

function sharedEdge(a: Box, b: Box): Edge | null {
  if (a.y === b.y && Math.abs(a.x - b.x) === a.w) {
    const x = Math.max(a.x, b.x)
    return { x1: x, y1: a.y + 4, x2: x, y2: a.y + a.h - 4 }
  }
  if (a.x === b.x && Math.abs(a.y - b.y) === a.h) {
    const y = Math.max(a.y, b.y)
    return { x1: a.x + 6, y1: y, x2: a.x + a.w - 6, y2: y }
  }
  return null
}

export default function PlanMap({ units, me, circle, selected, onSelect, view }: {
  units: UnitInfo[]
  me: UnitInfo
  circle: { id: string; relation: Relation }[]
  selected: string | null
  onSelect: (id: string) => void
  view: 'terrace' | 'apartment'
}) {
  const shown = units.filter((u) => u.kind === view)
  const circleIds = new Set(circle.map((c) => c.id))
  const mine = me.kind === view ? box(me) : null
  const worksAt = new Set(units.filter((u) => u.renovating).map((u) => u.id))

  const walls = mine
    ? shown
        .filter((u) => circleIds.has(u.id))
        .map((u) => ({ u, edge: sharedEdge(mine, box(u)) }))
        .filter((w): w is { u: UnitInfo; edge: Edge } => w.edge !== null)
    : []
  const links = mine ? shown.filter((u) => circleIds.has(u.id)).map((u) => ({ id: u.id, a: centre(mine), b: centre(box(u)) })) : []

  return (
    <svg className="plan" viewBox="0 0 720 400" role="group" aria-label={view === 'terrace' ? 'Plan of Jalan Demo 1' : 'Elevation of Block A'}>
      <defs>
        <pattern id="hatch-works" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="#e8710a" strokeWidth="2" opacity="0.45" />
        </pattern>
        <pattern id="hatch-wall" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#fff4e6" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#e8710a" strokeWidth="2.4" />
        </pattern>
        <linearGradient id="me-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#12b8a6" />
          <stop offset="100%" stopColor="#2f8cf5" />
        </linearGradient>
      </defs>

      {view === 'terrace' ? <TerraceFrame /> : <BlockFrame />}

      {shown.map((u) => {
        const b = box(u)
        const cls = u.id === me.id ? 'me' : circleIds.has(u.id) ? 'circle' : ''
        return (
          <g key={u.id} className={`home ${cls} ${selected === u.id ? 'selected' : ''}`} role="button" tabIndex={0}
            aria-label={`${u.label}, ${u.resident_name}${u.renovating ? ', renovating' : ''}`}
            onClick={() => onSelect(u.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(u.id)}>
            <rect className="home-fill" x={b.x} y={b.y} width={b.w} height={b.h} />
            {worksAt.has(u.id) && <rect className="home-works" x={b.x} y={b.y} width={b.w} height={b.h} />}
          </g>
        )
      })}

      {links.map((l) => <line key={l.id} className="plan-link" x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} />)}

      {/* party walls and slabs between every pair of neighbours */}
      {shown.map((u) => {
        const b = box(u)
        return shown
          .filter((v) => v.id > u.id)
          .map((v) => {
            const e = sharedEdge(b, box(v))
            return e && <line key={`${u.id}-${v.id}`} className="party" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
          })
      })}

      {walls.map(({ u, edge }) => {
        const atRisk = worksAt.has(u.id) || worksAt.has(me.id)
        const vertical = edge.x1 === edge.x2
        return (
          <g key={u.id} className={`shared ${atRisk ? 'at-risk' : ''}`}>
            {atRisk ? (
              <rect x={vertical ? edge.x1 - 5 : edge.x1} y={vertical ? edge.y1 : edge.y1 - 5}
                width={vertical ? 10 : edge.x2 - edge.x1} height={vertical ? edge.y2 - edge.y1 : 10} />
            ) : (
              <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
            )}
          </g>
        )
      })}

      {shown.map((u) => {
        const b = box(u)
        const c = centre(b)
        const isMe = u.id === me.id
        return (
          <g key={u.id} className={`home-label ${isMe ? 'me' : ''}`} pointerEvents="none">
            <text x={c.x} y={c.y - 3} className="home-no">{u.kind === 'terrace' ? u.label.replace('No. ', '') : `${u.floor}-${u.pos}`}</text>
            <text x={c.x} y={c.y + 15} className="home-name">{isMe ? 'YOU' : u.resident_name}</text>
            {worksAt.has(u.id) && <text x={b.x + b.w - 6} y={b.y + 13} className="home-tag">WORKS</text>}
          </g>
        )
      })}

      {selected && shown.some((u) => u.id === selected) && (() => {
        const b = box(shown.find((u) => u.id === selected)!)
        return <rect className="select-ring" x={b.x - 5} y={b.y - 5} width={b.w + 10} height={b.h + 10} rx="4" pointerEvents="none" />
      })()}
    </svg>
  )
}

function TerraceFrame() {
  const right = X0 + 6 * W
  return (
    <g className="frame" pointerEvents="none">
      <line className="dim" x1={X0} y1="30" x2={right} y2="30" />
      <line className="dim" x1={X0} y1="24" x2={X0} y2="36" />
      <line className="dim" x1={right} y1="24" x2={right} y2="36" />
      <text className="dim-text" x={(X0 + right) / 2} y="24">TERRACE ROW B · NO. 20–25</text>
      <line className="setback" x1={X0} y1="148" x2={right} y2="148" />
      <rect className="road" x="20" y="158" width="680" height="54" />
      <line className="road-centre" x1="24" y1="185" x2="696" y2="185" />
      <text className="road-name" x="360" y="190">JALAN DEMO 1</text>
      <line className="setback" x1={X0} y1="222" x2={right} y2="222" />
      <text className="dim-text" x={(X0 + right) / 2} y="342">TERRACE ROW A · NO. 10–15</text>
      <NorthArrow />
      <ScaleBar label="PLAN · 1:400" />
    </g>
  )
}

function BlockFrame() {
  const right = AX0 + 4 * AW
  return (
    <g className="frame" pointerEvents="none">
      <line className="party" x1={AX0 - 12} y1={AY0 - 8} x2={right + 12} y2={AY0 - 8} />
      <text className="dim-text" x={(AX0 + right) / 2} y={AY0 - 20}>BLOCK A · EAST ELEVATION</text>
      {[15, 14, 13].map((f, i) => (
        <text key={f} className="level" x={AX0 - 22} y={AY0 + i * AH + AH / 2 + 4}>L{f}</text>
      ))}
      <path className="break" d={`M${AX0 - 12} ${AY0 + 3 * AH + 16} l40 0 l8 -9 l8 18 l8 -9 l${4 * AW - 40} 0`} />
      <text className="dim-text" x={(AX0 + right) / 2} y={AY0 + 3 * AH + 40}>LEVELS 1–12 NOT SHOWN</text>
      <ScaleBar label="ELEVATION · 1:300" />
    </g>
  )
}

function NorthArrow() {
  return (
    <g className="north" transform="translate(680 40)">
      <circle r="14" />
      <path d="M0 -10 L5 6 L0 3 L-5 6 Z" />
      <text y="-18">N</text>
    </g>
  )
}

function ScaleBar({ label }: { label: string }) {
  return (
    <g className="scale" transform="translate(40 372)">
      <rect x="0" y="0" width="30" height="5" className="on" />
      <rect x="30" y="0" width="30" height="5" />
      <rect x="60" y="0" width="30" height="5" className="on" />
      <text x="0" y="17">0</text>
      <text x="60" y="17">10 m</text>
      <text x="640" y="8" className="sheet-label">{label}</text>
    </g>
  )
}
