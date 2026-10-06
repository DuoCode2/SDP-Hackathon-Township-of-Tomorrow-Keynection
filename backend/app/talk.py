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


def quick_text(key: str, lang: str) -> str:
    return QUICK_REPLIES[key].get(lang) or QUICK_REPLIES[key]["en"]
