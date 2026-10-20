import { expect, test, type Page } from '@playwright/test'
import { dismissWelcome, resetDemo, watchErrors } from './helpers'

// The household's assistant without an AI answer: the stand-in server has none for it, so a few key words decide.
// A renovation sentence opens the notice on its first step with the sentence waiting; a status question is answered
// by the server's own count. Nothing is sent to a neighbour from the assistant.

const RETRY = 'The AI didn’t answer in time · Try again'

async function ask(page: Page, words: string, { aiOn = true } = {}) {
  await page.getByRole('button', { name: 'Ask the assistant' }).click()
  const panel = page.getByRole('dialog')
  await panel.getByLabel('Type what you need').fill(words)
  await panel.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(panel.locator('.assistant-reply')).toBeVisible()
  // The stand-in has no answer for the assistant: with AI on the panel offers to ask again; with AI off it says so.
  if (aiOn) await expect(panel.getByRole('button', { name: RETRY })).toBeVisible()
  else await expect(panel.getByText('AI is off here, so this went by key words.')).toBeVisible()
  return panel
}

async function start(page: Page) {
  const errors = watchErrors(page)
  const sent: string[] = []
  const asked: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/(intros|messages)$/.test(r.url())) sent.push(r.url())
    if (r.method() === 'POST' && r.url().endsWith('/api/assistant')) asked.push(r.url())
  })
  await resetDemo(page)
  await page.goto('/')
  await expect(page.locator('article.person-card').first()).toBeVisible()
  await dismissWelcome(page)
  return { errors, sent, asked }
}

test('assistant: typed words open the notice with the sentence, and a status question gets the server count', async ({ page }) => {
  const { errors, sent, asked } = await start(page)

  const panel = await ask(page, 'renovate bathroom next Saturday')
  await expect(panel.locator('.assistant-reply')).toContainText('Opening the renovation notice')
  await panel.getByRole('button', { name: RETRY }).click()  // the same words, asked again
  await expect.poll(() => asked.length).toBe(2)
  await expect(panel.locator('.assistant-reply')).toContainText('Opening the renovation notice')
  await panel.getByRole('button', { name: 'Open the notice' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Tell everyone it affects, before you start')).toBeVisible()
  await expect(sheet.getByLabel('Just say it in one sentence')).toHaveValue('renovate bathroom next Saturday')
  await expect(sheet.locator('.works-card.on')).toBeVisible()  // step 1: the type of work
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  const status = await ask(page, 'my warranty status')
  await expect(status.locator('.assistant-reply')).toHaveText('No warranty tickets.')
  await page.keyboard.press('Escape')

  expect(sent, 'the assistant never sends anything to a neighbour').toEqual([])
  expect(errors, errors.join('\n')).toEqual([])
})

test('assistant with AI off: the sentence becomes the description on the notice\'s first step', async ({ page }) => {
  await page.route('**/api/ai', (route) => route.fulfill({ json: { on: false, model: null, provider: null } }))
  const { errors, sent } = await start(page)

  const panel = await ask(page, 'renovate bathroom next Saturday', { aiOn: false })
  await panel.getByRole('button', { name: 'Open the notice' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByLabel(/Describe the work/)).toHaveValue('renovate bathroom next Saturday')
  await page.keyboard.press('Escape')

  expect(sent).toEqual([])
  expect(errors, errors.join('\n')).toEqual([])
})
