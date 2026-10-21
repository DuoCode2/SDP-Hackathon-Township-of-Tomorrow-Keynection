import { expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// Shared by the specs: where screenshots go, the Guide's judge route, the welcome card, and what counts as an error.

export const SHOTS = process.env.ROUTE_SHOTS_DIR ?? path.resolve(__dirname, '..', '..', 'evidence', 'route-screenshots')
fs.mkdirSync(SHOTS, { recursive: true })

/** A screenshot named like docs/test-plan.md. Waits for a toast from the previous step to go, unless it is the point. */
export async function shot(page: Page, name: string, { keepToast = false } = {}) {
  if (!keepToast) await expect(page.locator('.toast')).toHaveCount(0, { timeout: 6000 })
  await page.waitForTimeout(350) // let the last transition settle
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

/** Click step n of the judge route in the Guide (opens the Guide first if it is closed). */
export async function judgeStep(page: Page, n: number) {
  const guide = page.locator('aside.guide')
  if (!(await guide.evaluate((el) => el.classList.contains('open')))) {
    await page.getByRole('button', { name: /^(Guide|Panduan|导览)$/ }).click()
    await expect(guide).toHaveClass(/open/)
  }
  const step = guide.locator('ol.route-judge > li').nth(n - 1).getByRole('button')
  await step.click()
  await expect(step).toHaveClass(/here/)
}

/** The welcome card: a sheet over Neighbours, once per pilot household; the demo never opens it by itself. Close it
 *  if it is there (after a photo). */
export async function dismissWelcome(page: Page, shotName?: string) {
  // The sheet appears once the directory has loaded, a moment after the screen; give it that moment.
  const welcome = page.getByRole('dialog').filter({ hasText: /meet your neighbours/i })
  await welcome.waitFor({ state: 'visible', timeout: 4000 }).catch(() => null)
  if (!(await welcome.isVisible().catch(() => false))) return
  if (shotName) await shot(page, shotName)
  await welcome.getByRole('button', { name: 'Look around first' }).click()
  await expect(welcome).toBeHidden()
}

/** Every uncaught page error and console error, except the browser's note about a 4xx answer: the app answers
 *  a heated message with 422 and a calmer wording, a second wave with 409, a cap with 429, all by design. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`)
  })
  return errors
}

/** A deployed demo sits behind the shared password page (E2E_BASE_URL with E2E_SITE_PASSWORD): pass it once, the
 *  cookie lasts 30 days. The local stand-in server has no password, so this does nothing there. */
export async function enterSite(page: Page) {
  const password = process.env.E2E_SITE_PASSWORD
  if (!password) return
  await page.goto('/')
  const field = page.locator('input[name="password"]')
  if (await field.isVisible().catch(() => false)) {
    await field.fill(password)
    await page.getByRole('button', { name: /^Enter/ }).click()
    await expect(field).toBeHidden()
  }
}

/** Back to the fictional phase as seeded, so a spec never depends on what another spec did. Every spec starts here,
 *  so this also marks the key-day opening as seen (storage.ts keeps it as keynection.opening.done): the specs start
 *  on the app itself. opening.spec.ts asks for the opening instead. */
export async function resetDemo(page: Page, { opening = false } = {}) {
  if (!opening) await page.addInitScript(() => localStorage.setItem('keynection.opening.done', '1'))
  const r = await page.request.post('/api/demo/reset', { data: { confirm: true } })
  expect(r.ok(), 'POST /api/demo/reset').toBeTruthy()
}
