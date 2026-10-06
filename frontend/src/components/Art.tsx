import { useId } from 'react'

// Hand-drawn style illustrations, all inline SVG so the demo works offline.

const WALLS: [string, string][] = [
  ['#FFF1E6', '#F9D9BF'], ['#ECF6EE', '#CFE6D3'], ['#FFF8E1', '#F5E1A4'],
  ['#EAF2FB', '#C9DCF2'], ['#FCEEF1', '#F0CBD4'], ['#F2EEFA', '#D8CCEE'],
]
const DOORS = ['#D85A30', '#2F6F5E', '#3B5BA9', '#8C4A2F', '#C9952C', '#7A4FA0']

function hash(text: string): number {
  return [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
}

/** A household's front door: every home gets its own colours and door, no photo needed. */
export function DoorAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const clip = useId()
  const h = hash(name)
  const [bg, wall] = WALLS[h % WALLS.length]
  const door = DOORS[(h >> 3) % DOORS.length]
  const gable = ((h >> 5) & 1) === 0
  const style = (h >> 7) % 3
  const plant = ((h >> 9) & 1) === 0
  const wallTop = gable ? 29 : 25
  return (
    <svg className="door-avatar" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={name}>
      <clipPath id={clip}><circle cx="32" cy="32" r="32" /></clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect width="64" height="64" fill={bg} />
        <rect x="0" y="55" width="64" height="9" fill={wall} opacity="0.6" />
        {gable
          ? <path d="M12 31 L32 14 L52 31 Z" fill="#9A4A36" />
          : <rect x="13" y="19" width="38" height="7" rx="1.5" fill="#56636B" />}
        <rect x="17" y={wallTop} width="30" height={55 - wallTop} fill={wall} />
        <rect x="19.5" y={wallTop + 5} width="5.5" height="5.5" rx="1" fill="#fff" opacity="0.9" />
        {style === 0 && <rect x="27" y="37" width="11" height="18" rx="1.5" fill={door} />}
        {style === 1 && <path d="M27 55 V43 a5.5 5.5 0 0 1 11 0 V55 Z" fill={door} />}
        {style === 2 && (
          <>
            <rect x="25.5" y="38" width="6.5" height="17" rx="1" fill={door} />
            <rect x="33" y="38" width="6.5" height="17" rx="1" fill={door} />
          </>
        )}
        <circle cx={style === 2 ? 31 : 35.5} cy="47" r="1.1" fill="#fff" opacity="0.85" />
        {plant && (
          <>
            <circle cx="44" cy="50.5" r="3.2" fill="#5E9E6E" />
            <rect x="42.3" y="52" width="3.4" height="3.5" rx="0.6" fill="#B5533C" />
          </>
        )}
      </g>
    </svg>
  )
}

/** Five homes around one: the five-household circle. */
export function Logo({ size = 20, color = '#fff' }: { size?: number; color?: string }) {
  const homes = [0, 1, 2, 3, 4].map((i) => {
    const a = (-90 + i * 72) * (Math.PI / 180)
    return { x: 16 + Math.cos(a) * 10, y: 16 + Math.sin(a) * 10 }
  })
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="10" fill="none" stroke={color} strokeWidth="1.2" strokeDasharray="1.6 2.2" opacity="0.7" />
      {homes.map((p, i) => (
        <path key={i} transform={`translate(${p.x} ${p.y})`} d="M-3.4 2.4 V-0.9 L0 -3.8 L3.4 -0.9 V2.4 Z" fill={color} />
      ))}
      <circle cx="16" cy="16" r="2.6" fill={color} />
    </svg>
  )
}

export type ArtKind = 'chat' | 'house' | 'camera' | 'inbox' | 'shield' | 'handshake'

/** Small empty-state illustrations. */
export function Art({ kind }: { kind: ArtKind }) {
  return (
    <svg className="art" viewBox="0 0 160 110" aria-hidden>
      <ellipse cx="80" cy="98" rx="58" ry="7" fill="#EFE6DA" />
      {kind === 'chat' && (
        <>
          <rect x="30" y="22" width="62" height="38" rx="14" fill="#FDE3D7" />
          <path d="M44 60 l-6 12 l16 -12 Z" fill="#FDE3D7" />
          <rect x="68" y="44" width="62" height="36" rx="14" fill="#E0603E" />
          <path d="M116 80 l8 11 l-18 -11 Z" fill="#E0603E" />
          <circle cx="86" cy="62" r="3.4" fill="#fff" /><circle cx="99" cy="62" r="3.4" fill="#fff" /><circle cx="112" cy="62" r="3.4" fill="#fff" />
          <rect x="42" y="35" width="38" height="4" rx="2" fill="#F0B39C" /><rect x="42" y="44" width="26" height="4" rx="2" fill="#F0B39C" />
        </>
      )}
      {kind === 'house' && (
        <>
          <circle cx="122" cy="26" r="11" fill="#F7C873" />
          <path d="M44 56 L80 26 L116 56 Z" fill="#9A4A36" />
          <rect x="52" y="54" width="56" height="40" fill="#F9D9BF" />
          <rect x="74" y="66" width="13" height="28" rx="2" fill="#2F6F5E" />
          <rect x="58" y="62" width="10" height="10" rx="1.5" fill="#fff" /><rect x="93" y="62" width="10" height="10" rx="1.5" fill="#fff" />
          <circle cx="40" cy="88" r="7" fill="#5E9E6E" /><circle cx="122" cy="89" r="6" fill="#5E9E6E" />
        </>
      )}
      {kind === 'camera' && (
        <>
          <rect x="40" y="34" width="80" height="54" rx="10" fill="#2B2622" />
          <rect x="62" y="26" width="24" height="12" rx="4" fill="#2B2622" />
          <circle cx="80" cy="61" r="17" fill="#F6F0E8" /><circle cx="80" cy="61" r="10" fill="#E0603E" />
          <circle cx="108" cy="44" r="3" fill="#F7C873" />
          <path d="M120 22 l4 -8 M128 28 l8 -4 M126 38 l9 2" stroke="#E0603E" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {kind === 'inbox' && (
        <>
          <path d="M40 60 L52 30 H108 L120 60 V88 H40 Z" fill="#C9DCF2" />
          <path d="M40 60 H64 a16 10 0 0 0 32 0 H120 V88 H40 Z" fill="#3B5BA9" />
          <path d="M70 18 v16 M80 14 v20 M90 18 v16" stroke="#3B5BA9" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
        </>
      )}
      {kind === 'shield' && (
        <>
          <path d="M80 16 L114 28 V54 C114 76 98 88 80 94 C62 88 46 76 46 54 V28 Z" fill="#CFE6D3" />
          <path d="M80 26 L104 35 V54 C104 70 93 80 80 84 Z" fill="#3E9E77" />
          <path d="M66 55 l10 10 l19 -21" stroke="#fff" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {kind === 'handshake' && (
        <>
          <circle cx="56" cy="48" r="20" fill="#FDE3D7" /><circle cx="104" cy="48" r="20" fill="#CFE6D3" />
          <path d="M44 74 C60 60 72 62 80 70 C88 62 100 60 116 74" stroke="#2B2622" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M70 68 l10 10 l10 -10" stroke="#E0603E" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  )
}
