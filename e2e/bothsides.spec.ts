import { expect, test } from '@playwright/test'
import { dismissWelcome, judgeStep, resetDemo, watchErrors } from './helpers'

// Both sides of the shared wall, on Photos & repairs: a case open in one pane follows what the other pane does
// to it, without leaving and reopening it (every pane reloads after a write, and the open case is read again from
// the fresh list). Siti asks Aiman to confirm; Aiman's pane shows the question; Aiman agrees; Siti's pane shows
// the decision. Not on the 3-minute route: walked here so it is checked every time.

test('Both sides: a case open in one pane follows the decision made in the other', async ({ page }) => {
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

  // Split first: turning it on later remounts the panes and closes any case already open.
  await judgeStep(page, 5) // Siti, Photos & repairs
  await page.locator('button.split-btn').click()
  const left = page.getByLabel('Pane 1') // Aiman, the renovating owner
  const right = page.getByLabel('Pane 2') // Siti, the neighbour
  await expect(left).toBeVisible()
  await expect(right).toBeVisible()

  await test.step('Siti seals a pre-work photo and reports the crack: the case opens on her side', async () => {
    const sealed = page.waitForResponse((r) => r.url().includes('/photos/demo') && r.request().method() === 'POST')
    await right.getByRole('button', { name: 'Use sample' }).first().click()
    expect((await sealed).status()).toBe(201)
    const compared = page.waitForResponse((r) => r.url().includes('/api/incidents') && r.request().method() === 'POST', { timeout: 60_000 })
    await right.getByRole('button', { name: 'Sample crack' }).click()
    expect((await compared).status()).toBe(201)
    await expect(right.getByText('Rule-based suggestion')).toBeVisible({ timeout: 30_000 })
  })

  await test.step('Aiman opens the same case on his side while it is still open', async () => {
    await left.getByRole('tab', { name: 'Photos & repairs' }).click()
    await left.locator('button.case').first().click()
    await expect(left.getByText('Rule-based suggestion')).toBeVisible()
    await expect(left.getByRole('button', { name: /^Our works caused it/ })).toBeVisible()
  })

  await test.step("Siti says the renovation caused it: Aiman's open case shows the question at once", async () => {
    await right.getByRole('button', { name: /^Caused by the renovation/ }).click()
    const proposed = page.waitForResponse((r) => r.url().includes('/decision') && r.request().method() === 'POST')
    await right.getByRole('button', { name: /^Ask No\. 12 to confirm$/ }).click()
    expect((await proposed).status()).toBe(200)
    await expect(right.getByText(/Waiting for .*Aiman.* to answer/)).toBeVisible()
    // Nothing is clicked on the left: the pane reloads after the write and the open case follows.
    await expect(left.getByText(/believes your renovation caused this/)).toBeVisible()
    await expect(left.getByRole('button', { name: /^Agree: our works caused it/ })).toBeVisible()
    await expect(left.getByRole('button', { name: /^Our works caused it/ })).toHaveCount(0)
  })

  await test.step("Aiman agrees: Siti's open case shows the decision at once", async () => {
    await left.getByRole('button', { name: /^Agree: our works caused it/ }).click()
    const decided = page.waitForResponse((r) => r.url().includes('/decision') && r.request().method() === 'POST')
    await left.getByRole('button', { name: 'Record decision' }).click()
    expect((await decided).status()).toBe(200)
    // Nothing is clicked on the right.
    await expect(right.getByText('Agreed by both owners')).toBeVisible()
    await expect(right.getByRole('button', { name: 'Record decision' })).toHaveCount(0)
  })

  expect(errors, errors.join('\n')).toEqual([])
})
