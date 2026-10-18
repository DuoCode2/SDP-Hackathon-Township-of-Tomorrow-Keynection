import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { dismissWelcome, judgeStep, resetDemo } from './helpers'

// A read-only audit of design discipline on the judge route: how many solid primary buttons each screen shows
// (the rule is one per screen) and where the rubber stamp is used (meant for verified or sealed records only).
// It never fails on its own; it writes test-results/ui-audit.json and prints a table, for a person to judge.

type Row = { screen: string; primaries: string[]; stamps: string[] }

async function look(page: Page, screen: string): Promise<Row> {
  await page.waitForTimeout(400)
  const texts = (sel: string) => page.locator(sel).evaluateAll((els) =>
    els.filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))
  return { screen, primaries: await texts('main .btn-primary, header .btn-primary, [role="dialog"] .btn-primary'), stamps: await texts('.stamp') }
}

test('primary buttons and stamps per screen (read-only audit)', async ({ page }) => {
  await resetDemo(page)
  // Aiman's renovation next door gives Siti a pre-work photo to take later (the route registers it by hand).
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
  const notice = await page.request.post('/api/intros', {
    data: { from_unit_id: 'T-12', message: 'Hi, Aiman from No. 12 here. Retiling the master bathroom soon.',
      renovation: { scope: 'Retiling the master bathroom', works_type: 'wet', start: day(10), end: day(24), noisy_from: '09:00', noisy_to: '17:00', weekdays_only: true } },
  })
  expect(notice.status(), await notice.text()).toBe(201)
  await page.goto('/')
  await expect(page.locator('article.person-card').first()).toBeVisible()
  await dismissWelcome(page)
  const rows: Row[] = []
  const names = ['Neighbours', 'Works', 'Channels', 'Chats', 'Photos & repairs', 'Impact model']

  for (let step = 1; step <= 6; step++) {
    await judgeStep(page, step)
    rows.push(await look(page, `${step} ${names[step - 1]}`))
  }

  await judgeStep(page, 2)
  await page.getByRole('button', { name: 'Register renovation' }).first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await sheet.locator('.works-card').first().click() // wet work: a terrace defaults to structural, which needs a permit before Next
  for (let i = 1; i <= 5; i++) {
    rows.push(await look(page, `Register renovation, step ${i}`))
    if (i < 5) await sheet.getByRole('button', { name: /^Next$/ }).click()
  }
  await page.keyboard.press('Escape')

  await judgeStep(page, 4)
  await page.locator('main').locator('button.chat-row', { hasText: 'Aiman' }).click()
  await expect(page.locator('textarea.compose-input')).toBeVisible()
  rows.push(await look(page, 'Chat thread (Siti ↔ Aiman)'))

  await judgeStep(page, 5)
  const sealed = page.waitForResponse((r) => r.url().includes('/photos/demo') && r.request().method() === 'POST')
  await page.locator('main').getByRole('button', { name: 'Use sample' }).first().click()
  await sealed
  rows.push(await look(page, 'Photos & repairs, photo sealed'))
  const compared = page.waitForResponse((r) => r.url().includes('/api/incidents') && r.request().method() === 'POST', { timeout: 60_000 })
  await page.locator('main').getByRole('button', { name: 'Sample crack' }).click()
  await compared
  await expect(page.locator('main').getByText('Rule-based suggestion')).toBeVisible({ timeout: 30_000 })
  rows.push(await look(page, 'Case view'))

  const out = path.join(__dirname, 'test-results', 'ui-audit.json')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(rows, null, 2))
  console.log('\nscreen | primary buttons | stamps')
  for (const r of rows) console.log(`${r.screen} | ${r.primaries.length}: ${r.primaries.join(' / ') || '–'} | ${r.stamps.length}: ${r.stamps.join(' / ') || '–'}`)
  expect(rows.length).toBeGreaterThan(0)
})
