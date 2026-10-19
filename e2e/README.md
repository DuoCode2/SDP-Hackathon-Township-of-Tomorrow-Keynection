# Scripted walks in a real browser

> **中文**：这个文件夹用 Playwright（测试用的浏览器）自动走原型。三个脚本：`route`（评审 3 分钟路线，每步截图到团队资料夹 `evidence/route-screenshots/`，可用 `ROUTE_SHOTS_DIR` 改）、`warranty`（测试计划的 K16：只有屋主能关保修单，演示版的 Procore 编号标为示范编号）、`monkey`（随机乱点 250 下，任何画面都不能崩）。它们用替身 AI 开一个独立的服务器（端口 8031、临时资料库），每个脚本开始时都把示范资料重置，不会碰你开着的演示（8000／8030），也不需要金钥。第一次要先 `npm install` 和 `npx playwright install chromium`（约 300 MB）。前端要先编译（`prototype/frontend` 里 `npm run build`），因为服务器送出的是 `frontend/dist`。

Layer 3 of `docs/testing-overview.md`.

```bash
cd prototype/frontend && npm run build        # the server serves frontend/dist
cd ../e2e
npm install                                    # once
npx playwright install chromium                # once, about 300 MB
npm run route                                  # the judge route, K01–K14, a screenshot per step
npm run warranty                               # K16: only the owner closes a ticket; "demo number" in three languages
npm run bothsides                              # a case open in one pane follows the other pane's decision (Siti asks, Aiman agrees)
npm run monkey                                 # 250 random clicks; MONKEY_CLICKS and MONKEY_SEED to change or repeat
npm run ai-off                                 # K22: the notice without AI, examples fill a preset
npm run all                                    # every spec (about 3 minutes)
npm run route:headed                           # watch the route happen
npm run report                                 # the HTML report, with a trace on failure
```

What they share (`helpers.ts`): the server started by `serve.mjs` (`backend/scripts/ai_standin_server.py` on port 8031, a fresh database in the temp folder, no site password, no AI key), a reset of the fictional phase at the start of each spec, the Guide's judge route as the way to jump between screens and households, and one definition of "error": an uncaught page error, a console error other than the browser's note about a 4xx answer (the app refuses a second wave today with 409, a heated message with 422 and a calmer wording, a cap with 429, on purpose), a 5xx answer, or the error boundary appearing.

Every AI answer is marked `[stand-in]`, so a screenshot can never be mistaken for the real AI. For deck screenshots with the real AI, point `baseURL` in `playwright.config.ts` at a server that has a key.

If a step fails the report keeps a trace; the usual reason is a renamed button, which is the point.
