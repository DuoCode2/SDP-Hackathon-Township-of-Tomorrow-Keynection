import { expect, test } from '@playwright/test'
import { dismissWelcome, resetDemo, watchErrors } from './helpers'

// The monkey: a few hundred random clicks and keystrokes across the demo, with the one rule that no screen may
// break (an uncaught error, a 5xx, or the error boundary showing). Refusals the app makes on purpose (a second
// wave today, an insult, a cap) are fine. The seed is printed so a failing run can be repeated:
//   MONKEY_SEED=12345 MONKEY_CLICKS=400 npm run monkey

const CLICKS = Number(process.env.MONKEY_CLICKS ?? 250)
const SEED = Number(process.env.MONKEY_SEED ?? Date.now() % 100_000)
// Things a monkey should not do in anyone's demo: leave the page, print, download, or wipe the data mid-run.
const AVOID = /download|print|reset demo|sign out|close account|open the join page|file/i
const BOUNDARY = /Something went wrong on this screen|这一页出了点问题|Ada masalah pada skrin ini/

/** xorshift32: small, deterministic, good enough to pick buttons. */
function random(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4_294_967_296
  }
}

test('random clicks never break a screen', async ({ page }) => {
  test.setTimeout(15 * 60_000)
  test.info().annotations.push({ type: 'monkey', description: `${CLICKS} clicks, seed ${SEED}` })
  console.log(`monkey: ${CLICKS} clicks, seed ${SEED} (repeat with MONKEY_SEED=${SEED})`)
  const errors = watchErrors(page)
  const next = random(SEED)
  const log: string[] = []
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${r.status()} from ${r.url()}`) })

  await resetDemo(page)
  await page.goto('/')
  await expect(page.locator('article.person-card').first()).toBeVisible()
  await dismissWelcome(page)

  for (let i = 0; i < CLICKS && errors.length === 0; i++) {
    const roll = next()
    if (roll < 0.1) {
      await page.keyboard.press('Escape')
      log.push('Esc')
    } else if (roll < 0.25) {
      const box = page.locator('main textarea:visible, main input[type="text"]:visible, [role="dialog"] textarea:visible').first()
      if (await box.count()) {
        const text = next() < 0.5 ? 'Hello from the monkey' : 'Rumah awak bising macam kilang! Tak reti hormat jiran ke?'
        await box.fill(text).catch(() => null)
        log.push(`type "${text.slice(0, 18)}…"`)
        if (next() < 0.5) await box.press('Enter').catch(() => null)
      }
    } else {
      const targets = page.locator('main button:visible, header button:visible, nav button:visible, aside button:visible, [role="dialog"] button:visible')
      const n = await targets.count()
      if (n === 0) { await page.keyboard.press('Escape'); continue }
      const pick = targets.nth(Math.floor(next() * n))
      const name = ((await pick.innerText().catch(() => '')) || (await pick.getAttribute('aria-label').catch(() => '')) || '?').trim().replace(/\s+/g, ' ').slice(0, 40)
      if (AVOID.test(name) || !(await pick.isEnabled().catch(() => false))) continue
      log.push(name)
      await pick.click({ timeout: 2000, noWaitAfter: true }).catch(() => log.push('  (could not click)'))
    }
    const boundary = page.getByRole('alert').filter({ hasText: BOUNDARY })
    if (await boundary.count()) errors.push(`error boundary shown after: ${log.slice(-10).join(' → ')}`)
  }

  expect(errors, `seed ${SEED}; last actions: ${log.slice(-30).join(' → ')}\n${errors.join('\n')}`).toEqual([])
})
