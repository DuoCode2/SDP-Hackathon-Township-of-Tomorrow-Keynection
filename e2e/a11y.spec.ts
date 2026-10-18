import { expect, test, type Page } from '@playwright/test'
import { dismissWelcome, judgeStep, resetDemo } from './helpers'

// Every button on the judge route has a name a screen reader can say: an aria-label, visible text, or an image's alt.
// A title alone does not count (not every reader announces it). Checked on a desktop and at phone width, where the
// top bar hides its labels and only icons remain; also inside the renovation form, a chat thread and the split view.

const DESKTOP = { width: 1920, height: 1080 }
const PHONE = { width: 390, height: 844 }

async function unnamed(page: Page, where: string): Promise<string[]> {
  const found = await page.evaluate(() => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll('button'))) {
      const style = getComputedStyle(el)
      const visible = (el.offsetParent !== null || style.position === 'fixed') && style.visibility !== 'hidden'
      if (!visible) continue
      const alt = Array.from(el.querySelectorAll('img')).map((i) => i.alt).join(' ')
      const name = (el.getAttribute('aria-label') || el.innerText || alt || '').trim()
      if (!name) out.push(`<button class="${el.className}"> ${el.outerHTML.replace(/\s+/g, ' ').slice(0, 90)}`)
    }
    return out
  })
  return found.map((f) => `${where}: ${f}`)
}

async function closeGuide(page: Page) {
  const guide = page.locator('aside.guide')
  if (await guide.evaluate((el) => el.classList.contains('open'))) await guide.getByRole('button', { name: /^(Hide guide|收起导览)$/ }).click()
}

test('every button on the judge route has a name, on a desktop and on a phone', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await resetDemo(page)
  await page.goto('/')
  await expect(page.locator('article.person-card').first()).toBeVisible()
  await dismissWelcome(page)
  const found: string[] = []

  // Each screen is reached through the Guide on the desktop, then looked at again at phone width (state is kept).
  for (let step = 1; step <= 6; step++) {
    await page.setViewportSize(DESKTOP)
    await judgeStep(page, step)
    await page.waitForTimeout(400)
    found.push(...(await unnamed(page, `step ${step} desktop`)))
    await closeGuide(page)
    await page.setViewportSize(PHONE)
    await page.waitForTimeout(400)
    found.push(...(await unnamed(page, `step ${step} phone`)))
  }

  await page.setViewportSize(DESKTOP)
  await judgeStep(page, 2)
  await page.getByRole('button', { name: 'Register renovation' }).first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  found.push(...(await unnamed(page, 'renovation form, step 1')))
  await page.keyboard.press('Escape')

  await judgeStep(page, 4) // Siti's chats
  await page.locator('main').locator('button.chat-row', { hasText: 'Aiman' }).click()
  await expect(page.locator('textarea.compose-input')).toBeVisible()
  found.push(...(await unnamed(page, 'chat thread desktop')))
  await closeGuide(page)
  await page.setViewportSize(PHONE)
  await page.waitForTimeout(400)
  found.push(...(await unnamed(page, 'chat thread phone')))

  await page.setViewportSize(DESKTOP)
  await page.locator('button.split-btn').click()
  await expect(page.getByLabel('Pane 2')).toBeVisible()
  found.push(...(await unnamed(page, 'split view')))
  await page.locator('button.split-btn').click()

  expect(found, `buttons without a name:\n${found.join('\n')}`).toEqual([])
})
