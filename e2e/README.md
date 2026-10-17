# Scripted walk of the judge route

> **中文**：这个文件夹用 Playwright（测试用的浏览器）自动走完评审 3 分钟路线，每一步截一张图存到团队资料夹 `evidence/route-screenshots/`（可用环境变量 `ROUTE_SHOTS_DIR` 改）。它用替身 AI 开一个独立的服务器（端口 8031、临时资料库），不会碰你开着的演示（8000／8030），也不需要金钥。第一次要先 `npm install` 和 `npx playwright install chromium`（约 300 MB）。前端要先编译（`prototype/frontend` 里 `npm run build`），因为服务器送出的是 `frontend/dist`。

Layer 3 of `docs/testing-overview.md`. One test, fourteen steps, one screenshot each (K01–K14, the same numbers as `docs/test-plan.md`).

```bash
cd prototype/frontend && npm run build        # the server serves frontend/dist
cd ../e2e
npm install                                    # once
npx playwright install chromium                # once, about 300 MB
npm run route                                  # headless; screenshots land in evidence/route-screenshots/
npm run route:headed                           # watch it happen
npm run report                                 # the HTML report, with a trace on failure
```

What it does: starts `backend/scripts/ai_standin_server.py` on port 8031 with a fresh database (`serve.mjs`), opens the app at 1440×900, and clicks the six steps of the judge route from the Guide panel, checking what a judge should see at each step (the five homes, the stand-in filling the notice, "quiet times of 2 homes", Tamil on Kumar's phone, the calmer wording, "Rule-based suggestion", 13.2%). Every AI answer is marked `[stand-in]`, so a screenshot can never be mistaken for the real AI; for deck screenshots with the real AI, run the same walk against a server that has a key (`KEYNECTION_E2E_PORT` and `baseURL` in `playwright.config.ts`).

If a step fails the report keeps a trace; the usual reason is a renamed button, which is the point.
