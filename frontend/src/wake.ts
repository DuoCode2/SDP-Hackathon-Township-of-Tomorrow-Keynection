// "Hello Neighbour": the assistant wakes when a resident says it, hands-free. The phrase is heard on this device only
// (sherpa-onnx's keyword spotter as WebAssembly, in a worker; frontend/wake-engine/README.md): no sound leaves the
// device before it. After it, what is said goes the way the mic button's words go (the browser's own listening, or the
// server's for a browser that has none).
//
// Why this phrase: "Hey Keynection" was measured first and caught 36–63% of synthetic voices even at the loosest
// settings, against 82–84% for the model's own phrases on the same voices; a made-up word is what this model,
// untrained, hears worst. "Hello Neighbour", at the settings below: 91.7% of voices it was not tuned on (clean; 77-79%
// with noise or other speech under it), 0 false wakes in 6 hours of the app's own sentences read aloud in English,
// Malay, Chinese and Tamil (21 Oct 2026; frontend/wake-engine/README.md).

export const WAKE_PHRASE = 'Hello Neighbour'
// The phrase as the model's word pieces (its BPE vocabulary), both spellings; boost and threshold as measured.
const KEYWORDS = ['▁HE LL O ▁NE IG H B O UR @HELLO_NEIGHBOUR', '▁HE LL O ▁NE IG H B OR @HELLO_NEIGHBOUR'].join('\n')
// The loosest setting with no false wake: at 0.1 one Chinese sentence and "Hello there. Say hello to the neighbours."
// woke it; 0.15 to 0.25 never did, and 0.15 hears the most.
const SCORE = 1.5
const THRESHOLD = 0.15
const COOLDOWN_MS = 2000  // one "Hello Neighbour" wakes it once
const BASE = `${import.meta.env.BASE_URL}wake/`

export type WakeState = 'off' | 'loading' | 'listening' | 'paused' | 'blocked' | 'unsupported'

/** Whether this browser can run the wake word at all (AudioWorklet, workers, WebAssembly, a microphone). */
export function wakeSupported(): boolean {
  return typeof AudioWorkletNode !== 'undefined' && typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
}

// Reasons the wake word lets go of the microphone for a while: the assistant is listening, a voice note is being
// recorded, the page is out of sight. The mic indicator goes off while any of them holds.
const holds = new Set<string>()
const onHolds = new Set<() => void>()
export function holdWake(reason: string, on: boolean) {
  if (on === holds.has(reason)) return
  if (on) holds.add(reason)
  else holds.delete(reason)
  onHolds.forEach((f) => f())
}

// How many 100 ms pieces of sound have gone to the wake word, and how many times it heard the phrase (before the
// cooldown and holds): the browser tests read these to tell "listening and heard nothing" from "not listening at all".
// A test can also set `record` to an array to keep a copy of what the wake word heard (16 kHz), and save it.
const heard: { chunks: number; wakes: number[]; record?: Float32Array[] } = { chunks: 0, wakes: [] }
;(window as unknown as { keynectionWake?: typeof heard }).keynectionWake = heard

export class WakeWord {
  state: WakeState = 'off'
  private worker: Worker | null = null
  private ctx: AudioContext | null = null
  private mic: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private last = 0
  private busy: Promise<void> = Promise.resolve()
  private readonly apply = () => { this.busy = this.busy.then(() => this.follow()) }

  constructor(private readonly onWake: () => void, private readonly onState: (s: WakeState) => void) {}

  private set(s: WakeState) {
    this.state = s
    this.onState(s)
  }

  /** Turn it on. The first time this must run inside a tap: browsers start audio only after one. */
  async start(): Promise<void> {
    if (this.state !== 'off') return
    if (!wakeSupported()) return this.set('unsupported')
    this.set('loading')
    try {
      this.ctx = new AudioContext()
      if (this.ctx.state === 'suspended') await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 500))])
      await this.ctx.audioWorklet.addModule(`${BASE}capture-worklet.js`)
      // Once more if the first download fails: the browser picks another connection for the second (measured:
      // HTTP/3 to Render failing after 45 s through a home router, the retry over TCP fine).
      await this.load().catch((e) => {
        console.warn('wake word engine failed to load, trying once more', e)
        return this.load()
      })
    } catch (e) {
      this.stop()
      this.set('unsupported')
      console.warn('wake word could not start', e)
      return
    }
    onHolds.add(this.apply)
    document.addEventListener('visibilitychange', this.apply)
    this.apply()
    await this.busy
  }

  /** Turn it off: the microphone, the worker and the audio all go. */
  stop() {
    onHolds.delete(this.apply)
    document.removeEventListener('visibilitychange', this.apply)
    this.release()
    this.worker?.terminate()
    this.worker = null
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.set('off')
  }

  /** The engine in its worker, ready to listen: about 8 MB the first time, then from the browser's cache. */
  private load(): Promise<void> {
    this.worker?.terminate()
    this.worker = null
    return new Promise((resolve, reject) => {
      const w = new Worker(`${BASE}kws-worker.js`)
      const timer = setTimeout(() => { w.terminate(); reject(new Error('the wake word engine took too long to load')) }, 90_000)
      w.onmessage = (e: MessageEvent<{ type: string; message?: string }>) => {
        if (e.data.type === 'ready') {
          clearTimeout(timer)
          resolve()
        } else if (e.data.type === 'error') {
          clearTimeout(timer)
          w.terminate()
          reject(new Error(e.data.message))
        } else if (e.data.type === 'wake') {
          heard.wakes.push(heard.chunks)
          const now = performance.now()
          if (now - this.last < COOLDOWN_MS || holds.size || document.hidden) return
          this.last = now
          this.onWake()
        }
      }
      w.onerror = (e) => {
        clearTimeout(timer)
        reject(new Error(e.message))
      }
      w.postMessage({ type: 'start', keywords: KEYWORDS, threshold: THRESHOLD, score: SCORE })
      this.worker = w
    })
  }

  /** Hold the microphone only while nothing else needs it and the page is in sight. */
  private async follow(): Promise<void> {
    if (!this.ctx || !this.worker) return
    if (holds.size || document.hidden) {
      this.release()
      if (this.state !== 'off') this.set('paused')
      return
    }
    if (this.mic) return
    let mic: MediaStream
    try {
      // The sound as it is: the wake word was measured on unprocessed speech, and Chrome's gain control and noise
      // suppression changed it enough to wake on "Say hello to the neighbours" (measured in the browser walk). Echo
      // cancellation isn't needed: the wake word lets go while the assistant speaks.
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
    } catch {
      if (!this.ctx) return  // switched off while the browser was asking
      this.release()
      return this.set('blocked')
    }
    // Switched off while the permission prompt was still open: the microphone granted after that is let go at once,
    // or it would stay on (its indicator lit) with nothing listening to it.
    if (!this.ctx || !this.worker) {
      mic.getTracks().forEach((t) => t.stop())
      return
    }
    this.mic = mic
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined)
    if (!this.ctx || !this.worker) return this.release()  // switched off while the audio was resuming
    this.worker.postMessage({ type: 'reset' })
    this.source = this.ctx.createMediaStreamSource(this.mic)
    this.node = new AudioWorkletNode(this.ctx, 'keynection-capture')
    const worker = this.worker
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      heard.chunks++
      heard.record?.push(e.data.slice())
      worker.postMessage({ type: 'audio', samples: e.data }, [e.data.buffer])
    }
    // Not heard by anyone: a muted path to the output keeps every browser running the worklet.
    const mute = this.ctx.createGain()
    mute.gain.value = 0
    this.source.connect(this.node).connect(mute).connect(this.ctx.destination)
    this.set(this.ctx.state === 'running' ? 'listening' : 'paused')
  }

  private release() {
    this.node?.port.close()
    this.node?.disconnect()
    this.source?.disconnect()
    this.mic?.getTracks().forEach((t) => t.stop())
    this.node = null
    this.source = null
    this.mic = null
  }

  /** After a page load the audio waits for a tap; this is that tap. */
  resume() {
    void this.ctx?.resume().then(this.apply)
  }
}

/** A short rising chime when the assistant wakes, made by the page itself (an <audio> element can stop iPhone
 *  listening from starting). */
export function chime() {
  try {
    const ctx = new AudioContext()
    const g = ctx.createGain()
    g.connect(ctx.destination)
    ;[660, 880].forEach((f, i) => {
      const o = ctx.createOscillator()
      o.frequency.value = f
      o.connect(g)
      o.start(ctx.currentTime + i * 0.09)
      o.stop(ctx.currentTime + i * 0.09 + 0.08)
    })
    g.gain.setValueAtTime(0.08, ctx.currentTime)
    setTimeout(() => void ctx.close(), 400)
  } catch {
    // No sound: the chat opening is the sign.
  }
}

/** One sentence from the microphone, for a browser that cannot listen by itself: starts at once, stops by itself
 *  after a second of quiet once speech has begun (or when stop() is called, for the hold-to-talk button), and gives up
 *  if nothing is said in the first seconds (`waitMs`; shorter for a follow-up after a spoken reply). The recording is
 *  for the server to turn into words, then dropped. */
export function recordSentence({ handsFree, waitMs, onLevel }: { handsFree: boolean; waitMs?: number; onLevel?: (level: number) => void }) {
  const MAX_MS = 15_000, QUIET_MS = 1000, WAIT_MS = waitMs ?? 6000
  let stopNow: (keep: boolean) => void = () => undefined
  const done = (async (): Promise<{ blob: Blob; seconds: number } | null> => {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find((x) => MediaRecorder.isTypeSupported(x))
    const rec = new MediaRecorder(mic, type ? { mimeType: type } : undefined)
    const parts: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data)
    const ctx = new AudioContext()
    const meter = ctx.createAnalyser()
    meter.fftSize = 1024
    ctx.createMediaStreamSource(mic).connect(meter)
    const frame = new Float32Array(meter.fftSize)
    const began = performance.now()
    let spoke = 0, quietSince = 0, floor = 0, frames = 0
    const finished = new Promise<boolean>((resolve) => {
      const tick = setInterval(() => {
        meter.getFloatTimeDomainData(frame)
        const rms = Math.sqrt(frame.reduce((a, x) => a + x * x, 0) / frame.length)
        onLevel?.(Math.min(1, rms * 8))  // for the listening orb: 0 silent, 1 loud
        const now = performance.now()
        if (frames++ < 5) floor = Math.max(floor, rms)  // the room in the first quarter second
        const loud = rms > Math.max(0.015, floor * 2.5)
        if (loud) {
          spoke ||= now
          quietSince = 0
        } else if (spoke && !quietSince) quietSince = now
        const over = now - began > MAX_MS || (handsFree && (
          (spoke && quietSince && now - quietSince > QUIET_MS) || (!spoke && now - began > WAIT_MS)))
        if (over) {
          clearInterval(tick)
          resolve(!!spoke || !handsFree)
        }
      }, 50)
      stopNow = (keep) => {
        clearInterval(tick)
        resolve(keep)
      }
    })
    rec.start()
    const heard = await finished
    const stopped = new Promise((r) => { rec.onstop = r })
    rec.stop()
    await stopped
    mic.getTracks().forEach((t) => t.stop())
    void ctx.close()
    const seconds = Math.min(15, Math.max(1, (performance.now() - began) / 1000))
    return heard && parts.length ? { blob: new Blob(parts, { type: rec.mimeType || type || 'audio/webm' }), seconds } : null
  })()
  // stop(): the sentence is finished (the button was let go); cancel(): nothing is sent (the chat was closed).
  return { done, stop: () => stopNow(true), cancel: () => stopNow(false) }
}

/** The words after the wake word, without the wake word if the listening caught its tail. */
export function withoutWakePhrase(said: string): string {
  return said.replace(/^\s*(hello|helo|hi|hey)[\s,]+neighbou?rs?[\s,.!]*/i, '').trim()
}
