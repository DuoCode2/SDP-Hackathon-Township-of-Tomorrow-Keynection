import { useEffect, useState } from 'react'
import { Camera, CalendarClock, Hexagon, LayoutDashboard, MessageCircle, Network } from 'lucide-react'
import { api, type UnitInfo } from './api'
import { Avatar, ToastProvider } from './ui'
import CircleView from './screens/CircleView'
import InboxView from './screens/InboxView'
import WorksView from './screens/WorksView'
import EvidenceView from './screens/EvidenceView'
import HistoryView from './screens/HistoryView'
import DashboardView from './screens/DashboardView'

type Tab = 'circle' | 'chats' | 'works' | 'evidence' | 'log' | 'sdp'

const TABS = [
  { id: 'circle', label: 'Circle', icon: Network },
  { id: 'chats', label: 'Chats', icon: MessageCircle },
  { id: 'works', label: 'Works', icon: CalendarClock },
  { id: 'evidence', label: 'Evidence', icon: Camera },
  { id: 'log', label: 'Log', icon: Hexagon },
  { id: 'sdp', label: 'SDP', icon: LayoutDashboard },
] as const

export default function App() {
  const [units, setUnits] = useState<UnitInfo[]>([])
  const [me, setMe] = useState('T-12')
  const [tab, setTab] = useState<Tab>('circle')
  const [offline, setOffline] = useState(false)
  const [pending, setPending] = useState(0)
  // Bumped after every write so the open screen reloads its data.
  const [version, setVersion] = useState(0)
  const changed = () => setVersion((v) => v + 1)

  useEffect(() => {
    api.units().then(setUnits).catch(() => setOffline(true))
  }, [])

  // Amber dot on Evidence when a repair is waiting for this household's confirmation.
  useEffect(() => {
    api.myWarranty(me).then((t) => setPending(t.filter((x) => x.status === 'repair_submitted').length)).catch(() => {})
  }, [me, version])

  const current = units.find((u) => u.id === me)

  return (
    <div className="stage">
      <div className="device">
        <ToastProvider>
          <header className="topbar">
            <div className="brand">
              <div className="brand-mark">
                <Network size={18} strokeWidth={2.4} />
              </div>
              <div>
                <div className="brand-name">Jiran5</div>
                <div className="brand-sub">PROTOTYPE · DEMO</div>
              </div>
            </div>
            {current && (
              <label className="acting" title="Switch which household you are acting as">
                <Avatar name={current.resident_name} size={26} />
                <select value={me} onChange={(e) => setMe(e.target.value)} aria-label="Acting as household">
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label} · {u.resident_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </header>

          <main className="content">
            {offline && (
              <div className="card">
                <strong>Can't reach the server</strong>
                <p className="muted small">Start the backend on port 8000, then reload this page.</p>
              </div>
            )}
            {current && (
              <div key={`${tab}-${me}`}>
                {tab === 'circle' && <CircleView me={current} units={units} version={version} onChange={changed} onPick={setMe} />}
                {tab === 'chats' && <InboxView me={current} version={version} onChange={changed} />}
                {tab === 'works' && <WorksView me={current} version={version} onChange={changed} />}
                {tab === 'evidence' && <EvidenceView me={current} version={version} onChange={changed} />}
                {tab === 'log' && <HistoryView me={current} version={version} />}
                {tab === 'sdp' && <DashboardView version={version} onChange={changed} />}
              </div>
            )}
          </main>

          <nav className="dock">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} className={id === tab ? 'active' : ''} onClick={() => setTab(id)} aria-current={id === tab}>
                <Icon size={19} strokeWidth={id === tab ? 2.4 : 1.9} />
                {label}
                {id === 'evidence' && pending > 0 && <span className="dot" aria-label="Repair waiting for you" />}
              </button>
            ))}
          </nav>
          <div id="sheet-root" />
        </ToastProvider>
      </div>
    </div>
  )
}
