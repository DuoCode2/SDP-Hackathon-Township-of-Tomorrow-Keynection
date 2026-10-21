// The assistant speaking its reply, when the question was spoken (or a reply's speaker button is pressed). English goes
// to the server's voice (Deepgram's Aura-2 through the LLM gateway); Deepgram has no Malay, Chinese or Tamil voice, so
// those are read by the browser's own voices, where the device has one. Without either, the reply is on screen as always.
import { api } from './api'

export type Speaking = { done: Promise<void>; stop: () => void }

const BROWSER_LANG: Record<string, string[]> = { en: ['en-MY', 'en-SG', 'en-GB', 'en'], ms: ['ms-MY', 'ms', 'id-ID', 'id'], zh: ['zh-CN', 'zh'], ta: ['ta-MY', 'ta-IN', 'ta'] }

/** The device's voice for a language: the closest match (Malay falls back to Indonesian, which reads Malay well). */
function browserVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null
  const voices = speechSynthesis.getVoices()
  for (const want of BROWSER_LANG[lang] ?? [lang]) {
    const v = voices.find((x) => x.lang.toLowerCase() === want.toLowerCase()) ?? voices.find((x) => x.lang.toLowerCase().startsWith(want.toLowerCase()))
    if (v) return v
  }
  return null
}

/** Whether this reply can be spoken here at all: by the server (English) or by one of the device's voices. */
export function canSpeak(lang: string, serverSpeaks: boolean): boolean {
  return (lang === 'en' && serverSpeaks) || browserVoice(lang) !== null
}

/** Speak one reply. `done` settles when it has finished, was stopped, or could not be spoken. */
export function speak(text: string, lang: string, { unitId, serverSpeaks }: { unitId: string; serverSpeaks: boolean }): Speaking {
  let stopNow = () => undefined as void
  const done = (async () => {
    if (lang === 'en' && serverSpeaks) {
      try {
        const blob = await api.speak(unitId, text, lang)
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        await new Promise<void>((resolve) => {
          stopNow = () => { audio.pause(); resolve() }
          audio.onended = () => resolve()
          audio.onerror = () => resolve()
          audio.play().catch(() => resolve())  // autoplay refused: the reply is on screen
        })
        URL.revokeObjectURL(url)
        return
      } catch {
        // the server's voice failed: the device's voice below, if it has one
      }
    }
    const voice = browserVoice(lang)
    if (!voice) return
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text)
      u.voice = voice
      u.lang = voice.lang
      u.onend = () => resolve()
      u.onerror = () => resolve()
      stopNow = () => { speechSynthesis.cancel(); resolve() }
      speechSynthesis.cancel()
      speechSynthesis.speak(u)
    })
  })()
  return { done, stop: () => stopNow() }
}
