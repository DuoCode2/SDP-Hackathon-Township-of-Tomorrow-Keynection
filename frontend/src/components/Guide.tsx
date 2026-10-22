import { Compass, Eye, Focus, Lightbulb, Sparkles, X } from 'lucide-react'
import { JUDGE_ROUTE, PAGES, ROUTE, UI, type GuideLang, type RouteStep, type TabId } from '../guide'
import { useAi } from '../features'

interface Props {
  tab: TabId
  me: string
  lang: GuideLang
  open: boolean
  onLang: (lang: GuideLang) => void
  onClose: () => void
  onGo: (tab: TabId, unit?: string, opts?: { split?: boolean; peer?: string }) => void
  showAll: boolean
  onShowAll: (on: boolean) => void
}

// Explains the current screen and walks through the demo routes (the 3-minute judge route first, then the full one).
// A side column on wide screens, a drawer otherwise.
export default function Guide({ tab, me, lang, open, onLang, onClose, onGo, showAll, onShowAll }: Props) {
  const page = PAGES[tab]
  const ai = useAi()
  const steps =(route: RouteStep[], judge = false) => (
    <ol className={`route ${judge ? 'route-judge' : ''}`}>
      {route.map((s, i) => {
        const here = s.tab === tab && (!s.unit || s.unit === me)
        const line = s.brief?.[lang] ?? s.text[lang]
        return (
          <li key={i}>
            <button className={here ? 'here' : ''} onClick={() => onGo(s.tab, s.unit, { split: s.split, peer: s.peer })}
              aria-label={`${UI.step[lang].replace('{n}', String(i + 1))}: ${line}`}>
              <span className="route-n">{i + 1}</span>
              <span>{line}</span>
            </button>
            {s.brief && (
              <details className="route-more">
                <summary>{UI.more[lang]}</summary>
                <p>{s.text[lang]}</p>
              </details>
            )}
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
          <div className="toggle" role="group" aria-label={UI.language[lang]}>
            <button className={lang === 'zh' ? 'on' : ''} onClick={() => onLang('zh')}>中文</button>
            <button className={lang === 'en' ? 'on' : ''} onClick={() => onLang('en')}>EN</button>
            <button className={lang === 'ms' ? 'on' : ''} onClick={() => onLang('ms')}>BM</button>
          </div>
          <button className="icon-btn" onClick={onClose} title={UI.close[lang]} aria-label={UI.close[lang]}><X size={16} /></button>
        </div>

        <div className="guide-body" lang={lang === 'zh' ? 'zh-Hans' : lang === 'ms' ? 'ms' : 'en'}>
          <p className="guide-about">{UI.about[lang]}</p>

          <div className="section-label">{UI.judgeRoute[lang]}</div>
          {ai && (
            <p className={`guide-ai ${ai.on ? 'on' : ''}`} title={ai.on && ai.model ? `${ai.provider ?? 'AI'} · ${ai.model}` : undefined}>
              <Sparkles size={13} /> {ai.on ? UI.aiOn[lang] : UI.aiOff[lang]}
            </p>
          )}
          {steps(JUDGE_ROUTE, true)}
          <details className="guide-notes">
            <summary>{UI.notesForJudges[lang]}</summary>
            <p className="guide-hint">{UI.judgeHint[lang]}</p>
            <p className="guide-hint">{UI.whoseScreen[lang]}</p>
            <p className="guide-hint">{UI.sharedDemo[lang]}</p>
            <p className="guide-hint">{UI.previewNote[lang]}</p>
          </details>

          <div className="section-label">{UI.thisPage[lang]}</div>
          <div className="guide-card">
            <span className="badge badge-brand">{page.layer[lang]}</span>
            <h2>{page.title[lang]}</h2>
            <p>{page.what[lang]}</p>
            <details className="guide-more">
              <summary className="guide-sub">{UI.features[lang]}</summary>
              <ul>
                {page.features[lang].map((f) => <li key={f}>{f}</li>)}
              </ul>
              <div className="guide-why">
                <Lightbulb size={15} />
                <div><b>{UI.why[lang]}</b>{page.why[lang]}</div>
              </div>
            </details>
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
