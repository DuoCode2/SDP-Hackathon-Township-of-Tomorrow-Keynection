# Jiran5 原型（项目名待定）

Sime Darby Property University Hackathon 2026 · People 赛道 · "邻里圈 + 信任账本"合并版的原型。

所有住户、门牌、姓名和示范照片都是虚构或程序画出来的，不是 SDP 的真实数据，也没有真实住户的照片。

## 四层都能演示了

| 层 | 画面 | 做什么 |
|---|---|---|
| 1 认识 | Circle、Chats | 按平面图算出每户的 5 户邻里圈（地图上有连线）；英文/马来文/中文自我介绍；模拟 WhatsApp，邻居 Wave back |
| 2 约定 | Works | 装修日历与"现在是否安静时段"的实时状态；承包商 QR 通行证；门卫扫码模拟；承包商只看得到自己那份工程资料；屋主随时撤销 |
| 3 证据 | Evidence → 案件 | 开工前照片（质量检查、指纹封存）；跟进照片自动对齐、"AI 扫描"动画、HUD 框标出裂缝或水渍；按公开规则给建议，人来决定 |
| 4 关闭 | Evidence → 保修、SDP | 判定为建筑瑕疵就自动开保修单；SDP 提交维修照片时，系统拿它跟开工前照片对比，判断"是否已恢复原样"；**只有屋主能关闭**，驳回就重开 |
| 屋历 | Log | 每户一条 SHA-256 链：交屋、装修、通行证、照片、案件、决定、维修、屋主确认都在里面，每块都显示自己的指纹和上一块的指纹 |
| 后台 | SDP | 环形仪表（回覆率、开工前照片覆盖率、屋主关闭比例）、活动数据、门禁扫描、保修队列 |

## 怎么运行

需要 Python 3.12 以上和 Node.js 20 以上。

### 最简单：双击一键启动

| 档案 | 用在 | 做什么 |
|---|---|---|
| `start-demo.bat` | Windows，演示、彩排 | 双击就好。第一次会自动装好全部套件（要几分钟），之后每次只需约 10 秒。自动打开 http://localhost:8000 ，前后端同一个窗口、同一个端口。演示时窗口不要关，关掉就停止 |
| `start-demo.sh` | macOS / Linux | 同上，在终端执行 `./start-demo.sh` |
| `start-dev.bat` | 改代码时 | 开两个窗口：后端（改 Python 自动重载）和前端（改画面即时更新），打开 http://localhost:5173 。要先跑过一次 `start-demo.bat` |

不想自动开浏览器：先设环境变量 `JIRAN_NO_BROWSER=1`。

### 手动启动（开发者用）

后端（第一次要先建虚拟环境）：

```bash
cd prototype/backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

前端（另开一个终端）：

```bash
cd prototype/frontend
npm install
npm run dev
```

打开 http://localhost:5173 。在电脑上会显示在石墨色手机外框里（画面是浅色）；窗口窄于 560 像素时会全屏显示。服务器默认只在本机开放，同一 Wi-Fi 里的其他人连不进来。

测试（50 个）：

```bash
cd prototype/backend
.venv/Scripts/python -m pytest -q
```

重新生成示范照片（一般不需要）：

```bash
cd prototype/backend
.venv/Scripts/python scripts/make_demo_photos.py
```

## 5 分钟演示路线

彩排前先到 SDP 页底部按 Reset demo data。

1. **Circle**，扮演 No. 12（Aiman）：地图上的连线就是 5 户邻里圈 → 勾"I'm planning renovation" → 发送
2. **Works → Contractor passes**：发出 QR 通行证 → 门卫扫码：选"周日 10:00"被拒、"平日 10:00"放行 → 打开 Contractor's view，展示承包商看不到什么
3. 切换到 No. 11（Siti）→ **Chats**：收到自我介绍和装修通知 → Wave back
4. **Evidence**：Use sample（开工前照片封存）→ Sample crack → 看扫描动画和 HUD 框 → 选"Building defect" → Record decision
5. **SDP**：保修队列 → Sample: poor patch（系统自动发现裂缝还在）
6. 回到 No. 11 → **Evidence** 有琥珀色提醒 → 打开 → 写备注 → Not fixed（驳回）
7. **SDP** → Sample: proper repair（系统判定"与开工前照片一致"）→ No. 11 → Accept
8. **Log**：从交屋到屋主确认，每一步都在链上，显示 CHAIN VERIFIED
9. 公寓版（可选）：A-15-3 登记装修，楼下 A-14-3 拍天花板 → Sample stain

## 路演时要注意的创新点（根据证据调研）

- **第二层不是新东西**：CIDB 的"Hak Jiran"指南已要求通知邻居、限定施工时段；VYROX 等物业系统已有承包商时效通行证和非时段警报。第二层只当"配套"，不要当卖点。
- **真正的差异在**：邻居一侧的开工前存证、"装修造成 vs 建筑瑕疵"的分流、维修后拿开工前照片自动核对、只有屋主能关闭、整条屋历链。调研没找到马来西亚有产品同时做到这些。
- 证据以有地房为主（21 宗对 5 宗分层），公寓"楼上装修导致楼下漏水"的公开案例很少，路演时不要夸大。

## 安全与稳定（已做的）

- **照片隐私**：上传照片一律重新编码，去掉 GPS、相机型号、拍摄时间（有测试验证）
- **上传检查**：只接受真正能解码的 JPEG/PNG/WebP；超过 12 MB 或像素过多直接拒绝；防"解压炸弹"
- **存储**：照片用随机 ID 命名，ID 格式不对一律 404，防止路径穿越；对比图网址带照片 ID，不会显示到别的案件的旧图
- **通行证**：QR 里是 32 位随机令牌，服务器只存它的 SHA-256 指纹，资料库外泄也做不出能用的通行证；令牌只在发出时显示一次；每项装修最多 3 张有效通行证；屋主可撤销
- **最少权限**：承包商视图不含屋主电话、邻居姓名、任何照片、其他住户；有测试逐项检查
- **权限检查**：只有装修户能发/撤通行证；只有收到通知的邻居能挂照片；只能拿自己的照片报案；**SDP 只能提交维修，不能关闭保修单，只有屋主能**；状态机防止重复提交或重复决定
- **输入限制**：讯息、装修内容、时段、备注都有长度和格式限制；结束日期和时段不能颠倒
- **CORS** 只允许本机前端；回应加上 nosniff、禁止嵌入等安全标头
- **演示专用功能**（重置、示范照片、模拟扫码时间）在设 `JIRAN_DEMO_MODE=0` 时自动关闭
- **不依赖外网**：字体、图标、QR 生成都打包在本地，演示现场断网也能跑
- **不卡**：照片对比约 0.2 秒；启动时预热 OpenCV；拖动滑杆、数字动画都不重新渲染整页；前端压缩后约 100 KB
- **版本锁定**：后端依赖版本全部固定；资料表结构变了会自动重建示范资料

## 还不是正式产品的地方（路演时要老实说）

- 没有登录：上方"扮演哪一户"只为演示；正式试点要用 WhatsApp 一次性密码之类的身份验证
- WhatsApp、CIDB 注册检查、Procore 编号、门卫扫码都是模拟的
- 演示时通行证令牌暂存在浏览器分页里（关分页就清掉）；正式版会通过 WhatsApp 链接只发给承包商
- 真实墙面通常很素，自动对齐需要画面里有墙角、插座、开关等固定物；对不齐时系统会请用户重拍，不会乱判
- 变化检测只找"变暗"的区域（裂缝、水渍、污痕），不判断原因

## 结构

```
start-demo.bat / .sh     一键演示（同一个端口 8000）
start-dev.bat            开发模式（8000 + 5173）
backend/
  app/neighbours.py      5 户邻里圈的计算
  app/ledger.py          屋历哈希链：计算与验证
  app/vision.py          照片安全处理、质量检查、前后对齐与变化检测
  app/triage.py          建议规则（只给建议，不下结论）
  app/seed.py            虚构的示意 phase
  app/demo_photos/       程序画出来的示范照片（含好/差两种维修）
  app/db.py              SQLite 资料表与写入屋历
  app/main.py            FastAPI 接口与安全设置（四层全部在这里）
  scripts/make_demo_photos.py
  tests/                 50 个测试
frontend/src/
  App.tsx                手机外框、切换住户、浮动底栏
  ui.tsx                 共用元件（卡片、徽章、环形仪表、数字动画、底部弹窗等）
  components/Compare.tsx 前后对比滑杆、扫描动画、HUD 框
  screens/               Circle、Chats、Works、Evidence、Case、Repair、Log、SDP
  messages.ts            讯息模板
```

## 接下来可以做的

- [ ] 淡米尔文讯息模板
- [ ] 后台补上平均解决天数
- [x] 英文提案初稿（Innovation Canvas，在 Claude Docs 里，队友一起改）
- [ ] 路演稿与 3 分钟演示视频

## 比赛规则相关

- **AI 披露**：这份代码由 Claude（Anthropic 的 AI）协助编写。依比赛条款第 13 条，提交时要在 AI 使用披露里写明。之后队员用到的 AI 工具也要记进 AI 使用日志。
- **知识产权**：参赛作品归主办方所有，所以这是全新的代码库，不要放进任何队员原有项目的代码。
- **仓库要设成私有**（Private），避免被其他参赛队看到。

## Git

这个资料夹已经是本机 git 仓库（分支 `main`），还没有连到任何线上仓库。`.gitignore` 已排除虚拟环境、node_modules、打包结果和演示资料库，只会提交源代码和示范照片。

放上 GitHub 时：先在 GitHub 建一个 **Private** 仓库（不要勾"加 README"），然后：

```bash
git remote add origin https://github.com/<你们的帐号>/<仓库名>.git
git push -u origin main
```

每位队员第一次提交前，先在这个资料夹设好自己的名字和邮箱：

```bash
git config user.name "你的名字"
git config user.email "你的邮箱"
```
