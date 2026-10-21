"""Control: the same TUNE voices saying phrases the model's own keyword list carries, to separate "synthetic voices are
hard for this model" from "the made-up word is hard"."""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
sys.path.insert(0, ".")
OUT = Path(sys.argv[1])
sys.argv = [sys.argv[0], ".", str(OUT)]  # gen.py reads its arguments at import
from gen import TUNE, HELD, RATES
SPLIT = os.environ.get('SPLIT', 'tune')
VOICES = HELD if SPLIT == 'held' else TUNE
import os
PHRASES = {"HEY_SIRI": "Hey Siri", "HELLO_WORLD": "Hello world", "ALEXA": "Alexa"} if not os.environ.get("ALT") else \
    {"HEY_NEIGHBOUR": "Hey neighbour", "HELLO_NEIGHBOUR": "Hello neighbour"} if os.environ.get("ALT") != "near" else \
    {f"NEAR{i:02d}": t for i, t in enumerate(["Hello there", "Hello number nine", "Yellow neighbour", "Hello labour",
        "Hello Nabil", "Hello, nice to meet you", "Hello Nadia", "Hollow neighbour", "Hello, Mister Neighbor",
        "Hello neighbourhood", "Helo jiran", "Hello, mind your neighbour's baby", "Hello Naveen", "Hello, nature",
        "My neighbour said hello", "Say hello to the neighbours"])}
jobs, man = [], []
for vi, v in enumerate(VOICES):
    for key, text in PHRASES.items():
        for rate in RATES:
            p = OUT / SPLIT / f"{key}_v{vi:02d}_r{rate or 0}.wav"
            cmd = ["nice", "-n", "15", "say", "-v", v, "--file-format=WAVE", "--data-format=LEI16@16000", "-o", str(p)] + (["-r", str(rate)] if rate else []) + [text]
            jobs.append((cmd, p)); man.append({"split": SPLIT, "kind": "near" if key.startswith("NEAR") else "pos", "voice": v, "text": text, "rate": rate, "path": str(p)})
def run(j):
    cmd, p = j
    if not p.exists():
        for _ in range(4):
            if subprocess.run(cmd, capture_output=True).returncode == 0 and p.exists() and p.stat().st_size > 1000:
                return
(OUT / SPLIT).mkdir(parents=True, exist_ok=True)
with ThreadPoolExecutor(2) as ex:
    list(ex.map(run, jobs))
(OUT / SPLIT).mkdir(parents=True, exist_ok=True)
(OUT / f"manifest-{SPLIT}.json").write_text(json.dumps([m for m in man if Path(m["path"]).exists()], indent=1))
print(len(man), "control clips")
