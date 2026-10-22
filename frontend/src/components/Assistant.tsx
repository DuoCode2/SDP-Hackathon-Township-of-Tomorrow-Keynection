import { useEffect, useRef, useState } from 'react'
import { Ear, Mic, Send, ShieldCheck, Square, Volume2, X } from 'lucide-react'
import { api, ApiError, type AssistantPlan, type AssistantTurn, type Directory, type QuietTimes, type RenovationDraft, type UnitInfo } from '../api'
import type { TabId } from '../guide'
import { noisyHours, useDates, useLang } from '../i18n'
import { useAi, usePilot } from '../features'
import { useCelebrate, useToast } from '../ui'
import RenovationWizard from '../screens/RenovationWizard'
import IntroWizard from '../screens/IntroWizard'
import { forget, remember, remembered } from '../storage'
import { ASK_EVENT } from '../welcome'
import { WAKE_PHRASE, WakeWord, chime, holdWake, recordSentence, wakeSupported, withoutWakePhrase, type WakeState } from '../wake'
import { canSpeak, speak, type Speaking } from '../speech'

// One sentence a judge can try without typing (demo only), in the language the screens are in: the same story as
// the guide's step 2, so what the chip does and what the guide says agree.
const EXAMPLES: Record<string, string> = {
  en: 'Retiling the master bathroom from next Monday, ABC Renovation, two weeks',
  ms: 'Isnin depan saya nak tukar jubin bilik air utama, ABC Renovation, dua minggu',
  zh: '我下周一开始换主浴室瓷砖，ABC Renovation，大概两个星期',
}
// Once the household's own notice is out, the same chip asks a question instead: the notice is not sent twice.
const EXAMPLES_AFTER: Record<string, string> = {
  en: 'Can my contractor come on Sunday?',
  ms: 'Boleh kontraktor saya datang hari Ahad?',
  zh: '我的承包商可以星期天来吗？',
}
const SPEECH_LANG = { en: 'en-MY', ms: 'ms-MY', zh: 'zh-CN' } as const
const PHONE = '(max-width: 899.98px)'
const HISTORY = 6  // the last few messages go with each question, so a follow-up is understood
const HANDS_FREE_WAIT_MS = 8000  // after "Hello Neighbour", how long the browser's listening waits for words
const FOLLOW_UP_WAIT_MS = 5000  // after a spoken reply, how long it keeps listening for the next question, no wake word
const WAKE_TO_LISTEN_MS = 350  // the chime and the ripple first, so the listening doesn't start on the chime
const NAME_MS = 5000  // how long the corner orb says its name before folding back into the orb

// The browser's speech recognition, where there is one (Chrome and Edge call it webkitSpeechRecognition).
type Recognition = {
  lang: string
  interimResults: boolean
  continuous?: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
const speech = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
const Listener = speech.SpeechRecognition ?? speech.webkitSpeechRecognition

type Windows = QuietTimes['windows']
/** One message of the chat. The assistant's carry what it got ready, and for a quiet time what Undo puts back. */
type Msg = { id: number; who: 'resident'; text: string }
  | { id: number; who: 'assistant'; text: string; said: string; plan: AssistantPlan; quiet?: { before: Windows; undone: boolean } }

/** The household's assistant, as a chat: ask anything about your home, neighbours and the house rules, or say what you
 *  want to do. What it gets ready is for you to check, never sent for you; only moving between pages and the
 *  household's own quiet time happen at once (and a quiet time can be undone). */
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
  const [chat, setChat] = useState<Msg[]>([])
  const [reno, setReno] = useState<{ names: Record<string, string>; from: { said: string; renovation: RenovationDraft | null } } | null>(null)
  // Whether this household's own notice is already out (the example chip then asks a question instead).
  const [hasWorks, setHasWorks] = useState(false)
  useEffect(() => {
    let live = true
    api.works(me.id).then((w) => live && setHasWorks(w.mine.length > 0)).catch(() => live && setHasWorks(false))
    return () => {
      live = false
    }
  }, [me.id, open])
  const [hello, setHello] = useState<{ circle: Directory['circle']; pick: string[] } | null>(null)
  const [easy, setEasy] = useState(false)
  const [wake, setWake] = useState<WakeState>('off')
  const [handsFree, setHandsFree] = useState(false)  // listening because "Hello Neighbour" was heard
  const [more, setMore] = useState(false)  // listening for a follow-up, right after a spoken reply (no wake word)
  // Hands-free is offered once, after the household has used the microphone once by hand (so the first thing the
  // chat asks for is never the microphone); after that only the ear button.
  const [offer, setOffer] = useState(() => remembered('wake') === null && remembered('wakeOffered') === null)
  const [micUsed, setMicUsed] = useState(() => remembered('micUsed') !== null)
  const noteMicUse = () => {
    if (micUsed) return
    remember('micUsed', '1')
    setMicUsed(true)
  }
  // The orb in the corner says its name ("Hello Neighbour") for a few seconds the first time it appears in this
  // browser, and once more each time hands-free is switched on and starts listening; then it folds back into the orb.
  const [named, setNamed] = useState(() => remembered('named') === null)
  const announce = useRef(false)
  // What the voice is doing, shown in the panel above the text box: the wake ripple, listening, turning a recording
  // into words, or speaking a reply (thinking is `busy`). `level` moves the orb with the voice, 0 to 1.
  const [phase, setPhase] = useState<'idle' | 'waking' | 'listening' | 'transcribing' | 'speaking'>('idle')
  const [level, setLevel] = useState(0)
  const [woke, setWoke] = useState(false)
  const [speakingId, setSpeakingId] = useState<number | null>(null)
  const speaking = useRef<Speaking | null>(null)
  const cancelled = useRef(false)
  const wakeWord = useRef<WakeWord | null>(null)
  const onWake = useRef<() => void>(() => undefined)
  const recording = useRef<ReturnType<typeof recordSentence> | null>(null)
  const listener = useRef<Recognition | null>(null)
  const said = useRef('')
  const log = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)
  // Heard in the language the screens are in; a Tamil-reading household on the English screens is heard in Tamil.
  const speechLang = lang === 'en' && me.lang === 'ta' ? 'ta-IN' : SPEECH_LANG[lang]
  // Where words come from when spoken: the browser's own listening, or else the server's (demo only).
  const serverEars = !Listener && !!ai?.listen
  const canHear = !!Listener || serverEars

  // Hands-free, as this browser last left it. After a page load the audio waits for a tap (WakeWord.resume).
  useEffect(() => {
    if (remembered('wake') === '1' && wakeSupported()) void turnWake(true)
    return () => wakeWord.current?.stop()
  }, [])
  useEffect(() => {
    if (wake !== 'paused') return
    const tap = () => wakeWord.current?.resume()
    window.addEventListener('pointerdown', tap)
    return () => window.removeEventListener('pointerdown', tap)
  }, [wake])
  useEffect(() => {
    if (!named) return
    remember('named', '1')
    const t = window.setTimeout(() => setNamed(false), NAME_MS)
    return () => window.clearTimeout(t)
  }, [named])
  // The first-day tour's "Ask now" opens the chat, the same as tapping the orb.
  useEffect(() => {
    const ask = () => setOpen(true)
    window.addEventListener(ASK_EVENT, ask)
    return () => window.removeEventListener(ASK_EVENT, ask)
  }, [])
  useEffect(() => {
    if (wake === 'listening' && announce.current) {
      announce.current = false
      setNamed(true)
    }
  }, [wake])

  // Another household starts a chat of its own. Easy mode is the household's setting: the button grows with it.
  useEffect(() => {
    api.profile(me.id).then((p) => setEasy(p.easy_mode)).catch(() => setEasy(false))
    setChat([])
  }, [me.id])

  // The newest message in view; the text box ready to type in; Escape closes the chat.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [chat, busy, open])
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const update = (id: number, patch: Partial<Extract<Msg, { who: 'assistant' }>>) =>
    setChat((c) => c.map((m) => (m.id === id && m.who === 'assistant' ? { ...m, ...patch } : m)))

  /** Hands-free on or off; `byHand`: the household just chose it (not a page load remembering it), so the corner orb
   *  says its name once it listens. */
  async function turnWake(on: boolean, byHand = false) {
    if (!on) {
      wakeWord.current?.stop()
      wakeWord.current = null
      setWake('off')
      forget('wake')
      return
    }
    if (wakeWord.current) return
    const w = new WakeWord(() => onWake.current(), setWake)
    wakeWord.current = w
    remember('wake', '1')
    remember('wakeOffered', '1')
    setOffer(false)
    announce.current = byHand
    await w.start()
    if (w.state === 'unsupported') {
      wakeWord.current = null
      forget('wake')
    }
  }

  // "Hello Neighbour" was heard: a chime, the chat, and listening for what comes next, as if the mic were held.
  onWake.current = () => {
    if (busy || listener.current || recording.current || speaking.current) return
    chime()
    setOpen(true)
    setWoke(true)
    setPhase('waking')
    holdWake('assistant', true)
    window.setTimeout(() => setWoke(false), 900)
    window.setTimeout(() => {
      if (Listener) listen(true)
      else if (serverEars) void record(true)
      else setPhase('idle')
    }, WAKE_TO_LISTEN_MS)
  }

  // A hands-free conversation goes on without the wake word: after a reply has been spoken to the end, the assistant
  // listens a few seconds more for the next question (the chime says so), then goes back to waiting for "Hello
  // Neighbour". Not when the reply was stopped, the chat was closed (a page it opened on a phone), hands-free was
  // turned off meanwhile, or the page is out of sight. Through a ref so the listening sees the chat as it is now.
  const followUp = useRef<() => void>(() => undefined)
  followUp.current = () => {
    if (!open || busy || listener.current || recording.current || speaking.current || document.hidden) return
    if (!wakeWord.current || wakeWord.current.state === 'off') return
    chime()
    setPhase('waking')
    holdWake('assistant', true)
    window.setTimeout(() => {
      if (Listener) listen(true, true)
      else if (serverEars) void record(true, true)
      else { setPhase('idle'); holdWake('assistant', false) }
    }, WAKE_TO_LISTEN_MS)
  }

  /** Speak one reply (by the server for English, the device's voice otherwise); the wake word waits meanwhile, so it
   *  never hears the assistant. Pressing a reply's speaker button again stops it. `thenListen`: the question came
   *  hands-free, so once the reply has been heard to the end the assistant listens for the next one. */
  async function sayReply(id: number, words: string, replyLang: string, thenListen = false) {
    if (!canSpeak(replyLang, !!ai?.speak)) return
    speaking.current?.stop()
    holdWake('speaking', true)
    setPhase('speaking')
    setSpeakingId(id)
    let stopped = false
    const said = speak(words, replyLang, { unitId: me.id, serverSpeaks: !!ai?.speak })
    const s: Speaking = { done: said.done, stop: () => { stopped = true; said.stop() } }
    speaking.current = s
    try {
      await s.done
    } finally {
      if (speaking.current === s) {
        speaking.current = null
        setSpeakingId(null)
        setPhase('idle')
        holdWake('speaking', false)
        if (thenListen && !stopped) followUp.current()
      }
    }
  }
  const stopSpeaking = () => speaking.current?.stop()

  /** Ask; again: the same words once more after the AI didn't answer in time (no second bubble of yours). A question
   *  that was spoken gets its reply spoken too; one that came hands-free gets the next question listened for after it. */
  async function ask(words: string, again = false, spoken = false, free = false) {
    const what = words.trim()
    if (!what || busy) return
    const history: AssistantTurn[] = chat.slice(-HISTORY).map((m) => ({ who: m.who, text: m.text }))
    if (!again) setChat((c) => [...c, { id: nextId.current++, who: 'resident', text: what }])
    setText('')
    setBusy(true)
    try {
      const plan = await api.assistant(me.id, what, tab, lang, history)
      const id = nextId.current++
      setChat((c) => [...c, { id, who: 'assistant', text: plan.reply, said: what, plan }])
      if (spoken) void sayReply(id, plan.reply, plan.language, free)
      if (plan.intent === 'go_to_page' && plan.page) {
        onGo(plan.page)
        if (window.matchMedia(PHONE).matches) setOpen(false)  // on a phone the chat covers the page it opened
      }
      if (plan.intent === 'set_quiet_time' && plan.quiet_window) await addQuiet(id, plan.quiet_window)
    } catch (e) {
      toast(e instanceof Error ? e.message : t('err.tryAgain'), 'error')
    } finally {
      setBusy(false)
    }
  }

  /** The household's own quiet time is low-risk, so it is added at once; Undo puts the old ones back. */
  async function addQuiet(id: number, w: NonNullable<AssistantPlan['quiet_window']>) {
    try {
      const before = (await api.quietTimes(me.id)).windows
      await api.setQuietTimes(me.id, [...before.filter((x) => x.start !== w.start || x.end !== w.end), w])
      update(id, { quiet: { before, undone: false } })
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('err.tryAgain'), 'error')  // more than two, or over three hours a day
    }
  }

  async function undoQuiet(m: Extract<Msg, { who: 'assistant' }>) {
    if (!m.quiet) return
    try {
      await api.setQuietTimes(me.id, m.quiet.before)
      update(m.id, { quiet: { ...m.quiet, undone: true } })
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('err.tryAgain'), 'error')
    }
  }

  // The wizards show names only for homes this household may know (its circle and accepted contacts).
  const names = (d: Directory) => {
    const n: Record<string, string> = { [me.id]: me.resident_name }
    d.circle.forEach((x) => { n[x.id] = x.resident_name })
    d.nearby.forEach((x) => { if (x.resident_name) n[x.id] = x.resident_name })
    return n
  }
  const openReno = (m: Extract<Msg, { who: 'assistant' }>) => api.directory(me.id).then((d) => {
    onGo('works')
    setOpen(false)
    setReno({ names: names(d), from: { said: m.said, renovation: m.plan.renovation } })
  })
  const openHello = (m: Extract<Msg, { who: 'assistant' }>) => api.directory(me.id).then((d) => {
    onGo('circle')
    setOpen(false)
    setHello({ circle: d.circle, pick: m.plan.hello_ids })
  })
  const go = (page: TabId, peer?: string) => {
    onGo(page, peer)
    if (window.matchMedia(PHONE).matches) setOpen(false)
  }

  /** Hold to talk: the words appear in the box as they are heard, and are asked when the button is let go. Hands-free
   *  (after "Hello Neighbour") the browser stops by itself when the sentence ends, or after a quiet wait; `more` is
   *  the shorter wait for a follow-up after a spoken reply, where silence just means the conversation is over. */
  function listen(free = false, more = false) {
    if (!Listener || listener.current || busy) return
    speaking.current?.stop()
    const r = new Listener()
    r.lang = speechLang
    r.interimResults = true
    r.continuous = false
    said.current = ''
    cancelled.current = false
    let wait: number | undefined
    r.onresult = (e) => {
      said.current = Array.from(e.results, (x) => x[0].transcript).join('')
      setHeard(said.current)
      setLevel(0.9)  // the browser gives words, not sound: each new word lifts the orb
      window.setTimeout(() => setLevel(0.35), 180)
      window.clearTimeout(wait)
    }
    r.onerror = (e) => { if (e.error === 'not-allowed') toast(t('assistant.micBlocked'), 'error') }
    r.onend = () => {
      window.clearTimeout(wait)
      listener.current = null
      setHeard(null)
      setHandsFree(false)
      setMore(false)
      setPhase('idle')
      setLevel(0)
      holdWake('assistant', false)
      const words = withoutWakePhrase(said.current)
      if (cancelled.current) return
      if (words) void ask(words, false, true, free)
      else if (free && !more) toast(t('assistant.wake.nothing'))
    }
    holdWake('assistant', true)  // the wake word lets go of the microphone while this listens (iPhone needs it)
    listener.current = r
    setHandsFree(free)
    setMore(more)
    setPhase('listening')
    setHeard('')
    try {
      r.start()
      if (free) wait = window.setTimeout(() => r.stop(), more ? FOLLOW_UP_WAIT_MS : HANDS_FREE_WAIT_MS)
    } catch {
      listener.current = null
      setHeard(null)
      setHandsFree(false)
      setMore(false)
      setPhase('idle')
      holdWake('assistant', false)
    }
  }

  /** For a browser that cannot listen: record the sentence, have the server turn it into words, and ask. */
  async function record(free = false, more = false) {
    if (recording.current || busy) return
    speaking.current?.stop()
    const r = recordSentence({ handsFree: free, waitMs: more ? FOLLOW_UP_WAIT_MS : undefined, onLevel: setLevel })
    recording.current = r
    cancelled.current = false
    holdWake('assistant', true)
    setHandsFree(free)
    setMore(more)
    setPhase('listening')
    setHeard('')
    try {
      const got = await r.done
      setHeard(null)
      setLevel(0)
      if (!got) {
        if (free && !more && !cancelled.current) toast(t('assistant.wake.nothing'))
        return
      }
      setPhase('transcribing')
      const words = await api.transcribe(me.id, got.blob, got.seconds, lang === 'en' && me.lang === 'ta' ? 'ta' : lang)
        .then((x) => withoutWakePhrase(x.text))
      setPhase('idle')
      if (words && !cancelled.current) await ask(words, false, true, free)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') toast(t('assistant.micBlocked'), 'error')
      else toast(e instanceof ApiError || e instanceof Error ? e.message : t('err.tryAgain'), 'error')
    } finally {
      recording.current = null
      setHeard(null)
      setHandsFree(false)
      setMore(false)
      setPhase((p) => (p === 'speaking' ? p : 'idle'))
      setLevel(0)
      holdWake('assistant', false)
    }
  }

  const hear = () => (Listener ? listen() : void record())
  const stop = () => {
    listener.current?.stop()
    recording.current?.stop()
  }
  /** Stop whatever the voice is doing; nothing half-heard is asked. */
  function cancelVoice() {
    cancelled.current = true
    listener.current?.stop()
    recording.current?.cancel()
    speaking.current?.stop()
  }
  function close() {
    cancelVoice()
    setOpen(false)
  }

  const example = (hasWorks ? EXAMPLES_AFTER[lang] ?? EXAMPLES_AFTER.en : EXAMPLES[lang]) ?? EXAMPLES.en
  const chips = (
    <div className="assistant-chips">
      <button type="button" disabled={busy} onClick={() => void ask(example)}>{example}</button>
    </div>
  )

  /** What the assistant got ready, under its reply. */
  function card(m: Extract<Msg, { who: 'assistant' }>, latest: boolean) {
    const plan = m.plan
    const r = plan.renovation
    const hours = plan.quiet_window ? `${plan.quiet_window.start}–${plan.quiet_window.end}` : ''
    return (
      <>
        {/* Key words only: AI is off here, or it is on and didn't answer in time (then the same words can be asked again).
            A status is the server's own count either way, so it needs neither. */}
        {!plan.by_ai && plan.intent !== 'check_status' && (ai?.on
          ? <button type="button" className="link assistant-retry" disabled={busy} onClick={() => void ask(m.said, true)}>{t('assistant.retry')}</button>
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
            <button className="btn btn-primary btn-sm" onClick={() => openReno(m)}>{t('assistant.reno.open')}</button>
          </div>
        )}
        {plan.intent === 'say_hello' && (
          <div className="assistant-card">
            <b>{t('assistant.hello.title', { who: plan.hello_to.length ? plan.hello_to.join(', ') : t('assistant.hello.all') })}</b>
            <button className="btn btn-primary btn-sm" onClick={() => openHello(m)}>{t('assistant.hello.open')}</button>
          </div>
        )}
        {plan.intent === 'set_quiet_time' && (m.quiet && plan.quiet_window ? (
          <div className="assistant-card row">
            <b className="grow">{m.quiet.undone ? t('assistant.quiet.undone', { hours })
              : t('assistant.quiet.added', { hours, why: t(`qt.why.${plan.quiet_window.why}`) })}</b>
            {!m.quiet.undone && <button className="btn btn-sm" onClick={() => undoQuiet(m)}>{t('assistant.undo')}</button>}
          </div>
        ) : <button className="btn btn-sm" onClick={() => go(plan.page ?? 'circle')}>{t('assistant.go')}</button>)}
        {/* An answer from the rules only; anything else is for the estate office (ChatsView's channel), under the latest one. */}
        {plan.intent === 'answer' && plan.by_ai && latest && (
          <button className="link" onClick={() => go('chats', '__estate')}>{t('assistant.estate')}</button>
        )}
        {plan.intent === 'check_status' && plan.page && (
          <button className="btn btn-sm" onClick={() => go(plan.page!)}>{t('assistant.goTo', { page: t(`nav.${plan.page}`) })}</button>
        )}
        {plan.intent === 'unknown' && chips}
      </>
    )
  }

  return (
    <>
      {/* The assistant's face in the corner: an orb, still when hands-free is off, breathing while it listens for
          "Hello Neighbour", blooming when it hears it, moving with the voice while it listens or speaks with the chat
          out of the way (a page it opened on a phone). A pill with its name for a few seconds, then the orb alone. */}
      <button className={`assistant-fab ${easy ? 'big' : ''} ${open ? 'on' : ''} ${wake === 'listening' ? 'wake' : ''} ${woke ? 'woke' : ''} ${named && !open ? 'named' : ''} ${!open && phase !== 'idle' ? phase : ''}`}
        style={{ '--level': level } as React.CSSProperties}
        onClick={() => (open ? close() : setOpen(true))} aria-label={t('assistant.open')} aria-expanded={open}
        title={wake === 'listening' ? `${t('assistant.open')} · ${t('assistant.wake.fab')}` : t('assistant.open')}>
        {open ? <X size={easy ? 28 : 22} /> : <span className="orb" aria-hidden="true"><i /><i /></span>}
        <span className="assistant-fab-name" aria-hidden="true">{WAKE_PHRASE}</span>
      </button>

      {open && (
        <div className="assistant-chat" role="dialog" aria-label={t('assistant.chatTitle')}>
          <header className="assistant-chat-head">
            <span className="assistant-avatar" aria-hidden="true"><span className="orb"><i /><i /></span></span>
            <span className="grow">
              <b>{t('assistant.chatTitle')}</b>
              <small>{t(ai && !ai.on ? 'assistant.chatOff' : 'assistant.chatOn')}</small>
            </span>
            {canHear && wakeSupported() && (
              <button type="button" className={`icon-btn wake-toggle ${wake !== 'off' ? 'on' : ''}`} aria-pressed={wake !== 'off'}
                aria-label={t('assistant.wake.toggle')} title={t('assistant.wake.toggle')} onClick={() => void turnWake(wake === 'off', true)}>
                <Ear size={16} />
              </button>
            )}
            <button className="icon-btn" onClick={close} aria-label={t('btn.cancel')}><X size={16} /></button>
          </header>

          <div className="assistant-log" ref={log}>
            <div className="assistant-msg bot">
              <p className="assistant-greeting">{t('assistant.greeting', { name: me.resident_name })}</p>
              {/* Hands-free, offered once: the tap on "Turn on" is the one browsers need before any audio starts. */}
              {offer && micUsed && wake === 'off' && canHear && wakeSupported() && (
                <div className="assistant-card assistant-offer">
                  <span><Ear size={14} /> {t('assistant.wake.offer')}</span>
                  <span className="assistant-offer-btns">
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void turnWake(true, true)}>{t('assistant.wake.offerYes')}</button>
                    <button type="button" className="btn btn-sm" onClick={() => { remember('wakeOffered', '1'); setOffer(false) }}>{t('assistant.wake.offerNo')}</button>
                  </span>
                </div>
              )}
              {!pilot && chat.length === 0 && chips}
            </div>
            {chat.map((m, i) => (m.who === 'resident'
              ? <div key={m.id} className="assistant-msg me"><p>{m.text}</p></div>
              : (
                <div key={m.id} className="assistant-msg bot" aria-live="polite">
                  <p className="assistant-reply">{m.text}
                    {canSpeak(m.plan.language, !!ai?.speak) && (
                      <button type="button" className={`assistant-say ${speakingId === m.id ? 'on' : ''}`}
                        aria-label={t(speakingId === m.id ? 'voice.stop' : 'voice.read')} title={t(speakingId === m.id ? 'voice.stop' : 'voice.read')}
                        onClick={() => (speakingId === m.id ? stopSpeaking() : void sayReply(m.id, m.text, m.plan.language))}>
                        {speakingId === m.id ? <Square size={12} /> : <Volume2 size={13} />}
                      </button>
                    )}
                  </p>
                  {card(m, i === chat.length - 1)}
                </div>
              )))}
            {busy && <div className="assistant-msg bot typing" role="status" aria-label={t('assistant.working')}><i /><i /><i /></div>}
          </div>

          {wake !== 'off' && (
            <p className={`assistant-wake ${wake}`} role="status">
              <Ear size={13} /> {t(wake === 'listening' ? 'assistant.wake.on' : `assistant.wake.${wake}`)}
            </p>
          )}
          {phase !== 'idle' && (
            <div className={`voice-panel ${phase} ${handsFree ? 'free' : ''}`} style={{ '--level': level } as React.CSSProperties}
              role="status" aria-live="polite">
              <span className="voice-orb" aria-hidden="true"><i /><i /><i /><b className="orb"><i /><i /></b></span>
              <span className="voice-words">
                <small>{t(phase === 'listening' ? (handsFree ? (more ? 'assistant.wake.more' : 'assistant.wake.yes') : 'assistant.listening') : `voice.${phase}`)}</small>
                {heard ? <q>{heard}</q> : phase === 'listening' && handsFree && <span className="voice-wait" key={String(handsFree)} />}
              </span>
              <button type="button" className="voice-cancel" onClick={cancelVoice}
                aria-label={t(phase === 'speaking' ? 'voice.stop' : 'voice.cancel')} title={t(phase === 'speaking' ? 'voice.stop' : 'voice.cancel')}>
                {phase === 'speaking' ? <Square size={14} /> : <X size={16} />}
              </button>
            </div>
          )}
          <form className="assistant-compose" onSubmit={(e) => { e.preventDefault(); void ask(text) }}>
            {canHear && (
              <button type="button" className={`assistant-hold ${heard !== null ? 'on' : ''}`} disabled={busy}
                aria-label={t('assistant.hold')} title={t('assistant.hold')}
                onPointerDown={(e) => { e.preventDefault(); if (!handsFree) { noteMicUse(); hear() } }} onPointerUp={() => !handsFree && stop()}
                onPointerLeave={() => !handsFree && stop()} onPointerCancel={() => !handsFree && stop()}
                onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); noteMicUse(); hear() } }}
                onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') stop() }} onContextMenu={(e) => e.preventDefault()}>
                <Mic size={18} />
              </button>
            )}
            <input ref={input} value={heard ?? text} maxLength={500} onChange={(e) => setText(e.target.value)} readOnly={heard !== null}
              placeholder={t(heard === null ? 'assistant.type' : handsFree ? (more ? 'assistant.wake.more' : 'assistant.wake.yes') : 'assistant.listening')} aria-label={t('assistant.type')} />
            <button className="btn btn-primary" disabled={!text.trim() || busy}><Send size={14} /> {t('assistant.ask')}</button>
          </form>
          <small className="assistant-foot">
            <ShieldCheck size={12} /> {t('assistant.never')}{wake !== 'off' && <> {t('assistant.wake.privacy')}</>}
            {!canHear && <> {t('assistant.noVoice')}</>}
          </small>
        </div>
      )}

      {reno && <RenovationWizard open onClose={() => setReno(null)} me={me} units={units} names={reno.names} onSent={onChanged} fromAssistant={reno.from} />}
      {hello && <IntroWizard open onClose={() => setHello(null)} me={me} circle={hello.circle} pick={hello.pick}
        onSent={() => { celebrate('👋', t('celebrate.hello')); onChanged() }} />}
    </>
  )
}
