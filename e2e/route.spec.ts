import { expect, test, type Locator } from '@playwright/test'
import { dismissWelcome, judgeStep, resetDemo, shot, watchErrors } from './helpers'

// Walks the 3-minute judge route exactly as the Guide lists it (frontend/src/guide.ts, JUDGE_ROUTE) and saves one
// screenshot per step, numbered like docs/test-plan.md and evidence/device-check/README.md (K01–K14). It reads the
// text a judge reads (button labels, headings), on purpose: a renamed button fails the walk.
// The server is the AI stand-in (serve.mjs): AI screens show, every AI answer is marked [stand-in].

const SENTENCE = 'Retiling the master bathroom from next Monday for two weeks, ABC Renovation, weekdays 9 to 6'
const SHARP_MALAY = 'Rumah awak bising macam kilang! Tak reti hormat jiran ke?'
const TAMIL = /[஀-௿]/

async function next(sheet: Locator) {
  await sheet.getByRole('button', { name: /^Next$/ }).click()
}

test('the 3-minute judge route, with a screenshot per step', async ({ page }) => {
  const errors = watchErrors(page)
  await resetDemo(page)
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
    // Wet work: the five homes of the circle, and No. 32 behind (the back drain runs along both homes).
    await expect(sheet.locator('ol.zone-list > li')).toHaveCount(6)
    await expect(sheet.locator('ol.zone-list > li', { hasText: 'No. 32' })).toContainText('Behind you · shares your back fence')
    await shot(page, 'K04-who-is-told')
  })

  await test.step('K05 When: hours planned around the neighbours', async () => {
    await next(sheet)
    // One set of hours: the planned ones, drawn on the day, with no time inputs beside them.
    await expect(sheet.locator('.hours-bar')).toContainText(/quiet times of 2 home/)
    await expect(sheet.locator('input[type="time"]')).toHaveCount(0)
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
    await judgeStep(page, 4) // one click: the Guide opens both panes itself
    await expect(left).toBeVisible()
    await expect(right).toBeVisible()
    await shot(page, 'K08-both-sides')
  })

  await test.step('K09 Siti reads the notice: planned around her quiet time', async () => {
    // Already open on Aiman's thread, no row to tap.
    await expect(right.locator('.thread-head')).toContainText('Aiman')
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
    await expect(right.locator('.msg.mine .msg-ticks').last()).toBeVisible()
  })

  await test.step('K11 Aiman reads it in English, the original one tap away', async () => {
    // Aiman's pane is already open on Siti's thread, so no row to tap.
    await expect(left.locator('.thread-head')).toContainText('Siti')
    await expect(left.getByText(/\[stand-in → EN\]/).last()).toBeVisible()
    // Aiman has the thread open, so Siti's message shows two ticks, live, on her side.
    await expect(right.locator('.msg.mine .msg-ticks.read').last()).toBeVisible()
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

  await test.step('K14 The Guide in all three interface languages', async () => {
    const guide = page.locator('aside.guide')
    await guide.locator('.guide-body').evaluate((el) => el.scrollTo({ top: 0 })) // the hints above the route in frame
    await guide.locator('.guide-head .toggle').getByRole('button', { name: '中文', exact: true }).click()
    await expect(guide).toContainText('3 分钟评审路线')
    await expect(guide).toContainText('不会真的发出') // what "preview" and "illustration" mean
    await shot(page, 'K14-guide-zh')
    await guide.locator('.guide-head .toggle').getByRole('button', { name: 'BM', exact: true }).click()
    await expect(guide).toContainText('Laluan juri 3 minit')
    await expect(guide).toContainText('tidak menghantar apa-apa dan bukan app sebenar SDP')
    await shot(page, 'K14-guide-ms')
    await guide.locator('.guide-head .toggle').getByRole('button', { name: 'EN', exact: true }).click()
    await expect(guide).toContainText('3-minute judge route')
    await expect(guide).toContainText('send nothing and are not SDP’s real app')
    await shot(page, 'K14-guide-en')
  })

  await test.step('No errors in the browser console along the way', async () => {
    expect(errors, errors.join('\n')).toEqual([])
  })
})
