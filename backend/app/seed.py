"""Fictional demo phase: two facing terrace rows and one apartment block.

All names and units are made up for the prototype; nothing here is real SDP data.
Dates are worked out from today, so a rehearsal or a judging day always opens on a phase handed over two weeks ago.
"""

from datetime import date, datetime, timedelta, timezone

MALAYSIA = timezone(timedelta(hours=8))
HANDOVER_DAYS_AGO = 14
# Version of the plain-language privacy notice a household agrees to when it joins (PDPA consent). Where AI is on,
# the notice has one more paragraph (what residents type is translated by Claude, outside Malaysia): its own version.
# 10b: how long each kind of data is kept, said exactly; backups; closing the account in the app.
# 10c (the AI versions only): the AI paragraph now says that a message the AI judges to be abuse is refused.
# 10d (the AI versions only): the AI paragraph also says what the assistant sends: the household's own records and
#   its neighbours' unit numbers, never their names or what they wrote.
CONSENT_VERSION = "pilot-2026-10b"
CONSENT_VERSION_AI = "pilot-2026-10d-ai"
# The demo with Gemini instead: the paragraph names Google, says its free tier may use what is sent to improve
# Google's products, and asks for made-up details only. Never shown in a pilot (ai.provider).
CONSENT_VERSION_AI_GEMINI = "pilot-2026-10d-ai-gemini"

# Households that have not joined Keynection yet. Until they do, neighbours see their unit number only, never a name,
# and renovation notices reach them on paper through the estate office.
NOT_JOINED = {"T-23", "T-34"}
# Households that use easy mode (bigger text, fewer options). Private to the household itself.
EASY_MODE = {"T-20"}
# Family helpers already set up at handover: (unit, helper name, relationship).
SEED_HELPERS = [("T-20", "Mei Fong", "child")]

PHASE = {
    "id": "demo",
    "name": "Taman Demo",  # fictional: see the note
    "note": "Two facing terrace rows on Jalan Demo 1 and one apartment block. Made-up data for the prototype.",
}


def today_my() -> date:
    return datetime.now(MALAYSIA).date()


def handover_date() -> str:
    """Vacant possession date for the whole phase; the 24-month defect liability period runs from here."""
    return (today_my() - timedelta(days=HANDOVER_DAYS_AGO)).isoformat()


# The story's lead collects the keys today: the opening says "key day", the welcome says "keys received" today, and
# the neighbours (here two weeks already) are the ones who welcome him.
KEY_DAY_UNITS = ("T-12",)


def handover_date_for(unit_id: str) -> str:
    return today_my().isoformat() if unit_id in KEY_DAY_UNITS else handover_date()


def _next(weekday: int, after: date) -> date:
    """The first given weekday (Mon=0) at least three days after `after`, so residents get notice."""
    d = after + timedelta(days=3)
    return d + timedelta(days=(weekday - d.weekday()) % 7)


def _day(d: date, lang: str = "en") -> str:
    """A date as a notice says it, in the reader's language: 'Thursday 29 Oct', 'Khamis 29 Okt', '10月29日（星期四）'."""
    if lang == "zh":
        return f"{d.month}月{d.day}日（{_WEEKDAYS['zh'][d.weekday()]}）"
    if lang in ("ms", "ta"):
        return f"{_WEEKDAYS[lang][d.weekday()]} {d.day} {_MONTHS[lang][d.month - 1]}"
    return f"{d:%A} {d.day} {d:%b}"


_WEEKDAYS = {
    "ms": ["Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu", "Ahad"],
    "zh": ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"],
    "ta": ["திங்கள்", "செவ்வாய்", "புதன்", "வியாழன்", "வெள்ளி", "சனி", "ஞாயிறு"],
}
_MONTHS = {
    "ms": ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"],
    "ta": ["ஜன.", "பிப்.", "மார்.", "ஏப்.", "மே", "ஜூன்", "ஜூலை", "ஆக.", "செப்.", "அக்.", "நவ.", "டிச."],
}


def demo_notices() -> list[dict]:
    """Community notices (ring 3): one-way, from the estate team. Fictional examples. The record is English; each
    comes with the team's own Malay, Chinese and Tamil wording, so a reader of any of the four languages gets the
    notice (in Chats and on WhatsApp) in theirs. A notice the estate team posts later is translated by the AI."""
    today = today_my()
    tank, drain = _next(5, today), _next(3, today)
    return [
        {
            "audience": "block:A", "title": "Block A water tank cleaning",
            "body": f"Water supply to Block A pauses on {_day(tank)}, 9am to 1pm. Please store water the night before.",
            "translations": {
                "ms": {"title": "Pencucian tangki air Blok A",
                       "body": f"Bekalan air ke Blok A terhenti pada {_day(tank, 'ms')}, 9 pagi hingga 1 tengah hari. "
                               "Sila simpan air pada malam sebelumnya."},
                "zh": {"title": "A 座水箱清洗",
                       "body": f"{_day(tank, 'zh')}上午 9 点到下午 1 点，A 座暂停供水。请在前一晚先储水。"},
                "ta": {"title": "A தொகுதி நீர்த் தொட்டி சுத்தம்",
                       "body": f"{_day(tank, 'ta')} காலை 9 முதல் மதியம் 1 வரை A தொகுதிக்கு நீர் விநியோகம் நிறுத்தப்படும். "
                               "முந்தைய இரவே தண்ணீர் சேமித்து வைக்கவும்."},
            },
        },
        {
            "audience": "street:Jalan Demo 1", "title": "Drain clearing on Jalan Demo 1",
            "body": f"Contractors will clear the roadside drains on {_day(drain)}. Please keep cars off the drain covers.",
            "translations": {
                "ms": {"title": "Pembersihan longkang di Jalan Demo 1",
                       "body": f"Kontraktor akan membersihkan longkang tepi jalan pada {_day(drain, 'ms')}. "
                               "Sila jangan letak kereta di atas penutup longkang."},
                "zh": {"title": "Jalan Demo 1 清理沟渠",
                       "body": f"{_day(drain, 'zh')}承包商会清理路边沟渠。请不要把车停在沟渠盖上。"},
                "ta": {"title": "Jalan Demo 1 சாக்கடை சுத்தம்",
                       "body": f"{_day(drain, 'ta')} அன்று ஒப்பந்ததாரர்கள் சாலையோர சாக்கடைகளைச் சுத்தம் செய்வார்கள். "
                               "சாக்கடை மூடிகள் மீது கார்களை நிறுத்த வேண்டாம்."},
            },
        },
        {
            "audience": "phase", "title": "Renovation hours in Taman Demo",
            "body": "Noisy renovation work only Monday to Saturday, 9am to 6pm, and never on Sundays or public holidays. "
                    "Register your renovation in Keynection so your neighbours hear about it from you first.",
            "translations": {
                "ms": {"title": "Waktu ubah suai di Taman Demo",
                       "body": "Kerja ubah suai yang bising hanya Isnin hingga Sabtu, 9 pagi hingga 6 petang, dan tidak sekali-kali "
                               "pada hari Ahad atau cuti umum. Daftarkan ubah suai anda dalam Keynection supaya jiran mendengarnya "
                               "daripada anda dahulu."},
                "zh": {"title": "Taman Demo 装修时段",
                       "body": "吵闹的装修只能在星期一至六早上 9 点到傍晚 6 点进行，星期日和公共假期不能施工。"
                               "请在 Keynection 登记装修，让邻居先从你这里听到。"},
                "ta": {"title": "Taman Demo புதுப்பிப்பு நேரம்",
                       "body": "சத்தமான புதுப்பிப்பு வேலை திங்கள் முதல் சனி வரை, காலை 9 முதல் மாலை 6 வரை மட்டுமே; ஞாயிறு மற்றும் "
                               "பொது விடுமுறை நாட்களில் கூடாது. உங்கள் புதுப்பிப்பை Keynection-இல் பதிவு செய்யுங்கள், "
                               "அண்டைவீட்டார் முதலில் உங்களிடமிருந்தே கேட்கட்டும்."},
            },
        },
    ]


_SOUTH_NAMES = ["Farid", "Siti", "Aiman", "Kumar", "Wei Jie", "Nurul"]
_NORTH_NAMES = ["Ah Hock", "Priya", "Hafiz", "Mei Ling", "Daniel", "Aisyah"]
_LANE_NAMES = ["Ravi", "Azura", "Boon Keat", "Salmah", "Vimala", "Iskandar"]
_APT_NAMES = {
    11: ["Faizal", "Mei Xin", "Ganesh", "Amira"],
    12: ["Ismail", "Hui Min", "Lakshmi", "Danish"],
    13: ["Rahman", "Jia Hui", "Suresh", "Liyana"],
    14: ["Kevin", "Zainab", "Arjun", "Yong"],
    15: ["Hana", "Rajesh", "Sofia", "Chong"],
    16: ["Nadia", "Wei Ming", "Thinesh", "Farah"],
}
# Language each household reads messages in (quick replies and alerts arrive translated into it). Kumar, next door to
# Aiman, reads Tamil, so the demo shows a renovation notice reaching him in Tamil.
_LANG = {
    "Farid": "ms", "Siti": "ms", "Aiman": "en", "Kumar": "ta", "Wei Jie": "zh", "Nurul": "ms",
    "Ah Hock": "zh", "Priya": "en", "Hafiz": "ms", "Mei Ling": "zh", "Daniel": "en", "Aisyah": "ms",
    "Rahman": "ms", "Jia Hui": "zh", "Suresh": "en", "Liyana": "ms", "Kevin": "en", "Zainab": "ms",
    "Arjun": "en", "Yong": "zh", "Hana": "ms", "Rajesh": "en", "Sofia": "en", "Chong": "zh",
    "Faizal": "ms", "Mei Xin": "zh", "Ganesh": "en", "Amira": "ms", "Ismail": "ms", "Hui Min": "zh",
    "Lakshmi": "en", "Danish": "ms", "Nadia": "ms", "Wei Ming": "zh", "Thinesh": "en", "Farah": "ms",
    "Ravi": "en", "Azura": "ms", "Boon Keat": "zh", "Salmah": "ms", "Vimala": "ta", "Iskandar": "ms",
}


# Short, harmless "about me" lines, each in all four reading languages. The profile screen warns residents not to
# share schedules or travel dates. A household's own bio is the one in its reading language (Siti writes Malay, Kumar
# Tamil, Mei Ling Chinese); the other three are stored with it, so each neighbour reads it in theirs and the card
# says which language it was written in. For a bio a resident types later, the AI writes the other three.
BIOS: dict[str, dict[str, str]] = {
    "Aiman": {"en": "Just moved in. Happy to help with Wi-Fi and computers.",
              "ms": "Baru pindah. Sudi tolong hal Wi-Fi dan komputer.",
              "zh": "刚搬进来。Wi-Fi 和电脑的事乐意帮忙。",
              "ta": "இப்போதுதான் குடிவந்தேன். Wi-Fi, கணினி விஷயங்களில் உதவ மகிழ்ச்சி."},
    "Siti": {"en": "Two kids and a cat. Say hi if you see us at the playground!",
             "ms": "Dua orang anak dan seekor kucing. Tegur kami kalau jumpa di taman permainan!",
             "zh": "两个孩子和一只猫。在游乐场看到我们就打个招呼吧！",
             "ta": "இரண்டு குழந்தைகள், ஒரு பூனை. விளையாட்டு மைதானத்தில் பார்த்தால் ஹாய் சொல்லுங்கள்!"},
    "Kumar": {"en": "Gardener. Ask me about mango trees.",
              "ms": "Tukang kebun. Tanya saya tentang pokok mangga.",
              "zh": "园丁。关于芒果树的事可以问我。",
              "ta": "தோட்டக்காரன். மா மரங்களைப் பற்றி என்னிடம் கேளுங்கள்."},
    "Priya": {"en": "Teacher. Always up for a teh tarik chat.",
              "ms": "Cikgu. Sentiasa boleh sembang sambil minum teh tarik.",
              "zh": "老师。随时可以边喝拉茶边聊天。",
              "ta": "ஆசிரியை. தேநீர் குடித்தபடி பேச எப்போதும் தயார்."},
    "Hafiz": {"en": "Works shifts: a quick message before noisy work really helps.",
              "ms": "Kerja syif: mesej ringkas sebelum kerja bising sangat membantu.",
              "zh": "轮班工作：吵闹施工前先传个短讯，帮助很大。",
              "ta": "ஷிஃப்ட் வேலை: சத்தமான வேலைக்கு முன் ஒரு சிறு செய்தி பெரிதும் உதவும்."},
    "Mei Ling": {"en": "Bakes on weekends and shares the extras.",
                 "ms": "Membakar kuih pada hujung minggu dan berkongsi lebihan.",
                 "zh": "周末会烘焙，多出来的会分给大家。",
                 "ta": "வார இறுதியில் பேக்கிங் செய்வேன்; மிச்சத்தைப் பகிர்வேன்."},
    "Sofia": {"en": "Re-doing the bathroom in October. Sorry in advance!",
              "ms": "Ubah suai bilik air pada bulan Oktober. Maaf awal-awal!",
              "zh": "十月要翻新浴室。先说声不好意思！",
              "ta": "அக்டோபரில் குளியலறையைப் புதுப்பிக்கிறேன். முன்கூட்டியே மன்னிக்கவும்!"},
    "Arjun": {"en": "Works from home. Big on football.",
              "ms": "Bekerja dari rumah. Peminat bola sepak.",
              "zh": "在家工作。超爱足球。",
              "ta": "வீட்டிலிருந்து வேலை. கால்பந்து பிரியர்."},
    "Suresh": {"en": "Retired engineer, happy to look at a leak with you.",
               "ms": "Jurutera bersara, sudi tengok kebocoran bersama anda.",
               "zh": "退休工程师，乐意陪你看看漏水。",
               "ta": "ஓய்வு பெற்ற பொறியாளர்; கசிவைச் சேர்ந்து பார்க்க மகிழ்ச்சி."},
    "Ah Hock": {"en": "Retired. Voice messages are easiest for me; my daughter helps with the app.",
                "ms": "Sudah bersara. Mesej suara paling senang untuk saya; anak perempuan saya tolong dengan app ini.",
                "zh": "退休了。语音讯息对我最方便；女儿帮我用这个 app。",
                "ta": "ஓய்வு பெற்றவன். குரல் செய்திகள்தான் எனக்கு எளிது; மகள் இந்த app-க்கு உதவுகிறாள்."},
}


def bio_texts(name: str, lang: str) -> tuple[str, dict[str, str]]:
    """A demo household's bio as written (in its reading language) and the same line in the other three languages."""
    texts = BIOS.get(name)
    if not texts:
        return "", {}
    own = texts.get(lang) or texts["en"]
    return own, {k: v for k, v in texts.items() if v != own}


# Times a household needs quiet, used only to plan the noisy hours of renovations that reach it. Nobody else sees
# them, or why: Siti next door to Aiman has a baby who naps after lunch, Hafiz across the road sleeps after night shifts.
QUIET_TIMES = {
    "Siti": [{"start": "13:00", "end": "15:00", "why": "baby"}],
    "Hafiz": [{"start": "09:00", "end": "11:00", "why": "night_shift"}],
}


def demo_units() -> list[dict]:
    units = []
    # South row: houses 10-15, facing north row houses 20-25 (house 12 faces 22), backing onto the lane row 30-35
    # across the back fence (house 12 backs onto 32).
    for pos in range(6):
        units.append({
            "id": f"T-{10 + pos}", "phase_id": "demo", "kind": "terrace", "label": f"No. {10 + pos}", "street": "Jalan Demo 1",
            "resident_name": _SOUTH_NAMES[pos], "row": "south", "facing_row": "north", "back_row": "lane", "pos": pos,
        })
        units.append({
            "id": f"T-{20 + pos}", "phase_id": "demo", "kind": "terrace", "label": f"No. {20 + pos}", "street": "Jalan Demo 1",
            "resident_name": _NORTH_NAMES[pos], "row": "north", "facing_row": "south", "pos": pos,
        })
    # The lane row: houses 30-35 on Jalan Demo 2, back to back with the south row. Not in anyone's circle on Jalan Demo 1,
    # but told when works there reach the back (wet, hacking, structural).
    for pos in range(6):
        units.append({
            "id": f"T-{30 + pos}", "phase_id": "demo", "kind": "terrace", "label": f"No. {30 + pos}", "street": "Jalan Demo 2",
            "resident_name": _LANE_NAMES[pos], "row": "lane", "back_row": "south", "pos": pos,
        })
    # Block A: floors 11-16 shown (the lower floors are left out of the demo), units 1-4 per floor.
    for floor, names in _APT_NAMES.items():
        for pos in range(1, 5):
            units.append({
                "id": f"A-{floor}-{pos}", "phase_id": "demo", "kind": "apartment", "label": f"A-{floor}-{pos}",
                "resident_name": names[pos - 1], "block": "A", "floor": floor, "pos": pos,
            })
    for u in units:
        u["lang"] = _LANG[u["resident_name"]]
    return units
