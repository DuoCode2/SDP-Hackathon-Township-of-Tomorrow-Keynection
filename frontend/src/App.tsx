import { useEffect, useState } from 'react'
import { Building2, Calculator, Camera, CalendarClock, CircleUserRound, Columns2, Compass, Grid3x3, HandHeart, Hexagon, Languages, LayoutDashboard, MessagesSquare, Network, ShieldHalf, Smartphone } from 'lucide-react'
import { api, onReachability, type UnitInfo } from './api'
import { Avatar, ToastProvider } from './ui'
import type { GuideLang, TabId } from './guide'
import { EnglishOnly, LangProvider, useDates, useLang, type UiLang } from './i18n'
import { HelperProvider, useActing, useHelper } from './helper'
import Guide from './components/Guide'
import CastPicker, { roleOf } from './components/Cast'
import { Logo } from './components/Art'
import CircleView from './screens/CircleView'
import ChatsView from './screens/ChatsView'
import WorksView from './screens/WorksView'
import EvidenceView from './screens/EvidenceView'
import HistoryView from './screens/HistoryView'
import DashboardView from './screens/DashboardView'
import SafeguardsView from './screens/SafeguardsView'
import MeView from './screens/MeView'
import JoinView from './screens/JoinView'
import PlannerView from './screens/PlannerView'
import ImpactView from './screens/ImpactView'
import ChannelsView from './screens/ChannelsView'

// Labels come from the dictionary: nav.<id>, nav.<id>.sub, nav.<id>.short.
const NAV = [
  {
    group: 'resident',
    items: [
      { id: 'circle', icon: Network, dock: true },
      { id: 'chats', icon: MessagesSquare, dock: true },
      { id: 'works', icon: CalendarClock, dock: true },
      { id: 'evidence', icon: Camera, dock: true },
      { id: 'log', icon: Hexagon, dock: false },
      { id: 'me', icon: CircleUserRound, dock: true },
    ],
  },
  {
    group: 'sdp',
    items: [
      { id: 'sdp', icon: LayoutDashboard, dock: false },
      { id: 'planner', icon: Grid3x3, dock: false },
      { id: 'impact', icon: Calculator, dock: false },
      { id: 'channels', icon: Smartphone, dock: false },
    ],
  },
  { group: 'trust', items: [{ id: 'safeguards', icon: ShieldHalf, dock: false }] },
] as const

type NavItem = (typeof NAV)[number]['items'][number] & { group: string; no: string }
const ALL: NavItem[] = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group }))).map((i, n) => ({ ...i, no: String(n + 1).padStart(2, '0') }))
const WIDE = '(min-width: 1600px)'
const SPLIT_OK = '(min-width: 1100px)'
const UI_LANGS: { code: UiLang; tag: string; name: string }[] = [
  { code: 'en', tag: 'EN', name: 'English' }, { code: 'ms', tag: 'BM', name: 'Bahasa Melayu' }, { code: 'zh', tag: '中', name: '中文' },
]

type PaneState = { me: string; tab: TabId; peer?: string }

// Two faces: people screens are warm; records (works, evidence, log, SDP) keep the blueprint look.
const WARM: TabId[] = ['circle', 'chats', 'me']
// SDP's side stays in English on purpose; every resident screen follows the chosen language.
const ENGLISH_TABS: TabId[] = ['sdp', 'planner', 'impact', 'channels', 'safeguards']
// A household that hasn't joined sees the join page on these; its home log (the property's record) stays viewable.
const NEEDS_JOIN: TabId[] = ['circle', 'chats', 'works', 'evidence', 'me']
const faceOf = (tab: TabId) => (WARM.includes(tab) ? 'face-warm' : 'face-blueprint')

function storedLang(): GuideLang {
  try {
    return localStorage.getItem('jiran5.guideLang') === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

export default function App() {
  return (
    <LangProvider>
      <HelperProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </HelperProvider>
    </LangProvider>
  )
}

function Shell() {
  const { lang: uiLang, setLang: setUiLang, t } = useLang()
  const dates = useDates()
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
    api.units().then((u) => setUnits(u)).catch(() => {})
  }, [version])
  // Any request that can't reach the server shows the banner; the next one that gets through clears it.
  useEffect(() => onReachability((ok) => setOffline(!ok)), [])

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

  // One switch for the interface; the guide follows it (it has English and Chinese).
  const pickUiLang = (l: UiLang) => {
    setUiLang(l)
    pickLang(l === 'zh' ? 'zh' : 'en')
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
        {!compact && <Icon size={17} strokeWidth={on ? 2.3 : 1.9} className="nav-lead" />}
        {compact ? t(`nav.${i.id}.short`) : (
          <span className="nav-text">
            <b>{t(`nav.${i.id}`)}</b>
            <small>{t(`nav.${i.id}.sub`)}</small>
          </span>
        )}
        {!compact && <Icon size={16} strokeWidth={on ? 2.3 : 1.8} className="nav-icon" />}
        {i.id === 'evidence' && pending > 0 && <span className="dot" aria-label="Repair waiting for you" />}
      </button>
    )
  }

  const groupTitle = (g: string) => t(`group.${g}`)

  return (
    <div className={`app ${faceOf(cur.tab)} ${guideOpen ? 'guide-on' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Logo size={24} /></div>
          <div>
            <div className="brand-name">Keynection</div>
            <div className="brand-sub">EVERY KEY · FIVE NEIGHBOURS</div>
          </div>
        </div>
        {NAV.map((g) => (
          <nav key={g.group} className="nav-group" aria-label={groupTitle(g.group)}>
            <div className="nav-title">{groupTitle(g.group)}</div>
            {ALL.filter((i) => i.group === g.group).map((i) => navButton(i, false))}
          </nav>
        ))}
        <dl className="title-block" aria-label="Drawing title block">
          <div className="tb-wide"><dt>Project</dt><dd><Building2 size={12} /> Taman Demo · Phase 1</dd></div>
          <div><dt>Sheet</dt><dd>{page.no} / {String(ALL.length).padStart(2, '0')}</dd></div>
          <div><dt>Rev</dt><dd>0.5</dd></div>
          <div className="tb-wide"><dt>Viewing as</dt><dd>{curUnit ? `${curUnit.resident_name} · ${curUnit.label}` : '–'}</dd></div>
          <div className="tb-wide"><dt>Data</dt><dd>Fictional · runs offline</dd></div>
        </dl>
        {curUnit && (
          <button className="side-home" onClick={() => setTab('me')}>
            <Avatar name={curUnit.resident_name} size={40} />
            <span className="grow">
              <small>{t('side.home')}</small>
              <b>{curUnit.resident_name} · {curUnit.label}</b>
              <em>{t('side.keys', { date: dates.date(curUnit.handover_date) })}</em>
            </span>
          </button>
        )}
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="brand mobile-only">
            <div className="brand-mark"><Logo size={24} /></div>
            <div className="brand-name">Keynection</div>
          </div>
          <div className="crumb desktop-only">
            <span className="crumb-sheet">Sheet {page.no}</span>
            <span className="crumb-sep">—</span>
            <b>{t(`nav.${page.id}`)}</b>
            {split && <span className="crumb-pane">{focus === 0 ? 'left pane' : 'right pane'}</span>}
          </div>
          <div className="topbar-right">
            <LiveClock />
            <div className="lang-switch" role="group" aria-label={t('top.lang')} title={t('top.lang')}>
              {UI_LANGS.map((l) => (
                <button key={l.code} className={uiLang === l.code ? 'on' : ''} aria-pressed={uiLang === l.code} onClick={() => pickUiLang(l.code)} title={l.name}>{l.tag}</button>
              ))}
            </div>
            {!split && <CastPicker units={units} me={cur.me} onPick={setMe} />}
            {canSplit && (
              <button className={`split-btn ${split ? 'on' : ''}`} onClick={toggleSplit} aria-pressed={split}
                title="See both sides of the shared wall at once">
                <Columns2 size={16} /> <span className="desktop-only">{t('top.bothSides')}</span>
              </button>
            )}
            <button className={`guide-btn ${guideOpen ? 'on' : ''}`} onClick={() => setGuideOpen((o) => !o)} aria-pressed={guideOpen}>
              <Compass size={16} />
              <span className="desktop-only">{lang === 'zh' ? '导览' : 'Guide'}</span>
            </button>
          </div>
        </header>

        <main className={`content ${split ? 'split' : faceOf(cur.tab)}`}>
          {offline && (
            <div className="card offline-banner" role="alert" style={{ margin: 16 }}>
              <strong>{t('offline.title')}</strong>
              <p className="muted small">{t('offline.body')} <span className="mono">(Demo: is the backend running?)</span></p>
              <button className="btn btn-sm btn-primary" onClick={changed}>{t('offline.retry')}</button>
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

        <nav className="dock">{ALL.filter((i) => i.dock).map((i) => navButton(i, true))}</nav>
      </div>

      <Guide tab={cur.tab} me={cur.me} lang={lang} open={guideOpen} onLang={pickLang} onClose={() => setGuideOpen(false)} onGo={go} />
      <div id="sheet-root" />
    </div>
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
  const { t, lang } = useLang()
  const me = units.find((u) => u.id === pane.me)
  const helper = useHelper(pane.me)
  const { setActing } = useActing()
  const [pending, setPending] = useState(0)
  const [easy, setEasy] = useState(false)
  const joined = me?.joined ?? true

  // Easy mode is a private household setting, so it is read from the household's own profile.
  useEffect(() => {
    if (!joined) {
      setEasy(false)
      return
    }
    let live = true
    api.profile(pane.me).then((p) => live && setEasy(p.easy_mode)).catch(() => live && setEasy(false))
    return () => {
      live = false
    }
  }, [pane.me, version, joined])

  // Amber dot on Evidence when a repair is waiting for this household's confirmation.
  useEffect(() => {
    api.myWarranty(pane.me).then((t) => setPending(t.filter((x) => x.status === 'repair_submitted').length)).catch(() => {})
  }, [pane.me, version])

  const tab = (t: TabId) => onUpdate({ tab: t, peer: undefined })
  const screen = me && (
    <div key={`${pane.tab}-${pane.me}`} className={`screen-wrap ${easy ? 'easy' : ''}`}>
      {helper && (
        <div className="helper-banner" role="status">
          <HandHeart size={17} />
          <span className="grow">{t('helpers.banner', { owner: me.resident_name, name: `${helper.name} (${t(`relation.${helper.relation}`)})` })}</span>
          <button className="btn btn-sm" onClick={() => setActing(null)}>{t('helpers.stop')}</button>
        </div>
      )}
      {lang !== 'en' && ENGLISH_TABS.includes(pane.tab) && !(me && !me.joined && NEEDS_JOIN.includes(pane.tab)) && <div className="records-note"><Languages size={14} /> {t('records.english')}</div>}
      {!me.joined && NEEDS_JOIN.includes(pane.tab) ? <JoinView me={me} onJoined={onChange} /> : <>
      {pane.tab === 'circle' && <CircleView me={me} units={units} version={version} onChange={onChange}
        onViewAs={(id) => onUpdate({ me: id })} onOpenChat={(peer) => onUpdate({ tab: 'chats', peer })} onOpenEvidence={() => tab('evidence')} />}
      {pane.tab === 'chats' && <ChatsView me={me} version={version} onChange={onChange} peer={pane.peer} onPeer={(peer) => onUpdate({ peer })} />}
      {pane.tab === 'works' && <WorksView me={me} units={units} version={version} onChange={onChange} />}
      {pane.tab === 'evidence' && <EvidenceView me={me} version={version} onChange={onChange} />}
      {pane.tab === 'log' && <HistoryView me={me} units={units} version={version} />}
      {/* SDP's side stays in English, including the resident components it reuses (clock, comparison, concerns). */}
      {pane.tab === 'sdp' && <EnglishOnly><DashboardView version={version} onChange={onChange} onViewAs={(id) => onUpdate({ me: id, tab: 'circle', peer: undefined })} /></EnglishOnly>}
      {pane.tab === 'planner' && <EnglishOnly><PlannerView /></EnglishOnly>}
      {pane.tab === 'impact' && <EnglishOnly><ImpactView /></EnglishOnly>}
      {pane.tab === 'channels' && <EnglishOnly><ChannelsView me={me} version={version} /></EnglishOnly>}
      {pane.tab === 'safeguards' && <EnglishOnly><SafeguardsView onGo={tab} /></EnglishOnly>}
      {pane.tab === 'me' && <MeView me={me} version={version} onChange={onChange} onGo={tab} />}
      </>}
    </div>
  )

  if (!split) return <div className="content-inner">{screen}</div>

  return (
    <section className={`pane ${faceOf(pane.tab)} ${active ? 'active' : ''}`} onMouseDownCapture={onFocus} onFocusCapture={onFocus} aria-label={`Pane ${index + 1}`}>
      <div className="pane-head">
        <CastPicker units={units} me={pane.me} onPick={(id) => onUpdate({ me: id, peer: undefined })} compact />
        <span className="pane-role">{roleOf(pane.me, t)}</span>
        <div className="pane-tabs" role="tablist">
          {ALL.map((i) => {
            const Icon = i.icon
            return (
              <button key={i.id} role="tab" aria-selected={pane.tab === i.id} className={pane.tab === i.id ? 'on' : ''} onClick={() => tab(i.id)} title={t(`nav.${i.id}`)}>
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
  const dates = useDates()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="clock desktop-only" title="Prototype running live">
      <span className="pulse" /> LIVE · {dates.time(now)}
    </span>
  )
}
