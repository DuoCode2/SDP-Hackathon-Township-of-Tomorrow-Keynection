import { Compass, Eye, Focus, Lightbulb, X } from 'lucide-react'
import { JUDGE_ROUTE, PAGES, ROUTE, UI, type GuideLang, type RouteStep, type TabId } from '../guide'

interface Props {
  tab: TabId
  me: string
  lang: GuideLang
  open: boolean
  onLang: (lang: GuideLang) => void
  onClose: () => void
  onGo: (tab: TabId, unit?: string) => void
  showAll: boolean
  onShowAll: (on: boolean) => void
}

// Explains the current screen and walks through the demo routes (the 3-minute judge route first, then the full one).
// A side column on wide screens, a drawer otherwise.
export default function Guide({ tab, me, lang, open, onLang, onClose, onGo, showAll, onShowAll }: Props) {
  const page = PAGES[tab]
  const steps = (route: RouteStep[], judge = false) => (
    <ol className={`route ${judge ? 'route-judge' : ''}`}>
      {route.map((s, i) => {
        const here = s.tab === tab && (!s.unit || s.unit === me)
        return (
          <li key={i}>
            <button className={here ? 'here' : ''} onClick={() => onGo(s.tab, s.unit)}>
              <span className="route-n">{i + 1}</span>
              <span>{s.text[lang]}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
  return (
    <>
      {open && <div className="guide-scrim" onClick={onClose} />}
      <aside className={`guide ${open ? 'open' : ''}`} aria-label={UI.guide[lang]} aria-hidden={!open}>
        <div className="guide-head">
          <div className="guide-heading"><Compass size={16} /> {UI.guide[lang]}</div>
          <div className="toggle" role="group" aria-label="Language">
            <button className={lang === 'zh' ? 'on' : ''} onClick={() => onLang('zh')}>中文</button>
            <button className={lang === 'en' ? 'on' : ''} onClick={() => onLang('en')}>EN</button>
          </div>
          <button className="icon-btn" onClick={onClose} title={UI.close[lang]} aria-label={UI.close[lang]}><X size={16} /></button>
        </div>

        <div className="guide-body" lang={lang === 'zh' ? 'zh-Hans' : 'en'}>
          <p className="guide-about">{UI.about[lang]}</p>

          <div className="section-label">{UI.judgeRoute[lang]}</div>
          <p className="guide-hint">{UI.judgeHint[lang]}</p>
          {steps(JUDGE_ROUTE, true)}

          <div className="section-label">{UI.thisPage[lang]}</div>
          <div className="guide-card">
            <span className="badge badge-brand">{page.layer[lang]}</span>
            <h2>{page.title[lang]}</h2>
            <p>{page.what[lang]}</p>
            <div className="guide-sub">{UI.features[lang]}</div>
            <ul>
              {page.features[lang].map((f) => <li key={f}>{f}</li>)}
            </ul>
            <div className="guide-why">
              <Lightbulb size={15} />
              <div><b>{UI.why[lang]}</b>{page.why[lang]}</div>
            </div>
          </div>

          {showAll && <>
            <div className="section-label">{UI.route[lang]}</div>
            <p className="guide-hint">{UI.routeHint[lang]}</p>
            {steps(ROUTE)}
          </>}
          <div className="guide-scope">
            <p className="guide-hint">{showAll ? UI.focusOnlyHint[lang] : UI.showAllHint[lang]}</p>
            <button className="btn btn-sm" onClick={() => onShowAll(!showAll)}>
              {showAll ? <><Focus size={14} /> {UI.focusOnly[lang]}</> : <><Eye size={14} /> {UI.showAll[lang]}</>}
            </button>
          </div>
          <p className="guide-hint">{UI.fictional[lang]}</p>
        </div>
      </aside>
    </>
  )
}
