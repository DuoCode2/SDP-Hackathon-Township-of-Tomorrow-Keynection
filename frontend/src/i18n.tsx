import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { ApiError } from './api'

// Interface language for the resident (warm) screens: English, Bahasa Melayu, 中文.
// Records screens (works, evidence, home log, SDP) stay in English for now: one language for the official record.

export type UiLang = 'en' | 'ms' | 'zh'
type Entry = [en: string, ms: string, zh: string]

const D: Record<string, Entry> = {
  // navigation and chrome
  'group.resident': ['Resident', 'Penduduk', '住户'],
  'group.trust': ['Trust', 'Kepercayaan', '信任'],
  'nav.circle': ['Neighbours', 'Jiran', '邻居'], 'nav.circle.sub': ['Who lives around you', 'Siapa di sekeliling anda', '你身边住着谁'], 'nav.circle.short': ['Circle', 'Jiran', '邻居'],
  'nav.chats': ['Chats', 'Sembang', '聊天'], 'nav.chats.sub': ['Talk & raise concerns', 'Berbual & luahkan isu', '聊天与反映问题'], 'nav.chats.short': ['Chats', 'Sembang', '聊天'],
  'nav.works': ['Works', 'Ubah suai', '装修'], 'nav.works.sub': ['Renovation & gate passes', 'Ubah suai & pas pagar', '装修与门禁通行证'], 'nav.works.short': ['Works', 'Kerja', '装修'],
  'nav.evidence': ['Evidence', 'Bukti', '证据'], 'nav.evidence.sub': ['Photos & warranty', 'Foto & waranti', '照片与保修'], 'nav.evidence.short': ['Evidence', 'Bukti', '证据'],
  'nav.log': ['Home log', 'Log rumah', '屋历'], 'nav.log.sub': ['Tamper-evident record', 'Rekod kalis usik', '防篡改纪录'], 'nav.log.short': ['Log', 'Log', '屋历'],
  'nav.me': ['Me', 'Saya', '我'], 'nav.me.sub': ['Profile & privacy', 'Profil & privasi', '个人资料与隐私'], 'nav.me.short': ['Me', 'Saya', '我'],
  'nav.sdp': ['Command view', 'Paparan kawalan', '管理后台'], 'nav.sdp.sub': ['Warranty, estate, safety', 'Waranti, estet, keselamatan', '保修、物业、安全'], 'nav.sdp.short': ['SDP', 'SDP', 'SDP'],
  'nav.safeguards': ['Safeguards', 'Perlindungan', '风险与保障'], 'nav.safeguards.sub': ['Risks we designed for', 'Risiko yang diambil kira', '我们考虑过的风险'], 'nav.safeguards.short': ['Trust', 'Amanah', '保障'],
  'top.bothSides': ['Both sides', 'Dua belah', '墙的两边'],
  'top.guide': ['Guide', 'Panduan', '导览'],
  'top.lang': ['Interface language', 'Bahasa antara muka', '介面语言'],
  'side.home': ['Your home', 'Rumah anda', '你的家'],
  'side.keys': ['Keys received {date}', 'Kunci diterima {date}', '{date} 交屋'],

  // demo cast
  'cast.title': ['Demo cast · whose screen are you seeing?', 'Pelakon demo · skrin siapa yang anda lihat?', '演示角色 · 你在看谁的画面？'],
  'cast.others': ['Everyone else in Taman Demo', 'Penduduk lain di Taman Demo', 'Taman Demo 的其他住户'],
  'role.T-12': ['Renovating owner', 'Pemilik yang mengubah suai', '装修户'], 'story.T-12': ['Extending the kitchen at No. 12', 'Membesarkan dapur di No. 12', '在 12 号扩建厨房'],
  'role.T-11': ['Next-door neighbour', 'Jiran sebelah', '隔壁邻居'], 'story.T-11': ['Shares a wall with No. 12', 'Berkongsi dinding dengan No. 12', '跟 12 号共用墙'],
  'role.T-22': ['Across the road', 'Seberang jalan', '对面邻居'], 'story.T-22': ['Faces No. 12, hears the noise', 'Bertentangan No. 12, terdengar bising', '面对 12 号，听得到噪音'],
  'role.A-15-3': ['Upstairs owner', 'Pemilik tingkat atas', '楼上住户'], 'story.A-15-3': ['Re-tiling a bathroom on level 15', 'Menukar jubin bilik air di tingkat 15', '在 15 楼换浴室瓷砖'],
  'role.A-14-3': ['Downstairs neighbour', 'Jiran tingkat bawah', '楼下邻居'], 'story.A-14-3': ['Ceiling below A-15-3', 'Siling di bawah A-15-3', '在 A-15-3 正下方'],
  'role.A-13-3': ['Two floors down', 'Dua tingkat di bawah', '楼下两层'], 'story.A-13-3': ['Outside the circle, but a bathroom leak can reach them', 'Di luar bulatan, tetapi kebocoran bilik air boleh sampai', '不在邻里圈，但浴室漏水可能影响到'],
  'role.resident': ['Resident', 'Penduduk', '住户'],
  'demo.role': ['{role} in this demo', '{role} dalam demo ini', '本演示中的{role}'],

  // relations, places, hints
  'rel.left': ['Left neighbour', 'Jiran kiri', '左边邻居'], 'rel.right': ['Right neighbour', 'Jiran kanan', '右边邻居'],
  'rel.across-left': ['Across the road', 'Seberang jalan', '对面'], 'rel.across-right': ['Across the road', 'Seberang jalan', '对面'],
  'rel.across': ['Directly across', 'Betul-betul di seberang', '正对面'], 'rel.above': ['Upstairs', 'Tingkat atas', '楼上'], 'rel.below': ['Downstairs', 'Tingkat bawah', '楼下'],
  'rel.above-2': ['Two floors up', 'Dua tingkat di atas', '楼上两层'], 'rel.below-2': ['Two floors down', 'Dua tingkat di bawah', '楼下两层'], 'rel.contact': ['Connected by request', 'Berhubung melalui permintaan', '通过请求联系'],
  'share.wall': ['Shares your wall', 'Berkongsi dinding', '跟你共用墙'], 'share.above': ['Lives above you', 'Tinggal di atas anda', '住你楼上'], 'share.below': ['Lives below you', 'Tinggal di bawah anda', '住你楼下'],
  'share.slab': ['shared slab', 'lantai berkongsi', '共用楼板'], 'share.wallShort': ['shared wall', 'dinding berkongsi', '共用墙'],
  'hint.same_row': ['Same row', 'Barisan sama', '同一排'], 'hint.across_road': ['Across the road', 'Seberang jalan', '对面'],
  'hint.floors_above': ['{n} floors above', '{n} tingkat di atas', '楼上 {n} 层'], 'hint.floors_below': ['{n} floors below', '{n} tingkat di bawah', '楼下 {n} 层'],
  'hint.same_floor': ['Same floor', 'Tingkat sama', '同一层'], 'hint.level': ['Level {n}', 'Tingkat {n}', '{n} 楼'],
  'lang.en': ['English', 'Bahasa Inggeris', '英文'], 'lang.ms': ['Bahasa Melayu', 'Bahasa Melayu', '马来文'], 'lang.zh': ['Chinese', 'Bahasa Cina', '中文'],
  'place.block': ['Block {b}', 'Blok {b}', '{b} 栋'],

  // common buttons
  'btn.message': ['Message', 'Mesej', '发讯息'], 'btn.wave': ['Wave', 'Lambai', '打招呼'], 'btn.waved': ['Waved', 'Sudah lambai', '已打招呼'],
  'btn.accept': ['Accept', 'Terima', '接受'], 'btn.decline': ['Decline', 'Tolak', '拒绝'], 'btn.cancel': ['Cancel', 'Batal', '取消'],
  'btn.back': ['Back', 'Kembali', '上一步'], 'btn.next': ['Next', 'Seterusnya', '下一步'], 'btn.save': ['Save', 'Simpan', '保存'],
  'btn.sending': ['Sending…', 'Menghantar…', '发送中…'], 'btn.remove': ['Remove', 'Buang', '移除'], 'btn.unblock': ['Unblock', 'Nyahsekat', '解除封锁'],
  'btn.request': ['Request', 'Minta', '请求'], 'btn.introduce': ['Introduce yourself', 'Perkenalkan diri', '自我介绍'],

  // neighbours page
  'circle.title': ['Your neighbours', 'Jiran anda', '你的邻居'],
  'circle.subtitle': ['The homes around you, worked out from the floor plan. Tap anyone to say hi.', 'Rumah di sekeliling anda, dikira daripada pelan lantai. Ketik sesiapa untuk bertegur sapa.', '根据平面图算出你身边的住户。点任何人打个招呼。'],
  'circle.people': ['People', 'Orang', '人物'], 'circle.map': ['Map', 'Peta', '地图'],
  'story.renovating': ['Renovating', 'Ubah suai', '装修中'], 'story.sayHi': ['Say hi', 'Tegur', '打招呼'],
  'req.title': ['{n} request(s) to connect', '{n} permintaan untuk berhubung', '{n} 个联系请求'],
  'req.sub': ['From your lorong or block. You see their unit, not their name, until you accept.', 'Dari lorong atau blok anda. Anda nampak unit mereka, bukan nama, sehingga anda terima.', '来自同一条 lorong 或同一栋。接受之前只看得到门牌，看不到名字。'],
  'req.resident': ['Resident of {label}', 'Penghuni {label}', '{label} 的住户'],
  'sayhi.title': ['{n} neighbour(s) haven’t met you yet', '{n} jiran belum berkenalan dengan anda', '还有 {n} 位邻居没认识你'],
  'sayhi.sub': ['Send one friendly hello to all of them, in your language.', 'Hantar satu ucapan mesra kepada mereka semua, dalam bahasa anda.', '用你的语言，一次跟他们打个招呼。'],
  'section.nextDoor': ['Next door · your circle', 'Sebelah-menyebelah · bulatan anda', '隔壁 · 你的邻里圈'],
  'status.renovating': ['Renovating now · you got their notice', 'Sedang ubah suai · anda terima notis mereka', '正在装修 · 你已收到通知'],
  'status.known': ['You know each other', 'Anda sudah saling kenal', '你们已经认识'], 'status.notMet': ['Not met yet', 'Belum berkenalan', '还没认识'],
  'wave.off': ['Waves turned off', 'Lambaian dimatikan', '对方关闭了打招呼'],
  'section.ring2': ['On {place} · by request', 'Di {place} · melalui permintaan', '{place} · 需要请求'],
  'ring2.note': ['Not in your circle, so names stay private. Ask to connect with a reason; you can talk once they accept.', 'Bukan dalam bulatan anda, jadi nama dirahsiakan. Minta untuk berhubung dengan alasan; anda boleh berbual selepas mereka terima.', '不在你的邻里圈，所以名字保密。写原因请求联系，对方接受后才能聊天。'],
  'status.requested': ['Requested', 'Sudah diminta', '已请求'], 'status.wantsConnect': ['Wants to connect', 'Mahu berhubung', '想联系你'], 'status.closed': ['Closed', 'Ditutup', '已关闭'],
  'map.sub': ['Tap a home to see what you may do', 'Ketik rumah untuk lihat apa yang boleh dibuat', '点房子看你可以做什么'],
  'legend.you': ['You', 'Anda', '你'], 'legend.circle': ['Circle', 'Bulatan', '邻里圈'], 'legend.wall': ['Shared wall / slab', 'Dinding / lantai berkongsi', '共用墙／楼板'],
  'legend.works': ['Works you were told about', 'Kerja yang dimaklumkan', '通知过你的装修'],
  'map.privacy': ['Names show only for your circle and accepted contacts. Other homes show their unit number.', 'Nama hanya dipaparkan untuk bulatan dan kenalan yang diterima. Rumah lain menunjukkan nombor unit.', '只有邻里圈和已接受的联系人会显示名字，其他房子只显示门牌。'],
  'map.tap': ['Tap a home', 'Ketik sebuah rumah', '点一间房子'],
  'map.tapSub': ['Filled: your circle. Dashed: your lorong or block, by request. Plain: the rest of the township.', 'Berwarna: bulatan anda. Garis putus: lorong atau blok anda, melalui permintaan. Biasa: seluruh taman.', '实心：邻里圈。虚线：同一条 lorong 或同一栋，需要请求。空白：社区其他住户。'],
  'panel.you': ['This is you', 'Ini anda', '这是你'], 'panel.reads': ['reads {lang}', 'membaca {lang}', '阅读{lang}'],
  'badge.circle': ['Circle', 'Bulatan', '邻里圈'], 'badge.request': ['By request', 'Melalui permintaan', '需请求'], 'badge.township': ['Township', 'Taman', '社区'],
  'panel.renovating': ['Renovating now: you received their notice', 'Sedang ubah suai: anda telah menerima notis mereka', '正在装修：你已收到通知'],
  'panel.requestBtn': ['Request to connect', 'Minta untuk berhubung', '请求联系'],
  'panel.requested': ['Request sent · waiting for them to accept', 'Permintaan dihantar · menunggu diterima', '请求已发出，等待对方接受'],
  'panel.acceptTheirs': ['Accept their request', 'Terima permintaan mereka', '接受对方请求'], 'panel.closed': ['Request closed', 'Permintaan ditutup', '请求已关闭'],
  'panel.outside': ['Outside your lorong or block', 'Di luar lorong atau blok anda', '不在同一条 lorong 或同一栋'],
  'panel.far': ['Too far for direct contact. The estate office can pass a message on.', 'Terlalu jauh untuk hubungan terus. Pejabat estet boleh sampaikan mesej.', '距离太远，不能直接联系，可以请物业办公室转达。'],
  'panel.viewAs': ['View as this household (demo only)', 'Lihat sebagai isi rumah ini (demo sahaja)', '以这户的身份查看（仅演示）'],
  'profile.reads': ['Reads {lang}', 'Membaca {lang}', '阅读{lang}'], 'profile.wavedToday': ['Waved today', 'Sudah lambai hari ini', '今天已打招呼'],
  'profile.privacy': ['Their surname, phone number and email stay private. Numbers are exchanged only if you both agree.', 'Nama keluarga, nombor telefon dan e-mel mereka dirahsiakan. Nombor hanya ditukar jika anda berdua bersetuju.', '对方的姓氏、电话和电邮都保密，双方同意才会交换号码。'],
  'profile.viewAs': ['View as {name} (demo only)', 'Lihat sebagai {name} (demo sahaja)', '以 {name} 的身份查看（仅演示）'],
  'request.eyebrow': ['Request to connect', 'Minta untuk berhubung', '请求联系'], 'request.title': ['Ask the resident of {label}', 'Tanya penghuni {label}', '联系 {label} 的住户'],
  'request.s1': ['They see your unit ({label}) and your reason, not your name.', 'Mereka nampak unit anda ({label}) dan alasan anda, bukan nama anda.', '对方看得到你的门牌（{label}）和原因，看不到名字。'],
  'request.s2': ['If they accept, you can message each other and see names.', 'Jika mereka terima, anda boleh berbalas mesej dan melihat nama.', '对方接受后，你们可以互传讯息并看到名字。'],
  'request.s3': ['If they decline, you can’t ask again. Up to 3 requests a day.', 'Jika mereka menolak, anda tidak boleh minta lagi. Maksimum 3 permintaan sehari.', '对方拒绝就不能再发。每天最多 3 个请求。'],
  'reason.parking': ['Parking or access', 'Parkir atau laluan', '停车或出入'], 'reason.noise': ['Noise', 'Bising', '噪音'], 'reason.leak': ['Water leak or seepage', 'Bocor atau resapan air', '漏水或渗水'],
  'reason.delivery': ['Parcel or delivery', 'Bungkusan atau penghantaran', '包裹或快递'], 'reason.safety': ['Safety concern', 'Isu keselamatan', '安全问题'], 'reason.other': ['Something else', 'Lain-lain', '其他'],
  'request.placeholder': ['A short, polite reason, e.g. your lorry has been parked at my gate since 8am', 'Alasan ringkas dan sopan, cth. lori anda diletakkan di pagar saya sejak 8 pagi', '简短、礼貌的原因，例如：你的罗里从早上 8 点就停在我门口'],
  'request.send': ['Send request', 'Hantar permintaan', '发出请求'],
  'request.sent': ['Request sent to {label}. They’ll see your unit, not your name.', 'Permintaan dihantar kepada {label}. Mereka nampak unit anda, bukan nama.', '请求已发给 {label}，对方只看得到你的门牌。'],
  'request.declined': ['Request declined. They won’t be told why.', 'Permintaan ditolak. Mereka tidak diberitahu sebabnya.', '已拒绝，对方不会知道原因。'],
  'celebrate.wave': ['You waved at {name}', 'Anda melambai kepada {name}', '你跟 {name} 打了招呼'],
  'celebrate.hello': ['Hello sent', 'Ucapan dihantar', '招呼已送出'],
  'celebrate.connected': ['Connected with {label}', 'Berhubung dengan {label}', '已跟 {label} 建立联系'],

  // welcome
  'welcome.eyebrow': ['Welcome home', 'Selamat pulang', '欢迎回家'],
  'welcome.title': ['Hi {name}, meet your neighbours', 'Hai {name}, kenali jiran anda', '{name}，来认识你的邻居吧'],
  'welcome.body': ['{label} · keys received {date}. These {n} homes share a wall, a slab or a road with yours. A hello now makes everything easier later.', '{label} · kunci diterima {date}. {n} rumah ini berkongsi dinding, lantai atau jalan dengan rumah anda. Bertegur sapa sekarang memudahkan segalanya kemudian.', '{label} · {date} 交屋。这 {n} 户跟你共用墙、楼板或面对面。现在打个招呼，以后什么事都好商量。'],
  'welcome.later': ['Look around first', 'Lihat-lihat dahulu', '先看看'], 'welcome.hello': ['Say hello to them', 'Tegur mereka', '跟他们打招呼'],
  'welcome.hide': ['Don’t show this again', 'Jangan tunjuk lagi', '不再显示'],
  'welcome.privacy': ['Only these neighbours see your first name. Your phone number stays private.', 'Hanya jiran ini nampak nama pertama anda. Nombor telefon anda kekal rahsia.', '只有这些邻居看得到你的名字，你的电话号码保密。'],

  // introduce yourself
  'intro.steps.who': ['Who', 'Siapa', '对象'], 'intro.steps.message': ['Message', 'Mesej', '讯息'], 'intro.steps.share': ['What you share', 'Apa dikongsi', '分享哪些资料'],
  'intro.title': ['Say hello to your circle', 'Tegur bulatan anda', '跟邻里圈打招呼'],
  'intro.lead': ['Your circle is the homes that share a wall, a slab or a road frontage with you. Pick who to greet: those you haven’t met are ticked.', 'Bulatan anda ialah rumah yang berkongsi dinding, lantai atau hadapan jalan dengan anda. Pilih siapa yang mahu ditegur: yang belum dikenali sudah ditanda.', '邻里圈就是跟你共用墙、楼板或面对面的住户。选择要打招呼的人：还没认识的已经帮你勾好。'],
  'intro.met': ['already met', 'sudah kenal', '已认识'],
  'intro.further': ['Someone further along your lorong or block? Tap their home on the plan to send a contact request instead.', 'Seseorang lebih jauh di lorong atau blok anda? Ketik rumah mereka pada pelan untuk menghantar permintaan.', '想联系同一条 lorong 或同一栋更远的住户？在地图上点他们的房子发联系请求。'],
  'intro.language': ['Language', 'Bahasa', '语言'],
  'intro.replies': ['Each neighbour can reply with quick replies that arrive in your language.', 'Setiap jiran boleh membalas dengan balasan pantas yang sampai dalam bahasa anda.', '邻居可以用快捷回复，会自动翻成你的语言。'],
  'intro.editable': ['Message · you can edit it', 'Mesej · boleh disunting', '讯息 · 可以修改'],
  'intro.shared': ['Shared', 'Dikongsi', '会分享'], 'intro.sharedBody': ['Your first name, your unit and the language you read', 'Nama pertama, unit dan bahasa bacaan anda', '你的名字、门牌和阅读语言'],
  'intro.notShared': ['Not shared', 'Tidak dikongsi', '不会分享'], 'intro.notSharedBody': ['Your surname, phone number and email. Numbers are exchanged only if you both agree later', 'Nama keluarga, nombor telefon dan e-mel. Nombor hanya ditukar jika anda berdua bersetuju kemudian', '你的姓氏、电话和电邮。之后双方同意才会交换号码'],
  'intro.theyCan': ['They can', 'Mereka boleh', '对方可以'], 'intro.theyCanBody': ['Wave back, reply in Jiran5, or ignore it. Nothing is posted to a group', 'Membalas lambaian, membalas dalam Jiran5, atau mengabaikannya. Tiada apa disiarkan ke kumpulan', '回招呼、在 Jiran5 回复或忽略，不会发到群组'],
  'intro.consent': ['I agree to share my first name and unit with the {n} neighbour(s) I picked.', 'Saya setuju berkongsi nama pertama dan unit saya dengan {n} jiran yang saya pilih.', '我同意把名字和门牌分享给我选的 {n} 位邻居。'],
  'intro.selected': ['{n} of {m} selected', '{n} daripada {m} dipilih', '已选 {n}/{m}'],
  'intro.send': ['Send on WhatsApp', 'Hantar melalui WhatsApp', '通过 WhatsApp 发送'],
  'intro.sent': ['Sent to {n} neighbour(s) on WhatsApp', 'Dihantar kepada {n} jiran melalui WhatsApp', '已通过 WhatsApp 发给 {n} 位邻居'],

  // register renovation
  'reno.steps.type': ['Type of work', 'Jenis kerja', '工程类型'], 'reno.steps.who': ['Who is told', 'Siapa dimaklumkan', '通知谁'], 'reno.steps.when': ['When', 'Bila', '时间'],
  'reno.steps.approvals': ['Contractor & approvals', 'Kontraktor & kelulusan', '承包商与批准'], 'reno.steps.review': ['Review', 'Semak', '确认'],
  'reno.eyebrow': ['Register renovation', 'Daftar ubah suai', '登记装修'], 'reno.title': ['Tell everyone it affects, before you start', 'Maklumkan semua yang terjejas, sebelum bermula', '开工前，通知所有会受影响的人'],
  'works.wet': ['Bathroom, kitchen or plumbing', 'Bilik air, dapur atau paip', '浴室、厨房或水管'], 'works.wet.d': ['Water can leak downwards: the two floors below are told', 'Air boleh bocor ke bawah: dua tingkat di bawah dimaklumkan', '水会往下漏：会通知楼下两层'],
  'works.hacking': ['Hacking, drilling or removing tiles', 'Pecah, gerudi atau buang jubin', '打墙、钻孔或拆瓷砖'], 'works.hacking.d': ['Noise and vibration travel two floors up and down', 'Bunyi dan gegaran merebak dua tingkat ke atas dan ke bawah', '噪音和震动会传到上下两层'],
  'works.structural': ['Extension or structural change', 'Tambahan atau ubah struktur', '扩建或改动结构'], 'works.structural.d': ['Needs approval first (council, or JMB/MC in a strata building)', 'Perlu kelulusan dahulu (PBT, atau JMB/MC bagi bangunan strata)', '需要先获批准（地方政府，或分层大楼的 JMB/MC）'],
  'works.light': ['Painting or carpentry', 'Mengecat atau kerja kayu', '油漆或木工'], 'works.light.d': ['Quieter work: only the homes sharing a wall are told', 'Kerja lebih senyap: hanya rumah yang berkongsi dinding dimaklumkan', '较安静的工程：只通知共用墙的邻居'],
  'reno.describe': ['Describe the work', 'Terangkan kerja', '工程说明'],
  'reno.lead': ['These homes get the notice, a reminder to photograph their side before work starts, and a way to raise a concern.', 'Rumah ini akan menerima notis, peringatan untuk mengambil foto bahagian mereka sebelum kerja bermula, dan cara untuk meluahkan kebimbangan.', '这些住户会收到通知、开工前拍照的提醒，以及反映问题的管道。'],
  'reno.working': ['Working it out…', 'Sedang dikira…', '计算中…'], 'reno.hidden': ['Resident (name hidden)', 'Penghuni (nama dirahsiakan)', '住户（名字隐藏）'],
  'reno.none': ['No neighbouring homes for this type of work.', 'Tiada rumah jiran untuk jenis kerja ini.', '这类工程没有需要通知的邻居。'],
  'reno.noRemove': ['You can’t remove anyone. Everyone the work can affect is told, so nobody can say they weren’t warned.', 'Anda tidak boleh membuang sesiapa. Semua yang mungkin terjejas dimaklumkan, jadi tiada siapa boleh kata tidak diberi amaran.', '你不能删掉任何人。所有可能受影响的人都会收到通知，没有人可以说没被提醒。'],
  'reno.start': ['Start', 'Mula', '开工'], 'reno.end': ['End', 'Tamat', '完工'], 'reno.noisyFrom': ['Noisy work from', 'Kerja bising dari', '吵闹工程开始'], 'reno.noisyTo': ['Noisy work until', 'Kerja bising hingga', '吵闹工程结束'],
  'reno.weekends': ['No noisy work on weekends', 'Tiada kerja bising pada hujung minggu', '周末不做吵闹工程'],
  'reno.rules': ['House rules still apply: no work on Sundays or public holidays, contractor entry 08:00–18:00.', 'Peraturan rumah tetap terpakai: tiada kerja pada hari Ahad atau cuti umum, kontraktor masuk 08:00–18:00.', '屋规照常适用：周日和公共假期不施工，承包商 08:00–18:00 才能进入。'],
  'reno.contractor': ['Contractor', 'Kontraktor', '承包商'], 'reno.cidb': ['Contractor is CIDB-registered (check simulated in the prototype)', 'Kontraktor berdaftar dengan CIDB (semakan disimulasikan)', '承包商已在 CIDB 注册（原型中为模拟检查）'],
  'reno.jmb': ['Management (JMB/MC) approval', 'Kelulusan pengurusan (JMB/MC)', '管理机构（JMB/MC）批准'], 'reno.jmbApproved': ['Approved, deposit paid', 'Diluluskan, deposit dibayar', '已批准，已付押金'], 'reno.jmbPending': ['Submitted, waiting', 'Dihantar, menunggu', '已提交，等待中'],
  'reno.permit': ['Council (PBT) permit', 'Permit PBT', '地方政府（PBT）准证'], 'reno.permitApproved': ['Approved', 'Diluluskan', '已批准'], 'reno.permitApplied': ['Applied, waiting', 'Dipohon, menunggu', '已申请，等待中'],
  'reno.permitNone': ['Not needed for this work', 'Tidak perlu untuk kerja ini', '这项工程不需要'], 'reno.permitRef': ['Permit reference', 'Rujukan permit', '准证编号'],
  'reno.approvalFirst': ['Approval first', 'Kelulusan dahulu', '先取得批准'],
  'reno.blockedStrata': ['Structural work can only be registered once the JMB/MC has approved it.', 'Kerja struktur hanya boleh didaftarkan selepas JMB/MC meluluskannya.', '结构工程要等 JMB/MC 批准后才能登记。'],
  'reno.blockedTerrace': ['Structural work can only be registered once the council permit is approved.', 'Kerja struktur hanya boleh didaftarkan selepas permit PBT diluluskan.', '结构工程要等地方政府准证批准后才能登记。'],
  'reno.work': ['Work', 'Kerja', '工程'], 'reno.dates': ['Dates', 'Tarikh', '日期'], 'reno.noisy': ['Noisy work', 'Kerja bising', '吵闹时段'],
  'reno.notified': ['Notified', 'Dimaklumkan', '通知'], 'reno.homes': ['{n} home(s)', '{n} rumah', '{n} 户'], 'reno.approvals': ['Approvals', 'Kelulusan', '批准'],
  'reno.step': ['Step {n} of {m}', 'Langkah {n} daripada {m}', '第 {n}/{m} 步'], 'reno.send': ['Send notice', 'Hantar notis', '发送通知'],
  'reno.sent': ['Renovation notice sent to {n} home(s) and written to your home log', 'Notis ubah suai dihantar kepada {n} rumah dan direkodkan dalam log rumah anda', '装修通知已发给 {n} 户，并写进你的屋历'],
  'reason.left': ['Shares a wall', 'Berkongsi dinding', '共用墙'], 'reason.right': ['Shares a wall', 'Berkongsi dinding', '共用墙'],
  'reason.across-left': ['Across the road: noise, dust and lorries', 'Seberang jalan: bising, debu dan lori', '对面：噪音、灰尘和罗里'], 'reason.across-right': ['Across the road: noise, dust and lorries', 'Seberang jalan: bising, debu dan lori', '对面：噪音、灰尘和罗里'],
  'reason.across': ['Directly across the road: noise, dust and lorries', 'Betul-betul di seberang: bising, debu dan lori', '正对面：噪音、灰尘和罗里'],
  'reason.below_wet': ['Directly below: leak risk', 'Betul-betul di bawah: risiko bocor', '正楼下：漏水风险'], 'reason.below-2_wet': ['Two floors below: leaks can travel', 'Dua tingkat di bawah: kebocoran boleh merebak', '楼下两层：漏水可能蔓延'],
  'reason.above': ['Directly above: noise and vibration', 'Betul-betul di atas: bising dan gegaran', '正楼上：噪音和震动'], 'reason.above-2': ['Two floors up: noise travels through the frame', 'Dua tingkat di atas: bunyi merebak melalui struktur', '楼上两层：噪音经结构传上去'],
  'reason.below': ['Directly below: noise, vibration and leaks', 'Betul-betul di bawah: bising, gegaran dan kebocoran', '正楼下：噪音、震动和漏水'], 'reason.below-2': ['Two floors below: noise travels through the frame', 'Dua tingkat di bawah: bunyi merebak melalui struktur', '楼下两层：噪音经结构传下去'],

  // chats
  'chats.eyebrow': ['Chats', 'Sembang', '聊天'], 'chats.title': ['Neighbours', 'Jiran', '邻居'],
  'chats.privacy': ['Alerts arrive on WhatsApp. Your number stays private until you both agree.', 'Notifikasi sampai melalui WhatsApp. Nombor anda kekal rahsia sehingga anda berdua bersetuju.', '通知会从 WhatsApp 送达。双方同意之前，你的号码保密。'],
  'estate.name': ['Estate Office', 'Pejabat Estet', '物业办公室'], 'estate.full': ['Taman Demo Estate Office', 'Pejabat Estet Taman Demo', 'Taman Demo 物业办公室'],
  'estate.readonly': ['Official · read-only', 'Rasmi · baca sahaja', '官方 · 只能阅读'], 'estate.none': ['No notices yet', 'Belum ada notis', '还没有公告'],
  'estate.sub': ['Official notices for your {place} and the township', 'Notis rasmi untuk {place} anda dan seluruh taman', '给你的{place}和整个社区的官方公告'],
  'place.lorong': ['lorong', 'lorong', 'lorong'], 'place.blockWord': ['block', 'blok', '大楼'],
  'estate.verified': ['Verified account run by SDP’s estate team. Residents can’t post or reply here.', 'Akaun disahkan oleh pasukan estet SDP. Penduduk tidak boleh menyiar atau membalas di sini.', 'SDP 物业团队的认证帐号，住户不能在这里发文或回复。'],
  'audience.phase': ['Whole township', 'Seluruh taman', '整个社区'], 'audience.terrace': ['Jalan Demo 1', 'Jalan Demo 1', 'Jalan Demo 1'], 'audience.block': ['Block A', 'Blok A', 'A 栋'],
  'estate.footer': ['Only the estate office can post here. One-way, so no reply-all arguments.', 'Hanya pejabat estet boleh menyiar di sini. Sehala, jadi tiada pertengkaran balas-semua.', '只有物业办公室能发文。单向公告，不会出现群回吵架。'],
  'chats.blocked': ['Blocked', 'Disekat', '已封锁'], 'chats.sayHello': ['Say hello', 'Tegur', '打个招呼'],
  'chats.pick': ['Pick a neighbour', 'Pilih jiran', '选择一位邻居'],
  'chats.pickBody': ['Talk, agree on renovation hours, or raise a concern. Everything important is kept on record.', 'Berbual, setuju waktu ubah suai, atau luahkan kebimbangan. Semua perkara penting direkodkan.', '聊天、约定装修时间或反映问题，重要的事都会留下纪录。'],
  'thread.reads': ['Reads {lang}', 'Membaca {lang}', '阅读{lang}'], 'thread.wavedToday': ['You waved today', 'Anda sudah melambai hari ini', '今天已打过招呼'], 'thread.waveAt': ['Wave at {name}', 'Lambai kepada {name}', '跟 {name} 打招呼'],
  'thread.numbersShared': ['Numbers shared', 'Nombor dikongsi', '已交换号码'], 'thread.waiting': ['Waiting for {name}', 'Menunggu {name}', '等待 {name} 同意'],
  'thread.acceptExchange': ['Accept number exchange', 'Terima pertukaran nombor', '接受交换号码'], 'thread.exchange': ['Exchange numbers', 'Tukar nombor', '交换号码'],
  'thread.block': ['Block {name}', 'Sekat {name}', '封锁 {name}'], 'thread.unblock': ['Unblock {name}', 'Nyahsekat {name}', '解除封锁 {name}'],
  'thread.blockNote': ['Blocking is silent. Formal notices and concerns stay on record either way.', 'Sekatan dibuat secara senyap. Notis rasmi dan kebimbangan tetap direkodkan.', '封锁不会通知对方。正式通知和问题照样留下纪录。'],
  'thread.private': ['Private between you two. Notices, concerns and decisions are also written to both home logs.', 'Peribadi antara anda berdua. Notis, kebimbangan dan keputusan juga direkodkan dalam log rumah kedua-dua pihak.', '只有你们两人看得到。通知、问题和决定也会写进双方的屋历。'],
  'thread.empty': ['No messages yet. A quick 👋 goes a long way.', 'Belum ada mesej. Satu 👋 pun sudah bermakna.', '还没有讯息。一个 👋 就很有用。'],
  'thread.translated': ['Translated from {lang}', 'Diterjemah daripada {lang}', '译自{lang}'], 'thread.original': ['Original · {lang}', 'Asal · {lang}', '原文 · {lang}'],
  'thread.quick': ['Quick reply', 'Balasan pantas', '快捷回复'], 'thread.sentBy': ['sent by {who}', 'dihantar oleh {who}', '由 {who} 代发'],
  'thread.voiceExpired': ['Voice message deleted after 30 days', 'Mesej suara dipadam selepas 30 hari', '语音讯息已在 30 天后删除'],
  'thread.exchanged': ['Numbers exchanged', 'Nombor telah ditukar', '已交换号码'], 'thread.willAsk': ['{name} will be asked to agree', '{name} akan diminta bersetuju', '会请 {name} 同意'],
  'thread.blockedToast': ['{name} is blocked. They won’t be told.', '{name} disekat. Mereka tidak akan diberitahu.', '已封锁 {name}，对方不会知道。'],
  'thread.youBlocked':['You blocked {name}.', 'Anda menyekat {name}.', '你封锁了 {name}。'],
  'private.title': ['Keep contact details private', 'Rahsiakan butiran hubungan', '联系方式请保密'],
  'private.body': ['Please don’t put phone numbers, emails or links here. Exchange numbers in a chat when you both agree.', 'Jangan letak nombor telefon, e-mel atau pautan di sini. Tukar nombor dalam sembang apabila anda berdua bersetuju.', '这里不要写电话号码、电邮或链接。双方同意后，可以在聊天里交换号码。'],
  'official.title': ['Name not allowed', 'Nama tidak dibenarkan', '不能用这个名字'],
  'official.body': ['A name can’t look like SDP, the estate office or an official account.', 'Nama tidak boleh menyerupai SDP, pejabat estet atau akaun rasmi.', '名字不能像 SDP、物业办公室或官方帐号。'],
  'records.english': ['', 'Rekod rasmi kekal dalam Bahasa Inggeris, supaya SDP, kontraktor dan Tribunal Tuntutan Pembeli Rumah membaca rekod yang sama.', '正式纪录统一用英文，让 SDP、承包商和购屋者索偿审裁庭看到同一份内容。'],
  'thread.arrives': ['{name} receives: “{text}”', '{name} menerima: “{text}”', '{name} 收到的是：「{text}」'],
  'tone.title': ['Tone check', 'Semakan nada', '语气提醒'],
  'tone.body': ['This may come across as hostile. Try calmer words or a quick reply: messages stay on record and can be reported.', 'Ini mungkin kedengaran kasar. Cuba kata-kata yang lebih tenang atau balasan pantas: mesej direkodkan dan boleh dilaporkan.', '这样说可能会让人觉得有敌意。试试平和一点的说法或快捷回复：讯息会留下纪录，也可能被检举。'],
  'thread.concern': ['Raise a concern', 'Luahkan kebimbangan', '反映问题'], 'thread.placeholder': ['Message {name}…', 'Mesej kepada {name}…', '发讯息给 {name}…'],
  'thread.record': ['Record a voice message', 'Rakam mesej suara', '录语音讯息'], 'thread.recordTitle': ['Voice message (up to 1 minute)', 'Mesej suara (sehingga 1 minit)', '语音讯息（最长 1 分钟）'],
  'thread.recording': ['Recording… tap send when done', 'Merakam… ketik hantar apabila selesai', '录音中…完成后按发送'],
  'thread.foot': ['Quick replies arrive in {lang}. Typed and voice messages are sent as they are.', 'Balasan pantas sampai dalam {lang}. Mesej taip dan suara dihantar seperti asal.', '快捷回复会以{lang}送达；打字和语音照原样发送。'],
  'wave.mine': ['You waved at {name}', 'Anda melambai kepada {name}', '你跟 {name} 打了招呼'], 'wave.theirs': ['{name} waved at you', '{name} melambai kepada anda', '{name} 跟你打招呼'],
  'wave.back': ['Wave back', 'Balas lambaian', '回个招呼'], 'wave.backDone': ['You waved back', 'Anda sudah membalas', '你已回招呼'],
  'notice.intro': ['Introduction', 'Perkenalan', '自我介绍'], 'notice.reno': ['Renovation notice', 'Notis ubah suai', '装修通知'],
  'notice.mine': ['You sent this', 'Anda menghantar ini', '你发出的'], 'notice.theirs': ['Sent to you', 'Dihantar kepada anda', '发给你的'],
  'notice.jmb': ['JMB/MC', 'JMB/MC', 'JMB/MC'], 'notice.permit': ['Permit', 'Permit', '准证'], 'notice.approved': ['Approved', 'Diluluskan', '已批准'], 'notice.waiting': ['Waiting for approval', 'Menunggu kelulusan', '等待批准'],
  'permit.approved': ['Council permit approved', 'Permit PBT diluluskan', '地方政府准证已批准'], 'permit.applied': ['Council permit applied for', 'Permit PBT telah dipohon', '已申请地方政府准证'], 'permit.not_needed': ['No council permit needed', 'Tidak perlu permit PBT', '不需要地方政府准证'],
  'msg.report': ['Report this message', 'Laporkan mesej ini', '检举这则讯息'], 'msg.react': ['React', 'Reaksi', '回应'],
  'concern.eyebrow': ['Raise a concern', 'Luahkan kebimbangan', '反映问题'], 'concern.title': ['Tell {name} first', 'Beritahu {name} dahulu', '先告诉 {name}'],
  'concern.s1': ['{name} hears it privately, not in a group chat.', '{name} mendengarnya secara peribadi, bukan dalam sembang kumpulan.', '{name} 会私下收到，不是在群组里。'],
  'concern.s2': ['They reply or fix it. Most things end here.', 'Mereka membalas atau membetulkannya. Kebanyakan perkara selesai di sini.', '对方回复或处理，大部分事情到这里就解决了。'],
  'concern.s3': ['Still not sorted? Hand it to SDP’s estate team with the full record.', 'Masih belum selesai? Serahkan kepada pasukan estet SDP bersama rekod penuh.', '还是没解决？连同完整纪录交给 SDP 物业团队。'],
  'concern.about': ['About', 'Mengenai', '关于'],
  'cat.noise_hours': ['Noise outside the agreed hours', 'Bising di luar waktu yang dipersetujui', '在约定时间以外施工吵闹'], 'cat.debris': ['Debris, dust or blocked drains', 'Sisa binaan, debu atau longkang tersumbat', '建筑垃圾、灰尘或沟渠堵塞'],
  'cat.access': ['Blocked road, gate or parking', 'Jalan, pagar atau parkir dihalang', '挡住道路、门口或停车位'], 'cat.damage': ['Possible damage to my home', 'Kemungkinan kerosakan pada rumah saya', '我的房子可能受损'],
  'cat.workers': ['Workers’ behaviour or unregistered workers', 'Kelakuan pekerja atau pekerja tidak berdaftar', '工人行为或未注册工人'], 'cat.other': ['Something else', 'Lain-lain', '其他'],
  'concern.damageHint': ['For cracks or leaks, also use Evidence: it compares your pre-work photo and can open an SDP warranty ticket.', 'Untuk retak atau bocor, gunakan juga Bukti: ia membandingkan foto sebelum kerja dan boleh membuka tiket waranti SDP.', '裂缝或漏水请同时用「证据」：会对比开工前照片，也能开 SDP 保修单。'],
  'concern.placeholder': ['What happened, and when? e.g. drilling at 7.30pm on Tuesday', 'Apa berlaku, dan bila? cth. menggerudi pada 7.30 malam hari Selasa', '发生了什么、什么时候？例如：星期二晚上 7 点半还在钻墙'],
  'concern.send': ['Send to {name}', 'Hantar kepada {name}', '发给 {name}'], 'concern.sent': ['Sent privately to {name}', 'Dihantar secara peribadi kepada {name}', '已私下发给 {name}'],
  'report.eyebrow': ['Report a message', 'Laporkan mesej', '检举讯息'], 'report.voice': ['🎤 Voice message (the estate team can play it)', '🎤 Mesej suara (pasukan estet boleh memainkannya)', '🎤 语音讯息（物业团队可以播放）'],
  'report.harassment': ['Harassment or insults', 'Gangguan atau hinaan', '骚扰或辱骂'], 'report.threat': ['Threat or intimidation', 'Ugutan atau intimidasi', '威胁或恐吓'],
  'report.spam': ['Spam or selling', 'Spam atau jualan', '垃圾讯息或推销'], 'report.privacy': ['Shares someone’s private information', 'Mendedahkan maklumat peribadi orang lain', '泄露他人隐私'], 'report.other': ['Something else', 'Lain-lain', '其他'],
  'report.note': ['The estate team reviews reports within one working day. You can also block {name} from the ⋯ menu.', 'Pasukan estet menyemak laporan dalam satu hari bekerja. Anda juga boleh menyekat {name} melalui menu ⋯.', '物业团队会在一个工作天内审核。你也可以在 ⋯ 选单封锁 {name}。'],
  'report.send': ['Send report', 'Hantar laporan', '发出检举'], 'report.sent': ['Reported to the SDP estate team. {name} won’t know it was you.', 'Dilaporkan kepada pasukan estet SDP. {name} tidak akan tahu anda yang melaporkan.', '已检举给 SDP 物业团队，{name} 不会知道是你。'],

  // concern card
  'cc.kicker': ['Concern · {from} → {to}', 'Kebimbangan · {from} → {to}', '问题 · {from} → {to}'], 'cc.by': ['raised by {who}', 'dibangkitkan oleh {who}', '由 {who} 代为提出'],
  'cc.open': ['Waiting for reply', 'Menunggu balasan', '等待回复'], 'cc.acknowledged': ['Owner responded', 'Pemilik telah membalas', '屋主已回复'], 'cc.resolved': ['Sorted by neighbours', 'Diselesaikan oleh jiran', '邻居之间已解决'],
  'cc.escalated': ['With SDP estate team', 'Bersama pasukan estet SDP', '已交给 SDP 物业团队'], 'cc.closed_by_estate': ['Closed by estate team', 'Ditutup oleh pasukan estet', '物业团队已结案'],
  'cc.raised': ['Raised', 'Dibangkitkan', '已提出'], 'cc.replied': ['Owner replied', 'Pemilik membalas', '屋主已回复'], 'cc.estate': ['SDP estate team', 'Pasukan estet SDP', 'SDP 物业团队'], 'cc.sorted': ['Sorted', 'Selesai', '已解决'], 'cc.closed': ['Closed', 'Ditutup', '已结案'],
  'cc.estateSays': ['Estate team:', 'Pasukan estet:', '物业团队：'], 'cc.reminders': ['Estate team sent {n} reminder(s) to {label}', 'Pasukan estet menghantar {n} peringatan kepada {label}', '物业团队已提醒 {label} {n} 次'],
  'cc.replyPlaceholder': ['Reply to your neighbour (optional)', 'Balas kepada jiran anda (pilihan)', '回复邻居（可选）'], 'cc.reply': ['Reply & look into it', 'Balas & siasat', '回复并处理'], 'cc.sortedBtn': ['It’s sorted', 'Sudah selesai', '已经解决'],
  'cc.stillHappening': ['Still happening? You can still involve the estate team.', 'Masih berlaku? Anda masih boleh melibatkan pasukan estet.', '还在发生？你仍然可以请物业团队介入。'],
  'cc.notSorted': ['Not sorted? Hand it to SDP’s estate team. Everything above goes with it.', 'Belum selesai? Serahkan kepada pasukan estet SDP. Semua di atas akan disertakan.', '还没解决？交给 SDP 物业团队，上面的纪录会一起送过去。'],
  'cc.pilot': ['In a pilot: available after 24 h without a reply.', 'Dalam perintis: tersedia selepas 24 jam tanpa balasan.', '试点时：24 小时没有回复才能使用。'],
  'cc.escalate': ['Escalate to SDP estate team', 'Bawa kepada pasukan estet SDP', '升级给 SDP 物业团队'],
  'cc.estateNote': ['Note for both households (optional)', 'Nota untuk kedua-dua isi rumah (pilihan)', '给双方的备注（可选）'],
  'cc.remind': ['Remind owner of house rules', 'Ingatkan pemilik tentang peraturan', '提醒屋主遵守屋规'], 'cc.close': ['Close concern', 'Tutup kebimbangan', '结案'],
  'cc.toastReply': ['Reply sent', 'Balasan dihantar', '已回复'], 'cc.toastSorted': ['Marked as sorted', 'Ditanda selesai', '已标记解决'], 'cc.toastEscalated': ['Sent to the SDP estate team', 'Dihantar kepada pasukan estet SDP', '已交给 SDP 物业团队'],
  'cc.toastReminded': ['Reminder sent to {label}', 'Peringatan dihantar kepada {label}', '已提醒 {label}'], 'cc.toastClosed': ['Concern closed', 'Kebimbangan ditutup', '已结案'],

  // me
  'me.eyebrow': ['Me', 'Saya', '我'], 'me.title': ['Profile & privacy', 'Profil & privasi', '个人资料与隐私'],
  'me.subtitle': ['How your neighbours see you, and how reachable you want to be.', 'Bagaimana jiran melihat anda, dan sejauh mana anda mahu dihubungi.', '邻居看到的你，以及你愿意被联系到什么程度。'],
  'me.noBio': ['No bio yet', 'Belum ada bio', '还没有自我介绍'],
  'me.bioField': ['About you · one line, shown only to your circle and accepted contacts', 'Tentang anda · satu baris, hanya untuk bulatan dan kenalan anda', '关于你 · 一句话，只给邻里圈和已接受的联系人看'],
  'me.bioPlaceholder': ['e.g. Two kids and a cat. Say hi at the playground!', 'cth. Dua anak dan seekor kucing. Tegurlah di taman permainan!', '例如：两个小孩和一只猫，在游乐场见到请打招呼！'],
  'me.bioFoot': ['{n}/80 · Don’t share schedules, travel dates or your children’s school.', '{n}/80 · Jangan kongsi jadual, tarikh perjalanan atau sekolah anak anda.', '{n}/80 · 不要写作息、出远门日期或孩子的学校。'],
  'me.saved': ['Profile saved', 'Profil disimpan', '已保存'],
  'me.langField': ['Language you read · quick replies arrive translated into it', 'Bahasa bacaan · balasan pantas diterjemah ke bahasa ini', '阅读语言 · 快捷回复会翻成这个语言'], 'me.langSaved': ['Language updated', 'Bahasa dikemas kini', '已更新语言'],
  'me.reach': ['Who can reach you', 'Siapa boleh hubungi anda', '谁可以联系你'], 'me.reachSub': ['Change these any time. Safety notices always get through.', 'Tukar bila-bila masa. Notis keselamatan sentiasa sampai.', '随时可以更改，安全相关的通知一定会送达。'],
  'me.requests': ['Contact requests', 'Permintaan hubungan', '联系请求'], 'me.requestsSub': ['Homes on your lorong or block can ask to connect', 'Rumah di lorong atau blok anda boleh meminta untuk berhubung', '同一条 lorong 或同一栋的住户可以请求联系'],
  'me.waves': ['👋 Waves', '👋 Lambaian', '👋 打招呼'], 'me.wavesSub': ['A one-tap hello from your circle, at most once a day each', 'Ucapan sekali ketik daripada bulatan anda, paling banyak sekali sehari', '邻里圈的一键招呼，每人每天最多一次'],
  'me.quiet': ['Quiet mode', 'Mod senyap', '安静模式'], 'me.quietSub': ['No new messages, waves or requests. Renovation notices, concerns and estate notices still reach you', 'Tiada mesej, lambaian atau permintaan baharu. Notis ubah suai, kebimbangan dan notis estet tetap sampai', '不接收新讯息、招呼和请求；装修通知、问题和物业公告仍会送达'],
  'me.quietOn': ['Quiet mode on', 'Mod senyap dihidupkan', '已开启安静模式'], 'me.quietOff': ['Quiet mode off', 'Mod senyap dimatikan', '已关闭安静模式'],
  'me.see': ['What neighbours see', 'Apa yang jiran nampak', '邻居看得到什么'],
  'me.seeCircle': ['Your circle & contacts', 'Bulatan & kenalan anda', '邻里圈与联系人'], 'me.seeCircleBody': ['First name, unit, language and your one-line bio', 'Nama pertama, unit, bahasa dan bio satu baris', '名字、门牌、语言和一句自我介绍'],
  'me.seeOthers': ['Everyone else', 'Orang lain', '其他人'], 'me.seeOthersBody': ['Only your unit number. Never your name', 'Hanya nombor unit anda. Tidak sekali-kali nama anda', '只看得到门牌，永远看不到名字'],
  'me.seeNobody': ['Nobody', 'Tiada sesiapa', '没有人'], 'me.seeNobodyBody': ['Surname, phone, email, unless you both agree to exchange numbers', 'Nama keluarga, telefon, e-mel, kecuali anda berdua bersetuju menukar nombor', '姓氏、电话、电邮（除非双方同意交换号码）'],
  'me.blocked': ['Blocked', 'Disekat', '已封锁'], 'me.blockedSub': ['They aren’t told. Formal notices and concerns stay on record.', 'Mereka tidak diberitahu. Notis rasmi dan kebimbangan tetap direkodkan.', '对方不会知道，正式通知和问题照样留下纪录。'],
  'me.noneBlocked': ['Nobody blocked.', 'Tiada yang disekat.', '没有封锁任何人。'], 'me.unblocked': ['{name} is unblocked', '{name} dinyahsekat', '已解除封锁 {name}'],
  'me.shortcuts': ['Shortcuts', 'Pintasan', '捷径'], 'me.myLog': ['My home log', 'Log rumah saya', '我的屋历'], 'me.safe': ['How Jiran5 keeps you safe', 'Bagaimana Jiran5 melindungi anda', 'Jiran5 怎样保护你'],
  'me.welcomeAgain': ['Show the welcome again', 'Tunjuk sambutan semula', '再看一次欢迎画面'], 'me.sdp': ['SDP command view (demo)', 'Paparan kawalan SDP (demo)', 'SDP 管理后台（演示）'],
  'helpers.title': ['Family helpers', 'Pembantu keluarga', '家人代办'],
  'helpers.sub': ['Let a family member use Jiran5 for you. Everything they do is recorded under their name.', 'Benarkan ahli keluarga menggunakan Jiran5 untuk anda. Semua tindakan mereka direkodkan atas nama mereka.', '授权家人替你使用 Jiran5，他们做的每件事都会以他们的名字记录。'],
  'helpers.none': ['No helpers yet.', 'Belum ada pembantu.', '还没有代办人。'], 'helpers.max': ['Up to 2 helpers.', 'Sehingga 2 pembantu.', '最多 2 位。'],
  'helpers.name': ['Name', 'Nama', '名字'], 'helpers.relation': ['Relationship', 'Hubungan', '关系'],
  'relation.child': ['Son or daughter', 'Anak', '子女'], 'relation.spouse': ['Spouse', 'Pasangan', '配偶'], 'relation.sibling': ['Brother or sister', 'Adik-beradik', '兄弟姐妹'],
  'relation.caregiver': ['Caregiver', 'Penjaga', '看护'], 'relation.other': ['Other', 'Lain-lain', '其他'],
  'helpers.consent': ['I am the owner and I agree that {name} can act for my household.', 'Saya pemilik dan saya bersetuju {name} boleh bertindak bagi pihak isi rumah saya.', '我是屋主，同意 {name} 代表我的住户操作。'],
  'helpers.add': ['Add helper', 'Tambah pembantu', '新增代办人'], 'helpers.use': ['Use the app as {name}', 'Guna aplikasi sebagai {name}', '以 {name} 的身份使用'],
  'helpers.added': ['{name} can now help this household', '{name} kini boleh membantu isi rumah ini', '{name} 现在可以代办了'], 'helpers.removed': ['{name} removed', '{name} dibuang', '已移除 {name}'],
  'helpers.banner': ['You’re helping {owner} as {name}. Everything you do is recorded as done by {name}.', 'Anda membantu {owner} sebagai {name}. Semua tindakan direkodkan sebagai dibuat oleh {name}.', '你正以 {name} 的身份替 {owner} 操作，所有动作都会记录为 {name} 所做。'],
  'helpers.stop': ['Stop helping', 'Berhenti membantu', '结束代办'],
  'data.title': ['Your data', 'Data anda', '你的资料'],
  'data.sub': ['Under Malaysia’s Personal Data Protection Act you can see everything Jiran5 holds about you.', 'Di bawah Akta Perlindungan Data Peribadi Malaysia, anda boleh melihat semua data Jiran5 tentang anda.', '根据马来西亚个人资料保护法，你可以查看 Jiran5 保存的所有关于你的资料。'],
  'data.download': ['Download my data', 'Muat turun data saya', '下载我的资料'], 'data.downloading': ['Your data file is downloading', 'Fail data anda sedang dimuat turun', '正在下载你的资料'],
  'data.note': ['Other residents appear by unit only. Voice messages are deleted after 30 days.', 'Penduduk lain dipaparkan mengikut unit sahaja. Mesej suara dipadam selepas 30 hari.', '其他住户只以门牌显示；语音讯息会在 30 天后删除。'],
  'data.leave': ['Leaving Jiran5 removes your profile and chats; the home log stays with the unit as part of the property’s record. (Pilot)', 'Meninggalkan Jiran5 membuang profil dan sembang anda; log rumah kekal bersama unit sebagai rekod hartanah. (Perintis)', '退出 Jiran5 会删除你的资料和聊天；屋历会留在这间房子，作为房产纪录。（试点）'],

  // new SDP pages (nav only: the pages themselves are records screens, in English)
  'group.sdp': ['Sime Darby Property', 'Sime Darby Property', 'Sime Darby Property'],
  'nav.planner': ['Phase setup', 'Tetapan fasa', '新 phase 设定'], 'nav.planner.sub': ['Circles from the site plan', 'Bulatan daripada pelan tapak', '从平面图算出邻里圈'], 'nav.planner.short': ['Setup', 'Tetapan', '设定'],
  'nav.impact': ['Impact model', 'Model impak', '影响估算'], 'nav.impact.sub': ['Assumptions you can change', 'Andaian yang boleh diubah', '可以调整的假设'], 'nav.impact.short': ['Impact', 'Impak', '影响'],
  'nav.channels': ['Channels', 'Saluran', '触达管道'], 'nav.channels.sub': ['SDP App & WhatsApp', 'Aplikasi SDP & WhatsApp', 'SDP App 与 WhatsApp'], 'nav.channels.short': ['Channels', 'Saluran', '管道'],

  // households that haven't joined yet
  'nj.status': ['Not on Jiran5 yet', 'Belum menyertai Jiran5', '还没加入 Jiran5'],
  'nj.note': ['They haven’t joined yet, so their name stays private. The estate office gives them formal notices on paper.', 'Mereka belum menyertai, jadi nama mereka dirahsiakan. Pejabat estet menyampaikan notis rasmi secara bercetak.', '对方还没加入，所以名字保密。物业办公室会把正式通知印出来交给他们。'],
  'nj.story': ['Not joined', 'Belum sertai', '未加入'],
  'nj.paper': ['Not on Jiran5: the estate office delivers a paper notice', 'Belum di Jiran5: pejabat estet menghantar notis bercetak', '还没加入：由物业办公室送纸本通知'],
  'nj.welcome': ['{n} of these homes isn’t on Jiran5 yet. The estate office gives them your notices on paper.', '{n} daripada rumah ini belum di Jiran5. Pejabat estet menyampaikan notis anda secara bercetak.', '其中 {n} 户还没加入 Jiran5，物业办公室会把你的通知印出来交给他们。'],
  'cast.notJoined': ['Not joined yet', 'Belum menyertai', '还没加入'],

  // joining at handover
  'join.eyebrow': ['Welcome to {phase}', 'Selamat datang ke {phase}', '欢迎来到 {phase}'],
  'join.title': ['{label} isn’t on Jiran5 yet', '{label} belum menyertai Jiran5', '{label} 还没加入 Jiran5'],
  'join.lead': ['Your join code is in the welcome pack from SDP’s handover team. Scan the QR code, or ask the estate office for a new one.', 'Kod penyertaan anda ada dalam pek selamat datang daripada pasukan serah kunci SDP. Imbas kod QR, atau minta kod baharu di pejabat estet.', '加入码在 SDP 交屋团队给你的欢迎礼包里。扫描 QR 码，或到物业办公室领一个新的。'],
  'join.paste': ['Join code', 'Kod penyertaan', '加入码'], 'join.use': ['Use this code', 'Guna kod ini', '使用这个码'],
  'join.demo': ['Get a code from the front desk (demo)', 'Dapatkan kod dari kaunter (demo)', '向物业柜台领码（演示）'],
  'join.steps.home': ['Your home', 'Rumah anda', '你的家'], 'join.steps.you': ['You', 'Anda', '你'], 'join.steps.privacy': ['Privacy', 'Privasi', '隐私'],
  'join.homeTitle': ['{label} · {phase}', '{label} · {phase}', '{label} · {phase}'],
  'join.homeBody': ['{n} homes share a wall, a slab or a road with yours. Jiran5 introduces you to them, and keeps renovations and repairs fair and on record.', '{n} rumah berkongsi dinding, lantai atau jalan dengan rumah anda. Jiran5 memperkenalkan anda kepada mereka, dan memastikan ubah suai serta pembaikan adil dan direkodkan.', '有 {n} 户跟你共用墙、楼板或面对面。Jiran5 帮你认识他们，也让装修和维修公平、有纪录。'],
  'join.b1': ['Say hello and chat with the homes around you, in your language', 'Bertegur sapa dan berbual dengan jiran di sekeliling, dalam bahasa anda', '用你的语言，跟身边的住户打招呼、聊天'],
  'join.b2': ['Get renovation notices before work starts, and raise concerns privately', 'Terima notis ubah suai sebelum kerja bermula, dan luahkan kebimbangan secara peribadi', '开工前收到装修通知，可以私下反映问题'],
  'join.b3': ['Keep photo evidence and follow SDP repairs until you are satisfied', 'Simpan bukti foto dan ikuti pembaikan SDP sehingga anda berpuas hati', '保存照片证据，跟进 SDP 维修直到你满意'],
  'join.name': ['Name your neighbours will see', 'Nama yang dilihat jiran', '邻居看到的名字'],
  'join.nameHint': ['Your first name or what neighbours call you. No surname, phone number or email.', 'Nama pertama atau panggilan anda. Tanpa nama keluarga, nombor telefon atau e-mel.', '你的名字或邻居怎么称呼你。不要写姓氏、电话或电邮。'],
  'join.lang': ['Language you read', 'Bahasa bacaan anda', '你阅读的语言'],
  'join.easy': ['Easy mode: bigger text and buttons, fewer options', 'Mod mudah: teks dan butang lebih besar, pilihan lebih sedikit', '简易模式：字和按钮更大、选项更少'],
  'join.privacyTitle': ['How Jiran5 uses your information', 'Bagaimana Jiran5 menggunakan maklumat anda', 'Jiran5 怎样使用你的资料'],
  'join.p1t': ['What we keep', 'Apa yang kami simpan', '我们保存什么'],
  'join.p1': ['The name you chose, your unit, your language, your messages, photos you upload and your home log.', 'Nama pilihan anda, unit, bahasa, mesej, foto yang dimuat naik dan log rumah anda.', '你选的名字、门牌、语言、讯息、上传的照片和屋历。'],
  'join.p2t': ['Who sees what', 'Siapa nampak apa', '谁看得到什么'],
  'join.p2': ['Your circle sees your name. Others see only your unit number. Your phone number stays private unless you both agree.', 'Bulatan anda nampak nama anda. Orang lain hanya nampak nombor unit. Nombor telefon kekal rahsia kecuali anda berdua bersetuju.', '邻里圈看得到你的名字，其他人只看到门牌。除非双方同意，电话号码保密。'],
  'join.p3t': ['How long', 'Berapa lama', '保存多久'],
  'join.p3': ['Voice messages: 30 days. Records: the defect liability period plus one year. The home log stays with the unit.', 'Mesej suara: 30 hari. Rekod: tempoh liabiliti kecacatan ditambah satu tahun. Log rumah kekal bersama unit.', '语音：30 天。纪录：保修期再加一年。屋历跟着这间房子。'],
  'join.p4t': ['Your rights', 'Hak anda', '你的权利'],
  'join.p4': ['Download your data any time, correct it, or ask the estate office to close your account.', 'Muat turun data anda bila-bila masa, betulkannya, atau minta pejabat estet menutup akaun anda.', '随时下载、更正你的资料，或请物业办公室关闭帐户。'],
  'join.consent': ['I have read this privacy notice ({version}) and agree to it.', 'Saya telah membaca notis privasi ini ({version}) dan bersetuju.', '我已阅读这份隐私声明（{version}）并同意。'],
  'join.wa': ['Send me short alerts on WhatsApp (never the content of messages)', 'Hantar notifikasi ringkas melalui WhatsApp (tanpa isi mesej)', '用 WhatsApp 发简短通知给我（不会有讯息内容）'],
  'join.finish': ['Join Jiran5', 'Sertai Jiran5', '加入 Jiran5'],
  'join.done': ['Welcome to Jiran5, {name}!', 'Selamat datang ke Jiran5, {name}!', '{name}，欢迎加入 Jiran5！'],
  'join.expired': ['This join code isn’t valid any more. Ask the estate office for a new one.', 'Kod ini tidak sah lagi. Minta kod baharu di pejabat estet.', '这个加入码已失效，请到物业办公室领新的。'],
  'join.expires': ['Code valid until {date}, once', 'Kod sah sehingga {date}, sekali sahaja', '这个码在 {date} 前有效，只能用一次'],

  // easy mode and WhatsApp alerts
  'me.easy': ['Easy mode', 'Mod mudah', '简易模式'],
  'me.easySub': ['Bigger text and buttons, fewer options. Only you see this setting.', 'Teks dan butang lebih besar, pilihan lebih sedikit. Hanya anda nampak tetapan ini.', '字和按钮更大、选项更少，只有你看得到这个设定。'],
  'me.easyOn': ['Easy mode on', 'Mod mudah dihidupkan', '已开启简易模式'], 'me.easyOff': ['Easy mode off', 'Mod mudah dimatikan', '已关闭简易模式'],
  'me.wa': ['WhatsApp alerts', 'Notifikasi WhatsApp', 'WhatsApp 通知'],
  'me.waSub': ['Short alerts from the Jiran5 account. What neighbours write stays in Jiran5.', 'Notifikasi ringkas daripada akaun Jiran5. Apa yang ditulis jiran kekal dalam Jiran5.', '来自 Jiran5 帐号的简短通知，邻居写的内容留在 Jiran5。'],

  // paper notice (printed by the estate office)
  'paper.title': ['Renovation notice', 'Notis ubah suai', '装修通知'],
  'paper.to': ['To the residents of {label}', 'Kepada penghuni {label}', '致 {label} 的住户'],
  'paper.from': ['From {name} ({label}), who is renovating nearby', 'Daripada {name} ({label}), yang mengubah suai berhampiran', '来自在附近装修的 {name}（{label}）'],
  'paper.registered': ['Registered by {who}', 'Didaftarkan oleh {who}', '由 {who} 登记'],
  'paper.photo': ['Before work starts, take photos of your walls, ceiling and floor on the side facing the works. They protect you if anything changes.', 'Sebelum kerja bermula, ambil foto dinding, siling dan lantai di bahagian yang menghadap kerja. Foto ini melindungi anda jika ada perubahan.', '开工前，请拍下靠近工程那一边的墙、天花板和地板。万一有变化，这些照片能保护你。'],
  'paper.concern': ['Worried about noise, debris or damage? Tell the estate office: they will pass it on and keep a record.', 'Bimbang tentang bising, sisa binaan atau kerosakan? Beritahu pejabat estet: mereka akan menyampaikannya dan merekodkannya.', '担心噪音、垃圾或损坏？请告诉物业办公室，他们会转达并留下纪录。'],
  'paper.join': ['You can also join Jiran5 with the code in your SDP welcome pack, to get notices on your phone.', 'Anda juga boleh menyertai Jiran5 dengan kod dalam pek selamat datang SDP untuk menerima notis di telefon.', '你也可以用 SDP 欢迎礼包里的加入码加入 Jiran5，在手机上收通知。'],
  'paper.delivered': ['Delivered by the estate office', 'Dihantar oleh pejabat estet', '由物业办公室送达'],
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string

const IDX: Record<UiLang, number> = { en: 0, ms: 1, zh: 2 }

function translate(lang: UiLang, key: string, vars?: Record<string, string | number>): string {
  const entry = D[key]
  let text = entry ? entry[IDX[lang]] || entry[0] : key
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v))
  return text
}

/** A refusal the server explains with a code (tone, private, official), shown in the reader's language. */
export function refusal(e: unknown): string | null {
  return e instanceof ApiError && (e.code === 'tone' || e.code === 'private' || e.code === 'official') ? e.code : null
}

/** A translator fixed to one language, e.g. a printed notice in the recipient's language. */
export const tIn = (lang: UiLang): Translate => (k, v) => translate(lang, k, v)

/** English only: for the records screens and the SDP side, whatever the interface language. */
export const tEn: Translate = (k, v) => translate('en', k, v)

/** "Adam (child)" from the server, with the relationship in the reader's language. */
export function byWho(t: Translate, who: string): string {
  const m = /^(.*) \((child|spouse|sibling|caregiver|other)\)$/.exec(who)
  return m ? `${m[1]} (${t(`relation.${m[2]}`)})` : who
}

const LangContext = createContext<{ lang: UiLang; setLang: (l: UiLang) => void; t: Translate }>({
  lang: 'en', setLang: () => {}, t: (k, v) => translate('en', k, v),
})

const STORE = 'jiran5.uiLang'
function initial(): UiLang {
  try {
    const v = localStorage.getItem(STORE)
    return v === 'ms' || v === 'zh' ? v : 'en'
  } catch {
    return 'en'
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<UiLang>(initial)
  const setLang = useCallback((l: UiLang) => {
    set(l)
    try {
      localStorage.setItem(STORE, l)
    } catch {
      /* private window: not remembered */
    }
  }, [])
  const t = useCallback<Translate>((k, v) => translate(lang, k, v), [lang])
  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>
}

/** SDP-side screens that reuse a resident component (e.g. the renovation form at the front desk) stay in English. */
export function EnglishOnly({ children }: { children: ReactNode }) {
  const value = useMemo(() => ({ lang: 'en' as UiLang, setLang: () => {}, t: tEn }), [])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export const useLang = () => useContext(LangContext)
export const useT = () => useContext(LangContext).t
