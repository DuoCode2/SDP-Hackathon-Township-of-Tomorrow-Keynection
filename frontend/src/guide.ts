// Text for the guide panel: what each screen does and the demo route, in the three interface languages: Chinese (for
// the team), English (for judges) and Malay. The guide follows the interface language switch in the top bar.

export type GuideLang = 'zh' | 'en' | 'ms'
export type TabId = 'circle' | 'chats' | 'works' | 'evidence' | 'log' | 'me' | 'sdp' | 'planner' | 'impact' | 'channels' | 'safeguards'

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
  guide: { zh: '功能导览', en: 'Guide', ms: 'Panduan' },
  thisPage: { zh: '这一页', en: 'This page', ms: 'Halaman ini' },
  tourBtn: { zh: '打开住户的入住介绍', en: 'Open the resident’s first-day tour', ms: 'Buka pengenalan hari pertama penduduk' },
  residentTour: { zh: '新住户手机上的四张卡：邻居、装修、拍照、助手', en: 'A new owner’s four cards: neighbours, works, the photo, the assistant', ms: 'Empat kad pemilik baharu: jiran, ubah suai, foto, pembantu' },
  features: { zh: '可以做什么', en: 'What you can do', ms: 'Apa yang boleh dibuat' },
  why: { zh: '为什么重要', en: 'Why it matters', ms: 'Mengapa ia penting' },
  route: { zh: '完整演示路线（约 7 分钟）', en: 'Full demo route (about 7 minutes)', ms: 'Laluan demo penuh (lebih kurang 7 minit)' },
  routeHint: { zh: '点一步就会自动跳到对应画面和住户', en: 'Click a step to jump to that screen and household', ms: 'Klik satu langkah untuk terus ke skrin dan isi rumah itu' },
  judgeRoute: { zh: '3 分钟评审路线', en: '3-minute judge route', ms: 'Laluan juri 3 minit' },
  judgeHint: {
    zh: '只走主线：交钥匙 → 认识左右和对面 5 户 → 装修通知就是自我介绍 → 万一出事有公平记录 → SDP 怎么检查效果',
    en: 'The main story only: keys → meet the five homes beside and opposite → the renovation notice is the introduction → a fair record if something goes wrong → how SDP checks it works',
    ms: 'Cerita utama sahaja: kunci → kenal lima rumah di sebelah dan bertentangan → notis ubah suai ialah perkenalan → rekod yang adil jika berlaku masalah → cara SDP menyemak hasilnya',
  },
  whoseScreen: {
    zh: '顶栏右边的「演示角色」卡可以换成任何一户，看对方收到什么、用什么语言。SDP 后台要先打开下面的「显示全部功能」，然后是菜单第 07 项。',
    en: 'The "Demo cast" card at the right of the top bar switches to any household, to see what they receive and in which language. For SDP’s command view, switch on "Show every feature" below; it is then menu item 07.',
    ms: 'Kad "Pelakon demo" di kanan bar atas menukar ke mana-mana isi rumah, untuk melihat apa yang mereka terima dan dalam bahasa apa. Untuk paparan kawalan SDP, hidupkan "Tunjukkan semua ciri" di bawah; ia kemudian menjadi item menu 07.',
  },
  sharedDemo: {
    zh: '这是大家共用的演示：没人用 20 分钟后会自动回到起点。如果某一步显示「今天已做过」，是别的评审做过了：从顶栏换一户看，或等自动回到起点。评审没有重置按钮，所以谁也清不掉别人的进度。',
    en: 'This demo is shared: after 20 quiet minutes it starts over by itself. If a step says it was already done today, another judge did it: switch to another household from the top bar, or come back after the reset. There is no reset button for judges, so nobody can wipe another judge\'s progress.',
    ms: 'Demo ini dikongsi: selepas 20 minit senyap ia bermula semula dengan sendirinya. Jika satu langkah berkata ia sudah dibuat hari ini, juri lain yang membuatnya: tukar ke isi rumah lain dari bar atas, atau kembali selepas set semula. Tiada butang set semula untuk juri, jadi tiada siapa boleh memadam kemajuan juri lain.',
  },
  previewNote: {
    zh: '标着「预览」「示意」或「示范编号」的都是示意：WhatsApp 和 SDP App 的手机画面不会真的发出，也不是 SDP 真正的 app；演示版的 Procore 编号是造的。其余画面上的每一步都真的写进了资料库。',
    en: 'Anything labelled "preview", "illustration" or "demo number" is a mock-up: the WhatsApp and SDP App phones send nothing and are not SDP’s real app, and the demo’s Procore numbers are invented. Every other step on screen really is written to the database.',
    ms: 'Apa-apa yang berlabel "pratonton", "ilustrasi" atau "nombor demo" ialah olok-olok: telefon WhatsApp dan SDP App tidak menghantar apa-apa dan bukan app sebenar SDP, dan nombor Procore demo adalah rekaan. Setiap langkah lain di skrin benar-benar ditulis ke pangkalan data.',
  },
  notesForJudges: { zh: '给评委的说明', en: 'Notes for judges', ms: 'Nota untuk juri' },
  about: {
    zh: '每一把钥匙都附送五户邻居：交钥匙起认识左右和对面，装修通知就是第一次打招呼，出了裂缝有公平的照片记录。',
    en: 'Every key comes with five neighbours: owners meet the homes beside and opposite from key day, the renovation notice is the first hello, and a fair photo record backs it up if a crack appears.',
    ms: 'Setiap kunci datang dengan lima jiran: pemilik mengenali rumah di sebelah dan bertentangan dari hari kunci, notis ubah suai ialah sapaan pertama, dan rekod foto yang adil menyokongnya jika muncul retak.',
  },
  more: { zh: '详细步骤', en: 'Details', ms: 'Butiran' },
  fictional: { zh: '所有住户、门牌和照片都是虚构的示范资料。', en: 'All residents, units and photos are fictional demo data.', ms: 'Semua penduduk, unit dan foto adalah data demo rekaan.' },
  aiOn: {
    zh: 'AI 已开启：打字自动翻译、太冲先劝、一句话写装修通知',
    en: 'AI on: typed words translated, heated ones calmed, the notice written from one sentence',
    ms: 'AI hidup: perkataan yang ditaip diterjemah, yang panas ditenangkan, notis ditulis daripada satu ayat',
  },
  aiOff: {
    zh: 'AI 没开（服务器没有 AI 金钥）：路线照样能走。打的字照原文送；装修通知的三句示例仍可按，会填入现成的内容（浴室那句按「English」），或保留第一张「浴室、厨房或水管」卡自己逐步填',
    en: 'AI off (no AI key on the server): the route still works. Typed words go as written; the three renovation examples still fill the notice in from a ready-made preset (the bathroom story is the "English" one), or keep the first card, "Bathroom, kitchen or plumbing", and fill in the steps yourself',
    ms: 'AI mati (tiada kunci AI pada pelayan): laluan tetap berjalan. Perkataan yang ditaip dihantar seperti ditulis; tiga contoh ubah suai masih mengisi notis daripada pratetap sedia ada (cerita bilik air ialah yang "English"), atau kekalkan kad pertama, "Bilik air, dapur atau paip", dan isi langkah-langkahnya sendiri',
  },
  showAll: { zh: '显示全部功能', en: 'Show every feature', ms: 'Tunjukkan semua ciri' },
  showAllHint: {
    zh: '只显示主线。问到长者、隐私、推广或风险时，打开全部功能。',
    en: 'Main story only. For older residents, privacy, scale or risks, show every feature.',
    ms: 'Cerita utama sahaja. Untuk warga emas, privasi, skala atau risiko, tunjukkan semua ciri.',
  },
  focusOnly: { zh: '只看主线', en: 'Main story only', ms: 'Cerita utama sahaja' },
  focusOnlyHint: {
    zh: '全部功能都打开了。示范完可以切回只看主线。',
    en: 'Every feature is showing. Switch back to the main story when you are done.',
    ms: 'Semua ciri sedang ditunjukkan. Kembali ke cerita utama apabila selesai.',
  },
  close: { zh: '收起导览', en: 'Hide guide', ms: 'Sembunyikan panduan' },
  step: { zh: '第 {n} 步', en: 'Step {n}', ms: 'Langkah {n}' },
  language: { zh: '语言', en: 'Language', ms: 'Bahasa' },
}

export const PAGES: Record<TabId, PageGuide> = {
  circle: {
    layer: { zh: '主线 · 认识', en: 'Main story · Meet', ms: 'Cerita utama · Kenal' },
    title: { zh: '你的邻居（像社交 app 一样用）', en: 'Your neighbours, like a social app', ms: 'Jiran anda, seperti app sosial' },
    what: {
      zh: '打开就看到身边有谁、可以跟谁聊。不用学：操作跟 IG、WhatsApp、Facebook 一样。',
      en: 'Open it and see who lives around you and who you can talk to. Nothing new to learn: it works like IG, WhatsApp and Facebook.',
      ms: 'Buka dan lihat siapa tinggal di sekeliling anda dan dengan siapa anda boleh berbual. Tiada yang baharu untuk dipelajari: ia berfungsi seperti IG, WhatsApp dan Facebook.',
    },
    features: {
      zh: [
        '顶部一排头像（像 IG 限时动态）：橙圈＋🔨 是正在装修，蓝点是还没认识，绿圈是已经认识；点头像看小档案',
        '邻居卡片：名字、门牌、跟你的关系（共用墙、楼上楼下）、语言、一句自我介绍，按「Message」或「👋 Wave」',
        '「Introduce yourself」：一次跟还没认识的邻居打招呼（三步流程，要勾同意才能发）',
        '同一条 lorong 或同一栋（像「你可能认识的人」）：只看到门牌，按「Request」写原因，对方接受才看到名字、才能聊',
        '右上角切到「地图」：建筑蓝图平面图，公寓有楼层剖面图和「你家这一列」',
        '没有住户名册、没有大群组；物业公告移到 Chats 里的官方帐号',
        '还没加入的邻居（No. 23）只显示门牌、不能传讯息；装修通知由物业办公室印纸本送过去',
        '「你的安静时间」：设一次（例如宝宝 13–15 点午睡），以后邻居装修就会自动避开；只有你自己看得到',
      ],
      en: [
        'A row of faces at the top (like IG stories): orange ring + 🔨 is renovating, blue dot is not met yet, green ring is known; tap for a mini profile',
        'Neighbour cards: name, unit, how they relate to you (shared wall, upstairs), language and a one-line bio, with Message and 👋 Wave',
        '"Introduce yourself": one hello to everyone you haven’t met (three steps, consent required)',
        'Your lorong or block (like "people you may know"): unit numbers only; Request with a reason, names and chat once accepted',
        'Switch to "Map" for the blueprint plan; apartments get a floor section with "YOUR STACK"',
        'No resident directory, no group chat; estate notices live in an official account in Chats',
        'A neighbour who hasn’t joined (No. 23) shows as a unit number and can’t be messaged; the estate office delivers their renovation notices on paper',
        '"Your quiet times": set once (say a baby’s nap 1–3pm) and every renovation nearby is planned around it; only you can see it',
      ],
      ms: [
        'Barisan wajah di atas (seperti IG stories): bulatan oren + 🔨 sedang ubah suai, titik biru belum berkenalan, bulatan hijau sudah kenal; ketik untuk profil ringkas',
        'Kad jiran: nama, unit, hubungan dengan anda (dinding kongsi, tingkat atas), bahasa dan satu baris pengenalan, dengan Mesej dan 👋 Lambai',
        '"Perkenalkan diri": satu ucapan kepada semua yang belum anda kenali (tiga langkah, persetujuan diperlukan)',
        'Lorong atau blok anda (seperti "orang yang mungkin anda kenal"): nombor unit sahaja; Minta dengan alasan, nama dan sembang selepas diterima',
        'Tukar ke "Peta" untuk pelan lukisan; pangsapuri mendapat keratan tingkat dengan "LAJUR ANDA"',
        'Tiada direktori penduduk, tiada sembang kumpulan; notis estet berada dalam akaun rasmi di Sembang',
        'Jiran yang belum menyertai (No. 23) ditunjukkan sebagai nombor unit dan tidak boleh dimesej; pejabat estet menyampaikan notis ubah suai mereka secara bercetak',
        '"Waktu senyap anda": tetapkan sekali (contohnya tidur siang bayi 1–3 petang) dan setiap ubah suai berhampiran dirancang mengelakkannya; hanya anda yang dapat melihatnya',
      ],
    },
    why: {
      zh: '居民不会为了一个新 app 重新学习。用大家每天在用的方式，最快在出事之前就认识邻居；但联系有层次，所以不会变成骚扰或吵架的地方。',
      en: 'Residents won’t learn a new app. Using what they already know gets neighbours acquainted before trouble starts, while layered contact keeps it from becoming a place for harassment or fights.',
      ms: 'Penduduk tidak akan belajar app baharu. Menggunakan apa yang mereka sudah tahu membuat jiran berkenalan sebelum masalah bermula, manakala hubungan berlapis mengelakkannya menjadi tempat gangguan atau pergaduhan.',
    },
  },
  chats: {
    layer: { zh: '主线 · 沟通', en: 'Main story · Talk', ms: 'Cerita utama · Berbual' },
    title: { zh: '邻居之间真正的沟通', en: 'Real conversations between neighbours', ms: 'Perbualan sebenar antara jiran' },
    what: {
      zh: '跟圈子里每一户一对一聊天。通知从 WhatsApp 来，但电话号码要双方同意才交换。',
      en: 'One-to-one chats with each household in your circle. Alerts arrive on WhatsApp, but numbers are shared only when both agree.',
      ms: 'Sembang satu-ke-satu dengan setiap isi rumah dalam bulatan anda. Makluman tiba di WhatsApp, tetapi nombor hanya dikongsi apabila kedua-dua pihak bersetuju.',
    },
    features: {
      zh: [
        '用什么语言打字都行：对方收到的是 AI 翻好的他的语言（设计上用 Claude；网上演示可能用 Gemini），标着「AI 翻译」，原文点一下就看到',
        '快捷回复不用上网也会翻：Siti 用马来文按，Aiman 看到英文；隔壁 Kumar 读淡米尔文',
        '「提出不满」：先私下告诉装修户 → 对方回复或处理 → 不行再升级给 SDP 物业团队；每一步写进两户屋历',
        '语气检查：AI 觉得太冲时，先给一个意思不变、比较平和的说法，你自己选发哪个；辱骂一律发不出去，也不能坚持原文：英巫华三语词表先拦，AI 开着时再加上 AI 的判断',
        '检举讯息给 SDP 审核（对方不知道是谁检举），也可以静默封锁',
        '「交换电话」要双方都同意才生效',
      ],
      en: [
        'Type in any language: your neighbour reads it in theirs, translated by AI (Claude by design; the online demo may use Gemini), marked "Translated by AI", with the original one tap away',
        'Quick replies are translated even offline: Siti taps in Malay, Aiman reads English, Kumar next door reads Tamil',
        '"Raise a concern": tell the renovating neighbour privately → they reply or fix it → if not, escalate to SDP’s estate team; every step goes into both home logs',
        'Tone check: when AI thinks a message sounds heated, it offers a calmer wording with the same facts and you choose which to send; an insult is never sent and cannot be sent anyway: a word list in English, Malay and Chinese, then AI’s own judgement when it is on',
        'Report a message for SDP review (the sender never learns who reported), or block silently',
        '"Exchange numbers" only takes effect when both sides agree',
      ],
      ms: [
        'Taip dalam apa-apa bahasa: jiran anda membacanya dalam bahasa mereka, diterjemah oleh AI (Claude mengikut reka bentuk; demo dalam talian mungkin menggunakan Gemini), ditanda "Diterjemah oleh AI", dengan teks asal satu ketikan sahaja',
        'Balasan pantas diterjemah walaupun luar talian: Siti mengetik dalam bahasa Melayu, Aiman membaca bahasa Inggeris, Kumar di sebelah membaca bahasa Tamil',
        '"Luahkan kebimbangan": beritahu jiran yang mengubah suai secara peribadi → mereka membalas atau membaikinya → jika tidak, naikkan kepada pasukan estet SDP; setiap langkah masuk ke kedua-dua log rumah',
        'Semakan nada: apabila AI merasakan mesej berbunyi panas, ia menawarkan ayat yang lebih tenang dengan fakta yang sama dan anda memilih yang mana untuk dihantar; penghinaan tidak pernah dihantar dan memang tidak boleh dihantar: senarai perkataan dalam bahasa Inggeris, Melayu dan Cina, kemudian pertimbangan AI sendiri apabila ia hidup',
        'Laporkan mesej untuk semakan SDP (penghantar tidak tahu siapa yang melaporkan), atau sekat secara senyap',
        '"Tukar nombor" hanya berkuat kuasa apabila kedua-dua pihak bersetuju',
      ],
    },
    why: {
      zh: '邻里纠纷大多从「没沟通、一沟通就吵」开始，最后报警、上法庭。这里让小事在邻居之间解决，解决不了才交给 SDP，而且全程有记录。',
      en: 'Neighbour disputes usually start with no communication, then blow up into police reports and court. Here small problems are settled between neighbours, and only the rest reach SDP, with a full record.',
      ms: 'Pertikaian jiran biasanya bermula tanpa komunikasi, kemudian meletus menjadi laporan polis dan mahkamah. Di sini masalah kecil diselesaikan antara jiran, dan hanya selebihnya sampai kepada SDP, dengan rekod penuh.',
    },
  },
  works: {
    layer: { zh: '主线 · 装修通知', en: 'Main story · Renovation notice', ms: 'Cerita utama · Notis ubah suai' },
    title: { zh: '装修通知与时段', en: 'Renovation notices and hours', ms: 'Notis dan waktu ubah suai' },
    what: {
      zh: '谁在装修、什么时候会吵，都在这里看清楚。登记装修时，通知自动送到受影响的每一户，同时就是一次自我介绍。',
      en: 'Who is renovating and when it can be noisy. Registering a renovation tells every affected home automatically, and doubles as an introduction.',
      ms: 'Siapa yang mengubah suai dan bila ia boleh bising. Mendaftar ubah suai memberitahu setiap rumah yang terkesan secara automatik, dan menjadi perkenalan sekali gus.',
    },
    features: {
      zh: [
        '最上面实时显示「现在是不是安静时段」',
        '未来 4 周的装修日历和屋规',
        '右上角「Register renovation」：按工程类型自动算出要通知哪几户（不能删掉任何人），图上标出每户被通知的原因',
        '「一句话说清楚」：用任何语言说要做什么，AI 判断工程类型（决定通知谁）、日期、吵闹时段和承包商，屋主逐步检查再发；批准和 CIDB 仍由屋主自己确认',
        '吵闹时段按邻居的安静时间自动排好（宝宝午睡、夜班补眠），不说是谁、为什么；屋主每天至少保留 4 小时能施工，也可以用自己的时段，被碰到的邻居会在通知里看到',
        '如果收到通知的某户这几天另一边也在施工，系统会提醒并建议改到哪天开工',
        '时间到了自己提醒：开工前 3 天提醒邻居拍照，完工后一天问双方有没有变化；邻居反映噪音时，系统自动标明当时是在约定时段内、安静时段，还是时段外',
        '通知用对方的阅读语言送达（屋主写的话由 AI 翻好）；还没加入的住户由物业送纸本，同样是他的语言',
        '装修卡片显示地方政府（PBT）准证状态；登记第 4 步按工程类型说明 2026年4月1日起全国统一装修指南要的是免准证、装修准证还是建筑图则，准证状态仍由屋主自己填',
      ],
      en: [
        'Live "quiet hours now?" status at the top',
        'Four-week renovation calendar and house rules',
        'Register renovation: the type of work decides which homes are told (nobody can be removed), and the plan shows why each one is',
        '"Just say it in one sentence": describe the work in any language and AI fills in the type of work (which decides who is told), dates, noisy hours and contractor for the owner to check; approvals and the CIDB tick stay the owner’s',
        'Noisy hours are planned around the neighbours’ quiet times (a baby’s nap, sleep after a night shift) without saying whose or why; the owner keeps at least 4 hours a day, or can keep their own hours and the neighbours affected are told in the notice',
        'If a home the notice reaches already has works on its other side on those days, the owner is warned and offered a start date that avoids it',
        'Reminders go out by themselves: photograph three days before works start, and a check the day after they end; a noise concern records whether it came during the agreed hours, a quiet break or outside them',
        'Notices arrive in each reader’s language (the owner’s own words translated by AI); homes not on the app get paper from the estate office, in their language too',
        'Renovation cards show the council (PBT) permit status; step 4 of the form says, for this kind of work, whether the national renovation guideline (in force 1 April 2026) expects no permit, a renovation permit or building plans — the status itself stays the owner’s to fill in',
      ],
      ms: [
        'Status langsung "waktu senyap sekarang?" di bahagian atas',
        'Kalendar ubah suai empat minggu dan peraturan rumah',
        'Daftar ubah suai: jenis kerja menentukan rumah mana yang diberitahu (tiada siapa boleh dibuang), dan pelan menunjukkan sebab setiap satu',
        '"Cakap saja dalam satu ayat": terangkan kerja dalam apa-apa bahasa dan AI mengisi jenis kerja (yang menentukan siapa diberitahu), tarikh, waktu bising dan kontraktor untuk disemak pemilik; kelulusan dan tanda CIDB kekal milik pemilik',
        'Waktu bising dirancang mengelakkan waktu senyap jiran (tidur siang bayi, tidur selepas syif malam) tanpa menyebut milik siapa atau sebabnya; pemilik mengekalkan sekurang-kurangnya 4 jam sehari, atau boleh kekalkan waktunya sendiri dan jiran yang terkesan diberitahu dalam notis',
        'Jika rumah yang menerima notis sudah ada kerja di sebelah satu lagi pada hari-hari itu, pemilik diberi amaran dan ditawarkan tarikh mula yang mengelakkannya',
        'Peringatan keluar dengan sendirinya: ambil foto tiga hari sebelum kerja bermula, dan semakan sehari selepas ia tamat; kebimbangan bunyi merekodkan sama ada ia berlaku dalam waktu yang dipersetujui, rehat senyap atau di luarnya',
        'Notis tiba dalam bahasa setiap pembaca (kata-kata pemilik diterjemah oleh AI); rumah yang tiada dalam app mendapat kertas daripada pejabat estet, dalam bahasa mereka juga',
        'Kad ubah suai menunjukkan status permit majlis (PBT); langkah 4 borang menyatakan, untuk jenis kerja ini, sama ada garis panduan ubah suai kebangsaan (berkuat kuasa 1 April 2026) menjangkakan tiada permit, permit ubah suai atau pelan bangunan — statusnya sendiri kekal untuk diisi pemilik',
      ],
    },
    why: {
      zh: '交屋后大家几乎同时装修，邻居第一次「认识」你往往是听到敲墙声。先通知、先自我介绍，关系就从打招呼开始，而不是从投诉开始。（承包商通行证和门卫扫码已经做好，但其他物业系统已有，所以示范里收起来。）',
      en: 'After handover everyone renovates at once, and a neighbour often first "meets" you through the noise. Telling them first, with an introduction, starts the relationship with a hello instead of a complaint. (Contractor passes and the guardhouse scan are built but hidden: estate systems already offer them.)',
      ms: 'Selepas penyerahan kunci semua orang mengubah suai serentak, dan jiran sering "berkenalan" dengan anda melalui bunyi bising. Memberitahu mereka dahulu, dengan perkenalan, memulakan hubungan dengan ucapan dan bukannya aduan. (Pas kontraktor dan imbasan pondok pengawal sudah dibina tetapi disembunyikan: sistem estet sudah menawarkannya.)',
    },
  },
  evidence: {
    layer: { zh: '安全网 · 证据与保修', en: 'Safety net · Evidence & warranty', ms: 'Jaring keselamatan · Bukti & waranti' },
    title: { zh: '照片证据与保修', en: 'Photo evidence and warranty', ms: 'Bukti foto dan waranti' },
    what: {
      zh: '邻居在隔壁开工前拍照存证；之后出现裂缝或水渍，系统帮你对比，再决定由谁负责。',
      en: 'Neighbours photograph their walls before work starts next door; if a crack or stain appears, the app compares the photos and helps decide who fixes it.',
      ms: 'Jiran mengambil foto dinding mereka sebelum kerja bermula di sebelah; jika muncul retak atau kesan air, app membandingkan foto dan membantu memutuskan siapa yang membaikinya.',
    },
    features: {
      zh: [
        '开工前照片：去掉 GPS 和相机资料，SHA-256 指纹记进屋历',
        '跟进照片自动对齐，扫描后用红框标出新裂缝或水渍',
        '按公开规则给建议（装修造成 / 建筑瑕疵 / 请检查员 / 没有变化 / 请重拍），由人来决定；开工前就拍到的变化不会算到装修头上',
        '「装修造成」只是提出：装修户同意才定案，不同意就请 SDP 检查员；住户不能自称检查员',
        '选「Building defect」会自动开 SDP 保修单（这是屋主自己的权利，不用邻居同意）',
        'SDP 修好后，系统拿维修照片跟开工前照片核对',
        '只有屋主能按 Accept 关单；按 Not fixed 驳回，保修单会重开',
        '保修单显示《房屋发展法》时钟：交屋后 24 个月保修期内，发展商要在 30 天内修好；驳回也不会重新计时',
      ],
      en: [
        'Pre-work photo: GPS and camera data stripped, sealed with a SHA-256 fingerprint',
        'Follow-up photo is auto-aligned; a scan marks new cracks or stains with red boxes',
        'Rule-based suggestion (renovation / building defect / inspector / no change / retake); people decide. A change photographed before work began is never put down to the renovation',
        '"Caused by the renovation" is only a proposal until the renovating owner agrees; if they disagree, an SDP inspector checks. Residents cannot record an inspector\'s finding',
        '"Building defect" opens an SDP warranty ticket automatically (the owner\'s own right; no neighbour sign-off needed)',
        'SDP\'s repair photo is checked against the pre-work photo',
        'Only the owner can Accept and close; "Not fixed" reopens the ticket',
        'Each ticket shows the Housing Development Act clock: within the 24-month liability period, repairs are due in 30 days; rejecting does not restart it',
      ],
      ms: [
        'Foto sebelum kerja: data GPS dan kamera dibuang, dimeterai dengan cap jari SHA-256',
        'Foto susulan dijajarkan secara automatik; imbasan menandakan retak atau kesan air baharu dengan kotak merah',
        'Cadangan berdasarkan peraturan (ubah suai / kecacatan bangunan / pemeriksa / tiada perubahan / ambil semula); manusia yang memutuskan. Perubahan yang difoto sebelum kerja bermula tidak pernah dipersalahkan kepada ubah suai',
        '"Disebabkan ubah suai" hanya cadangan sehingga pemilik yang mengubah suai bersetuju; jika mereka tidak bersetuju, pemeriksa SDP menyemak. Penduduk tidak boleh merekodkan dapatan pemeriksa',
        '"Kecacatan bangunan" membuka tiket waranti SDP secara automatik (hak pemilik sendiri; tiada persetujuan jiran diperlukan)',
        'Foto pembaikan SDP disemak berbanding foto sebelum kerja',
        'Hanya pemilik boleh Terima dan tutup; "Belum dibaiki" membuka semula tiket',
        'Setiap tiket menunjukkan jam Akta Pemajuan Perumahan: dalam tempoh liabiliti 24 bulan, pembaikan perlu siap dalam 30 hari; menolak tidak memulakannya semula',
      ],
    },
    why: {
      zh: '纠纷最难回答的是「装修前本来就有吗？」。没有证据，邻居只能吵，SDP 也难判断该不该修。开工前的照片让两边都有公平的依据，邻居关系和 SDP 的保修都不用赔进去。',
      en: 'The hardest question in a dispute is "was it there before the works?". Without evidence, neighbours argue and SDP cannot tell whether a repair is theirs. Pre-work photos give both sides a fair basis, so neither the friendship nor SDP’s warranty is lost to the argument.',
      ms: 'Soalan paling sukar dalam pertikaian ialah "adakah ia sudah ada sebelum kerja?". Tanpa bukti, jiran bertengkar dan SDP tidak dapat menentukan sama ada pembaikan itu tanggungjawabnya. Foto sebelum kerja memberi asas yang adil kepada kedua-dua pihak, jadi persahabatan mahupun waranti SDP tidak hilang dalam pertengkaran.',
    },
  },
  log: {
    layer: { zh: '安全网 · 屋历', en: 'Safety net · Home log', ms: 'Jaring keselamatan · Log rumah' },
    title: { zh: '环环相扣的屋历', en: 'Chained home log', ms: 'Log rumah berantai' },
    what: {
      zh: '每户一条记录链：交屋、装修、照片、案件、维修、屋主确认，全都按时间串起来。',
      en: 'One chain of records per home: handover, renovation, photos, cases, repairs and owner sign-off, in order.',
      ms: 'Satu rantaian rekod bagi setiap rumah: penyerahan kunci, ubah suai, foto, kes, pembaikan dan pengesahan pemilik, mengikut urutan.',
    },
    features: {
      zh: [
        '每一块都带自己的指纹和上一块的指纹',
        '偷偷改动旧的一笔（又没把后面全部重算），链就会断，最上面会从 CHAIN CHECKED 变成警告',
        '老实说明：目前由同一台服务器保存和检查；试点会给屋主每笔的签章收据，再每天把指纹盖上外部时间戳',
        '只有 app 自己的步骤能写进屋历，没有人能手动加纪录',
        '照片记录直接显示缩图',
      ],
      en: [
        'Each block shows its own fingerprint and the previous one',
        'A quiet edit to an old record (without recomputing everything after it) breaks the chain; the banner switches from CHAIN CHECKED to a warning',
        'Said plainly: today the same server keeps and checks it; the pilot adds a signed receipt to the owner for each record and a daily outside timestamp',
        'Only the app\'s own steps write to a home log; no one can add records by hand',
        'Photo records show a thumbnail',
      ],
      ms: [
        'Setiap blok menunjukkan cap jarinya sendiri dan cap jari sebelumnya',
        'Suntingan senyap pada rekod lama (tanpa mengira semula semua selepasnya) memutuskan rantaian; sepanduk bertukar daripada CHAIN CHECKED kepada amaran',
        'Dikatakan terus terang: hari ini pelayan yang sama menyimpan dan menyemaknya; perintis menambah resit bertandatangan kepada pemilik bagi setiap rekod dan cap masa luar setiap hari',
        'Hanya langkah app sendiri menulis ke log rumah; tiada siapa boleh menambah rekod secara manual',
        'Rekod foto menunjukkan imej kecil',
      ],
    },
    why: {
      zh: '以后保修和纠纷都有一份按时间串好、双方说法都在的纪录；试点加上外部时间戳后，才能当成大家都信得过的证据。',
      en: 'Warranty claims and disputes get one ordered record with both sides in it; with the pilot\'s outside timestamps it becomes evidence everyone can rely on.',
      ms: 'Tuntutan waranti dan pertikaian mendapat satu rekod tersusun dengan kedua-dua pihak di dalamnya; dengan cap masa luar perintis, ia menjadi bukti yang boleh dipercayai semua orang.',
    },
  },
  sdp: {
    layer: { zh: 'SDP 后台', en: 'SDP view', ms: 'Paparan SDP' },
    title: { zh: 'SDP 管理后台', en: 'SDP command view', ms: 'Paparan kawalan SDP' },
    what: {
      zh: 'SDP 的保修、物业和社区团队看到的画面。',
      en: 'What SDP’s warranty, estate and community teams would see.',
      ms: 'Apa yang akan dilihat oleh pasukan waranti, estet dan komuniti SDP.',
    },
    features: {
      zh: [
        '保修队列：每张单都有 30 天法定时钟，逾期会标红；SDP 提交维修照片后系统自动核对',
        '物业队列：邻居升级上来的不满，可以「提醒装修户遵守屋规」或「结案」',
        '讯息审核：被检举的讯息，可以警告发送者（只有他看得到）或驳回',
        '数据：多少不满在邻居之间就解决了、回覆率、开工前照片覆盖率、屋主关单比例',
        '邻里关系：隔壁之间互相认识的比例、从交屋到第一次打招呼的天数、30 天内活跃的邻里圈（只有数字，看不到谁跟谁聊、聊什么）',
        '讯息审核也能播放被检举的语音（检举的语音会保留到审核完，其他语音 30 天自动删除）',
        '物业柜台（Front desk）：交屋时发一次性加入码（QR）、列印给未加入住户的纸本通知并记录送达、替偏好纸本的屋主登记装修（职员名字记录在案）',
        '页底「Reset demo data」：彩排前清空示范资料（只在网址加上 ?rehearsal=1 时显示）',
      ],
      en: [
        'Warranty queue: every ticket has a 30-day statutory clock and turns red when overdue; repair photos are checked automatically',
        'Estate queue: concerns escalated by neighbours; remind the owner of the house rules, or close the concern',
        'Moderation: reported messages; warn the sender privately or dismiss',
        'Numbers: share of concerns settled between neighbours, reply rate, pre-work photo coverage, owner-closed repairs',
        'Neighbour relationships: share of next-door pairs who know each other, days from keys to a first hello, circles active in 30 days (counts only, never who or what)',
        'Moderation can play a reported voice message (reported voice is kept until reviewed; all other voice is deleted after 30 days)',
        'Front desk: one-time join codes (QR) at handover, printed notices for households not on Keynection with delivery recorded, and renovations registered for owners who prefer paper (the staff name goes on record)',
        '"Reset demo data" at the bottom clears everything before a rehearsal (shown only when the address ends in ?rehearsal=1)',
      ],
      ms: [
        'Barisan waranti: setiap tiket ada jam statutori 30 hari dan bertukar merah apabila lewat; foto pembaikan disemak secara automatik',
        'Barisan estet: kebimbangan yang dinaikkan oleh jiran; ingatkan pemilik tentang peraturan rumah, atau tutup kebimbangan',
        'Penyederhanaan: mesej yang dilaporkan; beri amaran kepada penghantar secara peribadi atau tolak',
        'Angka: bahagian kebimbangan yang diselesaikan antara jiran, kadar balasan, liputan foto sebelum kerja, pembaikan yang ditutup pemilik',
        'Hubungan jiran: bahagian pasangan sebelah-menyebelah yang saling kenal, hari dari kunci ke ucapan pertama, bulatan aktif dalam 30 hari (kiraan sahaja, bukan siapa atau apa)',
        'Penyederhanaan boleh memainkan mesej suara yang dilaporkan (suara yang dilaporkan disimpan sehingga disemak; semua suara lain dipadam selepas 30 hari)',
        'Kaunter hadapan: kod sertai sekali guna (QR) semasa penyerahan kunci, notis bercetak untuk isi rumah yang tiada dalam Keynection dengan penghantaran direkodkan, dan ubah suai didaftarkan bagi pemilik yang memilih kertas (nama kakitangan direkodkan)',
        '"Reset demo data" di bahagian bawah mengosongkan semuanya sebelum raptai (hanya ditunjukkan apabila alamat berakhir dengan ?rehearsal=1)',
      ],
    },
    why: {
      zh: 'SDP 第一次能看到社区关系和保修品质的真实数据，也能证明自己在法定时限内修好，而不是只看投诉数字。',
      en: 'SDP sees real numbers on community health and repair quality, and can show repairs were done within the statutory window, instead of only counting complaints.',
      ms: 'SDP melihat angka sebenar tentang kesihatan komuniti dan kualiti pembaikan, dan boleh menunjukkan pembaikan dibuat dalam tempoh statutori, bukan sekadar mengira aduan.',
    },
  },
  me: {
    layer: { zh: '我', en: 'Me', ms: 'Saya' },
    title: { zh: '个人页与隐私设定', en: 'Profile and privacy', ms: 'Profil dan privasi' },
    what: {
      zh: '像所有社交 app 的个人页：邻居看到的你，以及谁可以联系你。',
      en: 'Like any social app’s profile: how neighbours see you, and who may contact you.',
      ms: 'Seperti profil mana-mana app sosial: bagaimana jiran melihat anda, dan siapa boleh menghubungi anda.',
    },
    features: {
      zh: [
        '一句自我介绍（80 字以内），只有影响圈和已接受联系的人看得到；会提醒不要写作息或出远门的日期',
        '阅读语言：快捷回复会翻成这个语言',
        '开关：接受联系请求、接受 👋 Wave、安静模式（邻居不能发讯息，但装修通知和不满仍会送达）',
        '已封锁名单，可以解除封锁',
        '家人代办：屋主可以授权最多 2 位家人（例如替长辈操作），他们做的每件事都会以他们的名字记录；按「以 Adam 的身份使用」即可示范',
        '下载我的资料（PDPA）：一个档案包含 Keynection 保存的所有关于这户的资料，其他住户只显示门牌',
        '介面语言：顶栏 EN / BM / 中 切换住户页面的语言',
        '简易模式：字和按钮更大、选项更少（只有自己看得到这个设定）；WhatsApp 通知开关（通知里不会有讯息内容）',
        '捷径：我的屋历',
      ],
      en: [
        'A one-line bio (80 characters), visible only to your circle and accepted contacts; a reminder not to share schedules or travel dates',
        'Reading language: quick replies are translated into it',
        'Switches: accept contact requests, accept 👋 waves, quiet mode (no chats, but renovation notices and concerns still arrive)',
        'Blocked neighbours, with unblock',
        'Family helpers: the owner can add up to two family members (for example to help an elderly parent); everything they do is recorded under their name. Tap "Use the app as Adam" to demo it',
        'Download my data (PDPA): one file with everything Keynection holds about the household; other residents appear by unit only',
        'Interface language: EN / BM / 中 in the top bar switches the resident screens',
        'Easy mode: bigger text and buttons, fewer options (private to the household); WhatsApp alerts on or off (alerts never include message content)',
        'Shortcut to your home log',
      ],
      ms: [
        'Satu baris pengenalan (80 aksara), hanya kelihatan kepada bulatan anda dan kenalan yang diterima; peringatan supaya tidak berkongsi jadual atau tarikh perjalanan',
        'Bahasa bacaan: balasan pantas diterjemah ke dalamnya',
        'Suis: terima permintaan hubungan, terima 👋 lambaian, mod senyap (tiada sembang, tetapi notis ubah suai dan kebimbangan tetap tiba)',
        'Jiran yang disekat, dengan nyahsekat',
        'Pembantu keluarga: pemilik boleh menambah sehingga dua ahli keluarga (contohnya untuk membantu ibu bapa warga emas); semua yang mereka lakukan direkodkan atas nama mereka. Ketik "Guna app sebagai Adam" untuk demo',
        'Muat turun data saya (PDPA): satu fail dengan semua yang disimpan Keynection tentang isi rumah; penduduk lain muncul mengikut unit sahaja',
        'Bahasa antara muka: EN / BM / 中 di bar atas menukar skrin penduduk',
        'Mod mudah: teks dan butang lebih besar, pilihan lebih sedikit (peribadi kepada isi rumah); makluman WhatsApp hidup atau mati (makluman tidak pernah mengandungi kandungan mesej)',
        'Pintasan ke log rumah anda',
      ],
    },
    why: {
      zh: '用户自己决定被联系的程度，才会放心加入；但安全相关的通知不能被关掉。',
      en: 'People join when they control how reachable they are, but safety notices can’t be switched off.',
      ms: 'Orang menyertai apabila mereka mengawal sejauh mana mereka boleh dihubungi, tetapi notis keselamatan tidak boleh dimatikan.',
    },
  },
  planner: {
    layer: { zh: 'SDP 后台', en: 'SDP view', ms: 'Paparan SDP' },
    title: { zh: '新 phase 设定', en: 'Phase setup', ms: 'Tetapan fasa' },
    what: {
      zh: 'SDP 输入平面图的基本布局（几条 lorong、每排几间、几栋公寓、几层、每层几户），系统用跟 app 一模一样的规则算出每一户的邻里圈和每种装修要通知谁。不会存任何资料。',
      en: 'SDP enters the basic layout from the site plan (lorongs, houses per row, blocks, floors, units per floor) and Keynection works out every circle and notice list with the same rules as the app. Nothing is saved.',
      ms: 'SDP memasukkan susun atur asas daripada pelan tapak (lorong, rumah setiap baris, blok, tingkat, unit setiap tingkat) dan Keynection mengira setiap bulatan dan senarai notis dengan peraturan yang sama seperti app. Tiada apa-apa disimpan.',
    },
    features: {
      zh: [
        '三个预设：Taman Demo、纯排屋、混合 phase，也可以自己调',
        '结果：总户数、平均邻里圈大小、邻居比较少的户数（边间、转角、顶楼和最低层）、几毫秒算完',
        '邻里圈大小分布图、四种装修平均要通知几户',
        '示意图：第一条 lorong 和第一栋公寓，颜色越深表示邻居越少（物业要人工确认的就是这些）',
        '下载每户的邻里圈清单（CSV，只有门牌，没有住户资料）',
      ],
      en: [
        'Three presets (Taman Demo, landed, mixed) or your own numbers',
        'Results: homes, average circle, homes with fewer neighbours (end lots, corners, top and lowest floors), and setup time in milliseconds',
        'Circle-size chart and the average notice list for each type of work',
        'Sample drawing of the first lorong and block, darker where there are fewer neighbours (what the estate office checks by hand)',
        'Download every home’s circle as CSV (homes only, no resident data)',
      ],
      ms: [
        'Tiga pratetap (Taman Demo, bertanah, campuran) atau angka anda sendiri',
        'Keputusan: rumah, purata bulatan, rumah dengan jiran lebih sedikit (lot hujung, penjuru, tingkat atas dan terbawah), dan masa tetapan dalam milisaat',
        'Carta saiz bulatan dan purata senarai notis bagi setiap jenis kerja',
        'Lukisan sampel lorong dan blok pertama, lebih gelap di mana jiran lebih sedikit (apa yang disemak pejabat estet secara manual)',
        'Muat turun bulatan setiap rumah sebagai CSV (rumah sahaja, tiada data penduduk)',
      ],
    },
    why: {
      zh: '证明 Keynection 可以很快复制到 SDP 的其他 township：一个上千户的 phase 不到一秒就设定好，物业只需要检查不规则的地段。',
      en: 'Shows Keynection can be copied to SDP’s other townships quickly: a phase of a thousand homes is set up in under a second, and the estate office only checks irregular plots.',
      ms: 'Menunjukkan Keynection boleh disalin ke township SDP yang lain dengan cepat: fasa seribu rumah disediakan dalam kurang sesaat, dan pejabat estet hanya menyemak lot yang tidak sekata.',
    },
  },
  impact: {
    layer: { zh: 'SDP 后台', en: 'SDP view', ms: 'Paparan SDP' },
    title: { zh: '影响估算', en: 'Impact model', ms: 'Model impak' },
    what: {
      zh: '最上面是主要指标「邻里连结」：用统计局 2020 年人口普查的真实数字当起点（雪兰莪 13.2% 的人一个月内没跟邻居面对面说过话，全国 6.5%），试点用同一题检查。下面才是 SDP 可能省下的成本，每个数字都标明是假设，可以直接改。',
      en: 'The main measure, neighbour connection, comes first and starts from real census data (Selangor: 13.2% had no face-to-face contact with a neighbour in a month; Malaysia 6.5%). The pilot checks it with the same question. Below it, what SDP could save, every number marked as an assumption you can change.',
      ms: 'Ukuran utama, hubungan jiran, datang dahulu dan bermula daripada data banci sebenar (Selangor: 13.2% tiada hubungan bersemuka dengan jiran dalam sebulan; Malaysia 6.5%). Perintis menyemaknya dengan soalan yang sama. Di bawahnya, apa yang SDP boleh jimat, setiap angka ditanda sebagai andaian yang boleh anda ubah.',
    },
    features: {
      zh: [
        '选乡镇所在的州（雪兰莪、吉隆坡、森美兰、柔佛、全国），自动带入普查数字',
        '试点目标：把「一个月没跟邻居说过话」减少多少；算出多少户开始跟邻居有往来',
        '成本部分先算 SDP 一定要付的：保修期内「装修造成还是建筑缺陷」的争议；再算邻居投诉（只适用于 SDP 物业团队有处理投诉的社区）',
        '户数会自动带入「新 phase 设定」最近算的结果；页首写明只有普查数字是实测资料',
      ],
      en: [
        'Pick the township’s state (Selangor, Kuala Lumpur, Negeri Sembilan, Johor or all of Malaysia) to load its census figures',
        'Pilot target: how much to cut "no contact with a neighbour"; shows how many households come into contact',
        'Costs start with what SDP certainly pays: disputes over "renovation or building defect" during the warranty; then neighbour complaints, only where SDP’s estate team handles them',
        'Homes come from the latest Phase setup run; the banner says only the census figures are measured data',
      ],
      ms: [
        'Pilih negeri township (Selangor, Kuala Lumpur, Negeri Sembilan, Johor atau seluruh Malaysia) untuk memuatkan angka bancinya',
        'Sasaran perintis: berapa banyak untuk mengurangkan "tiada hubungan dengan jiran"; menunjukkan berapa banyak isi rumah mula berhubung',
        'Kos bermula dengan apa yang pasti dibayar SDP: pertikaian "ubah suai atau kecacatan bangunan" semasa waranti; kemudian aduan jiran, hanya di mana pasukan estet SDP mengendalikannya',
        'Rumah datang daripada larian Tetapan fasa terkini; sepanduk menyatakan hanya angka banci ialah data yang diukur',
      ],
    },
    why: {
      zh: '评审一定会问「数字从哪里来」。主要指标用政府普查的真实数据和同一个问题，试点结果可以直接跟全国比较；其他数字摊开让 SDP 自己调，不编造。',
      en: 'Judges will ask where the numbers come from. The main measure uses real government census data and the same question, so pilot results compare directly with the national figures; everything else is laid open for SDP to adjust, nothing invented.',
      ms: 'Juri akan bertanya dari mana datangnya angka. Ukuran utama menggunakan data banci kerajaan sebenar dan soalan yang sama, jadi keputusan perintis dibandingkan terus dengan angka kebangsaan; yang lain dibentangkan untuk SDP laraskan, tiada yang direka.',
    },
  },
  channels: {
    layer: { zh: 'SDP 后台', en: 'SDP view', ms: 'Paparan SDP' },
    title: { zh: '触达管道', en: 'Channels', ms: 'Saluran' },
    what: {
      zh: 'Keynection 怎么到住户手上，分两步。第一步不动 SDP App：交屋礼包里的一次性加入码 → 手机浏览器打开、加到主屏幕 → WhatsApp 提醒（用他的语言）。第二步（试点之后）做成 SDP App 里的模块，用屋主原有的登入。',
      en: 'How Keynection reaches residents, in two steps. Step one changes nothing in the SDP App: the one-time code in the welcome pack → opens in the phone’s browser, added to the Home Screen → WhatsApp alerts in their language. Step two, after the pilot, makes it a module inside the SDP App with the owner’s existing sign-in.',
      ms: 'Cara Keynection sampai kepada penduduk, dalam dua langkah. Langkah satu tidak mengubah apa-apa dalam SDP App: kod sekali guna dalam pek alu-aluan → dibuka dalam pelayar telefon, ditambah ke Skrin Utama → makluman WhatsApp dalam bahasa mereka. Langkah dua, selepas perintis, menjadikannya modul dalam SDP App dengan log masuk sedia ada pemilik.',
    },
    features: {
      zh: [
        '第一天就能用、不动 SDP App 一行代码：礼包有码，Keynection 是网页 app，提醒走 WhatsApp',
        'WhatsApp 通知按真实资料产生：装修通知（完整内容）、新讯息提醒（不含讯息内容）、问题进度、物业公告、维修确认；标「Scheduled」的会自己发出',
        '安静模式只挡聊天提醒，正式通知照样送达；还没加入的住户改用纸本，关掉 WhatsApp 的只在 app 里看',
        '换顶栏的住户，就能看到不同人、不同语言收到的通知：隔壁 Kumar（No. 13）收到的是淡米尔文',
        '右边那支 SDP App 手机是第二步：加一个「Neighbours」入口，用屋主原有的登入打开 Keynection，屋主只有一个 app、SDP 只有一套数据（版面是示意，不是 SDP 真正的 app）',
      ],
      en: [
        'Works on day one without touching the SDP App: the code is in the welcome pack, Keynection is a web app, alerts go by WhatsApp',
        'WhatsApp alerts built from real data: full renovation notices, new-message alerts without the content, concern updates, estate notices, repair checks; those marked Scheduled go out by themselves',
        'Quiet mode holds back chat alerts only; households not on Keynection get paper instead, and those with alerts off see everything in the app',
        'Switch household in the top bar to see what someone else receives, in their language: Kumar next door (No. 13) gets Tamil',
        'The SDP App phone on the right is step two: a "Neighbours" entry opens Keynection with the owner’s existing sign-in, so the owner has one app and SDP one set of data (illustrative layout, not SDP’s actual app)',
      ],
      ms: [
        'Berfungsi pada hari pertama tanpa menyentuh SDP App: kod ada dalam pek alu-aluan, Keynection ialah app web, makluman melalui WhatsApp',
        'Makluman WhatsApp dibina daripada data sebenar: notis ubah suai penuh, makluman mesej baharu tanpa kandungan, kemas kini kebimbangan, notis estet, semakan pembaikan; yang ditanda Dijadualkan keluar dengan sendirinya',
        'Mod senyap menahan makluman sembang sahaja; isi rumah yang tiada dalam Keynection mendapat kertas, dan yang mematikan makluman melihat semuanya dalam app',
        'Tukar isi rumah di bar atas untuk melihat apa yang diterima orang lain, dalam bahasa mereka: Kumar di sebelah (No. 13) mendapat bahasa Tamil',
        'Telefon SDP App di sebelah kanan ialah langkah dua: entri "Neighbours" membuka Keynection dengan log masuk sedia ada pemilik, jadi pemilik ada satu app dan SDP satu set data (susun atur ilustrasi, bukan app sebenar SDP)',
      ],
    },
    why: {
      zh: '回答评审最常问的两题：「住户真的会用吗？」——礼包有码、WhatsApp 大家天天用；「SDP 要改多少？」——第一步一行都不用改，第二步才整合进 SDP App（整合是 SDP 自己写明的 2026 年方向）。',
      en: 'Answers the judges’ two usual questions: "will residents actually use it?" (the code is in the welcome pack and alerts arrive on the WhatsApp everyone already uses) and "how much must SDP change?" (nothing in step one; step two integrates into the SDP App, SDP’s own stated direction for 2026).',
      ms: 'Menjawab dua soalan biasa juri: "adakah penduduk benar-benar akan menggunakannya?" (kod ada dalam pek alu-aluan dan makluman tiba di WhatsApp yang semua orang sudah guna) dan "berapa banyak SDP perlu berubah?" (tiada dalam langkah satu; langkah dua berintegrasi ke dalam SDP App, hala tuju SDP sendiri untuk 2026).',
    },
  },
  safeguards: {
    layer: { zh: '信任', en: 'Trust', ms: 'Kepercayaan' },
    title: { zh: '风险与保障', en: 'Safeguards', ms: 'Perlindungan' },
    what: {
      zh: '设计时想到的每一个风险，以及原型已经怎么处理（Built）或试点时会怎么做（Pilot）。',
      en: 'Every risk found while designing, and what the prototype already does (Built) or the pilot will add (Pilot).',
      ms: 'Setiap risiko yang ditemui semasa mereka bentuk, dan apa yang prototaip sudah lakukan (Built) atau yang akan ditambah perintis (Pilot).',
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
      ms: [
        'Privasi & PDPA, gangguan, bukti palsu, pertimbangan automatik yang salah, pembaikan lambat, penyalahgunaan kontraktor',
        'Penduduk yang tidak dalam talian, halangan bahasa, kesesuaian undang-undang (permit PBT, HDA, strata), penerimaan rendah, keselamatan sistem',
        'Setiap item memaut ke bahagian prototaip yang mengendalikannya',
      ],
    },
    why: {
      zh: '评审一定会问「如果有人乱用怎么办？」。这一页直接回答，而且大部分已经做出来了。',
      en: 'Judges will ask "what if someone abuses it?". This page answers it, and most answers are already built.',
      ms: 'Juri akan bertanya "bagaimana jika seseorang menyalahgunakannya?". Halaman ini menjawabnya, dan kebanyakan jawapan sudah dibina.',
    },
  },
}

export interface RouteStep {
  tab: TabId
  unit?: string
  // Both sides of the shared wall at once (Aiman left, Siti right), and the thread to open on the focused side.
  split?: boolean
  peer?: string
  /** One line on the button: what to do here. The judge route has one; the full route shows `text` instead. */
  brief?: Text
  /** The step in full, under "Details" when there is a brief. */
  text: Text
}

// The main story in about three minutes, for judges: connection first, the safety net last.
export const JUDGE_ROUTE: RouteStep[] = [
  {
    tab: 'circle', unit: 'T-12',
    brief: {
      zh: '交钥匙：Aiman（No. 12）的首页是左右和对面 5 户 → 对 Siti 按 👋',
      en: 'Key day: Aiman (No. 12) sees the five homes beside and opposite → 👋 Wave at Siti',
      ms: 'Hari kunci: Aiman (No. 12) nampak lima rumah di sebelah dan bertentangan → 👋 Lambai kepada Siti',
    },
    text: {
      zh: '交钥匙那天：Aiman（No. 12）刚交屋，首页就是左右和对面这 5 户邻居（共用墙、对面）→ 对 Siti 按「👋 Wave」',
      en: 'Key day: Aiman (No. 12) has just moved in, and his home screen is the five homes beside and opposite him (shared walls, across the road) → 👋 Wave at Siti',
      ms: 'Hari kunci: Aiman (No. 12) baru sahaja berpindah masuk, dan skrin utamanya ialah lima rumah di sebelah dan bertentangan dengannya (dinding kongsi, seberang jalan) → 👋 Lambai kepada Siti',
    },
  },
  {
    tab: 'works', unit: 'T-12',
    brief: {
      zh: 'Works → Register renovation → 打一句话 → Fill it in for me → 时段自动避开邻居的安静时间 → 发送',
      en: 'Works → Register renovation → type one sentence → Fill it in for me → the hours avoid the neighbours’ quiet times → Send',
      ms: 'Ubah suai → Daftar ubah suai → taip satu ayat → Isikan untuk saya → waktu mengelak waktu senyap jiran → Hantar',
    },
    text: {
      zh: '快捷方式：按右下角的麦克风，直接说「Retiling the master bathroom from next Monday…」→ 单子填好停在复核页。一步步来：装修通知就是自我介绍：Works →「Register renovation」→ 在「一句话说清楚」打「Retiling the master bathroom from next Monday for two weeks, weekdays 9 to 6」（中文、马来文也行）→「Fill it in for me」→ AI 判断工程类型，图上标出谁会收到 →「时间」那一步系统已按邻居作息排好：避开 Siti 宝宝午睡（13–15 点）和对面 Hafiz 夜班后补眠（9–11 点），但不说是谁 → 检查后发送（还没加入的 No. 23 由物业送纸本）',
      en: 'Shortcut: press the mic at the bottom right and just say "Retiling the master bathroom from next Monday…" → the notice is filled in and waits on Review. Step by step: the renovation notice is the introduction: Works → Register renovation → in "Just say it in one sentence" type "Retiling the master bathroom from next Monday for two weeks, weekdays 9 to 6" (Malay or Chinese work too) → Fill it in for me → AI picks the type of work and the plan marks who is told → at "When" the hours are already planned around the neighbours: clear of Siti’s baby nap (1–3pm) and Hafiz’s sleep after night shifts (9–11am), without saying whose → check and send (No. 23, not on the app yet, gets it on paper)',
      ms: 'Pintasan: tekan mikrofon di kanan bawah dan sebut sahaja "Retiling the master bathroom from next Monday…" → notis diisi dan menunggu di Semakan. Langkah demi langkah: notis ubah suai ialah perkenalan: Ubah suai → Daftar ubah suai → dalam "Cakap saja dalam satu ayat" taip "Retiling the master bathroom from next Monday for two weeks, weekdays 9 to 6" (bahasa Melayu atau Cina pun boleh) → Isikan untuk saya → AI memilih jenis kerja dan pelan menandakan siapa diberitahu → di "Bila" waktu sudah dirancang mengikut jiran: mengelakkan tidur siang bayi Siti (1–3 petang) dan tidur Hafiz selepas syif malam (9–11 pagi), tanpa menyebut milik siapa → semak dan hantar (No. 23, belum dalam app, menerimanya di atas kertas)',
    },
  },
  {
    tab: 'channels', unit: 'T-13',
    brief: {
      zh: '触达管道：Kumar（No. 13）在 WhatsApp 收到淡米尔文通知，另有两条自动提醒',
      en: 'Channels: Kumar (No. 13) gets the notice on WhatsApp in Tamil, plus two reminders that send themselves',
      ms: 'Saluran: Kumar (No. 13) menerima notis di WhatsApp dalam bahasa Tamil, dengan dua peringatan automatik',
    },
    text: {
      zh: '隔壁 Kumar（No. 13）读淡米尔文：触达管道里看到他在 WhatsApp 收到的是淡米尔文装修通知，连 Aiman 写的工程说明也由 AI 翻好；下面还排好两条会自己发出的提醒：开工前 3 天提醒拍照、完工后一天问有没有变化',
      en: 'Kumar next door (No. 13) reads Tamil: Channels shows Aiman’s notice reaching him on WhatsApp in Tamil, down to the work Aiman described, translated by AI; below it, two reminders that go out by themselves: photograph three days before the works, and a check the day after they end',
      ms: 'Kumar di sebelah (No. 13) membaca bahasa Tamil: Saluran menunjukkan notis Aiman sampai kepadanya di WhatsApp dalam bahasa Tamil, sehingga kerja yang Aiman terangkan, diterjemah oleh AI; di bawahnya, dua peringatan yang keluar dengan sendirinya: ambil foto tiga hari sebelum kerja, dan semakan sehari selepas ia tamat',
    },
  },
  {
    tab: 'chats', unit: 'T-11', split: true, peer: 'T-12',
    brief: {
      zh: 'Siti 那边：「吵闹时段已避开你的安静时间」→ 回挥手 → 打一句冲的马来文 → AI 给平和说法 → Aiman 看到英文',
      en: 'Siti’s side: “Noisy hours planned around your quiet time” → wave back → type something sharp in Malay → AI offers a calmer line → Aiman reads it in English',
      ms: 'Pihak Siti: “Waktu bising dirancang mengelakkan waktu senyap anda” → lambai balik → taip ayat tajam dalam bahasa Melayu → AI tawarkan ayat lebih tenang → Aiman membacanya dalam bahasa Inggeris',
    },
    text: {
      zh: 'Siti 打开 Aiman 的通知，看到「吵闹时段已避开你的安静时间」，宝宝午睡不用她开口 → 回 👋 → 再用马来文打一句冲的话（例：「Rumah awak bising macam kilang! Tak reti hormat jiran ke?」）→ AI 先给她平和的说法 → Aiman 看到的是英文，原文点一下就有',
      en: 'Siti opens Aiman’s notice: "Noisy hours planned around your quiet time", so she never had to ask about the baby’s nap → she waves back → then types something sharp in Malay ("Rumah awak bising macam kilang! Tak reti hormat jiran ke?") → AI offers her a calmer wording → Aiman reads it in English, the original one tap away',
      ms: 'Siti membuka notis Aiman: "Waktu bising dirancang mengelakkan waktu senyap anda", jadi dia tidak perlu bertanya tentang tidur siang bayi → dia melambai balik → kemudian menaip sesuatu yang tajam dalam bahasa Melayu ("Rumah awak bising macam kilang! Tak reti hormat jiran ke?") → AI menawarkan ayat yang lebih tenang → Aiman membacanya dalam bahasa Inggeris, teks asal satu ketikan sahaja',
    },
  },
  {
    tab: 'evidence', unit: 'T-11',
    brief: {
      zh: '照片：Siti 封存开工前照片（Use sample）→ Sample crack → 开工前就有：走保修，不怪 Aiman',
      en: 'Photos: Siti seals a pre-work photo (Use sample) → Sample crack → it was there before the works: warranty, not Aiman',
      ms: 'Foto: Siti memeterai foto sebelum kerja (Guna sampel) → Sampel retak → sudah ada sebelum kerja: waranti, bukan Aiman',
    },
    text: {
      zh: '万一出事：Siti 按 Use sample 封存开工前照片 → Sample crack → 系统说明裂缝开工前就有，属于保修，不是装修造成',
      en: 'If something goes wrong: Siti seals a pre-work photo (Use sample) → Sample crack → the crack was there before the works, so it goes to the warranty, not to Aiman',
      ms: 'Jika berlaku masalah: Siti memeterai foto sebelum kerja (Guna sampel) → Sampel retak → retak itu sudah ada sebelum kerja, jadi ia pergi ke waranti, bukan kepada Aiman',
    },
  },
  {
    tab: 'impact',
    brief: {
      zh: '影响估算：2020 普查同一题（雪兰莪 13.2% 一个月没跟邻居说过话），试点前后对比',
      en: 'Impact: the 2020 census question (Selangor: 13.2% had no neighbour contact in a month), asked before and after the pilot',
      ms: 'Impak: soalan banci 2020 (Selangor: 13.2% tiada hubungan jiran dalam sebulan), ditanya sebelum dan selepas perintis',
    },
    text: {
      zh: 'SDP 怎么检查效果：影响估算用 2020 年普查同一题（雪兰莪 13.2% 一个月没跟邻居说过话），试点前后一比就知道；后台还会算隔壁互相认识的比例',
      en: 'How SDP checks it works: the Impact model uses the 2020 census question (Selangor: 13.2% had no neighbour contact in a month), asked before and after the pilot; the command view also counts next-door pairs who know each other',
      ms: 'Cara SDP menyemak hasilnya: Model impak menggunakan soalan banci 2020 (Selangor: 13.2% tiada hubungan dengan jiran dalam sebulan), ditanya sebelum dan selepas perintis; paparan kawalan juga mengira pasangan sebelah-menyebelah yang saling kenal',
    },
  },
]

export const ROUTE: RouteStep[] = [
  {
    tab: 'circle', unit: 'T-12',
    text: {
      zh: 'Aiman（No. 12）：看顶部头像和邻居卡片 → 对 Siti 按「👋 Wave」→ 切到「Map」→ 点 No. 15 →「Request to connect」',
      en: 'Aiman (No. 12): see the faces and cards → 👋 Wave at Siti → switch to Map → tap No. 15 → Request to connect',
      ms: 'Aiman (No. 12): lihat wajah dan kad → 👋 Lambai kepada Siti → tukar ke Peta → ketik No. 15 → Minta untuk berhubung',
    },
  },
  {
    tab: 'works', unit: 'T-12',
    text: {
      zh: 'Aiman：Works 右上角「Register renovation」→ 用一句话说要做什么让 AI 填（或自己选 Extension）→ 图上标出谁会被通知 → 填完发送',
      en: 'Aiman: Works → Register renovation → say it in one sentence for AI to fill in (or pick Extension yourself) → the plan marks who is told → send',
      ms: 'Aiman: Ubah suai → Daftar ubah suai → sebut dalam satu ayat untuk AI isi (atau pilih Sambungan sendiri) → pelan menandakan siapa diberitahu → hantar',
    },
  },
  {
    tab: 'works', unit: 'T-12',
    text: {
      zh: '（助手，可选）Aiman 按右下角的麦克风（或打字）问「我的装修通知怎样了」→ 日期和通知了几户由服务器算，不是 AI 编的；说「宝宝一点到三点午睡」→ 直接加一个安静时段，可撤销；说一句装修的话 → 通知填好停在复核页，自己按发送才会发出',
      en: '(Assistant, optional) Aiman presses the mic at the bottom right (or types) and asks "How is my renovation notice doing?" → the dates and homes told are counted by the server, not the AI; "Baby naps 1 to 3" adds a quiet time, with Undo; a renovation sentence fills in the notice and waits on Review until he sends it',
      ms: '(Pembantu, pilihan) Aiman menekan mikrofon di kanan bawah (atau menaip) dan bertanya "Macam mana notis ubah suai saya?" → tarikh dan rumah yang diberitahu dikira oleh pelayan, bukan AI; "Bayi tidur 1 hingga 3" menambah waktu senyap, dengan Buat asal; ayat tentang ubah suai mengisi notis dan menunggu di Semakan sehingga dia menghantarnya',
    },
  },
  {
    tab: 'circle', unit: 'A-15-3',
    text: {
      zh: '（公寓，可选）Sofia（A-15-3）：Works →「Register renovation」→ 浴室 → 剖面图显示楼下两层也被通知，A-13-3 名字隐藏',
      en: '(Apartment, optional) Sofia (A-15-3): Works → Register renovation → Bathroom → two floors below are told; A-13-3 stays anonymous',
      ms: '(Pangsapuri, pilihan) Sofia (A-15-3): Ubah suai → Daftar ubah suai → Bilik air → dua tingkat di bawah diberitahu; A-13-3 kekal tanpa nama',
    },
  },
  {
    tab: 'chats', unit: 'T-11', split: true, peer: 'T-12',
    text: {
      zh: 'Siti 在 Chats 回 👋、按表情 ❤️、按快捷回复「宝宝午睡」→ 左边 Aiman 看到英文翻译；也可以按麦克风录语音',
      en: 'Siti waves back, reacts ❤️ and taps the baby-nap quick reply → Aiman sees it in English; the mic records a voice note',
      ms: 'Siti melambai balik, bereaksi ❤️ dan mengetik balasan pantas tidur siang bayi → Aiman melihatnya dalam bahasa Inggeris; mikrofon merakam nota suara',
    },
  },
  {
    tab: 'chats', unit: 'T-11',
    text: {
      zh: 'Siti 按「Raise a concern」→ 选晚上施工 → 发送；Aiman 回复；Siti 再升级给 SDP 物业团队',
      en: 'Siti → Raise a concern → noise outside hours → send; Aiman replies; Siti escalates to the SDP estate team',
      ms: 'Siti → Luahkan kebimbangan → bunyi di luar waktu → hantar; Aiman membalas; Siti menaikkan kepada pasukan estet SDP',
    },
  },
  {
    tab: 'sdp',
    text: {
      zh: 'SDP 后台的物业队列：提醒 Aiman 遵守屋规 → 结案（两边的对话里都看得到）',
      en: 'SDP estate queue: remind Aiman of the house rules → close the concern (both chats show it)',
      ms: 'Barisan estet SDP: ingatkan Aiman tentang peraturan rumah → tutup kebimbangan (kedua-dua sembang menunjukkannya)',
    },
  },
  {
    tab: 'evidence', unit: 'T-11',
    text: {
      zh: 'Siti：Use sample 封存开工前照片 → Sample crack → 选 Building defect → Record decision',
      en: 'Siti: Use sample to seal a pre-work photo → Sample crack → Building defect → Record decision',
      ms: 'Siti: Guna sampel untuk memeterai foto sebelum kerja → Sampel retak → Kecacatan bangunan → Rekod keputusan',
    },
  },
  {
    tab: 'sdp',
    text: {
      zh: '保修队列看 30 天法定时钟 → Sample: poor patch（系统发现裂缝还在）',
      en: 'Warranty queue: note the 30-day clock → Sample: poor patch (crack still detected)',
      ms: 'Barisan waranti: perhatikan jam 30 hari → Sampel: tampalan buruk (retak masih dikesan)',
    },
  },
  {
    tab: 'evidence', unit: 'T-11',
    text: {
      zh: 'Siti 驳回（Not fixed）→ SDP 按 Sample: proper repair → Siti 按 Accept 关单',
      en: 'Siti rejects (Not fixed) → SDP submits Sample: proper repair → Siti accepts and closes it',
      ms: 'Siti menolak (Belum dibaiki) → SDP menghantar Sampel: pembaikan sempurna → Siti menerima dan menutupnya',
    },
  },
  {
    tab: 'log', unit: 'T-11',
    text: {
      zh: '屋历：不满、升级、保修、维修、屋主确认全部在链上，显示 CHAIN CHECKED',
      en: 'Home log: concern, escalation, warranty, repair and sign-off are all chained; CHAIN CHECKED',
      ms: 'Log rumah: kebimbangan, naik taraf, waranti, pembaikan dan pengesahan semuanya berantai; CHAIN CHECKED',
    },
  },
  {
    tab: 'sdp',
    text: {
      zh: '（加入与纸本，可选）SDP 后台 → Front desk：Aiman 的装修通知里 No. 23 还没加入 → 按 Print 看纸本通知 → Delivered；再为 No. 23 按 Issue code → 用演示按钮打开加入页 → 选名字、语言、同意隐私声明',
      en: '(Joining and paper, optional) Command view → Front desk: No. 23 isn’t on Keynection, so Aiman’s notice is on paper → Print → Delivered; then Issue code for No. 23 → open the join page (demo) → name, language, privacy consent',
      ms: '(Menyertai dan kertas, pilihan) Paparan kawalan → Kaunter hadapan: No. 23 tiada dalam Keynection, jadi notis Aiman di atas kertas → Cetak → Dihantar; kemudian Keluarkan kod untuk No. 23 → buka halaman sertai (demo) → nama, bahasa, persetujuan privasi',
    },
  },
  {
    tab: 'circle', unit: 'T-20',
    text: {
      zh: '（长者，可选）Ah Hock（No. 20）开着简易模式：字大、选项少；女儿 Mei Fong 是他的家人代办',
      en: '(Elder, optional) Ah Hock (No. 20) uses easy mode: big text, fewer options; his daughter Mei Fong is his family helper',
      ms: '(Warga emas, pilihan) Ah Hock (No. 20) menggunakan mod mudah: teks besar, pilihan lebih sedikit; anak perempuannya Mei Fong ialah pembantu keluarganya',
    },
  },
  {
    tab: 'planner',
    text: {
      zh: 'SDP 的规模化：新 phase 设定（上千户不到一秒算完）→ 影响估算（所有假设可调）→ 触达管道（第一步礼包 QR 和 WhatsApp，第二步 SDP App 模块）',
      en: 'Scaling for SDP: Phase setup (a thousand homes in under a second) → Impact model (every assumption editable) → Channels (step one: welcome pack and WhatsApp; step two: a module in the SDP App)',
      ms: 'Skala untuk SDP: Tetapan fasa (seribu rumah dalam kurang sesaat) → Model impak (setiap andaian boleh diubah) → Saluran (langkah satu: pek alu-aluan dan WhatsApp; langkah dua: modul dalam SDP App)',
    },
  },
  {
    tab: 'safeguards',
    text: {
      zh: '最后打开 Safeguards：每个风险怎么处理，一页讲完',
      en: 'Finish on Safeguards: every risk and how it is handled, on one page',
      ms: 'Akhiri di Perlindungan: setiap risiko dan cara ia dikendalikan, dalam satu halaman',
    },
  },
]
