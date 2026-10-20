import { expect, test, type Page } from '@playwright/test'
import { dismissWelcome, resetDemo, watchErrors } from './helpers'

// The household's assistant, a chat, without an AI answer: the stand-in server has none for it, so a few key words
// decide. A renovation sentence opens the notice on its first step with the sentence waiting; a status question is
// answered by the server's own count; the chat so far goes with each question. Nothing is sent to a neighbour.

const RETRY = 'The AI didn’t answer in time · Try again'

async function ask(page: Page, words: string, { aiOn = true } = {}) {
  const chat = page.getByRole('dialog', { name: 'Keynection assistant' })
  if (!(await chat.isVisible())) await page.getByRole('button', { name: 'Ask the assistant' }).click()
  await expect(chat.locator('.assistant-greeting')).toBeVisible()
  const replies = await chat.locator('.assistant-reply').count()
  await chat.getByLabel('Type what you need').fill(words)
  await chat.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(chat.locator('.assistant-msg.me').last()).toHaveText(words)
  await expect(chat.locator('.assistant-reply')).toHaveCount(replies + 1)
  // The stand-in has no answer for the assistant: with AI on the chat offers to ask again; with AI off it says so.
  // A status is the server's own count, so it offers neither.
  const last = chat.locator('.assistant-msg.bot').last()
  if (/status/.test(words)) await expect(last.getByRole('button', { name: RETRY })).toHaveCount(0)
  else if (aiOn) await expect(last.getByRole('button', { name: RETRY })).toBeVisible()
  else await expect(last.getByText('AI is off here, so this went by key words.')).toBeVisible()
  return { chat, last }
}

async function start(page: Page) {
  const errors = watchErrors(page)
  const sent: string[] = []
  const asked: Record<string, unknown>[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/(intros|messages)$/.test(r.url())) sent.push(r.url())
    if (r.method() === 'POST' && r.url().endsWith('/api/assistant')) asked.push(r.postDataJSON())
  })
  await resetDemo(page)
  await page.goto('/')
  await expect(page.locator('article.person-card').first()).toBeVisible()
  await dismissWelcome(page)
  return { errors, sent, asked }
}

test('assistant: typed words open the notice with the sentence, and a status question gets the server count', async ({ page }) => {
  const { errors, sent, asked } = await start(page)

  const { chat, last } = await ask(page, 'renovate bathroom next Saturday')
  await expect(last.locator('.assistant-reply')).toContainText('Opening the renovation notice')
  await last.getByRole('button', { name: RETRY }).click()  // the same words, asked again, without a second bubble
  await expect.poll(() => asked.length).toBe(2)
  await expect(chat.locator('.assistant-msg.me')).toHaveCount(1)
  await chat.locator('.assistant-msg.bot').last().getByRole('button', { name: 'Open the notice' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Tell everyone it affects, before you start')).toBeVisible()
  await expect(sheet.getByLabel('Just say it in one sentence')).toHaveValue('renovate bathroom next Saturday')
  await expect(sheet.locator('.works-card.on')).toBeVisible()  // step 1: the type of work
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  // The chat is still there when it opens again, and goes with the next question.
  const status = await ask(page, 'my warranty status')
  await expect(status.last.locator('.assistant-reply')).toHaveText('No warranty tickets.')
  await expect(status.last.getByRole('button', { name: 'Open Photos & repairs' })).toBeVisible()
  expect(asked[2].history).toEqual([
    { who: 'resident', text: 'renovate bathroom next Saturday' },
    { who: 'assistant', text: expect.stringContaining('Opening the renovation notice') },
    { who: 'assistant', text: expect.stringContaining('Opening the renovation notice') },
  ])
  await page.keyboard.press('Escape')
  await expect(status.chat).toBeHidden()

  expect(sent, 'the assistant never sends anything to a neighbour').toEqual([])
  expect(errors, errors.join('\n')).toEqual([])
})

test('assistant with AI off: the sentence becomes the description on the notice\'s first step', async ({ page }) => {
  await page.route('**/api/ai', (route) => route.fulfill({ json: { on: false, model: null, provider: null } }))
  const { errors, sent } = await start(page)

  const { last } = await ask(page, 'renovate bathroom next Saturday', { aiOn: false })
  await last.getByRole('button', { name: 'Open the notice' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByLabel(/Describe the work/)).toHaveValue('renovate bathroom next Saturday')
  await page.keyboard.press('Escape')

  expect(sent).toEqual([])
  expect(errors, errors.join('\n')).toEqual([])
})
