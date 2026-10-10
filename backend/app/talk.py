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
    "quiet_nap": {
        "en": "Could the noisiest work avoid 1–3pm? Our baby naps then. Thank you!",
        "ms": "Boleh elakkan kerja paling bising antara 1–3 petang? Bayi kami tidur waktu itu. Terima kasih!",
        "zh": "最吵的工作可以避开下午1点到3点吗？我们的宝宝那时午睡。谢谢！",
        "ta": "அதிக சத்தமான வேலையை மதியம் 1–3 மணிக்குத் தவிர்க்க முடியுமா? அப்போது எங்கள் குழந்தை தூங்கும். நன்றி!",
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

# Small, deliberately conservative list: the aim is to catch obvious insults before they are sent, not to police
# tone. A pilot would add a proper multilingual classifier and human review (reports already go to SDP).
_HOSTILE = [
    r"\bidiot\w*", r"\bstupid\b", r"\bmoron\w*", r"\bshut up\b", r"\bf+u+c+k\w*", r"\bshit\w*", r"\bbastard\w*",
    r"\bbitch\w*", r"\bkill you\b", r"\bbodoh\b", r"\bbabi\b", r"\bsial\b", r"\bcelaka\b", r"\bbangang\b", r"\bbengap\b",
    "白痴", "笨蛋", "去死", "他妈的", "混蛋", "王八蛋",
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
        "en": "Renovation notice from {name} ({label}): {scope}, {start} to {end}. Noisy work: {hours}. Contractor: "
              "{contractor}. Please photograph your side before work starts. If anything worries you, reply in Keynection.",
        "ms": "Notis ubah suai daripada {name} ({label}): {scope}, {start} hingga {end}. Kerja bising: {hours}. Kontraktor: "
              "{contractor}. Sila ambil foto bahagian rumah anda sebelum kerja bermula. "
              "Jika ada kebimbangan, balas dalam Keynection.",
        "zh": "{name}（{label}）的装修通知：{scope}，{start} 至 {end}。吵闹时段：{hours}。承包商：{contractor}。"
              "开工前请先拍下你那一边的照片。有任何担心，请在 Keynection 回复。",
        "ta": "{name} ({label}) அனுப்பிய புதுப்பிப்பு அறிவிப்பு: {scope}, {start} முதல் {end} வரை. சத்தமான வேலை: {hours}. "
              "ஒப்பந்ததாரர்: {contractor}. வேலை தொடங்கும் முன் உங்கள் பக்கத்தைப் படம் எடுத்து வையுங்கள். "
              "ஏதாவது கவலை இருந்தால், Keynection-இல் பதில் அனுப்புங்கள்.",
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


def hours_text(reno: dict, lang: str) -> str:
    key = "weekdays" if reno.get("weekdays_only", True) else "mon_sat"
    template = HOURS[key].get(lang) or HOURS[key]["en"]
    return template.format(start=reno.get("noisy_from") or "09:00", end=reno.get("noisy_to") or "17:00")


def wa_text(key: str, lang: str, **values: str) -> str:
    template = WA_TEMPLATES[key].get(lang) or WA_TEMPLATES[key]["en"]
    return template.format(**values)


def wa_button(key: str, lang: str) -> str:
    return WA_BUTTONS[key].get(lang) or WA_BUTTONS[key]["en"]


def category_label(key: str, lang: str) -> str:
    labels = CATEGORY_LABELS.get(key, CATEGORY_LABELS["other"])
    return labels.get(lang) or labels["en"]
