import { useEffect, useRef, useState } from 'react'
import { Mic, Send, ShieldCheck, Sparkles, X } from 'lucide-react'
import { api, type AssistantPlan, type Directory, type QuietTimes, type RenovationDraft, type UnitInfo } from '../api'
import type { TabId } from '../guide'
import { noisyHours, useDates, useLang } from '../i18n'
import { useAi, usePilot } from '../features'
import { Sheet, useCelebrate, useToast } from '../ui'
import RenovationWizard from '../screens/RenovationWizard'
import IntroWizard from '../screens/IntroWizard'

// Three sentences a judge can try without typing (demo only), one in each language the screens speak.
const EXAMPLES = [
  'Saturday I’m retiling the bathroom, ABC Renovation, two weeks',
  'Sabtu ni saya nak tukar jubin bilik air, dua minggu',
  '我下周六开始换浴室瓷砖，大概两个星期',
]
const SPEECH_LANG = { en: 'en-MY', ms: 'ms-MY', zh: 'zh-CN' } as const

// The browser's speech recognition, where there is one (Chrome and Edge call it webkitSpeechRecognition).
type Recognition = {
  lang: string
  interimResults: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
const speech = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
const Listener = speech.SpeechRecognition ?? speech.webkitSpeechRecognition

type Answer = { said: string; plan: AssistantPlan }
type Windows = QuietTimes['windows']

/** The household's assistant: hold to talk, or type. What it reads is made ready to check, never sent for you; only
 * moving between pages and the household's own quiet time happen at once (and a quiet time can be undone). */
export default function Assistant({ me, units, tab, onGo, onChanged }: {
  me: UnitInfo
  units: UnitInfo[]
  tab: TabId
  onGo: (tab: TabId, peer?: string) => void
  onChanged: () => void
}) {
  const { t, lang } = useLang()
  const dates = useDates()
  const toast = useToast()
  const celebrate = useCelebrate()
  const pilot = usePilot()
  const ai = useAi()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [heard, setHeard] = useState<string | null>(null)  // null: not listening
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [quiet, setQuiet] = useState<{ before: Windows; undone: boolean } | null>(null)
  const [reno, setReno] = useState<{ names: Record<string, string>; from: { said: string; renovation: RenovationDraft | null } } | null>(null)
  const [hello, setHello] = useState<{ circle: Directory['circle']; pick: string[] } | null>(null)
  const [easy, setEasy] = useState(false)
  const listener = useRef<Recognition | null>(null)
  const said = useRef('')
  // Heard in the language the screens are in; a Tamil-reading household on the English screens is heard in Tamil.
  const speechLang = lang === 'en' && me.lang === 'ta' ? 'ta-IN' : SPEECH_LANG[lang]

  // Easy mode is the household's own setting: the button grows with it.
  useEffect(() => {
    api.profile(me.id).then((p) => setEasy(p.easy_mode)).catch(() => setEasy(false))
    setAnswer(null)
    setQuiet(null)
  }, [me.id])

  async function ask(words: string) {
    const what = words.trim()
    if (!what || busy) return
    setBusy(true)
    setAnswer(null)
    setQuiet(null)
    try {
      const plan = await api.assistant(me.id, what, tab, lang)
      setText('')
      if (plan.intent === 'go_to_page' && plan.page) {
        onGo(plan.page)
        setOpen(false)
        toast(plan.reply)
        return
      }
      setAnswer({ said: what, plan })
      if (plan.intent === 'set_quiet_time' && plan.quiet_window) await addQuiet(plan.quiet_window)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not ask', 'error')
    } finally {
      setBusy(false)
    }
  }

  /** The household's own quiet time is low-risk, so it is added at once; Undo puts the old ones back. */
  async function addQuiet(w: NonNullable<AssistantPlan['quiet_window']>) {
    try {
      const before = (await api.quietTimes(me.id)).windows
      await api.setQuietTimes(me.id, [...before.filter((x) => x.start !== w.start || x.end !== w.end), w])
      setQuiet({ before, undone: false })
      toast(t('assistant.quiet.added', { hours: `${w.start}–${w.end}`, why: t(`qt.why.${w.why}`) }))
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', 'error')  // more than two, or over three hours a day
    }
  }

  async function undoQuiet() {
    if (!quiet) return
    try {
      await api.setQuietTimes(me.id, quiet.before)
      setQuiet({ ...quiet, undone: true })
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', 'error')
    }
  }

  // The wizards show names only for homes this household may know (its circle and accepted contacts).
  const names = (d: Directory) => {
    const n: Record<string, string> = { [me.id]: me.resident_name }
    d.circle.forEach((x) => { n[x.id] = x.resident_name })
    d.nearby.forEach((x) => { if (x.resident_name) n[x.id] = x.resident_name })
    return n
  }
  const openReno = (a: Answer) => api.directory(me.id).then((d) => {
    onGo('works')
    setOpen(false)
    setReno({ names: names(d), from: { said: a.said, renovation: a.plan.renovation } })
  })
  const openHello = (a: Answer) => api.directory(me.id).then((d) => {
    onGo('circle')
    setOpen(false)
    setHello({ circle: d.circle, pick: a.plan.hello_ids })
  })

  /** Hold to talk: the words appear as they are heard, and are asked when the button is let go. */
  function listen() {
    if (!Listener || listener.current || busy) return
    const r = new Listener()
    r.lang = speechLang
    r.interimResults = true
    said.current = ''
    r.onresult = (e) => {
      said.current = Array.from(e.results, (x) => x[0].transcript).join('')
      setHeard(said.current)
    }
    r.onerror = (e) => { if (e.error === 'not-allowed') toast(t('assistant.micBlocked'), 'error') }
    r.onend = () => {
      listener.current = null
      setHeard(null)
      if (said.current.trim()) {
        setText(said.current)
        void ask(said.current)
      }
    }
    listener.current = r
    setHeard('')
    try {
      r.start()
    } catch {
      listener.current = null
      setHeard(null)
    }
  }
  const stop = () => listener.current?.stop()
  const close = () => {
    stop()
    setOpen(false)
  }

  const plan = answer?.plan
  const r = plan?.renovation
  const hours = plan?.quiet_window ? `${plan.quiet_window.start}–${plan.quiet_window.end}` : ''
  return (
    <>
      <button className={`assistant-fab ${easy ? 'big' : ''}`} onClick={() => setOpen(true)} aria-label={t('assistant.open')} title={t('assistant.open')}>
        <Mic size={easy ? 28 : 22} />
      </button>

      <Sheet open={open} onClose={close}>
        <div className="assistant">
          <div className="assistant-head">
            <Sparkles size={16} /> <b className="grow">{t('assistant.title')}</b>
            <button className="icon-btn" onClick={close} aria-label={t('btn.cancel')}><X size={16} /></button>
          </div>
          {Listener ? (
            <button type="button" className={`assistant-mic ${heard !== null ? 'on' : ''}`} disabled={busy}
              onPointerDown={(e) => { e.preventDefault(); listen() }} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
              onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); listen() } }}
              onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') stop() }} onContextMenu={(e) => e.preventDefault()}>
              <Mic size={26} /> {t(heard !== null ? 'assistant.listening' : 'assistant.hold')}
            </button>
          ) : <small className="muted">{t('assistant.noVoice')}</small>}
          {heard && <p className="assistant-heard" aria-live="polite">{heard}</p>}
          <form className="assistant-type" onSubmit={(e) => { e.preventDefault(); void ask(text) }}>
            <label className="field grow">
              <input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder={t('assistant.type')} aria-label={t('assistant.type')} />
            </label>
            <button className="btn btn-primary" disabled={!text.trim() || busy}><Send size={14} /> {t('assistant.ask')}</button>
          </form>
          {busy && <small className="muted" role="status">{t('assistant.working')}</small>}

          {answer && plan && (
            <div className="assistant-answer" aria-live="polite">
              <p className="assistant-reply">{plan.reply}</p>
              {/* Key words only: AI is off here, or it is on and didn't answer in time (then the same words can be asked again) */}
              {!plan.by_ai && (ai?.on
                ? <button type="button" className="link assistant-retry" disabled={busy} onClick={() => void ask(answer.said)}>{t('assistant.retry')}</button>
                : <small className="muted">{t('assistant.keywords')}</small>)}
              {plan.intent === 'register_renovation' && (
                <div className="assistant-card">
                  <b>{t(r ? 'assistant.reno.title' : 'assistant.reno.empty')}</b>
                  {r && (
                    <dl className="notice-grid">
                      <div><dt>{t('reno.steps.type')}</dt><dd>{t(`works.${r.works_type}`)}</dd></div>
                      {r.scope && <div><dt>{t('reno.work')}</dt><dd>{r.scope}</dd></div>}
                      {r.start && r.end && <div><dt>{t('reno.dates')}</dt><dd>{dates.range(r.start, r.end)}</dd></div>}
                      {r.noisy_from && <div><dt>{t('reno.noisy')}</dt><dd>{noisyHours(t, r)}</dd></div>}
                      <div><dt>{t('reno.contractor')}</dt><dd>{r.contractor || '–'}</dd></div>
                    </dl>
                  )}
                  <button className="btn btn-primary" onClick={() => openReno(answer)}>{t('assistant.reno.open')}</button>
                </div>
              )}
              {plan.intent === 'say_hello' && (
                <div className="assistant-card">
                  <b>{t('assistant.hello.title', { who: plan.hello_to.length ? plan.hello_to.join(', ') : t('assistant.hello.all') })}</b>
                  <button className="btn btn-primary" onClick={() => openHello(answer)}>{t('assistant.hello.open')}</button>
                </div>
              )}
              {plan.intent === 'set_quiet_time' && (quiet && plan.quiet_window ? (
                <div className="assistant-card row">
                  <b className="grow">{quiet.undone ? t('assistant.quiet.undone', { hours })
                    : t('assistant.quiet.added', { hours, why: t(`qt.why.${plan.quiet_window.why}`) })}</b>
                  {!quiet.undone && <button className="btn btn-sm" onClick={undoQuiet}>{t('assistant.undo')}</button>}
                </div>
              ) : <button className="btn" onClick={() => { onGo(plan.page ?? 'circle'); close() }}>{t('assistant.go')}</button>)}
              {/* An answer from the rules only; anything else is for the estate office (ChatsView's channel). */}
              {plan.intent === 'answer' && (
                <button className="link" onClick={() => { onGo('chats', '__estate'); close() }}>{t('assistant.estate')}</button>
              )}
              {plan.intent === 'check_status' && plan.page && (
                <button className="btn" onClick={() => { onGo(plan.page!); close() }}>{t('assistant.go')}</button>
              )}
            </div>
          )}

          {(!pilot || plan?.intent === 'unknown') && (
            <div className="ai-examples">
              <small className="muted">{t('assistant.try')}</small>
              {EXAMPLES.map((x) => <button key={x} type="button" className="btn btn-sm" disabled={busy} onClick={() => { setText(x); void ask(x) }}>{x}</button>)}
            </div>
          )}
          <small className="muted"><ShieldCheck size={12} /> {t('assistant.never')}</small>
        </div>
      </Sheet>

      {reno && <RenovationWizard open onClose={() => setReno(null)} me={me} units={units} names={reno.names} onSent={onChanged} fromAssistant={reno.from} />}
      {hello && <IntroWizard open onClose={() => setHello(null)} me={me} circle={hello.circle} pick={hello.pick}
        onSent={() => { celebrate('👋', t('celebrate.hello')); onChanged() }} />}
    </>
  )
}
