import { useEffect, useRef, useState } from 'react'
import { MoveHorizontal } from 'lucide-react'
import type { Region } from '../api'

interface Props {
  before: string
  after: string
  overlay: string
  regions: Region[]
  leftLabel: string
  rightLabel: string
  /** Play the scan animation (first time a result is shown). */
  scan?: boolean
}

const HUD_COLOR = '#f0375f'

export default function Compare({ before, after, overlay, regions, leftLabel, rightLabel, scan = true }: Props) {
  const frame = useRef<HTMLDivElement>(null)
  const [highlight, setHighlight] = useState(true)
  const [scanning, setScanning] = useState(scan)

  useEffect(() => {
    if (!scan) return
    const id = setTimeout(() => setScanning(false), 1250)
    return () => clearTimeout(id)
  }, [scan])

  // Write the CSS variable directly so dragging never re-renders React (smooth on slow phones).
  const move = (value: string) => frame.current?.style.setProperty('--cut', `${value}%`)

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="card-row">
        <div className="grow mono muted">DRAG TO COMPARE</div>
        <div className="toggle">
          <button className={highlight ? 'on' : ''} onClick={() => setHighlight(true)}>Detect</button>
          <button className={!highlight ? 'on' : ''} onClick={() => setHighlight(false)}>Raw</button>
        </div>
      </div>
      <div ref={frame} className="compare" style={{ ['--cut' as string]: '42%' }}>
        <img src={before} alt="Before" decoding="async" />
        <div className="after-layer">
          <img src={highlight ? overlay : after} alt="After, aligned to the before photo" decoding="async" />
          {highlight &&
            !scanning &&
            regions.map((r, i) => (
              <div
                key={i}
                className="hud"
                style={{
                  left: `${r.x * 100 - 1.5}%`,
                  top: `${r.y * 100 - 2}%`,
                  width: `${r.w * 100 + 3}%`,
                  height: `${r.h * 100 + 4}%`,
                  ['--c' as string]: HUD_COLOR,
                  ['--delay' as string]: `${i * 120}ms`,
                }}
              >
                <span className={`hud-label ${r.y < 0.14 ? 'below' : ''}`}>
                  {String(i + 1).padStart(2, '0')} · {r.shape === 'line' ? 'LINE' : 'PATCH'} · {(r.area_ratio * 100).toFixed(2)}%
                </span>
              </div>
            ))}
        </div>
        <span className="tag left">{leftLabel}</span>
        <span className="tag right">{rightLabel}</span>
        <div className="handle"><div className="knob"><MoveHorizontal size={15} /></div></div>
        {scanning && (
          <>
            <div className="scan" />
            <div className="scan-label">ALIGNING · ANALYSING</div>
          </>
        )}
        <input type="range" min={0} max={100} defaultValue={42} aria-label="Drag to compare before and after"
          onInput={(e) => move((e.target as HTMLInputElement).value)} />
      </div>
    </div>
  )
}
