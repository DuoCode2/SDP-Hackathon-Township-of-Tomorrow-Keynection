import { useEffect, useRef } from 'react'
import type { Relation, UnitInfo, WorksType } from '../api'
import { useT } from '../i18n'

// The phase drawn the way SDP's own plans are: house footprints, party walls and floor slabs.
// Ring 1 (your circle) is filled, ring 2 (your lorong or block) is outlined, everything else is plain.
// Names appear only for homes you know; the rest show their unit number.

type Box = { x: number; y: number; w: number; h: number }
type Edge = { x1: number; y1: number; x2: number; y2: number }

const X0 = 60, W = 100, D = 86
// The lane row (No. 30–35) backs onto the south row across a back lane: told about works that reach the back.
const ROW_Y: Record<string, number> = { north: 52, south: 232, lane: 342 }
const TERRACE_H = 512, BLOCK_H = 400
const AX0 = 150, AW = 120, AH = 50, AY0 = 46
const TOP_FLOOR = 16, FLOORS = 6
// The block in an oblique projection: each floor's side and the roof recede up and to the right by this much.
const DX = 26, DY = -13

const box = (u: UnitInfo): Box =>
  u.kind === 'terrace'
    ? { x: X0 + u.pos * W, y: ROW_Y[u.row ?? 'south'], w: W, h: D }
    : { x: AX0 + (u.pos - 1) * AW, y: AY0 + (TOP_FLOOR - (u.floor ?? TOP_FLOOR)) * AH, w: AW, h: AH }

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

export default function PlanMap({ units, me, circle, ring2 = [], names, works = [], selected = null, onSelect, view, impact, intro = false, worksType, explain }: {
  units: UnitInfo[]
  me: UnitInfo
  circle: { id: string; relation: Relation }[]
  ring2?: string[]
  /** Names this household is allowed to see (its circle and accepted contacts). */
  names: Record<string, string>
  /** Renovations this household has been told about. */
  works?: string[]
  selected?: string | null
  onSelect?: (id: string) => void
  view: 'terrace' | 'apartment'
  /** Renovation preview: the homes that would be notified. */
  impact?: string[]
  /** Key-day opening: the plan draws itself, then the circle lights up one home at a time (styles.css, plan-intro). */
  intro?: boolean
  /** Renovation preview: the type of work, so the plan shows the rule that decides who is told. */
  worksType?: WorksType
  /** Renovation preview: what a tap on a home explains (its relation, and why it is told). */
  explain?: Record<string, string>
}) {
  const shown = units.filter((u) => u.kind === view)
  const circleIds = new Set(circle.map((c) => c.id))
  const ring2Ids = new Set(ring2)
  const impactIds = new Set(impact ?? [])
  const worksAt = new Set(works)
  const mine = me.kind === view ? box(me) : null
  // The home behind yours: not in the circle, so it is shown apart, with when it would be told.
  const behindId = me.kind === 'terrace' && me.back_row ? shown.find((u) => u.row === me.back_row && u.pos === me.pos)?.id : undefined
  const previewing = impact !== undefined
  const rule = previewing ? worksType : undefined
  // Each effect shows a rule. Wet: water runs down the stack. Hacking: vibration two floors up and down. Structural:
  // the whole zone. Terrace: works that reach the back fence and drain tell the home behind.
  const stack = mine && me.kind === 'apartment' ? shown.filter((u) => u.pos === me.pos && impactIds.has(u.id)) : []
  const wetPath = rule === 'wet' ? stack.filter((u) => (u.floor ?? 0) < (me.floor ?? 0)) : []
  const shaken = rule === 'hacking' ? stack : []
  const behindTold = !!behindId && impactIds.has(behindId)
  const behindBox = behindId ? box(shown.find((u) => u.id === behindId)!) : null
  // Where each home comes in: terrace homes draw outwards from yours, block floors rise from the bottom, and the
  // homes that matter light up one after another.
  const order = (u: UnitInfo): React.CSSProperties => {
    const lit = previewing ? (impact ?? []).indexOf(u.id) : circle.findIndex((c) => c.id === u.id)
    return {
      ...(lit >= 0 ? { '--i': lit } : {}),
      ...(u.kind === 'terrace'
        ? { '--d': Math.abs(u.pos - (me.kind === 'terrace' ? me.pos : 0)) + (u.row === me.row ? 0 : 1) }
        : { '--f': (u.floor ?? TOP_FLOOR) - (TOP_FLOOR - FLOORS + 1) }),
    } as React.CSSProperties
  }
  const entry = intro ? 'plan-intro' : view === 'terrace' ? 'draw' : 'rise'

  const walls = mine
    ? shown
        .filter((u) => circleIds.has(u.id))
        .map((u) => ({ u, edge: sharedEdge(mine, box(u)) }))
        .filter((w): w is { u: UnitInfo; edge: Edge } => w.edge !== null)
    : []
  const linked = previewing ? shown.filter((u) => impactIds.has(u.id)) : shown.filter((u) => circleIds.has(u.id))
  const links = mine ? linked.map((u) => ({ id: u.id, a: centre(mine), b: centre(box(u)) })) : []

  const cls = (u: UnitInfo) => {
    if (u.id === me.id) return 'me'
    if (previewing) return impactIds.has(u.id) ? 'notified' : 'muted-home'
    return circleIds.has(u.id) ? 'circle' : u.id === behindId ? 'behind-home' : ring2Ids.has(u.id) ? 'ring2' : ''
  }

  // On a phone the plan keeps a readable size and scrolls sideways (see .plan-scroll); start with your home in view.
  const t = useT()
  const scroller = useRef<HTMLDivElement>(null)
  const meX = mine ? centre(mine).x : null
  useEffect(() => {
    const el = scroller.current
    if (!el || meX === null || el.scrollWidth <= el.clientWidth) return
    el.scrollLeft = (meX / 720) * el.scrollWidth - el.clientWidth / 2
  }, [meX, view])

  return (
    <>
    <div className="plan-wrap">
    {rule && (
      <div className="plan-legend" aria-label={t('plan.legend')}>
        <span><i className="lg-told" />{t('plan.legend.told')}</span>
        {view === 'apartment' && rule === 'wet' && <span><i className="lg-wet" />{t('plan.legend.wet')}</span>}
        {view === 'apartment' && rule === 'hacking' && <span><i className="lg-vibe" />{t('plan.legend.hacking')}</span>}
        {rule === 'structural' && <span><i className="lg-structural" />{t('plan.legend.structural')}</span>}
        {behindTold && <span><i className="lg-back" />{t('plan.legend.back')}</span>}
      </div>
    )}
    <div className="plan-scroll" ref={scroller}>
    <svg className={`plan ${previewing ? 'previewing' : ''} ${entry} ${view === 'apartment' ? 'axo' : ''} ${rule ? `works-${rule}` : ''}`} viewBox={`0 0 720 ${view === 'terrace' ? TERRACE_H : BLOCK_H}`} role="group" aria-label={view === 'terrace' ? 'Plan of Jalan Demo 1' : 'Section through Block A'}>
      <defs>
        <pattern id="hatch-works" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" style={{ stroke: 'var(--works)' }} strokeWidth="2" opacity="0.45" />
        </pattern>
        <pattern id="hatch-wall" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" style={{ fill: 'var(--works-bg)' }} />
          <line x1="0" y1="0" x2="0" y2="5" style={{ stroke: 'var(--works)' }} strokeWidth="2.4" />
        </pattern>
        <linearGradient id="me-fill" x1="0" y1="0" x2="1" y2="1">
          {/* the face's own gradient, so the map's "you" matches the legend on both faces */}
          <stop offset="0%" style={{ stopColor: 'var(--grad-a)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--grad-b)' }} />
        </linearGradient>
      </defs>

      {view === 'terrace' ? <TerraceFrame rowB={t('plan.rowB')} lane={t('plan.lane')} scale={t('plan.scale')} /> : <BlockFrame stackPos={me.kind === 'apartment' ? me.pos : null} />}

      {shown.map((u) => {
        const b = box(u)
        return (
          <g key={u.id} className={`home ${cls(u)} ${selected === u.id ? 'selected' : ''} ${onSelect ? '' : 'static'} ${wetPath.includes(u) ? 'wet-path' : ''} ${shaken.includes(u) ? 'shaken' : ''}`}
            role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} style={order(u)}
            aria-label={`${u.label}${names[u.id] ? `, ${names[u.id]}` : ''}${worksAt.has(u.id) ? ', renovating' : ''}`}
            onClick={() => onSelect?.(u.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect?.(u.id)}>
            <rect className="home-fill" x={b.x} y={b.y} width={b.w} height={b.h} />
            {(worksAt.has(u.id) || (previewing && u.id === me.id)) && <rect className="home-works" x={b.x} y={b.y} width={b.w} height={b.h} />}
          </g>
        )
      })}

      {links.map((l) => <line key={l.id} className={`plan-link ${previewing ? 'notify' : ''}`} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} />)}

      {/* wet: the water's way down the stack, two floors */}
      {mine && wetPath.length > 0 && (
        <path className="drip" d={`M${centre(mine).x} ${mine.y + mine.h - 6} V${Math.max(...wetPath.map((u) => box(u).y + box(u).h)) - 8}`} />
      )}
      {/* hacking: vibration through the frame, marked beside each unit it reaches */}
      {shaken.map((u) => {
        const b = box(u)
        return [b.x - 9, b.x + b.w + 3].map((x) => (
          <path key={`${u.id}-${x}`} className="vibe" d={`M${x} ${b.y + 10} l6 6 l-6 6 l6 6 l-6 6`} />
        ))
      })}
      {/* terrace: works that reach the back fence and drain, which the home behind shares */}
      {mine && behindTold && behindBox && (
        <rect className="back-reach" x={mine.x + 6} y={mine.y + mine.h} width={mine.w - 12} height={behindBox.y - mine.y - mine.h} />
      )}

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

      {!previewing && walls.map(({ u, edge }) => {
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
        const short = u.kind === 'terrace' ? u.label.replace('No. ', '') : `${u.floor}-${u.pos}`
        const tall = b.h > 60
        return (
          <g key={u.id} className={`home-label ${isMe ? 'me' : ''}`} pointerEvents="none" style={order(u)}>
            <text x={c.x} y={tall ? c.y - 3 : c.y - 1} className="home-no">{short}</text>
            {u.id === behindId && !previewing ? (
              <text x={c.x} y={c.y + 13} className="home-name behind-note">
                {twoLines(t('plan.behind')).map((line, i) => <tspan key={i} x={c.x} dy={i ? 10 : 0}>{line}</tspan>)}
              </text>
            ) : <text x={c.x} y={tall ? c.y + 15 : c.y + 13} className="home-name">{isMe ? t('plan.you') : names[u.id] ?? ''}</text>}
            {worksAt.has(u.id) && !previewing && <text x={b.x + b.w - 6} y={b.y + 12} className="home-tag">{t('plan.works')}</text>}
          </g>
        )
      })}

      {selected && shown.some((u) => u.id === selected) && (() => {
        const b = box(shown.find((u) => u.id === selected)!)
        return <rect className="select-ring" x={b.x - 5} y={b.y - 5} width={b.w + 10} height={b.h + 10} rx="4" pointerEvents="none" />
      })()}
      {/* your home: one pulse when the plan opens */}
      {mine && <rect className="me-glow" x={mine.x - 2} y={mine.y - 2} width={mine.w + 4} height={mine.h + 4} rx="3" pointerEvents="none" />}
    </svg>
    </div>
    </div>
    {explain && selected && explain[selected] && <div className="plan-explain" role="status">{explain[selected]}</div>}
    <div className="plan-hint">{t('plan.swipe')}</div>
    </>
  )
}

/** A short note over two lines, split at the space nearest the middle. */
function twoLines(text: string): string[] {
  const spaces = [...text.matchAll(/ /g)].map((m) => m.index ?? 0)
  if (!spaces.length) return [text]
  const cut = spaces.reduce((a, b) => (Math.abs(b - text.length / 2) < Math.abs(a - text.length / 2) ? b : a))
  return [text.slice(0, cut), text.slice(cut + 1)]
}

function TerraceFrame({ rowB, lane, scale }: { rowB: string; lane: string; scale: string }) {
  const right = X0 + 6 * W
  return (
    <g className="frame" pointerEvents="none">
      <line className="dim" x1={X0} y1="30" x2={right} y2="30" />
      <line className="dim" x1={X0} y1="24" x2={X0} y2="36" />
      <line className="dim" x1={right} y1="24" x2={right} y2="36" />
      <text className="dim-text" x={(X0 + right) / 2} y="24">{rowB}</text>
      <line className="setback" x1={X0} y1="148" x2={right} y2="148" />
      <rect className="road" x="20" y="158" width="680" height="54" />
      <line className="road-centre" x1="24" y1="185" x2="696" y2="185" />
      <text className="road-name" x="360" y="190">JALAN DEMO 1</text>
      <line className="setback" x1={X0} y1="222" x2={right} y2="222" />
      {/* behind row A: the back lane and its drain, then row C, which faces Jalan Demo 2 */}
      <rect className="back-lane" x="20" y="322" width="680" height="16" />
      <line className="drain" x1="24" y1="335" x2="696" y2="335" />
      <text className="dim-text lane-text" x={(X0 + right) / 2} y="333">{lane}</text>
      <line className="setback" x1={X0} y1="436" x2={right} y2="436" />
      <rect className="road" x="20" y="444" width="680" height="34" />
      <text className="road-name" x="360" y="465">JALAN DEMO 2</text>
      <NorthArrow />
      <ScaleBar label={scale} y={TERRACE_H - 20} />
    </g>
  )
}

function BlockFrame({ stackPos }: { stackPos: number | null }) {
  const right = AX0 + 4 * AW
  const bottom = AY0 + FLOORS * AH
  return (
    <g className="frame" pointerEvents="none">
      {stackPos && (
        <>
          <rect className="stack" x={AX0 + (stackPos - 1) * AW - 6} y={AY0 - 20} width={AW + 12} height={FLOORS * AH + 28} rx="6" />
          <text className="stack-label" x={AX0 + (stackPos - 0.5) * AW} y={AY0 - 24}>YOUR STACK</text>
        </>
      )}
      {/* the block in depth: the side of every floor, each rising with its floor, and the roof on top */}
      {Array.from({ length: FLOORS }, (_, i) => (
        <polygon key={i} className="axo-side" style={{ '--f': FLOORS - 1 - i } as React.CSSProperties}
          points={`${right},${AY0 + i * AH} ${right + DX},${AY0 + i * AH + DY} ${right + DX},${AY0 + (i + 1) * AH + DY} ${right},${AY0 + (i + 1) * AH}`} />
      ))}
      <g className="axo-roof" style={{ '--f': FLOORS - 1 } as React.CSSProperties}>
        <polygon className="axo-top" points={`${AX0},${AY0} ${AX0 + DX},${AY0 + DY} ${right + DX},${AY0 + DY} ${right},${AY0}`} />
        {[1, 2, 3].map((p) => <line key={p} className="axo-edge" x1={AX0 + p * AW} y1={AY0} x2={AX0 + p * AW + DX} y2={AY0 + DY} />)}
      </g>
      {Array.from({ length: FLOORS }, (_, i) => (
        <text key={i} className="level" x={AX0 - 22} y={AY0 + i * AH + AH / 2 + 4}>L{TOP_FLOOR - i}</text>
      ))}
      <path className="break" d={`M${AX0 - 12} ${bottom + 14} l40 0 l8 -9 l8 18 l8 -9 l${4 * AW - 40} 0`} />
      <text className="dim-text" x={(AX0 + right) / 2} y={bottom + 36}>LEVELS 1–10 NOT SHOWN</text>
      <ScaleBar label="SECTION · 1:300" y={BLOCK_H - 20} />
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

function ScaleBar({ label, y }: { label: string; y: number }) {
  return (
    <g className="scale" transform={`translate(40 ${y})`}>
      <rect x="0" y="0" width="30" height="5" className="on" />
      <rect x="30" y="0" width="30" height="5" />
      <rect x="60" y="0" width="30" height="5" className="on" />
      <text x="0" y="16">0</text>
      <text x="60" y="16">10 m</text>
      <text x="640" y="8" className="sheet-label">{label}</text>
    </g>
  )
}
