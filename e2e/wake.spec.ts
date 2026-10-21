import { chromium, devices, expect, test as base, type Page } from '@playwright/test'
import path from 'node:path'
import { dismissWelcome, enterSite, resetDemo, watchErrors } from './helpers'

// Hands-free: "Hello Neighbour" opens the assistant and what follows is asked. Chrome's fake microphone plays a
// recording (fixtures/, made by fixtures/make.sh) on a loop, and the real engine hears it: the page's audio worklet,
// the worker, sherpa-onnx as WebAssembly and the model, as a resident's browser runs them. Two things after the wake
// word depend on where it runs:
//  - the browser's own listening (Chrome's goes to Google, which headless Chrome cannot reach) is a stand-in here;
//  - the server's listening, for a browser without its own, is the server stand-in by default, the real gateway with
//    KEYNECTION_E2E_REAL=1 (and KEYNECTION_STT_KEY), or whatever a deployed site has with E2E_BASE_URL.

const REMOTE = !!process.env.E2E_BASE_URL
const REAL = process.env.KEYNECTION_E2E_REAL === '1' || REMOTE
const TOGGLE = 'Hands-free: say “Hello Neighbour”'
const LISTENING = 'Say “Hello Neighbour” to ask, any time this page is open'

// Each test hears its own recording, so each gets its own Chrome with that file as the microphone.
const test = base.extend<{ micFile: string }>({
  micFile: ['wake-then-ask.wav', { option: true }],
  page: async ({ micFile, baseURL }, use) => {
    const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${path.join(__dirname, 'fixtures', micFile)}`] })
    const context = await browser.newContext({ ...devices['Desktop Chrome'], baseURL, permissions: ['microphone'],
      viewport: { width: 1920, height: 1080 }, locale: 'en-MY', timezoneId: 'Asia/Kuala_Lumpur', colorScheme: 'light' })
    await use(await context.newPage())
    await browser.close()
  },
})
// A deployed site: Render's free tier may be waking, and the engine comes over the internet.
if (REMOTE) test.describe.configure({ timeout: 300_000 })

/** The browser's own listening, standing in for Chrome's: whatever it starts, it hears this sentence. */
async function browserHears(page: Page, sentence: string) {
  await page.addInitScript((words) => {
    class Recognition {
      lang = ''
      interimResults = false
      continuous = false
      onresult: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      onend: (() => void) | null = null
      private ended = false
      start() {
        const w = window as unknown as { recognitionStarts?: number }
        w.recognitionStarts = (w.recognitionStarts ?? 0) + 1
        // The words half a second in; the end when the button is let go (stop) or, like Chrome, after a pause.
        setTimeout(() => this.onresult?.({ results: [[{ transcript: words }]] }), 500)
        setTimeout(() => this.end(), 2500)
      }
      stop() { this.end() }
      private end() { if (!this.ended) { this.ended = true; this.onend?.() } }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: Recognition, configurable: true })
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: Recognition, configurable: true })
  }, sentence)
}

/** A browser without its own listening (Firefox, say): what is said goes to the server. */
async function noBrowserListening(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true })
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true })
  })
}

async function start(page: Page) {
  const errors = watchErrors(page)
  const asked: string[] = []
  const spoken: { text: string; lang: string; status?: number }[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/assistant')) asked.push(r.postDataJSON().text)
    if (r.method() === 'POST' && r.url().endsWith('/api/assistant/speak')) spoken.push(r.postDataJSON())
  })
  page.on('response', (r) => {
    if (r.request().method() === 'POST' && r.url().endsWith('/api/assistant/speak')) {
      const said = spoken.find((x) => x.status === undefined)
      if (said) said.status = r.status()
    }
  })
  await enterSite(page)
  await resetDemo(page)
  await page.goto('/')
  await expect(page.locator('article.person-card').first()).toBeVisible()
  await dismissWelcome(page)
  return { errors, asked, spoken }
}

/** The spoken reply: the reply's own words go to the server's voice, the speaking panel shows while it plays, and
 *  then the panel goes. */
async function heardTheReply(page: Page, chat: ReturnType<Page['getByRole']>, spoken: { text: string; lang: string; status?: number }[], n = 1) {
  const reply = (await chat.locator('.assistant-reply').last().innerText()).trim()
  await expect.poll(() => spoken.length).toBe(n)
  expect(spoken[n - 1]).toMatchObject({ text: reply, lang: 'en' })
  await expect.poll(() => spoken[n - 1].status).toBe(200)
  await expect(chat.locator('.voice-panel.speaking')).toBeHidden({ timeout: 15_000 })
}

/** Turn hands-free on from the chat (the tap that lets the page start audio), wait until it listens, close the chat. */
async function handsFreeOn(page: Page) {
  await page.getByRole('button', { name: 'Ask the assistant' }).click()
  const chat = page.getByRole('dialog', { name: 'Keynection assistant' })
  await chat.getByRole('button', { name: TOGGLE }).click()
  // 8 MB the first time; over a slow or broken connection the engine is fetched once more.
  await expect(chat.getByRole('status').filter({ hasText: LISTENING })).toBeVisible({ timeout: REMOTE ? 200_000 : 90_000 })
  await expect(chat.getByRole('button', { name: TOGGLE })).toHaveAttribute('aria-pressed', 'true')
  await chat.getByRole('button', { name: 'Cancel' }).click()
  await expect(chat).toBeHidden()
  await expect(page.locator('.assistant-fab')).toHaveClass(/\bwake\b/)
  return chat
}

/** What the wake word heard since `record` was set (16 kHz), as a WAV in the test's own output folder, with the
 *  100 ms pieces at which it heard the phrase: what to listen to when this walk fails. */
async function saveHeard(page: Page, name: string) {
  const got = await page.evaluate(() => {
    const w = (window as unknown as { keynectionWake?: { record?: Float32Array[]; wakes: number[] } }).keynectionWake
    return { samples: Array.from(w?.record ?? []).flatMap((c) => Array.from(c)), wakes: w?.wakes ?? [] }
  })
  const pcm = Buffer.alloc(44 + got.samples.length * 2)
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + got.samples.length * 2, 4); pcm.write('WAVEfmt ', 8)
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(16000, 24)
  pcm.writeUInt32LE(32000, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36)
  pcm.writeUInt32LE(got.samples.length * 2, 40)
  got.samples.forEach((x, i) => pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x * 32767))), 44 + i * 2))
  const fs = await import('node:fs')
  fs.writeFileSync(test.info().outputPath(`${name}.wav`), pcm)
  await test.info().attach(`${name}.wav`, { body: pcm, contentType: 'audio/wav' })
  await test.info().attach(`${name}-wakes.json`, { body: JSON.stringify(got.wakes), contentType: 'application/json' })
  return got.wakes
}

const chunks = (page: Page) => page.evaluate(() => (window as unknown as { keynectionWake?: { chunks: number } }).keynectionWake?.chunks ?? 0)

test.describe('the browser listens after the wake word', () => {
  test.use({ micFile: 'wake-then-ask.wav' })

  test('“Hello Neighbour” opens the assistant and the question that follows is asked', async ({ page }) => {
    await browserHears(page, 'what is my renovation status')
    const { errors, asked, spoken } = await start(page)
    const chat = await handsFreeOn(page)

    // Nobody touches anything now: the recording says "Hello neighbour", then the question.
    await expect(chat).toBeVisible({ timeout: 30_000 })
    await expect(chat.locator('.assistant-msg.me').last()).toHaveText('what is my renovation status')
    await expect(chat.locator('.assistant-reply').last()).toBeVisible()
    expect(asked).toEqual(['what is my renovation status'])
    expect(await page.evaluate(() => (window as unknown as { recognitionStarts?: number }).recognitionStarts)).toBe(1)
    // A spoken question gets a spoken reply; while it speaks the wake word waits, then it listens again.
    await heardTheReply(page, chat, spoken)
    await expect(page.locator('.assistant-fab')).toHaveClass(/\bwake\b/)

    // Turned off, it lets go of the microphone: no more sound reaches the wake word.
    await chat.getByRole('button', { name: TOGGLE }).click()
    await expect(chat.getByRole('button', { name: TOGGLE })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.assistant-fab')).not.toHaveClass(/\bwake\b/)
    const before = await chunks(page)
    await page.waitForTimeout(1500)
    expect(await chunks(page)).toBe(before)
    expect(errors).toEqual([])
  })
})

test.describe('a broken download', () => {
  test.skip(REMOTE, 'cuts a download on purpose: local server only')

  test('if the engine download fails half way, it is fetched once more and hands-free still starts', async ({ page }) => {
    const { errors } = await start(page)
    let tries = 0
    await page.context().route('**/wake/sherpa-onnx-wasm-kws-main.data', (route) => (++tries === 1 ? route.abort('failed') : route.continue()))
    await handsFreeOn(page)
    expect(tries).toBe(2)
    // The worker's own report of the first failure is expected; anything else is not.
    expect(errors.filter((x) => !/Failed to load resource|net::ERR_FAILED|network error/i.test(x))).toEqual([])
  })
})

test.describe('near misses', () => {
  test.use({ micFile: 'near-misses.wav' })

  test('sentences close to the phrase never open it, while it listens the whole time; out of sight it stops', async ({ page }) => {
    await browserHears(page, 'this should never be asked')
    const { errors, asked } = await start(page)
    const chat = await handsFreeOn(page)

    // "Hello there. Say hello to the neighbours. Hey, connection. My neighbour said hello…", over and over.
    await page.evaluate(() => { (window as unknown as { keynectionWake: { record?: Float32Array[] } }).keynectionWake.record = [] })
    const first = await chunks(page)
    await page.waitForTimeout(25_000)
    const wakes = await saveHeard(page, 'near-misses-heard')
    expect(wakes, 'the wake word heard the phrase at these 100 ms pieces').toEqual([])
    await expect(chat).toBeHidden()
    expect(asked).toEqual([])
    expect(await chunks(page) - first).toBeGreaterThan(150)  // about 250 pieces of 100 ms: it was hearing all along

    // The page out of sight (another tab, the phone locked): the microphone goes, and comes back with the page.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(page.locator('.assistant-fab')).not.toHaveClass(/\bwake\b/)
    const hidden = await chunks(page)
    await page.waitForTimeout(1500)
    expect(await chunks(page)).toBe(hidden)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(page.locator('.assistant-fab')).toHaveClass(/\bwake\b/)
    await expect.poll(() => chunks(page)).toBeGreaterThan(hidden + 5)
    expect(errors).toEqual([])
  })
})

test.describe('the server listens after the wake word', () => {
  test.use({ micFile: 'wake-then-ask.wav' })

  test('without the browser’s own listening, the sentence is recorded, turned into words by the server and asked', async ({ page }) => {
    await noBrowserListening(page)
    const { errors, asked, spoken } = await start(page)
    const heard: number[] = []
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && r.url().endsWith('/api/assistant/transcribe')) heard.push(r.status())
    })
    const chat = await handsFreeOn(page)

    await expect(chat).toBeVisible({ timeout: 30_000 })
    const said = chat.locator('.assistant-msg.me').last()
    if (REAL) {
      await expect(said).toContainText(/renovation status/i, { timeout: 30_000 })  // the real gateway: Deepgram heard it
    } else {
      // The stand-in says what it was sent: a WebM recording of a few seconds, not an empty clip.
      await expect(said).toContainText('[stand-in] what is my renovation status (audio/webm', { timeout: 30_000 })
      expect(Number(/, (\d+) KB\)/.exec(await said.innerText())?.[1])).toBeGreaterThanOrEqual(4)
    }
    await expect(chat.locator('.assistant-reply').last()).toBeVisible()
    expect(heard).toEqual([200])
    expect(asked).toHaveLength(1)
    await heardTheReply(page, chat, spoken)
    expect(errors).toEqual([])
  })
})

test.describe('talking without the wake word', () => {
  test('holding the mic asks what was said and the reply is spoken; any reply can be read aloud and stopped', async ({ page }) => {
    await browserHears(page, 'what is my warranty status')
    const { errors, asked, spoken } = await start(page)
    await page.getByRole('button', { name: 'Ask the assistant' }).click()
    const chat = page.getByRole('dialog', { name: 'Keynection assistant' })
    const mic = chat.getByRole('button', { name: 'Hold to talk' })
    await mic.hover()
    await page.mouse.down()
    await expect(chat.locator('.voice-panel.listening')).toBeVisible()
    await expect(chat.locator('.voice-panel q')).toHaveText('what is my warranty status')
    await page.mouse.up()
    await expect(chat.locator('.assistant-msg.me').last()).toHaveText('what is my warranty status')
    expect(asked).toEqual(['what is my warranty status'])
    await heardTheReply(page, chat, spoken)

    // Typed questions stay quiet; their reply can still be read aloud, and stopped.
    await chat.getByLabel('Type what you need').fill('my renovation status')
    await chat.getByRole('button', { name: 'Ask', exact: true }).click()
    await expect(chat.locator('.assistant-reply')).toHaveCount(2)
    await page.waitForTimeout(800)
    expect(spoken).toHaveLength(1)
    const last = chat.locator('.assistant-msg.bot').last()
    await last.getByRole('button', { name: 'Read aloud' }).click()
    await expect(chat.locator('.voice-panel.speaking')).toBeVisible()
    await last.getByRole('button', { name: 'Stop speaking' }).click()
    await expect(chat.locator('.voice-panel.speaking')).toBeHidden()
    expect(spoken).toHaveLength(2)
    expect(errors).toEqual([])
  })
})
