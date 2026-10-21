import { expect, test, type Page } from '@playwright/test'
import { resetDemo, watchErrors } from './helpers'

// The demo's key-day opening (T26): the welcome-pack card, who you are, the homes around you lighting up. It shows once
// per browser; Skip is always there. Every other spec marks it as seen (helpers.ts resetDemo); this one asks for it.

const opening = (page: Page) => page.getByRole('dialog', { name: 'Key day' })

async function noSidewaysScroll(page: Page) {
  const wide = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(wide[0], 'the page does not scroll sideways').toBeLessThanOrEqual(wide[1])
}

test('key day: the card, who you are, five homes light up, and a wave lands on Neighbours', async ({ page }) => {
  const errors = watchErrors(page)
  await resetDemo(page, { opening: true })
  await page.goto('/')

  await expect(opening(page).getByText('Your keys came with this card')).toBeVisible()
  await opening(page).getByRole('button', { name: 'Open my welcome card' }).click()
  await expect(opening(page).getByRole('heading', { name: 'Who are you?' })).toBeVisible()
  const aiman = opening(page).getByRole('button', { name: /^Aiman/ })
  await expect(aiman).toContainText('Start here')
  await aiman.click()

  // The plan draws itself and the circle lights up; the line and the buttons follow within 2.5 s.
  const hi = opening(page).getByText('Hi Aiman, these 5 homes share a wall or a road with yours')
  await expect(opening(page).locator('svg.plan.plan-intro')).toBeVisible()
  await expect(hi).toBeVisible({ timeout: 4000 })
  // A 1024 x 768 laptop: the line and both buttons are on screen without scrolling.
  await page.setViewportSize({ width: 1024, height: 768 })
  for (const name of ['👋 Wave at Siti', 'Look around first']) await expect(opening(page).getByRole('button', { name })).toBeInViewport()
  await expect(hi).toBeInViewport()
  await opening(page).getByRole('button', { name: '👋 Wave at Siti' }).click()

  await expect(opening(page)).toBeHidden()
  await expect(page.locator('article.person-card').first()).toBeVisible()
  await expect(page.getByText('You waved at Siti')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('keynection.opening.done'))).toBe('1')
  await page.reload()
  await expect(page.locator('article.person-card').first()).toBeVisible()
  await expect(opening(page)).toHaveCount(0)  // once per browser
  expect(errors, errors.join('\n')).toEqual([])
})

test('key day: Skip goes straight to Neighbours, and no screen scrolls sideways on a phone', async ({ page }) => {
  const errors = watchErrors(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await resetDemo(page, { opening: true })
  await page.goto('/')
  await expect(opening(page).getByText('Your keys came with this card')).toBeVisible()
  await noSidewaysScroll(page)
  await opening(page).getByRole('button', { name: 'Open my welcome card' }).click()
  await expect(opening(page).getByRole('heading', { name: 'Who are you?' })).toBeVisible()
  await noSidewaysScroll(page)
  await opening(page).getByRole('button', { name: /^Siti/ }).click()
  await expect(opening(page).getByText(/^Hi Siti, these \d homes share a wall or a road with yours$/)).toBeVisible({ timeout: 4000 })
  await noSidewaysScroll(page)

  await page.reload()  // not done yet: it starts again, and Skip ends it from any screen
  await opening(page).getByRole('button', { name: 'Skip the opening' }).click()
  await expect(opening(page)).toBeHidden()
  await expect(page.locator('article.person-card').first()).toBeVisible()
  expect(errors, errors.join('\n')).toEqual([])
})
