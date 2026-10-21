# 分支交接：批 1–4 改了什么、怎么合、还欠什么

> 写给队友（2026-10-20）。四个叠着的分支、34 个 commit，相对 `main`（`47486e7`）共 62 个文件、+2,293 / −308。每个任务一个 commit，commit message 就是该任务做了什么。本文按「怎么合 → 改了什么 → 清单外改动 → 你要改的文档 → 发现但没修的问题 → 真 AI 实测 → 本地怎么跑 → 还欠的非代码项」排。

## 1. 怎么合

分支是**叠**的，每个都包含前一个：

```
main (47486e7)
 └─ fix/day1-route-and-fairness   (15b554c)  批 1  T1–T8    8 commits
     └─ route/step4-and-impact     (4c98888)  批 2  T9–T13   7 commits
         └─ route/polish           (811947e)  批 3  T14–T21  8 commits
             └─ feat/assistant     (e0f4fec)  批 4A T22–T25, T30  5 commits
                 └─ feat/opening   (478e2e1)  批 4B T26–T27  2 commits
                     └─ feat/plan-geometry (c98db8c)  批 4C T28–T29  2 commits
```

- **合 `feat/plan-geometry` 一个分支就全进了**；也可以按顺序一批一批合（每批独立可用）。
- `main` 自 `47486e7` 之后没有新 commit，所以现在合**没有冲突**。
- 每个分支结束时的全量检查（都在 `frontend/dist` 已编译的状态下跑）：

| 分支 | pytest | tsc | Playwright |
|---|---|---|---|
| fix/day1-route-and-fairness | 347 passed | exit 0 | 7 passed |
| route/step4-and-impact | 347 passed | exit 0 | 7 passed |
| route/polish | 348 passed | exit 0 | 7 passed |
| feat/assistant | 367 passed | exit 0 | 9 passed |
| feat/opening | 367 passed | exit 0 | 11 passed |
| **feat/plan-geometry（终态）** | **369 passed** | **exit 0** | **11 passed** |

- `feat/assistant` 一个分支 +1,015 行，超过我们说好的 400 行；但每个任务一个 commit，建议**按 commit 看**（T22 后端 / T23 前端 / T24 文案 / T30 prompt / T25 问答）。
- 合并后 Render 会自动部署。**部署前请在 Render 的 Environment 设 `ANTHROPIC_API_KEY`、删 `GEMINI_API_KEY`、加 `KEYNECTION_AI_MODEL=claude-haiku-5-5`**（见第 7 节为什么）。

## 2. 改了什么（按批、按任务）

### 批 1 `fix/day1-route-and-fairness` — 评审路线上的死路 + pitch 依赖的公平规则

| # | 改动 | 为什么 | 主要文件 |
|---|---|---|---|
| T1 | 装修向导默认「浴室/厨房/水管」（原来排屋默认「结构工程」，第 4 步 Next 灰掉写 Approval first）；AI 关着时三个示例按钮用**本地预设**填表，不调 API；Guide 和 README 的 AI-off 说明改写 | 评委没 AI key 时走到第 4 步以为坏了 | RenovationWizard.tsx, guide.ts, i18n.tsx, README.md:34, e2e/ai-off.spec.ts（新） |
| T2 | 聊天框发送中 Enter 不能再发；textarea 发送中只读 | AI 检查要几秒，评委按两次 Enter 发出两条 | ChatsView.tsx |
| T3 | Evidence 页每次重载后重新取当前 open case / ticket | 双视角下一边改了状态，另一边还是旧快照 | EvidenceView.tsx, e2e/bothsides.spec.ts（新） |
| T4 | 装修方只有在被指控（proposed / disputed）后才能选「Ask an SDP inspector」 | 原来装修方能用 inspect 锁死邻居还没决定的案件 | main.py decide(), CaseView.tsx choicesFor, test_decisions.py +3 |
| T5 | 开工前照片只能挂到**装修通知**，不能挂到普通 hello；follow-up 照片不能指向别的装修 | 原来能让没装修的邻居被指控 | main.py _store_photo / report_incident, test_evidence_api.py +2 |
| T6 | 噪音时段必须在屋规 09:00–18:00 内，通知和 quiet-plan 都拒收（422）；向导时间框加 min/max 和一行屋规提示 | 原来夜间 20:00–23:00 的通知照发给五户 | main.py Renovation.check_order / quiet_plan, quiet.py HOUSE_RULE_HOURS, RenovationWizard.tsx, test_quiet.py +2 |
| T7 | **只改文档**：technical-summary 的不满阶梯图改为「装修方标记 sorted，提出者仍可升级」 | 代码本来就是这样，文档画反了 | docs/technical-summary.md |
| T8 | Siti 的快捷回复「能不能避开 1–3 点」改成「谢谢你避开了午睡时段」 | 她回复的通知已经避开了，自相矛盾 | talk.py, test_talk.py +1 |

### 批 2 `route/step4-and-impact` — 3 分钟路线更顺

| # | 改动 | 文件 |
|---|---|---|
| T9 | Guide 第 4 步一键开分屏：左 Aiman 右 Siti，两格各自打开对方线程（原来评委要自己找 Both sides、再点两行）；a11y / audit spec 随之调整 | App.tsx go(), guide.ts, e2e/route|a11y|audit.spec.ts |
| T10 | demo 限定的「Try a sharp message」芯片，一键填入那句马来文 | ChatsView.tsx, i18n.tsx |
| T11 | Impact 页英雄位换成「新增联系的住户数」等连接指标；「379 h / RM 16,584」挪到下面「What SDP could save (assumptions)」 | ImpactView.tsx |
| T12 | When 步选规划时段时显示 09–18 的时间轴条（噪音段 / 安静段），不再同时显示屋主输入框和绿卡两套数字；超时段红字 + Next 灰；三个示例句 9 to 5 → **9 to 6**（规划离 240 分钟底线有 60 分钟余量） | RenovationWizard.tsx, styles.css, e2e/route.spec.ts |
| T13 | Works 页 demo 限定「Quick example」：一键填好浴室示例直接开到 When 步 | WorksView.tsx, RenovationWizard.tsx |
| — | Guide 第 2 步文案和 `ai.reno.placeholder` 也改成 9 to 6 | guide.ts, i18n.tsx |

### 批 3 `route/polish` — 手机、无障碍、隐私、稳定性

| # | 改动 | 文件 |
|---|---|---|
| T14 | 手机 dock 加 Impact、Channels | App.tsx |
| T15 | 消息的反应/举报工具在触屏常显（`hover: none`）；easy mode 保留举报 | styles.css |
| T16 | Guide：四段评委说明移到步骤下方折叠；≥ **1312px** 停靠成 300px 列（不再每点一步就关） | Guide.tsx, App.tsx, styles.css |
| T17 | demo 不再自动弹 Welcome；Me 页「Show the welcome again」在两种模式都能重放 | CircleView.tsx, welcome.ts |
| T18 | 未认识的邻居卡上 Wave 是主按钮、Message 次按钮；「Introduce yourself」横幅改文字链接 | CircleView.tsx |
| T19 | 侧栏/dock/Guide 步骤按钮加 aria-label；a11y spec 扩到侧栏 | App.tsx, Guide.tsx, e2e/a11y.spec.ts |
| T20 | 案件系统消息按**门牌**存（`values.unit`），不再存姓名；`close_account` 清理旧数据 → 注销后名字不再留在邻居线程里（隐私声明的承诺） | main.py, privacy.py, ChatsView.tsx, test_privacy.py +1, test_codes.py |
| T21 | `/api/demo/reset` 要 `{"confirm": true}` + 前端 confirm + `_idle_lock`；SQLite 开 WAL、busy_timeout 15 s | main.py, db.py, DashboardView.tsx, e2e/helpers.ts |

### 批 4A `feat/assistant` — 语音/文字助手

| # | 改动 | 文件 |
|---|---|---|
| T22 | `POST /api/assistant`：一句话 → 六种意图之一（register_renovation / say_hello / set_quiet_time / check_status / go_to_page / unknown）+ 字段。装修复用现有 `draft_renovation`；状态查询的回复由**服务器**拼（数字不靠 AI）；AI 关/额度用完/没答时按关键词路由，响应多 `by_ai: false` | ai.py plan_request + AssistantPlan, main.py, test_assistant.py（新，14 个） |
| T23 | 右下角常驻按钮：**按住说话**（Web Speech，本地转写，音频不出境）或打字；结果卡：装修 → 打开向导停在 Review；打招呼 → IntroWizard 预勾；安静时段 → 直接加、可 Undo；查状态 → 显示 + Open；跳页 → 直接跳。**永远不替用户发送**。demo 限定三个示例芯片 | components/Assistant.tsx（新）, App.tsx, api.ts, RenovationWizard.tsx（`fromAssistant`）, IntroWizard.tsx（`pick`）, guide.ts, i18n.tsx, e2e/assistant.spec.ts（新） |
| T24 | 隐私声明（`join.p5`，含泰米尔文）、Safeguards、README「AI use」、technical-summary 写明助手会送什么：**本户记录 + 邻居门牌，不含邻居姓名和他们写的话** | i18n.tsx, SafeguardsView.tsx, README.md:173, docs/technical-summary.md:83 |
| T30 | 真 AI 实走发现的 4 个问题（见第 6 节）：描述不再含日期/时段（prompt + 服务端兜底）；排屋的 why 不再提楼上楼下；缓和版本必须保留每个事实和问句、不加料；**通知翻译改到 201 之后的后台任务**；聊天检查 800 token + 真正的 10 s 总时长上限（`_ask_claude` 走 worker + `future.result(timeout)`）；每次 AI 调用记一行耗时和 token | ai.py, main.py, test_ai.py +5 |
| T25 | 助手问答：只从 `knowledge.py`（屋规、许可摘要、不满阶梯、保修规则，约 1,200 token）和本户记录回答，答不了就指向前台（Chats 的 Estate Office 频道） | knowledge.py（新）, ai.py, Assistant.tsx |

### 批 4B `feat/opening` — 开场 + Channels 可点

| # | 改动 | 文件 |
|---|---|---|
| T26 | demo 首次打开（每个浏览器一次，`keynection.opening.done`）：① welcome pack 卡 → ② 「Who are you?」六张 cast 卡（Aiman 标 Start here）→ ③ 平面图描线、五户依次亮起（约 2.3 秒）、「Wave at Siti / Look around first」；随时 Skip；pilot 不出现 | screens/OpeningView.tsx（新）, App.tsx, welcome.ts, PlanMap.tsx, e2e/opening.spec.ts（新） |
| T27 | Channels 的 SDP App 手机：点「Neighbours · Keynection」后手机里跑**真的 app**（`?embed=1&me=…`，隐藏侧栏/顶栏/Guide/助手，只在 demo 模式）；WhatsApp 预览能滚，按钮按提醒类型跳到对应页面 | ChannelsView.tsx, App.tsx, main.py（响应头，见第 3 节） |

### 批 4C `feat/plan-geometry` — 排屋后排 + 平面图动画

| # | 改动 | 文件 |
|---|---|---|
| T28 | 排屋加「后面那家」（`back_row`，共用后围栏和后排水沟）：**湿作业 / 敲打 / 结构**三类工程会通知它，但它**不进日常五户圈子**（口号 five neighbours 不变）。demo 多了第三排 No. 30–35（Jalan Demo 2，No. 34 未加入）；pilot CSV 多可选列 `back_row`；平面图画出后巷 | neighbours.py, phase_import.py, seed.py, db.py（`SCHEMA_VERSION` 16）, main.py, PlanMap.tsx, RenovationWizard.tsx, test_neighbours.py +1, test_pilot_phase.py +1 |
| T29 | 公寓改成有深度的「格子楼」：楼层逐层升起、你的单位脉冲一次、圈子四户亮；Who is told 上每条规则有动画 + 图例（湿作业水往下流两层、敲打上下震动、结构整区红边、排屋后围栏）；点任一户显示「关系 + 为什么被通知」。所有动画 ≤ 2.5 秒、只播一次、`prefers-reduced-motion` 直接终态 | PlanMap.tsx, RenovationWizard.tsx, styles.css, i18n.tsx |

## 3. 清单外的改动（你要知道的）

- **`X-Frame-Options: DENY` → `SAMEORIGIN`**（main.py 安全响应头）：T27 的同源 iframe 必须这样；别的网站仍然不能把 Keynection 嵌进去。technical-summary 的安全头一节若有写 DENY 请改。
- **`db.py`：units 表加 `back_row`，`SCHEMA_VERSION` 15 → 16**。demo 库会重建；pilot 库走现有「只加列」升级路径（test_pilot_data 通过）。
- **`seed.py`：36 户 → 42 户**（35 已加入 → 40）。dashboard 的数字会变。
- **全局 reduced-motion 规则**改成 `0.01ms` + `animation-iteration-count: 1` + delay 0（原来是 `animation: none`，会让带 delay 的元素一直隐藏）。
- `IntroWizard.tsx` 加 `pick` prop；`RenovationWizard.tsx` 加 `fromAssistant`、`worksType`、`explain`；`PlanMap.tsx` 收 `worksType` / `explain`。
- e2e：`helpers.ts`（reset 带 confirm、`resetDemo` 顺手设 `keynection.opening.done`）、`playwright.config.ts` testMatch、`package.json` 脚本、`e2e/README.md` 都按新 spec 加了行。
- commit trailer 是 `Co-Authored-By: Claude Opus 5.5`（执行的模型）。

## 4. 要你改的文档数字和文案（我们没动你维护的文件）

**数字**
- `docs/testing-overview.md`：后端总数 **369**（批 3 后 348；test_assistant.py 新文件 14、test_ai.py 30 → 35、test_neighbours +1、test_pilot_phase +1；Layer-1 表各行按文件重数）；「five Playwright scripts」→ **nine 个 spec 文件 / 11 个测试**（新增 bothsides、ai-off、assistant、opening）；第 21 行「333 collected」已过时；第 28 行「only the text leaves」要加助手的例外（本户记录 + 邻居门牌）。
- `docs/judging-criteria-map.md`、`docs/technical-summary.md:23`、`docs/团队说明.md:7`：凡写测试数的地方统一 369；表数写 34 的地方改 **32**（`grep -c "CREATE TABLE" backend/app/db.py`；T28 加的是列不是表）。
- README「For scale」那行：17 screens → **18**（Opening）；103 endpoints → **104**（`/api/assistant`）；日期改。

**文案**
- 「weekdays 9 to 5」→「weekdays 9 to 6」：`README.md:28`、`docs/test-plan.md:21`（K03）、`docs/团队说明.md:184`。
- 「5 homes told / 通知五户」：对**湿作业、敲打、结构**工程现在是 **6 户**（含后面的 No. 32），对油漆/木工仍是 2 户；README 路线第 2 步、`docs/test-plan.md` 的 K04、`docs/团队说明.md` 相应处。No. 23 走纸本的说法不变。
- `docs/test-plan.md` 若引用 `K01a-welcome-card` 截图：demo 不再自动弹 Welcome，改为从 Me 页「Show the welcome again」拍。
- `docs/key-decisions.md` 第 3 行「AI 只放两处」→ 三处（助手是例外，且永不替用户发送）；decision 17 的 read-ticks 一行和实际不符（e35eade 加了 read ticks）。
- `docs/feature-status.md` 加三行：助手（live with key；关键词退路 live）、开场（live，demo only）、排屋后排（live）；「WhatsApp 发送」仍 Not built。
- ~~隐私声明版本升 10d~~：已在合并 PR 里做（`pilot-2026-10d-ai` / `pilot-2026-10d-ai-gemini`）。
- technical-summary 安全头：DENY → SAMEORIGIN。

## 5. 发现但没修的问题（按优先级）

**评审现场会咬人的**
1. **助手第一次调用可能超时退化**：`ai.plan_request` 的 `timeout=12`（ai.py）对冷启动第一次调用太紧，超时后静默走关键词路由，面板显示「No AI answer this time, so this went by key words」。接口本身中英文都正确（约 8 秒）。修法：12 → 20，并在 `by_ai === false` 且 AI 开着时显示「再试一次」按钮而不是那句话。（T31）
2. **通知翻译仍要约 27 秒**（Haiku，三种语言一次请求）：现在不挡发送，但这段时间 Siti / Kumar 看到的是英文原文，没有「translating…」字样。修法：ChannelsView / ChatsView 在 `translated: false` 时显示一行「正在翻译…」；或改成每种语言一次调用并行。
3. **demo reset 并发仍会 500**：`_idle_lock` 只让两次重建互斥，别的请求在 DROP/重建那几百毫秒里会读到不存在的表（压测：每 2 秒按一次 reset，1,110 个请求里 16 个 500）。评审日多个评委同时用时别按 reset。修法：先在内存库 `init_db` 再一次 `backup` 进正式库。
4. 开场揭示屏的两个按钮在 768 高的笔电上在折叠线以下，要滚动；修法：平面图限高 60vh，按钮固定底部。

**体验**
5. 助手里中文例句「换浴室瓷砖」被判成 hacking（英文判成 wet），通知名单因此不同（上下两层 vs 往下两层）；两种都说得通，但三个示例最好一致——改中文例句措辞，或在 Guide 解释。
6. 「下周六开始…平日九点到六点」：开工日是星期六却 `weekdays_only: true`（AI 填表）。
7. Neighbours 页的「Your quiet times」卡只在换户时读取：用助手加/撤销安静时段后卡片不刷新。一行修法：`<QuietTimesCard key={version} …>`。
8. 助手按钮的 easy-mode 尺寸只在换户时读 profile。
9. SDP App 手机只有 311px 宽，iframe 里聊天输入框被「Raise a concern」和麦克风挤窄；加宽到 375 或 <340px 时收进菜单。
10. check_status 的回复只有英文（中文问也回英文）；AI-off 关键词路由没有 go_to_page。
11. 后巷那条 16px 的带子上文字会被「back reach」色块盖住一部分；PlanMap 每次挂载都重播动画（向导里从第 1 步回到第 2 步会再播）。
12. monkey.spec 偶发卡到 15 分钟超时：`box.fill()` 没 timeout；一行修法 `box.fill(text, { timeout: 2000 })`。

**没验证的**
13. **按住说话没有用真麦克风测过**（自动化浏览器没有麦克风）。请在手机上同一 Wi-Fi `start-demo.bat --lan` 试一句。
14. pilot 模式下的助手、开场、embed、PlanMap 动画都没起 pilot 服务器实测。
15. e2e 的 AI 替身（`backend/scripts/ai_standin_server.py`）没有 `AssistantPlan` 分支，e2e 只测得到关键词退路。
16. T20 的设计副作用：注销后若新屋主重新加入同一户，旧案件通知会显示新屋主名字（按门牌实时解析）。
17. T28 没做 Planner 预览的「背靠背」开关（`Unit.back_row` 默认 None，不影响现有预设）。
18. `e2e/helpers.ts` 的 `judgeStep` 只能在 ≥1312px 用（窄屏 Guide 抽屉会关）。
19. e2e/README.md、playwright.config.ts、serve.mjs 里写的 `prototype/frontend` 应为 `frontend/`。

## 6. 真 AI 实测（Claude Haiku 5.5，本地）

**T30 之前 → 之后**
- Send notice：27.4 s → **0.3 s**（翻译转后台，自身仍 27.7 s）。
- 马来文 tone 检查：18.6 s → **2.1 s**（原来 SDK 的 timeout 只管每段网络等待，不是总时长；现在有真正的总时长上限）。
- 填表：8.1 s → 5.3–6.4 s。
- 描述不再把「weekdays only, for two weeks」塞进 scope（三种语言的通知都不再重复）。
- 排屋的 why 不再写「leak into the home below」。
- 缓和版本保留事实和问句、不加原文没有的时间词。

**助手真实输出样例**（都正确）：中文「我下周六开始换浴室瓷砖，大概两个星期，ABC Renovation 做，平日九点到六点」→ 向导停在 Review、5 homes；「Help me say hi to No. 11 and No. 13 can?」→ IntroWizard 预勾两户；马来文「perlukan senyap pukul 10 hingga 12 pagi」→ 安静时段 10:00–12:00 已加、可 Undo；「我的保修票到哪了」→「Warranty #1 · open · 30 days left.」；「我可以星期天施工吗」→ 引屋规回答「不可以…周一至周六 09:00–18:00」。

**为什么建议 Render 换 Claude**：线上 Gemini 这几天的失败是 503 / 模型 id（你已换 3.5-flash 加重试），Haiku 的延迟和稳定性在上面；而且 pitch 里本来就是「Claude by design」。费用整个评审期几美元。

## 7. 本地怎么跑 / 测

- **Python ≥ 3.12**（numpy 2.5 / opencv 5.0 的锁定）；默认 python 是 3.10 的机器 `start-demo.bat` 会失败且不报版本。
- AI key：**不要放进仓库**。本机做法是仓库外一个 `keys.env`（两行：`ANTHROPIC_API_KEY=…`、`KEYNECTION_AI_MODEL=claude-haiku-5-5`），启动后端前 `set -a; . ../keys.env; set +a`。
- Playwright：第一次 `npx playwright install chromium`（约 300 MB）；`route.spec` 默认把截图写到 `../evidence/route-screenshots/`（团队资料夹），不想覆盖就设 `ROUTE_SHOTS_DIR` 指到别处。
- 全套：`cd backend && .venv/Scripts/python -m pytest -q`；`cd frontend && npx tsc --noEmit -p .`；`cd e2e && npm run all`（要先 `npm run build`）。
- demo reset 现在要 body `{"confirm": true}`。
- 不要一边 `npm run build` 一边跑 pytest（`test_site_gate` 会在 dist 出现的瞬间失败一次）。

## 8. 还欠的非代码项（评审报告里最提分、只有人能做）

按分数权重排：
1. **住户访谈 + 问卷**（Impact 25% + Evidence 10%）：8–10 个最近 18 个月拿过钥匙的人，问「五户里认识几个名字 / 装修季有没有和邻居起摩擦 / 会不会回复一条通知式的自我介绍」，结果进 repo `evidence/`，README「Why」放三个数字两句引言。
2. **点名一个 pilot phase**（Feasibility 20% + Strategic 15%）：一个 2027 交房的有地 phase + 一个高层备选，Planner 预设用它的真实排数。
3. **证据文件进 repo**（普查表、28 起纠纷、36 条评论、路线截图）；测试数等数字统一一处。
4. **README 砍到 ~700 字**，加 **Mechanism / Enabler** 两节（评分表的原词），团队段落，视频链接；「What it is not yet」改写成「What the pilot adds」。
5. Impact 页的控制组说法（姐妹 phase 或 6 vs 12 个月）写进 criteria map；Commercial 价值重排（HDA 责任 → Tribunal → ESG 数据 → 满意度 → 物业工时）。
6. 真机表（test-plan §D）：一台 Android 一台 iPhone 跑 K00–K15 填满。
7. 两页 DPIA 草案随 proposal 交；Tamil 找母语者校对。
8. 3 分钟视频 + 10 页 deck + 60 秒版。

## 9. 几个设计决定（为什么这样做）

- **助手永远停在一键确认**：通知发给五户 + 前台打印纸本，发错收不回；查状态、跳页、设自己的安静时段才直接执行。评委问「说错了怎么办」答这个。
- **后排不进「五户」圈子，只进通知名单**：口号保住，demo 主线「extend kitchen (rear wall)」也通知到共用后围栏那户。
- **送去 AI 的只有本户记录和邻居门牌**：和原来「只有打的字出境」同一原则的扩展，隐私声明已写。
- **翻译转后台而不是改模型**：发送体验 0.3 秒，翻译质量不变；代价是 27 秒内读者看到原文（第 5 节第 2 条）。
- **动画一次、≤ 2.5 秒、reduced-motion 终态**：评审只有 3 分钟，评委会测无障碍。

---
完整的逐任务执行记录（含每处 spec 和实际的差异、每次全量测试的数字）在 Frankie 本机的 `TASKS.md` 第 5 节，需要可发。
