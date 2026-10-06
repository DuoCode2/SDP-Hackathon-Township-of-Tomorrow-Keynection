import { useEffect, useState } from 'react'
import { Building2, Camera, CalendarClock, Columns2, Compass, Hexagon, LayoutDashboard, MessagesSquare, Network, ShieldHalf } from 'lucide-react'
import { api, type UnitInfo } from './api'
import { ToastProvider } from './ui'
import type { GuideLang, TabId } from './guide'
import Guide from './components/Guide'
import CastPicker, { roleOf } from './components/Cast'
import CircleView from './screens/CircleView'
import ChatsView from './screens/ChatsView'
import WorksView from './screens/WorksView'
import EvidenceView from './screens/EvidenceView'
import HistoryView from './screens/HistoryView'
import DashboardView from './screens/DashboardView'
import SafeguardsView from './screens/SafeguardsView'

const NAV = [
  {
    group: 'Resident',
    items: [
      { id: 'circle', label: 'Circle', short: 'Circle', sub: 'Your five neighbours', icon: Network },
      { id: 'chats', label: 'Chats', short: 'Chats', sub: 'Talk & raise concerns', icon: MessagesSquare },
      { id: 'works', label: 'Works', short: 'Works', sub: 'Calendar & gate passes', icon: CalendarClock },
      { id: 'evidence', label: 'Evidence', short: 'Evidence', sub: 'Photos & warranty', icon: Camera },
      { id: 'log', label: 'Home log', short: 'Log', sub: 'Tamper-evident record', icon: Hexagon },
    ],
  },
  {
    group: 'Sime Darby Property',
    items: [{ id: 'sdp', label: 'Command view', short: 'SDP', sub: 'Warranty, estate, safety', icon: LayoutDashboard }],
  },
  {
    group: 'Trust',
    items: [{ id: 'safeguards', label: 'Safeguards', short: 'Trust', sub: 'Risks we designed for', icon: ShieldHalf }],
  },
] as const

type NavItem = (typeof NAV)[number]['items'][number] & { group: string; no: string }
const ALL: NavItem[] = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group }))).map((i, n) => ({ ...i, no: String(n + 1).padStart(2, '0') }))
const WIDE = '(min-width: 1600px)'
const SPLIT_OK = '(min-width: 1100px)'

type PaneState = { me: string; tab: TabId; peer?: string }

function storedLang(): GuideLang {
  try {
    return localStorage.getItem('jiran5.guideLang') === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

export default function App() {
  const [units, setUnits] = useState<UnitInfo[]>([])
  const [panes, setPanes] = useState<PaneState[]>([{ me: 'T-12', tab: 'circle' }])
  const [active, setActive] = useState(0)
  const [offline, setOffline] = useState(false)
  const [guideOpen, setGuideOpen] = useState(() => window.matchMedia(WIDE).matches)
  const [lang, setLang] = useState<GuideLang>(storedLang)
  const [canSplit, setCanSplit] = useState(() => window.matchMedia(SPLIT_OK).matches)
  // Bumped after every write so every open pane reloads its data.
  const [version, setVersion] = useState(0)
  const changed = () => setVersion((v) => v + 1)

  useEffect(() => {
    api.units().then((u) => { setUnits(u); setOffline(false) }).catch(() => setOffline(true))
  }, [version])

  useEffect(() => {
    const mq = window.matchMedia(SPLIT_OK)
    const on = () => setCanSplit(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const split = panes.length === 2 && canSplit
  const shown = split ? panes : [panes[Math.min(active, panes.length - 1)]]
  const focus = split ? active : Math.min(active, panes.length - 1)
  const cur = panes[focus]

  const update = (i: number, patch: Partial<PaneState>) => setPanes((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const setTab = (tab: TabId) => update(focus, { tab, peer: undefined })
  const setMe = (me: string) => update(focus, { me, peer: undefined })

  const toggleSplit = () => {
    if (panes.length === 2) {
      setPanes([panes[focus]])
      setActive(0)
      return
    }
    // Both sides of the shared wall: the renovating owner on the left, the neighbour on the right.
    const left = cur.me === 'T-11' ? { me: 'T-12', tab: cur.tab } : cur
    const right = cur.me === 'T-11' ? cur : { me: cur.me === 'T-12' ? 'T-11' : 'T-12', tab: cur.tab }
    setPanes([left, right])
    setActive(cur.me === 'T-11' ? 1 : 0)
  }

  const pickLang = (l: GuideLang) => {
    setLang(l)
    try {
      localStorage.setItem('jiran5.guideLang', l)
    } catch {
      // Private window: the choice just isn't remembered.
    }
  }

  // Guide steps: in split view, drive the pane that already shows that household.
  const go = (next: TabId, unit?: string) => {
    const target = split && unit ? panes.findIndex((p) => p.me === unit) : -1
    const i = target >= 0 ? target : focus
    update(i, { tab: next, peer: undefined, ...(unit ? { me: unit } : {}) })
    setActive(i)
    if (!window.matchMedia(WIDE).matches) setGuideOpen(false)
  }

  const page = ALL.find((i) => i.id === cur.tab)!
  const curUnit = units.find((u) => u.id === cur.me)
  const [pending, setPending] = useState(0)
  useEffect(() => {
    api.myWarranty(cur.me).then((t) => setPending(t.filter((x) => x.status === 'repair_submitted').length)).catch(() => {})
  }, [cur.me, version])

  const navButton = (i: NavItem, compact: boolean) => {
    const Icon = i.icon
    const on = i.id === cur.tab
    return (
      <button key={i.id} className={on ? 'active' : ''} onClick={() => setTab(i.id)} aria-current={on ? 'page' : undefined}>
        {compact ? <Icon size={19} strokeWidth={on ? 2.4 : 1.9} /> : <span className="nav-no">{i.no}</span>}
        {compact ? i.short : (
          <span className="nav-text">
            <b>{i.label}</b>
            <small>{i.sub}</small>
          </span>
        )}
        {!compact && <Icon size={16} strokeWidth={on ? 2.3 : 1.8} className="nav-icon" />}
        {i.id === 'evidence' && pending > 0 && <span className="dot" aria-label="Repair waiting for you" />}
      </button>
    )
  }

  return (
    <ToastProvider>
      <div className={`app ${guideOpen ? 'guide-on' : ''}`}>
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark"><Network size={18} strokeWidth={2.4} /></div>
            <div>
              <div className="brand-name">Jiran5</div>
              <div className="brand-sub">NEIGHBOURS · ON RECORD</div>
            </div>
          </div>
          {NAV.map((g) => (
            <nav key={g.group} className="nav-group" aria-label={g.group}>
              <div className="nav-title">{g.group}</div>
              {ALL.filter((i) => i.group === g.group).map((i) => navButton(i, false))}
            </nav>
          ))}
          <dl className="title-block" aria-label="Drawing title block">
            <div className="tb-wide"><dt>Project</dt><dd><Building2 size={12} /> Taman Demo · Phase 1</dd></div>
            <div><dt>Sheet</dt><dd>{page.no} / {String(ALL.length).padStart(2, '0')}</dd></div>
            <div><dt>Rev</dt><dd>0.4</dd></div>
            <div className="tb-wide"><dt>Viewing as</dt><dd>{curUnit ? `${curUnit.resident_name} · ${curUnit.label}` : '–'}</dd></div>
            <div className="tb-wide"><dt>Data</dt><dd>Fictional · runs offline</dd></div>
          </dl>
        </aside>

        <div className="main">
          <header className="topbar">
            <div className="brand mobile-only">
              <div className="brand-mark"><Network size={18} strokeWidth={2.4} /></div>
              <div className="brand-name">Jiran5</div>
            </div>
            <div className="crumb desktop-only">
              <span>Sheet {page.no}</span>
              <span className="crumb-sep">—</span>
              <b>{page.label}</b>
              {split && <span className="crumb-pane">{focus === 0 ? 'left pane' : 'right pane'}</span>}
            </div>
            <div className="topbar-right">
              <LiveClock />
              {!split && <CastPicker units={units} me={cur.me} onPick={setMe} />}
              {canSplit && (
                <button className={`split-btn ${split ? 'on' : ''}`} onClick={toggleSplit} aria-pressed={split}
                  title="See both sides of the shared wall at once">
                  <Columns2 size={16} /> <span className="desktop-only">Both sides</span>
                </button>
              )}
              <button className={`guide-btn ${guideOpen ? 'on' : ''}`} onClick={() => setGuideOpen((o) => !o)} aria-pressed={guideOpen}>
                <Compass size={16} />
                <span className="desktop-only">{lang === 'zh' ? '导览' : 'Guide'}</span>
              </button>
            </div>
          </header>

          <main className={`content ${split ? 'split' : ''}`}>
            {offline && (
              <div className="card" style={{ margin: 16 }}>
                <strong>Can't reach the server</strong>
                <p className="muted small">Start the backend on port 8000, then reload this page.</p>
              </div>
            )}
            {split ? (
              <div className="split-grid">
                {shown.map((p, i) => [
                  i === 1 && (
                    <div key="wall" className="wall" aria-hidden>
                      <span>SHARED WALL</span>
                    </div>
                  ),
                  <Pane key={i} index={i} pane={p} units={units} active={focus === i} split version={version} onChange={changed}
                    onFocus={() => setActive(i)} onUpdate={(patch) => update(i, patch)} />,
                ])}
              </div>
            ) : (
              <Pane index={focus} pane={cur} units={units} active split={false} version={version} onChange={changed}
                onFocus={() => {}} onUpdate={(patch) => update(focus, patch)} />
            )}
          </main>

          <nav className="dock">{ALL.map((i) => navButton(i, true))}</nav>
        </div>

        <Guide tab={cur.tab} me={cur.me} lang={lang} open={guideOpen} onLang={pickLang} onClose={() => setGuideOpen(false)} onGo={go} />
        <div id="sheet-root" />
      </div>
    </ToastProvider>
  )
}

function Pane({ index, pane, units, active, split, version, onChange, onFocus, onUpdate }: {
  index: number
  pane: PaneState
  units: UnitInfo[]
  active: boolean
  split: boolean
  version: number
  onChange: () => void
  onFocus: () => void
  onUpdate: (patch: Partial<PaneState>) => void
}) {
  const me = units.find((u) => u.id === pane.me)
  const [pending, setPending] = useState(0)

  // Amber dot on Evidence when a repair is waiting for this household's confirmation.
  useEffect(() => {
    api.myWarranty(pane.me).then((t) => setPending(t.filter((x) => x.status === 'repair_submitted').length)).catch(() => {})
  }, [pane.me, version])

  const tab = (t: TabId) => onUpdate({ tab: t, peer: undefined })
  const screen = me && (
    <div key={`${pane.tab}-${pane.me}`} className="screen-wrap">
      {pane.tab === 'circle' && <CircleView me={me} units={units} version={version} onChange={onChange}
        onViewAs={(id) => onUpdate({ me: id })} onOpenChat={(peer) => onUpdate({ tab: 'chats', peer })} />}
      {pane.tab === 'chats' && <ChatsView me={me} version={version} onChange={onChange} peer={pane.peer} onPeer={(peer) => onUpdate({ peer })} />}
      {pane.tab === 'works' && <WorksView me={me} version={version} onChange={onChange} />}
      {pane.tab === 'evidence' && <EvidenceView me={me} version={version} onChange={onChange} />}
      {pane.tab === 'log' && <HistoryView me={me} version={version} />}
      {pane.tab === 'sdp' && <DashboardView version={version} onChange={onChange} />}
      {pane.tab === 'safeguards' && <SafeguardsView onGo={tab} />}
    </div>
  )

  if (!split) return <div className="content-inner">{screen}</div>

  return (
    <section className={`pane ${active ? 'active' : ''}`} onMouseDownCapture={onFocus} onFocusCapture={onFocus} aria-label={`Pane ${index + 1}`}>
      <div className="pane-head">
        <CastPicker units={units} me={pane.me} onPick={(id) => onUpdate({ me: id, peer: undefined })} compact />
        <span className="pane-role">{roleOf(pane.me)}</span>
        <div className="pane-tabs" role="tablist">
          {ALL.map((i) => {
            const Icon = i.icon
            return (
              <button key={i.id} role="tab" aria-selected={pane.tab === i.id} className={pane.tab === i.id ? 'on' : ''} onClick={() => tab(i.id)} title={i.label}>
                <Icon size={15} />
                {i.id === 'evidence' && pending > 0 && <span className="dot" />}
              </button>
            )
          })}
        </div>
      </div>
      <div className="pane-body">
        <div className="content-inner">{screen}</div>
      </div>
    </section>
  )
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="clock desktop-only" title="Prototype running live">
      <span className="pulse" /> LIVE · {now.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}
