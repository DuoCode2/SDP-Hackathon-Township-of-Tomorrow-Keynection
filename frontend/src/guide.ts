// Text for the guide panel: what each screen does and the demo route, in Chinese (for the team) and English (for judges).

export type GuideLang = 'zh' | 'en'
export type TabId = 'circle' | 'chats' | 'works' | 'evidence' | 'log' | 'sdp' | 'safeguards'

type Text = Record<GuideLang, string>
type List = Record<GuideLang, string[]>

export interface PageGuide {
  layer: Text
  title: Text
  what: Text
  features: List
  why: Text
}

export const UI: Record<string, Text> = {
  guide: { zh: '功能导览', en: 'Guide' },
  thisPage: { zh: '这一页', en: 'This page' },
  features: { zh: '可以做什么', en: 'What you can do' },
  why: { zh: '为什么重要', en: 'Why it matters' },
  route: { zh: '演示路线', en: 'Demo route' },
  routeHint: { zh: '点一步就会自动跳到对应画面和住户', en: 'Click a step to jump to that screen and household' },
  about: {
    zh: 'Jiran5：交屋当天就帮屋主认识最近的 5 户邻居，装修前约好规矩、留下照片证据，建筑瑕疵交给 SDP 修到屋主满意为止。',
    en: 'Jiran5 introduces new owners to their five closest neighbours at handover, agrees renovation rules up front, keeps photo evidence, and hands building defects to SDP until the owner is satisfied.',
  },
  fictional: { zh: '所有住户、门牌和照片都是虚构的示范资料。', en: 'All residents, units and photos are fictional demo data.' },
  close: { zh: '收起导览', en: 'Hide guide' },
}

export const PAGES: Record<TabId, PageGuide> = {
  circle: {
    layer: { zh: '第 1 层 · 认识', en: 'Layer 1 · Know' },
    title: { zh: '邻里圈', en: 'Neighbour circle' },
    what: {
      zh: '根据平面图自动算出跟你最近的 5 户：排屋是左右两户加对面 3 户，公寓是左右和楼上楼下。',
      en: 'Your five closest homes, worked out from the floor plan: left, right and three across for a terrace; left, right, above and below for an apartment.',
    },
    features: {
      zh: [
        '地图画成真的房屋平面：粗线是共用墙，跟你共用的墙会发亮；正在装修的房子有橙色斜线，共用墙变成「施工中」警示',
        '点任何一户：看到住户、跟你的关系、用什么语言；可以直接发讯息，或「以这户的身份查看」',
        '用英文、马来文或中文写自我介绍，经 WhatsApp 发给 5 户',
        '勾选「I\'m planning renovation」：通知附上工期、吵闹时段、承包商、CIDB 注册和地方政府（PBT）准证',
      ],
      en: [
        'A real plan: thick lines are party walls; yours glow, and walls next to renovation turn into orange "works" hatching',
        'Click any home to see who lives there, how they relate to you and their language; message them or view as them',
        'Write an intro in English, Malay or Chinese and send it to all five on WhatsApp',
        'Tick "I\'m planning renovation" to add dates, noisy hours, contractor, CIDB status and the council (PBT) permit',
      ],
    },
    why: {
      zh: '很多邻里装修纠纷一开始只是「不认识、没被通知」。先认识，之后出事比较好谈。',
      en: 'Many renovation disputes start with "we never met and nobody told us". Knowing each other first makes later problems easier to settle.',
    },
  },
  chats: {
    layer: { zh: '第 1–2 层 · 认识与沟通', en: 'Layers 1–2 · Know & talk' },
    title: { zh: '邻居之间真正的沟通', en: 'Real conversations between neighbours' },
    what: {
      zh: '跟圈子里每一户一对一聊天。通知从 WhatsApp 来，但电话号码要双方同意才交换。',
      en: 'One-to-one chats with each household in your circle. Alerts arrive on WhatsApp, but numbers are shared only when both agree.',
    },
    features: {
      zh: [
        '快捷回复会自动翻成对方的语言：Siti 用马来文按，Aiman 看到英文（不用上网翻译）',
        '「提出不满」：先私下告诉装修户 → 对方回复或处理 → 不行再升级给 SDP 物业团队；每一步写进两户屋历',
        '语气检查：明显的辱骂发不出去，系统建议改用平和的快捷回复',
        '检举讯息给 SDP 审核（对方不知道是谁检举），也可以静默封锁',
        '「交换电话」要双方都同意才生效',
      ],
      en: [
        'Quick replies arrive translated: Siti taps in Malay, Aiman reads English (no online translation needed)',
        '"Raise a concern": tell the renovating neighbour privately → they reply or fix it → if not, escalate to SDP’s estate team; every step goes into both home logs',
        'Tone check: obvious insults are not sent; a calmer quick reply is suggested',
        'Report a message for SDP review (the sender never learns who reported), or block silently',
        '"Exchange numbers" only takes effect when both sides agree',
      ],
    },
    why: {
      zh: '邻里纠纷大多从「没沟通、一沟通就吵」开始，最后报警、上法庭。这里让小事在邻居之间解决，解决不了才交给 SDP，而且全程有记录。',
      en: 'Neighbour disputes usually start with no communication, then blow up into police reports and court. Here small problems are settled between neighbours, and only the rest reach SDP, with a full record.',
    },
  },
  works: {
    layer: { zh: '第 2 层 · 约定', en: 'Layer 2 · Agree' },
    title: { zh: '装修日历与承包商通行证', en: 'Works calendar and contractor passes' },
    what: {
      zh: '谁在装修、什么时候吵、哪些工人可以进来，全部在这里约定清楚。',
      en: 'Who is renovating, when it can be noisy, and which workers may come through the gate.',
    },
    features: {
      zh: [
        '最上面实时显示「现在是不是安静时段」',
        'Schedule：未来 4 周的装修日历和屋规',
        'Contractor passes：装修户发 QR 通行证，只限工期内、周一至六 08:00–18:00，最多 3 张，随时可撤销',
        '模拟门卫扫码：周日、晚上、工期结束后都会被拒绝',
        'Contractor\'s view：承包商看不到屋主电话、邻居名字和任何照片',
        '装修卡片显示地方政府（PBT）准证状态',
      ],
      en: [
        'Live "quiet hours now?" status at the top',
        'Schedule: four-week renovation calendar and house rules',
        'Contractor passes: QR pass valid only during the works, Mon–Sat 08:00–18:00, max 3, revocable any time',
        'Simulated guardhouse scan: Sundays, evenings and expired passes are refused',
        'Contractor\'s view: no owner phone, neighbour names or photos',
        'Renovation cards show the council (PBT) permit status',
      ],
    },
    why: {
      zh: '噪音和陌生工人是投诉大宗；SDP App 评论里也有屋主要求限制承包商权限。注意：CIDB 指南和一些物业系统已有类似做法，这层是配套，不是卖点。',
      en: 'Noise and unknown workers drive complaints, and SDP App reviewers asked for limited contractor access. Note: CIDB guidance and some estate systems already do similar things, so this layer supports the pitch rather than leads it.',
    },
  },
  evidence: {
    layer: { zh: '第 3–4 层 · 证据与关闭', en: 'Layers 3–4 · Prove & close' },
    title: { zh: '照片证据与保修', en: 'Photo evidence and warranty' },
    what: {
      zh: '邻居在隔壁开工前拍照存证；之后出现裂缝或水渍，系统帮你对比，再决定由谁负责。',
      en: 'Neighbours photograph their walls before work starts next door; if a crack or stain appears, the app compares the photos and helps decide who fixes it.',
    },
    features: {
      zh: [
        '开工前照片：去掉 GPS 和相机资料，用 SHA-256 指纹封存，日后不能偷改',
        '跟进照片自动对齐，扫描后用红框标出新裂缝或水渍',
        '按公开规则给建议（装修造成 / 建筑瑕疵 / 请检查员 / 没有变化 / 请重拍），由人来决定',
        '选「Building defect」会自动开 SDP 保修单',
        'SDP 修好后，系统拿维修照片跟开工前照片核对',
        '只有屋主能按 Accept 关单；按 Not fixed 驳回，保修单会重开',
        '保修单显示《房屋发展法》时钟：交屋后 24 个月保修期内，发展商要在 30 天内修好；驳回也不会重新计时',
      ],
      en: [
        'Pre-work photo: GPS and camera data stripped, sealed with a SHA-256 fingerprint',
        'Follow-up photo is auto-aligned; a scan marks new cracks or stains with red boxes',
        'Rule-based suggestion (renovation / building defect / inspector / no change / retake); people decide',
        '"Building defect" opens an SDP warranty ticket automatically',
        'SDP\'s repair photo is checked against the pre-work photo',
        'Only the owner can Accept and close; "Not fixed" reopens the ticket',
        'Each ticket shows the Housing Development Act clock: within the 24-month liability period, repairs are due in 30 days; rejecting does not restart it',
      ],
    },
    why: {
      zh: '纠纷最难回答的是「装修前本来就有吗？」。没有证据只能吵，甚至上法庭（Bukit Jelutong 案判赔约 RM480 万）。这层和屋历是我们跟别人最大的不同。',
      en: 'The hardest question in a dispute is "was it there before the works?". Without evidence it ends in arguments or court (the Bukit Jelutong judgment was about RM4.8m). This layer and the home log are what set us apart.',
    },
  },
  log: {
    layer: { zh: '屋历', en: 'Home log' },
    title: { zh: '防篡改的屋历', en: 'Tamper-evident home log' },
    what: {
      zh: '每户一条记录链：交屋、装修、通行证、照片、案件、维修、屋主确认，全都按时间串起来。',
      en: 'One chain of records per home: handover, renovation, passes, photos, cases, repairs and owner sign-off, in order.',
    },
    features: {
      zh: [
        '每一块都带自己的指纹和上一块的指纹',
        '改动任何一笔，链就会断，最上面会从 CHAIN VERIFIED 变成警告',
        '照片记录直接显示缩图',
      ],
      en: [
        'Each block shows its own fingerprint and the previous one',
        'Change any record and the chain breaks; the banner switches from CHAIN VERIFIED to a warning',
        'Photo records show a thumbnail',
      ],
    },
    why: {
      zh: '以后卖房、保修、纠纷都能拿出一份大家都信得过的屋历。',
      en: 'When selling, claiming warranty or settling a dispute, there is a history everyone can trust.',
    },
  },
  sdp: {
    layer: { zh: 'SDP 后台', en: 'SDP view' },
    title: { zh: 'SDP 管理后台', en: 'SDP command view' },
    what: {
      zh: 'SDP 的保修、物业和社区团队看到的画面。',
      en: 'What SDP’s warranty, estate and community teams would see.',
    },
    features: {
      zh: [
        '保修队列：每张单都有 30 天法定时钟，逾期会标红；SDP 提交维修照片后系统自动核对',
        '物业队列：邻居升级上来的不满，可以「提醒装修户遵守屋规」或「结案」',
        '讯息审核：被检举的讯息，可以警告发送者（只有他看得到）或驳回',
        '数据：多少不满在邻居之间就解决了、回覆率、开工前照片覆盖率、屋主关单比例',
        '页底「Reset demo data」：彩排前清空示范资料',
      ],
      en: [
        'Warranty queue: every ticket has a 30-day statutory clock and turns red when overdue; repair photos are checked automatically',
        'Estate queue: concerns escalated by neighbours; remind the owner of the house rules, or close the concern',
        'Moderation: reported messages; warn the sender privately or dismiss',
        'Numbers: share of concerns settled between neighbours, reply rate, pre-work photo coverage, owner-closed repairs',
        '"Reset demo data" at the bottom clears everything before a rehearsal',
      ],
    },
    why: {
      zh: 'SDP 第一次能看到社区关系和保修品质的真实数据，也能证明自己在法定时限内修好，而不是只看投诉数字。',
      en: 'SDP sees real numbers on community health and repair quality, and can show repairs were done within the statutory window, instead of only counting complaints.',
    },
  },
  safeguards: {
    layer: { zh: '信任', en: 'Trust' },
    title: { zh: '风险与保障', en: 'Safeguards' },
    what: {
      zh: '设计时想到的每一个风险，以及原型已经怎么处理（Built）或试点时会怎么做（Pilot）。',
      en: 'Every risk found while designing, and what the prototype already does (Built) or the pilot will add (Pilot).',
    },
    features: {
      zh: [
        '隐私与 PDPA、骚扰与冲突、假照片、系统判断错误、维修拖延、承包商滥用',
        '不上网的长者、语言隔阂、法律（PBT 准证、HDA、分层地契法）、使用率低、系统安全',
        '每一项都可以点「See it」跳到原型里对应的功能',
      ],
      en: [
        'Privacy & PDPA, harassment, false evidence, wrong automated judgement, slow repairs, contractor misuse',
        'Residents who are not online, language barriers, legal fit (PBT permits, HDA, strata), low adoption, system security',
        'Each item links to the part of the prototype that handles it',
      ],
    },
    why: {
      zh: '评审一定会问「如果有人乱用怎么办？」。这一页直接回答，而且大部分已经做出来了。',
      en: 'Judges will ask "what if someone abuses it?". This page answers it, and most answers are already built.',
    },
  },
}

export interface RouteStep {
  tab: TabId
  unit?: string
  text: Text
}

export const ROUTE: RouteStep[] = [
  {
    tab: 'circle', unit: 'T-12',
    text: {
      zh: '扮演 No. 12 Aiman：看平面图上的共用墙 → 勾「I\'m planning renovation」（含 PBT 准证）→ Send on WhatsApp',
      en: 'As No. 12 Aiman: see the party walls on the plan → tick "I\'m planning renovation" (with PBT permit) → Send on WhatsApp',
    },
  },
  {
    tab: 'chats', unit: 'T-11',
    text: {
      zh: '按顶栏「Both sides」开分屏（左 Aiman、右 Siti）→ Siti 在 Chats 按 Wave back，再按快捷回复「宝宝午睡」→ 左边 Aiman 看到英文翻译',
      en: 'Turn on "Both sides" (Aiman left, Siti right) → Siti waves back and taps the baby-nap quick reply → Aiman sees it in English',
    },
  },
  {
    tab: 'chats', unit: 'T-11',
    text: {
      zh: 'Siti 按「Raise a concern」→ 选晚上施工 → 发送；Aiman 回复；Siti 再升级给 SDP 物业团队',
      en: 'Siti → Raise a concern → noise outside hours → send; Aiman replies; Siti escalates to the SDP estate team',
    },
  },
  {
    tab: 'sdp',
    text: {
      zh: 'SDP 后台的物业队列：提醒 Aiman 遵守屋规 → 结案（两边的对话里都看得到）',
      en: 'SDP estate queue: remind Aiman of the house rules → close the concern (both chats show it)',
    },
  },
  {
    tab: 'works', unit: 'T-12',
    text: {
      zh: 'Aiman：Contractor passes → 发通行证 → 门卫扫码：周日 10:00 被拒、平日 10:00 放行',
      en: 'Aiman: Contractor passes → issue a pass → scan: Sunday 10:00 denied, weekday 10:00 allowed',
    },
  },
  {
    tab: 'evidence', unit: 'T-11',
    text: {
      zh: 'Siti：Use sample 封存开工前照片 → Sample crack → 选 Building defect → Record decision',
      en: 'Siti: Use sample to seal a pre-work photo → Sample crack → Building defect → Record decision',
    },
  },
  {
    tab: 'sdp',
    text: {
      zh: '保修队列看 30 天法定时钟 → Sample: poor patch（系统发现裂缝还在）',
      en: 'Warranty queue: note the 30-day clock → Sample: poor patch (crack still detected)',
    },
  },
  {
    tab: 'evidence', unit: 'T-11',
    text: {
      zh: 'Siti 驳回（Not fixed）→ SDP 按 Sample: proper repair → Siti 按 Accept 关单',
      en: 'Siti rejects (Not fixed) → SDP submits Sample: proper repair → Siti accepts and closes it',
    },
  },
  {
    tab: 'log', unit: 'T-11',
    text: {
      zh: '屋历：不满、升级、保修、维修、屋主确认全部在链上，显示 CHAIN VERIFIED',
      en: 'Home log: concern, escalation, warranty, repair and sign-off are all chained; CHAIN VERIFIED',
    },
  },
  {
    tab: 'safeguards',
    text: {
      zh: '最后打开 Safeguards：每个风险怎么处理，一页讲完',
      en: 'Finish on Safeguards: every risk and how it is handled, on one page',
    },
  },
]
