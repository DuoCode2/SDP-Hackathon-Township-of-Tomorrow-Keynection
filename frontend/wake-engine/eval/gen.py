"""Synthetic test set for the "Hey Keynection" wake word, from the macOS voices on this machine.

Positives: the wake phrase alone and followed by a question, two spellings, three speaking rates, per voice.
Near-misses: phrases that sound close but must not wake.
Long-form negatives: the app's own strings in English, Malay, Chinese and Tamil, read aloud, with the product name
replaced (a sentence that only mentions the product is scored separately, as a near-miss).

Voices are split in two: TUNE (thresholds may be chosen on it) and HELD (only reported). Malay and Tamil voices are
held out on purpose, so their numbers are never fitted.

usage: python -I gen.py <repo> <out_dir> [kinds]   kinds: comma list of pos,near,long-en,long-ms,long-zh,long-ta
"""
import json
import random
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO, OUT = Path(sys.argv[1]), Path(sys.argv[2])
KINDS = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else None

TUNE = ["Samantha (English (US))", "Daniel (English (UK))", "Karen", "Rishi", "Tessa", "Flo (English (US))",
        "Reed (English (UK))", "Fred", "Grandma (English (US))", "Shelley (English (UK))", "Albert", "Junior",
        "Tingting (Chinese (China mainland))", "Eddy (Chinese (China mainland))"]
HELD = ["Moira", "Aman", "Tara", "Eddy (English (US))", "Eddy (English (UK))", "Sandy (English (UK))",
        "Rocko (English (US))", "Grandpa (English (UK))", "Kathy", "Ralph", "Flo (English (UK))",
        "Shelley (English (US))", "Amira", "Vani", "Meijia (Chinese (Taiwan))", "Sinji"]

POSITIVE = ["Hey Keynection", "Hey Key-nection", "Hey Keynection, how is my renovation notice doing?",
            "Hey Key-nection, what are the house rules for renovation?",
            # added after macOS voices were found to say "Keynection" close to "connection": spellings that force "key"
            "Hey Key Nekshun", "Hey Kee Nection", "Hey Key Nekshun, when does my warranty end?"]
RATES = [None, 150, 210]
NEAR = ["Hey connection", "Key election", "Hey Kenny", "Keyboard connection", "The connection is fine",
        "Hey kitchen", "Key collection", "Nice connection", "Hey Keanu", "A key injection", "Hey, any news?",
        "Hey neighbour", "Key selection", "Hey, nice to meet you", "Keynection", "Keynection helps new owners",
        "I opened Keynection yesterday", "Hey Kenneth", "Hey, connect it", "They connected the pipes"]

LONG_VOICES = {
    "en": ["Samantha (English (US))", "Daniel (English (UK))", "Moira", "Aman", "Tessa", "Karen"],
    "ms": ["Amira"],
    "zh": ["Tingting (Chinese (China mainland))", "Meijia (Chinese (Taiwan))", "Sinji"],
    "ta": ["Vani"],
}


def corpus() -> dict[str, list[str]]:
    """The app's own sentences per language, product name taken out."""
    text = (REPO / "frontend/src/i18n.tsx").read_text(encoding="utf-8")
    rows = re.findall(r"^\s+'[\w.]+': \['((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\]", text, re.M)
    out: dict[str, list[str]] = {"en": [], "ms": [], "zh": [], "ta": []}
    for en, ms, zh in rows:
        for lang, s in (("en", en), ("ms", ms), ("zh", zh)):
            s = re.sub(r"\{\w+\}", "", s).replace("\\'", "'").strip()
            if len(s) > 12:
                out[lang].append(s)
    tamil = set()
    for f in list((REPO / "backend/app").glob("*.py")) + list((REPO / "frontend/src").rglob("*.ts*")):
        for m in re.findall(r"[஀-௿][஀-௿\s,.!?0-9:()\-–]{12,}", f.read_text(encoding="utf-8")):
            tamil.add(m.strip())
    out["ta"] = sorted(tamil)
    readme = (REPO / "README.md").read_text(encoding="utf-8")
    out["en"] += [p for p in re.split(r"\n\s*\n", re.sub(r"[`*#>\[\]()|!]", " ", readme)) if len(p) > 40 and not re.search(r"[一-鿿]", p)]
    for lang in out:
        # A line that says the wake phrase itself ("免提：说 “Hello Neighbour”") is a positive, not a negative: it goes.
        out[lang] = [re.sub(r"(?i)\bhey\s+keynection\b|\bkeynection\b|\bjiran\b", "the app", s) for s in out[lang]
                     if not re.search(r"(?i)\b(hello|hey|hi)\s+neighbou?rs?\b", s)]
    return out


FAILED: list[str] = []


def say(voice: str, text: str, path: Path, rate: int | None = None) -> None:
    """Render to a temporary file and rename, so a crash never leaves a half-written clip that a rerun would keep."""
    if path.exists():
        return
    tmp = path.with_suffix(".part.wav")
    cmd = ["nice", "-n", "15", "say", "-v", voice, "--file-format=WAVE", "--data-format=LEI16@16000", "-o", str(tmp)]
    if rate:
        cmd += ["-r", str(rate)]
    for _ in range(4):
        if subprocess.run(cmd + [text], capture_output=True).returncode == 0 and tmp.stat().st_size > 1000:
            tmp.rename(path)
            return
    tmp.unlink(missing_ok=True)
    FAILED.append(str(path))


def main() -> None:
    random.seed(7)
    jobs, manifest = [], []
    for split, voices in (("tune", TUNE), ("held", HELD)):
        for vi, voice in enumerate(voices):
            for pi, phrase in enumerate(POSITIVE):
                for rate in RATES:
                    p = OUT / split / "pos" / f"v{vi:02d}_p{pi}_r{rate or 0}.wav"
                    jobs.append((voice, phrase, p, rate))
                    manifest.append({"split": split, "kind": "pos", "voice": voice, "text": phrase, "rate": rate, "path": str(p)})
            for ni, phrase in enumerate(NEAR):
                p = OUT / split / "near" / f"v{vi:02d}_n{ni:02d}.wav"
                jobs.append((voice, phrase, p, None))
                manifest.append({"split": split, "kind": "near", "voice": voice, "text": phrase, "rate": None, "path": str(p)})
    texts = corpus()
    for lang, voices in LONG_VOICES.items():
        lines = texts[lang]
        for vi, voice in enumerate(voices):
            for rate in ([None, 170] if len(voices) < 3 else [None]):
                chunk = 25
                for ci in range(0, len(lines), chunk):
                    p = OUT / "long" / lang / f"v{vi}_r{rate or 0}_{ci // chunk:03d}.wav"
                    jobs.append((voice, ". ".join(lines[ci:ci + chunk]), p, rate))
                    manifest.append({"split": "long", "kind": f"long-{lang}", "voice": voice, "text": None, "rate": rate, "path": str(p)})
    if KINDS is not None:
        wanted = {m["path"] for m in manifest if m["kind"] in KINDS}
        jobs = [j for j in jobs if str(j[2]) in wanted]
    for _, _, p, _ in jobs:
        p.parent.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(2) as ex:
        list(ex.map(lambda j: say(*j), jobs))
    manifest = [m for m in manifest if m["path"] not in set(FAILED) and Path(m["path"]).exists()]
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print({k: len(v) for k, v in texts.items()}, len(manifest), "clips;", len(FAILED), "failed:", FAILED[:10])


if __name__ == "__main__":
    main()
