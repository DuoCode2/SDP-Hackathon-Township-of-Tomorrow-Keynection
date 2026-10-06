"""Neighbour messaging rules: translated quick replies, a tone check, and the concern categories.

Quick replies are pre-translated, so a message tapped in Malay arrives in the neighbour's own language
without any online translation service. Free-text messages are delivered as written.
"""

import re

LANGS = ("en", "ms", "zh")
LANG_NAME = {"en": "English", "ms": "Bahasa Melayu", "zh": "中文"}

QUICK_REPLIES: dict[str, dict[str, str]] = {
    "welcome": {
        "en": "Welcome to the neighbourhood! Let us know if you need anything.",
        "ms": "Selamat datang ke kejiranan ini! Beritahu kami jika perlukan apa-apa.",
        "zh": "欢迎成为邻居！有需要随时告诉我们。",
    },
    "thanks_notice": {
        "en": "Thanks for letting us know in advance.",
        "ms": "Terima kasih kerana memaklumkan lebih awal.",
        "zh": "谢谢你提前通知。",
    },
    "noted": {
        "en": "Noted, no problem at all.",
        "ms": "Baik, tiada masalah.",
        "zh": "收到，没问题。",
    },
    "quiet_nap": {
        "en": "Could the noisiest work avoid 1–3pm? Our baby naps then. Thank you!",
        "ms": "Boleh elakkan kerja paling bising antara 1–3 petang? Bayi kami tidur waktu itu. Terima kasih!",
        "zh": "最吵的工作可以避开下午1点到3点吗？我们的宝宝那时午睡。谢谢！",
    },
    "parking": {
        "en": "Could the contractor's lorry avoid blocking our gate? Thanks!",
        "ms": "Boleh minta lori kontraktor tidak menghalang pagar rumah kami? Terima kasih!",
        "zh": "可以请承包商的罗里不要挡住我们的门口吗？谢谢！",
    },
    "will_fix": {
        "en": "Sorry about that, we'll sort it out today.",
        "ms": "Maaf ya, kami akan selesaikan hari ini.",
        "zh": "不好意思，我们今天会处理好。",
    },
    "check_together": {
        "en": "Shall we check the wall together this weekend?",
        "ms": "Jom periksa dinding bersama-sama hujung minggu ini?",
        "zh": "这个周末我们一起看看墙好吗？",
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
_OFFICIAL_RE = re.compile(r"\b(?:sdp|sime\s*darby|estate|official|admin(?:istrator)?|jiran5|management|jmb|polis|police|pengurusan)\b|物业|管理|官方",
                          re.IGNORECASE)


def official_sounding(text: str) -> bool:
    return bool(_OFFICIAL_RE.search(text))


def quick_text(key: str, lang: str) -> str:
    return QUICK_REPLIES[key].get(lang) or QUICK_REPLIES[key]["en"]


# ---------- WhatsApp alerts ----------
# Pre-approved message templates (WhatsApp Business only allows approved templates for alerts), one per language.
# Chat alerts never carry the message itself: the conversation stays in Jiran5.
CATEGORY_LABELS: dict[str, dict[str, str]] = {
    "noise_hours": {"en": "noise outside the agreed hours", "ms": "bising di luar waktu yang dipersetujui", "zh": "在约定时间以外施工吵闹"},
    "debris": {"en": "debris, dust or blocked drains", "ms": "sisa binaan, debu atau longkang tersumbat", "zh": "建筑垃圾、灰尘或沟渠堵塞"},
    "access": {"en": "blocked road, gate or parking", "ms": "jalan, pagar atau parkir dihalang", "zh": "挡住道路、门口或停车位"},
    "damage": {"en": "possible damage to their home", "ms": "kemungkinan kerosakan pada rumah mereka", "zh": "对方的房子可能受损"},
    "workers": {"en": "workers' behaviour", "ms": "kelakuan pekerja", "zh": "工人行为"},
    "other": {"en": "something else", "ms": "perkara lain", "zh": "其他问题"},
}

WA_TEMPLATES: dict[str, dict[str, str]] = {
    "reno": {
        "en": "Renovation notice from {name} ({label}): {scope}, {start} to {end}. Noisy work: {hours}. Contractor: {contractor}. "
              "Please photograph your side before work starts. If anything worries you, reply in Jiran5.",
        "ms": "Notis ubah suai daripada {name} ({label}): {scope}, {start} hingga {end}. Kerja bising: {hours}. Kontraktor: {contractor}. "
              "Sila ambil foto bahagian rumah anda sebelum kerja bermula. Jika ada kebimbangan, balas dalam Jiran5.",
        "zh": "{name}（{label}）的装修通知：{scope}，{start} 至 {end}。吵闹时段：{hours}。承包商：{contractor}。"
              "开工前请先拍下你那一边的照片。有任何担心，请在 Jiran5 回复。",
    },
    "hello": {"en": "{name} from {label} said hello on Jiran5 👋", "ms": "{name} dari {label} menyapa anda di Jiran5 👋",
              "zh": "{label} 的 {name} 在 Jiran5 跟你打招呼 👋"},
    "message": {"en": "New message from {name} ({label}). Open Jiran5 to read it.",
                "ms": "Mesej baharu daripada {name} ({label}). Buka Jiran5 untuk membacanya.",
                "zh": "{name}（{label}）传来新讯息，请打开 Jiran5 查看。"},
    "voice": {"en": "New voice message from {name} ({label}). Open Jiran5 to listen.",
              "ms": "Mesej suara baharu daripada {name} ({label}). Buka Jiran5 untuk mendengarnya.",
              "zh": "{name}（{label}）传来语音讯息，请打开 Jiran5 收听。"},
    "wave": {"en": "{name} ({label}) waved at you 👋", "ms": "{name} ({label}) melambai kepada anda 👋", "zh": "{name}（{label}）跟你打招呼 👋"},
    "request": {"en": "A resident of {label} asked to connect. Open Jiran5 to accept or decline.",
                "ms": "Penghuni {label} ingin berhubung. Buka Jiran5 untuk terima atau tolak.",
                "zh": "{label} 的住户想联系你，请打开 Jiran5 接受或拒绝。"},
    "concern_new": {"en": "A neighbour ({label}) raised a concern about your renovation: {category}. Please reply in Jiran5.",
                    "ms": "Jiran ({label}) meluahkan kebimbangan tentang ubah suai anda: {category}. Sila balas dalam Jiran5.",
                    "zh": "邻居（{label}）对你的装修提出问题：{category}。请在 Jiran5 回复。"},
    "concern_reply": {"en": "{name} ({label}) replied to your concern. Open Jiran5 to see it.",
                      "ms": "{name} ({label}) telah membalas kebimbangan anda. Buka Jiran5 untuk melihatnya.",
                      "zh": "{name}（{label}）回复了你提出的问题，请打开 Jiran5 查看。"},
    "concern_sorted": {"en": "{name} ({label}) marked your concern as sorted. Still happening? You can involve the estate team in Jiran5.",
                       "ms": "{name} ({label}) menandakan kebimbangan anda sebagai selesai. Masih berlaku? Anda boleh melibatkan pasukan estet dalam Jiran5.",
                       "zh": "{name}（{label}）把你的问题标记为已解决。还在发生？可以在 Jiran5 请物业团队介入。"},
    "concern_estate_raiser": {"en": "Your concern is now with the SDP estate team. They aim to reply within one working day.",
                              "ms": "Kebimbangan anda kini bersama pasukan estet SDP. Mereka cuba membalas dalam satu hari bekerja.",
                              "zh": "你的问题已交给 SDP 物业团队，他们会尽量在一个工作天内回复。"},
    "concern_estate_owner": {"en": "A concern about your renovation was passed to the SDP estate team. Everything already said goes with it.",
                             "ms": "Satu kebimbangan tentang ubah suai anda telah diserahkan kepada pasukan estet SDP, bersama rekod penuh.",
                             "zh": "一个关于你装修的问题已交给 SDP 物业团队，之前的纪录会一起送过去。"},
    "concern_closed": {"en": "The SDP estate team closed a concern: {note}", "ms": "Pasukan estet SDP menutup satu kebimbangan: {note}",
                       "zh": "SDP 物业团队已结案：{note}"},
    "notice": {"en": "Estate office notice: {title}. {body}", "ms": "Notis pejabat estet: {title}. {body}", "zh": "物业办公室公告：{title}。{body}"},
    "repair": {"en": "SDP says the repair is done ({subject}). Please check it and confirm in Jiran5: only you can close the ticket.",
               "ms": "SDP memaklumkan pembaikan telah siap ({subject}). Sila semak dan sahkan dalam Jiran5: hanya anda boleh menutup tiket.",
               "zh": "SDP 表示维修已完成（{subject}）。请检查后在 Jiran5 确认：只有你能关闭这张单。"},
}

WA_BUTTONS: dict[str, dict[str, str]] = {
    "open": {"en": "Open Jiran5", "ms": "Buka Jiran5", "zh": "打开 Jiran5"},
    "concern": {"en": "Raise a concern", "ms": "Luahkan kebimbangan", "zh": "反映问题"},
    "wave": {"en": "Wave back", "ms": "Balas lambaian", "zh": "回个招呼"},
    "accept": {"en": "Accept", "ms": "Terima", "zh": "接受"},
}


def wa_text(key: str, lang: str, **values: str) -> str:
    template = WA_TEMPLATES[key].get(lang) or WA_TEMPLATES[key]["en"]
    return template.format(**values)


def wa_button(key: str, lang: str) -> str:
    return WA_BUTTONS[key].get(lang) or WA_BUTTONS[key]["en"]


def category_label(key: str, lang: str) -> str:
    labels = CATEGORY_LABELS.get(key, CATEGORY_LABELS["other"])
    return labels.get(lang) or labels["en"]
