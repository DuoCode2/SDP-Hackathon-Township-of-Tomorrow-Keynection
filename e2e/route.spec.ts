import { expect, test, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// Walks the 3-minute judge route exactly as the Guide lists it (frontend/src/guide.ts, JUDGE_ROUTE) and saves one
// screenshot per step, numbered like docs/test-plan.md and evidence/device-check/README.md (K01–K14). It reads the
// text a judge reads (button labels, headings), on purpose: a renamed button fails the walk.
// The server is the AI stand-in (serve.mjs): AI screens show, every AI answer is marked [stand-in].

const SHOTS = process.env.ROUTE_SHOTS_DIR ?? path.resolve(__dirname, '..', '..', 'evidence', 'route-screenshots')
fs.mkdirSync(SHOTS, { recursive: true })

const SENTENCE = 'Retiling the master bathroom from next Monday for two weeks, ABC Renovation, weekdays 9 to 5'
const SHARP_MALAY = 'Rumah awak bising macam kilang! Tak reti hormat jiran ke?'
const TAMIL = /[஀-௿]/

async function shot(page: Page, name: string, { keepToast = false } = {}) {
  // A toast from the previous step lasts about 3 s; wait it out so each frame shows its own step (unless it is the point).
  if (!keepToast) await expect(page.locator('.toast')).toHaveCount(0, { timeout: 6000 })
  await page.waitForTimeout(350) // let the last transition settle
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

/** Click step n of the judge route in the Guide (opens the Guide first if it is closed). */
async function judgeStep(page: Page, n: number) {
  const guide = page.locator('aside.guide')
  if (!(await guide.evaluate((el) => el.classList.contains('open')))) {
    await page.getByRole('button', { name: /^(Guide|Panduan|导览)$/ }).click()
    await expect(guide).toHaveClass(/open/)
  }
  await guide.locator('ol.route-judge > li').nth(n - 1).getByRole('button').click()
  await expect(guide.locator('ol.route-judge > li').nth(n - 1).getByRole('button')).toHaveClass(/here/)
}

async function next(sheet: Locator) {
  await sheet.getByRole('button', { name: /^Next$/ }).click()
}

/** The welcome card greets each household once, in a sheet over the Neighbours screen; close it (after a photo). */
async function dismissWelcome(page: Page, shotName?: string) {
  // The sheet appears once the directory has loaded, a moment after the screen; give it that moment.
  const welcome = page.getByRole('dialog').filter({ hasText: /meet your neighbours/i })
  await welcome.waitFor({ state: 'visible', timeout: 4000 }).catch(() => null)
  if (!(await welcome.isVisible().catch(() => false))) return
  if (shotName) await shot(page, shotName)
  await welcome.getByRole('button', { name: 'Look around first' }).click()
  await expect(welcome).toBeHidden()
}

test('the 3-minute judge route, with a screenshot per step', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`))
  // A heated message is answered with 422 and a calmer wording (by design); the browser logs that as a resource error.
  page.on('console', (m) => { if (m.type() === 'error' && !/422/.test(m.text())) errors.push(`console: ${m.text()}`) })
  await page.goto('/')
  await expect(page.getByRole('button', { name: /^(Guide|Panduan|导览)$/ })).toBeVisible()
  await expect(page.locator('article.person-card').first()).toBeVisible() // the directory has loaded
  await dismissWelcome(page, 'K01a-welcome-card')

  await test.step('K01 Neighbours: Aiman (No. 12) sees the five homes', async () => {
    await judgeStep(page, 1)
    await dismissWelcome(page)
    for (const name of ['Siti', 'Kumar', 'Priya', 'Hafiz']) await expect(page.locator('article.person-card', { hasText: name }).first()).toBeVisible()
    await expect(page.getByText('Not on Keynection yet').first()).toBeVisible() // No. 23
    await shot(page, 'K01-neighbours')
  })

  await test.step('K02 Wave at Siti', async () => {
    const siti = page.locator('article.person-card', { hasText: 'Siti' }).first()
    await siti.getByRole('button', { name: /Wave$/ }).click()
    await expect(siti.getByRole('button', { name: /Waved$/ })).toBeDisabled()
    await shot(page, 'K02-wave', { keepToast: true })
  })

  const sheet = page.getByRole('dialog')

  await test.step('K03 Works: one sentence fills in the notice', async () => {
    await judgeStep(page, 2)
    await page.getByRole('button', { name: 'Register renovation' }).first().click()
    await expect(sheet).toBeVisible()
    await sheet.getByLabel('Just say it in one sentence').fill(SENTENCE)
    await sheet.getByRole('button', { name: 'Fill it in for me' }).click()
    await expect(sheet.locator('.ai-filled')).toBeVisible()
    await expect(sheet.locator('.ai-filled')).toContainText(/stand-in/) // never mistaken for the real AI
    await shot(page, 'K03-one-sentence')
  })

  await test.step('K04 Who is told, and why', async () => {
    await next(sheet)
    await expect(sheet.locator('ol.zone-list > li').first()).toBeVisible()
    await expect(sheet.locator('ol.zone-list')).toContainText('Not on Keynection yet') // No. 23 goes on paper
    expect(await sheet.locator('ol.zone-list > li').count()).toBeGreaterThanOrEqual(5)
    await shot(page, 'K04-who-is-told')
  })

  await test.step('K05 When: hours planned around the neighbours', async () => {
    await next(sheet)
    await expect(sheet.locator('.qplan-card')).toContainText(/quiet times of 2 home/)
    await shot(page, 'K05-when')
  })

  await test.step('K06 Review and send', async () => {
    await next(sheet) // approvals: the owner's own statements, left as they are
    await next(sheet)
    await expect(sheet.getByRole('button', { name: 'Send notice' })).toBeEnabled()
    await shot(page, 'K06a-review')
    await sheet.getByRole('button', { name: 'Send notice' }).click()
    await expect(page.getByText(/Renovation notice sent to \d+ home/)).toBeVisible()
    await shot(page, 'K06-sent', { keepToast: true })
  })

  await test.step('K07 Channels: Kumar (No. 13) receives it in Tamil, with two scheduled reminders', async () => {
    await judgeStep(page, 3)
    const phone = page.locator('.phone.wa')
    await expect(phone).toContainText(TAMIL)
    await expect(phone).toContainText(/Scheduled/)
    await shot(page, 'K07-channels-tamil')
  })

  const left = page.getByLabel('Pane 1')
  const right = page.getByLabel('Pane 2')

  await test.step('K08 Both sides of the shared wall', async () => {
    await judgeStep(page, 4)
    await page.locator('button.split-btn').click()
    await expect(left).toBeVisible()
    await expect(right).toBeVisible()
    await shot(page, 'K08-both-sides')
  })

  await test.step('K09 Siti reads the notice: planned around her quiet time', async () => {
    await right.locator('button.chat-row', { hasText: 'Aiman' }).click()
    await expect(right.getByText('Noisy hours planned around your quiet time')).toBeVisible()
    await shot(page, 'K09-notice-quiet-time')
  })

  await test.step('K10 Siti waves back, then types something sharp: a calmer wording is offered', async () => {
    const back = right.getByRole('button', { name: /^Wave back$/ })
    if (await back.isVisible().catch(() => false)) await back.click()
    await right.locator('textarea.compose-input').fill(SHARP_MALAY)
    await right.locator('textarea.compose-input').press('Enter')
    await expect(right.getByRole('button', { name: 'Use this' })).toBeVisible()
    await shot(page, 'K10-calmer-wording')
    await right.getByRole('button', { name: 'Use this' }).click()
  })

  await test.step('K11 Aiman reads it in English, the original one tap away', async () => {
    await left.locator('button.chat-row', { hasText: 'Siti' }).click()
    await expect(left.getByText(/\[stand-in → EN\]/).last()).toBeVisible()
    await shot(page, 'K11-translated')
    await page.locator('button.split-btn').click() // back to one pane
    await expect(right).toBeHidden()
  })

  await test.step('K12 Photos & repairs: the crack was there before the works', async () => {
    await judgeStep(page, 5)
    const main = page.locator('main')
    const sealed = page.waitForResponse((r) => r.url().includes('/photos/demo') && r.request().method() === 'POST')
    await main.getByRole('button', { name: 'Use sample' }).first().click()
    expect((await sealed).status()).toBe(201)
    const crack = main.getByRole('button', { name: 'Sample crack' })
    await expect(crack).toBeVisible()
    const compared = page.waitForResponse((r) => r.url().includes('/api/incidents') && r.request().method() === 'POST', { timeout: 60_000 })
    await crack.click()
    expect((await compared).status()).toBe(201)
    await expect(main.getByText('Rule-based suggestion')).toBeVisible({ timeout: 30_000 })
    await expect(main.getByText('Suggestion only · people decide below')).toBeVisible()
    await shot(page, 'K12-crack-before-works')
  })

  await test.step('K13 Impact: the census question', async () => {
    await judgeStep(page, 6)
    const main = page.locator('main')
    await expect(main.getByText(/13\.2\s?%/).first()).toBeVisible()
    await expect(main.getByText(/6\.5\s?%/).first()).toBeVisible()
    await shot(page, 'K13-impact')
  })

  await test.step('K14 The Guide in both languages', async () => {
    const guide = page.locator('aside.guide')
    await guide.locator('.guide-head .toggle').getByRole('button', { name: '中文', exact: true }).click()
    await expect(guide).toContainText('3 分钟评审路线')
    await shot(page, 'K14-guide-zh')
    await guide.locator('.guide-head .toggle').getByRole('button', { name: 'EN', exact: true }).click()
    await expect(guide).toContainText('3-minute judge route')
    await shot(page, 'K14-guide-en')
  })

  await test.step('No errors in the browser console along the way', async () => {
    expect(errors, errors.join('\n')).toEqual([])
  })
})
