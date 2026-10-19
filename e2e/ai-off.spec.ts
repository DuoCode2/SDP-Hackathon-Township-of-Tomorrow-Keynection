import { expect, test } from '@playwright/test'
import { dismissWelcome, judgeStep, resetDemo, watchErrors } from './helpers'

// The renovation notice without AI (docs/test-plan.md, K22). The server still runs the stand-in, so the page is told
// AI is off instead: the three examples must fill the notice in from a preset on the device, with no AI call, and a
// terrace must start on wet work so Next is never blocked by a missing approval.

test('AI off: an example fills the notice in without AI, and a terrace starts on wet work', async ({ page }) => {
  const errors = watchErrors(page)
  const drafts: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/ai/renovation-draft')) drafts.push(r.url())
  })
  await page.route('**/api/ai', (route) => route.fulfill({ json: { on: false, model: null, provider: null } }))
  await resetDemo(page)
  await page.goto('/')
  await expect(page.locator('article.person-card').first()).toBeVisible()
  await dismissWelcome(page)

  await judgeStep(page, 2)
  await page.getByRole('button', { name: 'Register renovation' }).first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()

  // A terrace starts on the first card, wet work, so nothing on step 4 blocks Next.
  await expect(sheet.locator('.works-card.on')).toContainText('Bathroom, kitchen or plumbing')
  await expect(sheet.getByLabel(/Describe the work/)).toHaveValue('Re-tile bathroom')

  // No sentence box, but the three examples are still there.
  await expect(sheet.getByText('Try an example')).toBeVisible()
  await expect(sheet.getByLabel('Just say it in one sentence')).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Fill it in for me' })).toHaveCount(0)

  await sheet.getByRole('button', { name: 'Bahasa Melayu' }).click()
  await expect(sheet.locator('.works-card.on')).toContainText('Hacking, drilling or removing tiles')
  await expect(sheet.getByLabel(/Describe the work/)).toHaveValue('Pecah jubin dapur dan gerudi dinding')
  await expect(sheet.locator('.ai-note')).toContainText('Example filled in')
  expect(drafts, 'the preset never calls the AI').toEqual([])

  for (let i = 0; i < 4; i++) await sheet.getByRole('button', { name: /^Next$/ }).click()
  await expect(sheet.getByRole('button', { name: 'Send notice' })).toBeEnabled()
  await page.keyboard.press('Escape')

  expect(errors, errors.join('\n')).toEqual([])
})
