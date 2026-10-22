import { expect, test } from '@playwright/test'
import { dismissWelcome, judgeStep, resetDemo, shot, watchErrors } from './helpers'

// K16 of docs/test-plan.md: only the owner closes a warranty ticket, and the demo's invented Procore number is
// marked as a demo number wherever it is shown (SDP's queue and the owner's card). Not on the 3-minute route:
// it is the safety net, walked here so it is checked every time.

test('K16: only the owner closes a warranty ticket, and the demo marks its Procore number', async ({ page }) => {
  const errors = watchErrors(page)
  await resetDemo(page)
  // Aiman's renovation next door is what gives Siti a pre-work photo to take (the route registers it by hand).
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
  const notice = await page.request.post('/api/intros', {
    data: { from_unit_id: 'T-12', message: 'Hi, Aiman from No. 12 here. Retiling the master bathroom soon.',
      renovation: { scope: 'Retiling the master bathroom', works_type: 'wet', start: day(10), end: day(24), noisy_from: '09:00', noisy_to: '17:00', weekdays_only: true } },
  })
  expect(notice.status(), await notice.text()).toBe(201)
  await page.goto('/')
  await expect(page.locator('article.person-card').first()).toBeVisible()
  await dismissWelcome(page)
  const main = page.locator('main')
  const nav = page.locator('nav')

  await test.step('Siti seals a pre-work photo, the crack is compared, she records a building defect', async () => {
    await judgeStep(page, 5)
    const sealed = page.waitForResponse((r) => r.url().includes('/photos/demo') && r.request().method() === 'POST')
    await main.getByRole('button', { name: 'Use sample' }).first().click()
    expect((await sealed).status()).toBe(201)
    const crack = main.getByRole('button', { name: 'Sample crack' })
    await expect(crack).toBeVisible()
    const compared = page.waitForResponse((r) => r.url().includes('/api/incidents') && r.request().method() === 'POST', { timeout: 60_000 })
    await crack.click()
    expect((await compared).status()).toBe(201)
    await expect(main.getByText('Rule-based suggestion')).toBeVisible({ timeout: 30_000 })
    await expect(main.getByRole('button', { name: 'Record decision' })).toBeDisabled() // nothing is pre-selected
    await main.getByRole('button', { name: /^Building defect/ }).click()
    const decided = page.waitForResponse((r) => r.url().includes('/decision') && r.request().method() === 'POST')
    await main.getByRole('button', { name: 'Record decision' }).click()
    expect((await decided).status()).toBe(200)
  })

  await test.step('SDP submits a poor repair: the queue shows the demo number as such and has no Close button', async () => {
    await page.locator('aside.guide').getByRole('button', { name: 'Show every feature' }).click()
    await nav.getByRole('button', { name: /Command view/ }).click()
    await main.getByRole('tab', { name: /^Warranty/ }).click()
    const repaired = page.waitForResponse((r) => r.url().includes('/repair/demo') && r.request().method() === 'POST', { timeout: 60_000 })
    await main.getByRole('button', { name: 'Sample: poor patch' }).click()
    expect((await repaired).status()).toBe(200)
    await expect(main.getByText(/PC-\d+ \(demo\)/)).toBeVisible()
    await expect(main.getByRole('button', { name: /^(Accept|Close|Close ticket)$/ })).toHaveCount(0)
    await shot(page, 'K16a-sdp-queue-demo-number')
  })

  await test.step('Siti sees "demo number", sends the repair back; SDP repairs properly; Siti accepts', async () => {
    await judgeStep(page, 5)
    await main.locator('button.case.attention').first().click() // "SDP says it is repaired · only you can confirm"
    await expect(main.getByText(/Procore PC-\d+ \(demo number\)/)).toBeVisible()
    await shot(page, 'K16b-owner-demo-number')
    // The same mark in the other two interface languages.
    const lang = page.locator('header .lang-switch')
    await lang.getByRole('button', { name: 'BM', exact: true }).click()
    await expect(main.getByText(/Procore PC-\d+ \(nombor demo\)/)).toBeVisible()
    await lang.getByRole('button', { name: '中', exact: true }).click()
    await expect(main.getByText(/Procore PC-\d+（演示编号）/)).toBeVisible()
    await lang.getByRole('button', { name: 'EN', exact: true }).click()
    await expect(main.getByText(/Procore PC-\d+ \(demo number\)/)).toBeVisible()
    await main.locator('textarea').first().fill('Still a crack along the top')
    const rejected = page.waitForResponse((r) => r.url().includes('/owner') && r.request().method() === 'POST')
    await main.getByRole('button', { name: 'Not fixed' }).click()
    expect((await rejected).status()).toBe(200)
    await expect(main.getByRole('button', { name: 'Not fixed' })).toHaveCount(0) // back with SDP

    await nav.getByRole('button', { name: /Command view/ }).click()
    await main.getByRole('tab', { name: /^Warranty/ }).click()
    await expect(main.getByText(/Owner rejected/)).toBeVisible()
    const again = page.waitForResponse((r) => r.url().includes('/repair/demo') && r.request().method() === 'POST', { timeout: 60_000 })
    await main.getByRole('button', { name: 'Sample: proper repair' }).click()
    expect((await again).status()).toBe(200)

    await judgeStep(page, 5)
    await main.locator('button.case.attention').first().click() // "SDP says it is repaired · only you can confirm"
    const accepted = page.waitForResponse((r) => r.url().includes('/owner') && r.request().method() === 'POST')
    await main.getByRole('button', { name: 'Accept' }).click()
    expect((await accepted).status()).toBe(200)
    await expect(main.getByRole('button', { name: 'Accept' })).toHaveCount(0)
    await shot(page, 'K16c-owner-closed')
  })

  expect(errors, errors.join('\n')).toEqual([])
})
