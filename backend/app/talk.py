"""Neighbour messaging rules: translated quick replies, a tone check, and the concern categories.

Quick replies are pre-translated, so a message tapped in Malay arrives in the neighbour's own language
without any online translation service. Free-text messages are delivered as written.
"""

import re
from datetime import date

# Tamil ("ta") is a reading language for everything a resident receives (quick replies, alerts, notices). The screens
# themselves are in English, Malay and Chinese. The Tamil text was written with AI help and needs a native speaker's
# review before a pilot.
LANGS = ("en", "ms", "zh", "ta")
LANG_NAME = {"en": "English", "ms": "Bahasa Melayu", "zh": "中文", "ta": "தமிழ்"}

QUICK_REPLIES: dict[str, dict[str, str]] = {
    "welcome": {
        "en": "Welcome to the neighbourhood! Let us know if you need anything.",
        "ms": "Selamat datang ke kejiranan ini! Beritahu kami jika perlukan apa-apa.",
        "zh": "欢迎成为邻居！有需要随时告诉我们。",
        "ta": "எங்கள் அக்கம்பக்கத்துக்கு வரவேற்கிறோம்! ஏதாவது தேவைப்பட்டால் சொல்லுங்கள்.",
    },
    "thanks_notice": {
        "en": "Thanks for letting us know in advance.",
        "ms": "Terima kasih kerana memaklumkan lebih awal.",
        "zh": "谢谢你提前通知。",
        "ta": "முன்கூட்டியே தெரிவித்ததற்கு நன்றி.",
    },
    "noted": {
        "en": "Noted, no problem at all.",
        "ms": "Baik, tiada masalah.",
        "zh": "收到，没问题。",
        "ta": "சரி, எந்தப் பிரச்சினையும் இல்லை.",
    },
    # A thank-you, not a request: the notice has usually already planned its noisy hours around this nap (seed.py
    # QUIET_TIMES), and the same reply is offered in every thread, so it must read well either way.
    "quiet_nap": {
        "en": "Our baby naps 1–3pm. Thanks for keeping the noisiest work outside those hours!",
        "ms": "Bayi kami tidur antara 1–3 petang. Terima kasih kerana mengelakkan kerja paling bising pada waktu itu!",
        "zh": "我们的宝宝下午1点到3点午睡。谢谢你把最吵的工作避开那段时间！",
        "ta": "எங்கள் குழந்தை மதியம் 1–3 மணிக்குத் தூங்கும். அதிக சத்தமான வேலையை அந்த நேரத்தில் தவிர்த்ததற்கு நன்றி!",
    },
    "parking": {
        "en": "Could the contractor's lorry avoid blocking our gate? Thanks!",
        "ms": "Boleh minta lori kontraktor tidak menghalang pagar rumah kami? Terima kasih!",
        "zh": "可以请承包商的罗里不要挡住我们的门口吗？谢谢！",
        "ta": "ஒப்பந்ததாரரின் லாரி எங்கள் வாசலை மறைக்காமல் நிறுத்த முடியுமா? நன்றி!",
    },
    "will_fix": {
        "en": "Sorry about that, we'll sort it out today.",
        "ms": "Maaf ya, kami akan selesaikan hari ini.",
        "zh": "不好意思，我们今天会处理好。",
        "ta": "மன்னிக்கவும், இன்றே சரிசெய்து விடுகிறோம்.",
    },
    "check_together": {
        "en": "Shall we check the wall together this weekend?",
        "ms": "Jom periksa dinding bersama-sama hujung minggu ini?",
        "zh": "这个周末我们一起看看墙好吗？",
        "ta": "இந்த வார இறுதியில் சுவரை ஒன்றாகப் பார்க்கலாமா?",
    },
}

CONCERN_CATEGORIES: dict[str, str] = {
    "noise_hours": "Noise outside the agreed hours",
    "debris": "Debris, dust or blocked drains",
    "access": "Blocked road, gate or parking",
    "damage": "Possible damage to my home",
    "workers": "Workers' behaviour or unregistered workers",
    "other": "Something else",
}

REPORT_REASONS = ("harassment", "threat", "spam", "privacy", "other")

# Obvious insults are refused outright, before any AI look. The aim is to catch abuse, not to police tone, so the list
# holds words that are abuse almost wherever they appear, in the languages Malaysian neighbours actually type: English
# and Manglish, romanised Hokkien and Cantonese, Malay, Chinese. Words that are also ordinary (die, mati, 滚, 草, 妈)
# are matched only in the shapes that are abuse ("go die", "kau mati", "滚开", 草 on its own), so a complaint about
# dust killing the plants, a dead light or a neighbour's mother's car still goes through (tests/test_talk.py keeps
# both lists honest). Tamil has no entries yet: it needs a native speaker. With AI on, Claude's own judgement of abuse
# in any language is the second net (ai.MessageCheck.insult); reports to SDP remain the third.
_HOSTILE = [
    # English and Manglish
    r"\bidiot\w*", r"\bstupid\b", r"\bmoron\w*", r"\bshut up\b", r"\bbastard\w*", r"\bbitch\w*", r"\bretard\w*",
    r"\bdumb(ass)?\b", r"\bass(hole|wipe)?s?\b", r"\bloser\b", r"\bscum\b", r"\bjerk\b", r"\bcunt\b", r"\bdickhead\b",
    r"\bwanker\b", r"\bpsycho\b",
    r"\bf+[u*@#]+c*k+\w*", r"\bfk(ing|in|s)?\b", r"\bmotherf\w*", r"\bshit\w*", r"\bbull\s?shit\b", r"\bwtf\b", r"\bstfu\b",
    r"\bgtfo\b", r"\bscrew (you|u|off)\b", r"\bpiss off\b", r"\bbugger off\b", r"\bsod off\b",
    r"\bgo (and |n )?die\b", r"\byou (can |should |will |all |better )?(go )?die\b", r"^\W*die+\W*$",
    r"\bgo to hell\b", r"\brot in hell\b", r"\bdrop dead\b", r"\b(kill|whack|beat up|hit|punch) (you|u)\b",
    # romanised Hokkien and Cantonese, as typed in Malaysia
    r"\bsoh?hai\b", r"\bkan? ?ni+ ?na+\b", r"\bknn\b", r"\bkns\b", r"\bkana ?sai\b", r"\bc(i|hi|hee)\s?b(ai|ye)\b",
    r"\bccb\b", r"\blan\s?jiao\b", r"\bdiu\b", r"\bna\s?bei\b",
    # Malay
    r"\bbodoh?\b", r"\bbabi\b", r"\bsial(an)?\b", r"\bcelaka\b", r"\bbangang\b", r"\bbengap\b", r"\bbangsat\b",
    r"\bpuki\w*", r"\bkimak\b", r"\bpantat\b", r"\bbutoh\b", r"\btolol\b", r"\bdungu\b", r"\bbahlul\b", r"\bbengong\b",
    r"\bgoblok\b", r"\bsengal\b", r"\bmampus\b", r"\b(kau|ko|engkau|awak|lu|hang|kamu) (pergi )?mati\b",
    r"\botak udang\b", r"\bkepala (otak|hotak|bapak|butoh)\b", r"\blahanat\b", r"\blaknat\b", r"\bjahanam\b",
    r"\bharam jadah\b", r"\bsundal\b", r"\bpelacur\b", r"\bjalang\b",
    # Chinese: no word boundaries, so each entry must be abuse wherever it appears (妈的 only when nothing precedes it,
    # so 我妈的车 goes through; 他妈妈 and 你妈妈 never match)
    "白痴", "笨蛋", "去死", "找死", "死全家", "全家死", "混蛋", "王八蛋", "吃屎", "神经病", "傻逼", "傻b", "傻比", "煞笔",
    "沙比", "脑残", "智障", "弱智", "白目", "蠢货", "蠢蛋", "蠢猪", "笨猪", "死猪", "贱人", "贱货", "婊子", "畜生", "禽兽",
    "狗东西", "变态", "垃圾人", "脑子有病",
    r"(?<![一-鿿])妈的", "他妈的", "你妈的", "尼玛", "妈逼", "操你", "草你", "草泥马", "艹", "肏", "屌你",
    "靠北", "靠腰", "靠杯", "靠夭", "仆街", "扑街", "冚家", "戇鳩", "戆鸠", "痴线", "黐线", "柒头",
    r"滚(开|蛋|出去|啦|吧|远)", "给我滚", r"^\W*草+\W*$",
]
_HOSTILE_RE = re.compile("|".join(_HOSTILE), re.IGNORECASE)


def tone_problem(text: str) -> bool:
    return bool(_HOSTILE_RE.search(text))


# Phone numbers (Malaysian mobiles, or any long run of digits), emails and links. Used on text other residents see
# without a chat (bio, helper names), so numbers are still exchanged only when both households agree.
_CONTACT_RE = re.compile(
    r"(?<!\d)(?:\+?60|0)1\d(?:[\s-]?\d){7,8}(?!\d)|\d{9,}|[\w.+-]+@[\w-]+\.[\w.]+|https?://|www\.|"
    r"\b[\w-]+\.(?:com|my|net|org|io|me|ly|link)\b",
    re.IGNORECASE,
)


def contact_details(text: str) -> bool:
    return bool(_CONTACT_RE.search(text))


# Names a family helper must not use, so nobody can pose as SDP, the estate office or the authorities.
_OFFICIAL_RE = re.compile(r"\b(?:sdp|sime\s*darby|estate|official|admin(?:istrator)?|keynection|management|jmb|polis|police|pengurusan)\b|物业|管理|官方",
                          re.IGNORECASE)


def official_sounding(text: str) -> bool:
    return bool(_OFFICIAL_RE.search(text))


def quick_text(key: str, lang: str) -> str:
    return QUICK_REPLIES[key].get(lang) or QUICK_REPLIES[key]["en"]


# ---------- WhatsApp alerts ----------
# Pre-approved message templates (WhatsApp Business only allows approved templates for alerts), one per language.
# Chat alerts never carry the message itself: the conversation stays in Keynection.
CATEGORY_LABELS: dict[str, dict[str, str]] = {
    "noise_hours": {
        "en": "noise outside the agreed hours",
        "ms": "bising di luar waktu yang dipersetujui",
        "zh": "在约定时间以外施工吵闹",
        "ta": "ஒப்புக்கொண்ட நேரத்துக்கு வெளியே சத்தம்",
    },
    "debris": {
        "en": "debris, dust or blocked drains",
        "ms": "sisa binaan, debu atau longkang tersumbat",
        "zh": "建筑垃圾、灰尘或沟渠堵塞",
        "ta": "கட்டுமானக் கழிவு, தூசி அல்லது அடைபட்ட வடிகால்",
    },
    "access": {
        "en": "blocked road, gate or parking",
        "ms": "jalan, pagar atau parkir dihalang",
        "zh": "挡住道路、门口或停车位",
        "ta": "மறிக்கப்பட்ட சாலை, வாசல் அல்லது வாகன நிறுத்தம்",
    },
    "damage": {
        "en": "possible damage to their home",
        "ms": "kemungkinan kerosakan pada rumah mereka",
        "zh": "对方的房子可能受损",
        "ta": "அவர்களின் வீட்டுக்குச் சேதம் ஏற்பட்டிருக்கலாம்",
    },
    "workers": {
        "en": "workers' behaviour",
        "ms": "kelakuan pekerja",
        "zh": "工人行为",
        "ta": "தொழிலாளர்களின் நடத்தை",
    },
    "other": {
        "en": "something else",
        "ms": "perkara lain",
        "zh": "其他问题",
        "ta": "வேறு ஏதாவது",
    },
}

WA_TEMPLATES: dict[str, dict[str, str]] = {
    "reno": {
        # {contractor} is contractor_note(): a sentence when the owner named one, nothing otherwise.
        "en": "Renovation notice from {name} ({label}): {scope}, {start} to {end}. Noisy work: {hours}.{quiet}{contractor} "
              "Please photograph your side before work starts. If anything worries you, reply in Keynection.",
        "ms": "Notis ubah suai daripada {name} ({label}): {scope}, {start} hingga {end}. Kerja bising: {hours}.{quiet}{contractor} "
              "Sila ambil foto bahagian rumah anda sebelum kerja bermula. Jika ada kebimbangan, balas dalam Keynection.",
        "zh": "{name}（{label}）的装修通知：{scope}，{start} 至 {end}。吵闹时段：{hours}。{quiet}{contractor}"
              "开工前请先拍下你那一边的照片。有任何担心，请在 Keynection 回复。",
        "ta": "{name} ({label}) அனுப்பிய புதுப்பிப்பு அறிவிப்பு: {scope}, {start} முதல் {end} வரை. சத்தமான வேலை: {hours}.{quiet}{contractor} "
              "வேலை தொடங்கும் முன் உங்கள் பக்கத்தைப் படம் எடுத்து வையுங்கள். ஏதாவது கவலை இருந்தால், Keynection-இல் பதில் அனுப்புங்கள்.",
    },
    "hello": {
        "en": "{name} from {label} said hello on Keynection 👋",
        "ms": "{name} dari {label} menyapa anda di Keynection 👋",
        "zh": "{label} 的 {name} 在 Keynection 跟你打招呼 👋",
        "ta": "{label}-இல் வசிக்கும் {name} Keynection-இல் உங்களுக்கு வணக்கம் சொன்னார் 👋",
    },
    "message": {
        "en": "New message from {name} ({label}). Open Keynection to read it.",
        "ms": "Mesej baharu daripada {name} ({label}). Buka Keynection untuk membacanya.",
        "zh": "{name}（{label}）传来新讯息，请打开 Keynection 查看。",
        "ta": "{name} ({label}) புதிய செய்தி அனுப்பியுள்ளார். படிக்க Keynection-ஐத் திறக்கவும்.",
    },
    "voice": {
        "en": "New voice message from {name} ({label}). Open Keynection to listen.",
        "ms": "Mesej suara baharu daripada {name} ({label}). Buka Keynection untuk mendengarnya.",
        "zh": "{name}（{label}）传来语音讯息，请打开 Keynection 收听。",
        "ta": "{name} ({label}) புதிய குரல் செய்தி அனுப்பியுள்ளார். கேட்க Keynection-ஐத் திறக்கவும்.",
    },
    "wave": {
        "en": "{name} ({label}) waved at you 👋",
        "ms": "{name} ({label}) melambai kepada anda 👋",
        "zh": "{name}（{label}）跟你打招呼 👋",
        "ta": "{name} ({label}) உங்களுக்குக் கை அசைத்தார் 👋",
    },
    "request": {
        "en": "A resident of {label} asked to connect. Open Keynection to accept or decline.",
        "ms": "Penghuni {label} ingin berhubung. Buka Keynection untuk terima atau tolak.",
        "zh": "{label} 的住户想联系你，请打开 Keynection 接受或拒绝。",
        "ta": "{label}-இல் வசிப்பவர் உங்களுடன் தொடர்பு கொள்ள விரும்புகிறார். ஏற்க அல்லது மறுக்க Keynection-ஐத் திறக்கவும்.",
    },
    "concern_new": {
        "en": "A neighbour ({label}) raised a concern about your renovation: {category}. Please reply in Keynection.",
        "ms": "Jiran ({label}) meluahkan kebimbangan tentang ubah suai anda: {category}. Sila balas dalam Keynection.",
        "zh": "邻居（{label}）对你的装修提出问题：{category}。请在 Keynection 回复。",
        "ta": "அண்டை வீட்டார் ({label}) உங்கள் புதுப்பிப்பு வேலை பற்றி ஒரு கவலையைத் தெரிவித்துள்ளார்: {category}. "
              "Keynection-இல் பதில் அனுப்புங்கள்.",
    },
    "concern_reply": {
        "en": "{name} ({label}) replied to your concern. Open Keynection to see it.",
        "ms": "{name} ({label}) telah membalas kebimbangan anda. Buka Keynection untuk melihatnya.",
        "zh": "{name}（{label}）回复了你提出的问题，请打开 Keynection 查看。",
        "ta": "{name} ({label}) உங்கள் கவலைக்குப் பதில் அனுப்பியுள்ளார். பார்க்க Keynection-ஐத் திறக்கவும்.",
    },
    "concern_sorted": {
        "en": "{name} ({label}) marked your concern as sorted. Still happening? You can involve the estate team in Keynection.",
        "ms": "{name} ({label}) menandakan kebimbangan anda sebagai selesai. "
              "Masih berlaku? Anda boleh melibatkan pasukan estet dalam Keynection.",
        "zh": "{name}（{label}）把你的问题标记为已解决。还在发生？可以在 Keynection 请物业团队介入。",
        "ta": "{name} ({label}) உங்கள் கவலை தீர்ந்தது எனக் குறித்துள்ளார். "
              "இன்னும் நடக்கிறதா? Keynection-இல் நிர்வாகக் குழுவின் உதவியைக் கேட்கலாம்.",
    },
    "concern_estate_raiser": {
        "en": "Your concern is now with the SDP estate team. They aim to reply within one working day.",
        "ms": "Kebimbangan anda kini bersama pasukan estet SDP. Mereka cuba membalas dalam satu hari bekerja.",
        "zh": "你的问题已交给 SDP 物业团队，他们会尽量在一个工作天内回复。",
        "ta": "உங்கள் கவலை இப்போது SDP நிர்வாகக் குழுவிடம் உள்ளது. ஒரு வேலை நாளுக்குள் பதில் அளிக்க முயல்வார்கள்.",
    },
    "concern_estate_owner": {
        "en": "A concern about your renovation was passed to the SDP estate team. Everything already said goes with it.",
        "ms": "Satu kebimbangan tentang ubah suai anda telah diserahkan kepada pasukan estet SDP, bersama rekod penuh.",
        "zh": "一个关于你装修的问题已交给 SDP 物业团队，之前的纪录会一起送过去。",
        "ta": "உங்கள் புதுப்பிப்பு வேலை பற்றிய ஒரு கவலை SDP நிர்வாகக் குழுவிடம் ஒப்படைக்கப்பட்டது. "
              "இதுவரை சொல்லப்பட்ட அனைத்தும் அதனுடன் செல்லும்.",
    },
    "concern_closed": {
        "en": "The SDP estate team closed a concern: {note}",
        "ms": "Pasukan estet SDP menutup satu kebimbangan: {note}",
        "zh": "SDP 物业团队已结案：{note}",
        "ta": "SDP நிர்வாகக் குழு ஒரு கவலையை முடித்து வைத்தது: {note}",
    },
    "notice": {
        "en": "Estate office notice: {title}. {body}",
        "ms": "Notis pejabat estet: {title}. {body}",
        "zh": "物业办公室公告：{title}。{body}",
        "ta": "நிர்வாக அலுவலக அறிவிப்பு: {title}. {body}",
    },
    "reno_photo": {
        "en": "Works at {label} start on {start}. Please photograph your side now: before photos protect you if anything changes.",
        "ms": "Kerja di {label} bermula pada {start}. Sila ambil foto bahagian anda sekarang: foto sebelum kerja melindungi anda "
              "jika ada perubahan.",
        "zh": "{label} 的工程 {start} 开工。请现在拍下你那一边：开工前的照片能在有变化时保护你。",
        "ta": "{label}-இல் வேலை {start} அன்று தொடங்குகிறது. உங்கள் பக்கத்தை இப்போதே படம் எடுங்கள்: ஏதாவது மாறினால் "
              "வேலைக்கு முந்தைய படங்கள் உங்களைப் பாதுகாக்கும்.",
    },
    "reno_done": {
        "en": "The works at {label} ended on {end}. Is everything on your side as before? If something changed, compare it "
              "with your before photo in Keynection.",
        "ms": "Kerja di {label} tamat pada {end}. Adakah semuanya di bahagian anda seperti dahulu? Jika ada perubahan, "
              "bandingkan dengan foto sebelum kerja dalam Keynection.",
        "zh": "{label} 的工程已在 {end} 完工。你那一边一切都跟以前一样吗？如果有变化，可以在 Keynection 跟开工前的照片对比。",
        "ta": "{label}-இல் வேலை {end} அன்று முடிந்தது. உங்கள் பக்கம் எல்லாம் முன்பு போலவே உள்ளதா? ஏதாவது மாறியிருந்தால், "
              "Keynection-இல் வேலைக்கு முந்தைய படத்துடன் ஒப்பிடுங்கள்.",
    },
    "reno_done_owner": {
        "en": "Your works ended on {end}. Your neighbours have been asked whether anything changed on their side; any answer "
              "comes to you in Keynection.",
        "ms": "Kerja anda tamat pada {end}. Jiran anda telah ditanya sama ada apa-apa berubah di bahagian mereka; sebarang "
              "jawapan akan sampai kepada anda dalam Keynection.",
        "zh": "你的工程已在 {end} 完工。系统已问过邻居他们那一边有没有变化；有回复会在 Keynection 通知你。",
        "ta": "உங்கள் வேலை {end} அன்று முடிந்தது. அண்டைவீட்டாரிடம் அவர்கள் பக்கம் ஏதாவது மாறியதா என்று "
              "கேட்கப்பட்டுள்ளது; பதில் வந்தால் Keynection-இல் உங்களுக்குத் தெரியும்.",
    },
    "repair": {
        "en": "SDP says the repair is done ({subject}). Please check it and confirm in Keynection: only you can close the ticket.",
        "ms": "SDP memaklumkan pembaikan telah siap ({subject}). Sila semak dan sahkan dalam Keynection: "
              "hanya anda boleh menutup tiket.",
        "zh": "SDP 表示维修已完成（{subject}）。请检查后在 Keynection 确认：只有你能关闭这张单。",
        "ta": "பழுதுபார்ப்பு முடிந்ததாக SDP தெரிவிக்கிறது ({subject}). சரிபார்த்து Keynection-இல் உறுதிப்படுத்துங்கள்: "
              "இந்தப் பதிவை நீங்கள் மட்டுமே மூட முடியும்.",
    },
}

WA_BUTTONS: dict[str, dict[str, str]] = {
    "open": {
        "en": "Open Keynection",
        "ms": "Buka Keynection",
        "zh": "打开 Keynection",
        "ta": "Keynection-ஐத் திற",
    },
    "concern": {
        "en": "Raise a concern",
        "ms": "Luahkan kebimbangan",
        "zh": "反映问题",
        "ta": "கவலையைத் தெரிவி",
    },
    "wave": {
        "en": "Wave back",
        "ms": "Balas lambaian",
        "zh": "回个招呼",
        "ta": "பதிலுக்குக் கை அசை",
    },
    "accept": {
        "en": "Accept",
        "ms": "Terima",
        "zh": "接受",
        "ta": "ஏற்றுக்கொள்",
    },
    "photo": {
        "en": "Take photos",
        "ms": "Ambil foto",
        "zh": "去拍照",
        "ta": "படம் எடு",
    },
    "all_good": {
        "en": "All good",
        "ms": "Semua baik",
        "zh": "一切正常",
        "ta": "எல்லாம் சரி",
    },
    "changed": {
        "en": "Something changed",
        "ms": "Ada perubahan",
        "zh": "有变化",
        "ta": "ஏதோ மாறியது",
    },
}

# Whether a renovation notice's noisy hours keep clear of the reader's quiet times (fixed when the notice is sent).
QUIET_NOTE: dict[str, dict[str, str]] = {
    "avoided": {"en": " These hours avoid your quiet time.", "ms": " Waktu bising ini mengelak waktu senyap anda.",
                "zh": "吵闹时段已避开你的安静时间。", "ta": " இந்த நேரம் உங்கள் அமைதி நேரத்தைத் தவிர்க்கிறது."},
    "overlap": {"en": " These hours overlap your quiet time; reply in Keynection to ask.",
                "ms": " Waktu bising ini bertembung dengan waktu senyap anda; balas dalam Keynection untuk bertanya.",
                "zh": "吵闹时段和你的安静时间重叠，可以在 Keynection 回复询问。",
                "ta": " இந்த நேரம் உங்கள் அமைதி நேரத்துடன் மோதுகிறது; Keynection-இல் பதில் அனுப்பிக் கேளுங்கள்."},
}


# Dates and noisy-work hours inside an alert, in the reader's language. The English text stored with the notice
# stays as the record; these are built from its fields.
_MONTHS = {
    "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "ms": ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"],
    "ta": ["ஜன.", "பிப்.", "மார்.", "ஏப்.", "மே", "ஜூன்", "ஜூலை", "ஆக.", "செப்.", "அக்.", "நவ.", "டிச."],
}

HOURS: dict[str, dict[str, str]] = {
    "weekdays": {"en": "weekdays {start}–{end}, no weekends", "ms": "hari bekerja {start}–{end}, tiada hujung minggu",
                 "zh": "平日 {start}–{end}，周末不施工", "ta": "வார நாட்களில் {start}–{end}, வார இறுதியில் இல்லை"},
    "mon_sat": {"en": "Mon–Sat {start}–{end}", "ms": "Isnin–Sabtu {start}–{end}", "zh": "星期一至六 {start}–{end}",
                "ta": "திங்கள்–சனி {start}–{end}"},
}


def date_text(iso: str, lang: str) -> str:
    d = date.fromisoformat(iso)
    if lang == "zh":
        return f"{d.year}年{d.month}月{d.day}日"
    return f"{d.day} {_MONTHS.get(lang, _MONTHS['en'])[d.month - 1]} {d.year}"


QUIET_BREAK = {"en": "quiet {start}–{end}", "ms": "senyap {start}–{end}", "zh": "{start}–{end} 不吵", "ta": "{start}–{end} அமைதி"}


def hours_text(reno: dict, lang: str) -> str:
    key = "weekdays" if reno.get("weekdays_only", True) else "mon_sat"
    template = HOURS[key].get(lang) or HOURS[key]["en"]
    text = template.format(start=reno.get("noisy_from") or "09:00", end=reno.get("noisy_to") or "17:00")
    breaks = [(QUIET_BREAK.get(lang) or QUIET_BREAK["en"]).format(**b) for b in reno.get("quiet_breaks") or []]
    return text + "".join(("，" if lang == "zh" else ", ") + b for b in breaks)


def quiet_note(state: str | None, lang: str) -> str:
    return (QUIET_NOTE[state].get(lang) or QUIET_NOTE[state]["en"]) if state else ""


# The contractor is named only when the owner gave one, so a notice without one doesn't read "Contractor: -".
CONTRACTOR_NOTE = {"en": " Contractor: {name}.", "ms": " Kontraktor: {name}.", "zh": "承包商：{name}。", "ta": " ஒப்பந்ததாரர்: {name}."}


def contractor_note(name: str | None, lang: str) -> str:
    name = (name or "").strip()
    return (CONTRACTOR_NOTE.get(lang) or CONTRACTOR_NOTE["en"]).format(name=name) if name else ""


# The first notification after a phone turns them on, so the household knows it works.
PUSH_TEST = {
    "en": "Notifications are on for this phone. Keynection will tell you about renovation notices, messages and repairs.",
    "ms": "Pemberitahuan dihidupkan untuk telefon ini. Keynection akan memaklumkan notis ubah suai, mesej dan pembaikan.",
    "zh": "这支手机已开启通知。装修通知、讯息和维修进度，Keynection 都会告诉你。",
    "ta": "இந்தத் தொலைபேசிக்கு அறிவிப்புகள் இயக்கப்பட்டன. புதுப்பிப்பு அறிவிப்புகள், செய்திகள், பழுதுபார்ப்புகள் பற்றி "
          "Keynection உங்களுக்குச் சொல்லும்.",
}


def push_test_text(lang: str) -> str:
    return PUSH_TEST.get(lang) or PUSH_TEST["en"]


def wa_text(key: str, lang: str, **values: str) -> str:
    template = WA_TEMPLATES[key].get(lang) or WA_TEMPLATES[key]["en"]
    return template.format(**values)


def wa_button(key: str, lang: str) -> str:
    return WA_BUTTONS[key].get(lang) or WA_BUTTONS[key]["en"]


def category_label(key: str, lang: str) -> str:
    labels = CATEGORY_LABELS.get(key, CATEGORY_LABELS["other"])
    return labels.get(lang) or labels["en"]
