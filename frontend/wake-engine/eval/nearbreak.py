"""Per-phrase firing counts for the near-miss set and false wakes per language on the long speech, at several
operating points in one pass (one spotter per point)."""
import json, sys
from collections import Counter, defaultdict
from pathlib import Path
M, KW = sys.argv[1], sys.argv[2]
POINTS = [(0.25, 1.0), (0.2, 1.5), (0.15, 1.5), (0.1, 2.0)]
sys.argv = [sys.argv[0], M, "unused", KW, "0.25", "1.0"]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import evalkws
spotters = {}
for th, sc in POINTS:
    evalkws.THRESHOLD, evalkws.SCORE = th, sc
    spotters[(th, sc)] = evalkws.spotter()
near = json.loads(Path("near-n/manifest-tune.json").read_text()) + json.loads(Path("near-n/manifest-held.json").read_text())
longs = [m for m in json.loads(Path("data/manifest.json").read_text()) if m["split"] == "long"]
fired = defaultdict(Counter); total = Counter()
for m in near:
    a = evalkws.read(m["path"]); total[m["text"]] += 1
    for p, k in spotters.items():
        if evalkws.fires(k, a): fired[p][m["text"]] += 1
hours = defaultdict(float); fa = defaultdict(Counter); where = defaultdict(list)
for m in longs:
    a = evalkws.read(m["path"]); lang = m["kind"]; hours[lang] += len(a) / 16000 / 3600
    for p, k in spotters.items():
        h = evalkws.fires(k, a); fa[p][lang] += len(h)
        if h: where[p] += [f"{Path(m['path']).name}@{t}" for t in h]
for p in POINTS:
    print(f"== threshold {p[0]} score {p[1]}")
    print("  near:", ", ".join(f"{t!r} {fired[p][t]}/{total[t]}" for t in total))
    print("  long:", ", ".join(f"{l} {fa[p][l]} in {hours[l]:.2f} h" for l in sorted(hours)), "| where:", where[p][:6])
