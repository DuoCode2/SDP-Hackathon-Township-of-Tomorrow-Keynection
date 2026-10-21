"""The Python reference, same feeding as parity.cjs: prints {"file", "hits"} per WAV."""
import json, os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
M = sys.argv[2]
sys.argv = [sys.argv[0], M, "unused", sys.argv[3], sys.argv[4], sys.argv[5]] + sys.argv[6:]
import evalkws
kws = evalkws.spotter()
for f in sys.argv[6:]:
    print(json.dumps({"file": Path(f).parent.name + "/" + Path(f).name, "hits": evalkws.fires(kws, evalkws.read(f))}))
