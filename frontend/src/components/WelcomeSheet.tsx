import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { Printer, X } from 'lucide-react'
import type { WelcomeCard } from '../api'
import { Logo } from './Art'
import { count, formatDate } from '../ui'

/** Welcome-pack cards to print: one per home, with the owner's own QR code. The code works once; whoever holds the
 *  card can join as that home, so it goes into the welcome pack handed to the owner with the keys. */
export default function WelcomeSheet({ phase, cards, onClose }: { phase: string; cards: WelcomeCard[]; onClose: () => void }) {
  const [qrs, setQrs] = useState<Record<string, string>>({})

  useEffect(() => {
    let live = true
    const link = (token: string) => `${window.location.origin}/?join=${token}`
    Promise.all(cards.map((c) => QRCode.toDataURL(link(c.token), { margin: 1, width: 240, errorCorrectionLevel: 'M', color: { dark: '#0b1220', light: '#ffffff' } })
      .then((url) => [c.unit_id, url] as const)))
      .then((pairs) => { if (live) setQrs(Object.fromEntries(pairs)) })
    return () => { live = false }
  }, [cards])

  const ready = Object.keys(qrs).length === cards.length
  return createPortal(
    <div className="print-pages welcome-sheet" role="dialog" aria-label="Welcome-pack cards">
      <div className="welcome-sheet-bar no-print">
        <div>
          <b>{count(cards.length, 'welcome-pack card')} · {phase}</b>
          <small className="muted">Each code works once. Print now: the codes are not shown again.</small>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary btn-sm" disabled={!ready} onClick={() => window.print()}><Printer size={14} /> Print</button>
          <button className="btn btn-sm" onClick={onClose}><X size={14} /> Close</button>
        </div>
      </div>
      <div className="welcome-cards">
        {cards.map((c) => (
          <article key={c.unit_id} className="welcome-card">
            <header>
              <span className="welcome-card-mark"><Logo size={16} /></span>
              <span>Keynection · {phase}</span>
            </header>
            <h2>{c.label}</h2>
            <div className="welcome-card-where">{c.street ?? (c.block ? `Block ${c.block}` : '')}{c.owner ? ` · For ${c.owner}` : ''}</div>
            <div className="welcome-card-body">
              {qrs[c.unit_id] ? <img src={qrs[c.unit_id]} alt={`Join code for ${c.label}`} /> : <span className="welcome-card-qr" />}
              <ol>
                <li lang="en">Scan with your phone camera to meet the homes around yours. Your phone becomes your key: no password.</li>
                <li lang="ms">Imbas dengan kamera telefon untuk berkenalan dengan jiran di sekeliling rumah anda. Telefon anda menjadi kunci: tiada kata laluan.</li>
                <li lang="zh">用手机相机扫描，认识你家周围的邻居。手机就是你的钥匙，不用密码。</li>
              </ol>
            </div>
            <footer>
              <span className="mono">{c.token}</span>
              <span>Valid once, until {formatDate(c.expires_at)}</span>
            </footer>
          </article>
        ))}
      </div>
    </div>,
    document.body,
  )
}
