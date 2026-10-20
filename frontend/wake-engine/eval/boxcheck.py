"""The capture worklet's resampling (average the input samples each output sample covers), applied to 48 kHz copies,
against the same clips at 16 kHz directly: does the worklet's simple low-pass cost the wake word anything?"""
import sys, wave, numpy as np
from pathlib import Path
sys.path.insert(0, sys.argv[1]); M = sys.argv[2]; HELD = Path(sys.argv[4])
sys.argv = [sys.argv[0], M, "unused", sys.argv[3], "0.25", "1.0"]
import evalkws
def read48(p):
    w = wave.open(p); assert w.getframerate() == 48000
    return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
def box(x, rate=48000):  # the same loop as capture-worklet.js
    step, out, pos, s, c = rate / 16000, [], 0.0, 0.0, 0
    for v in x:
        s += v; c += 1; pos += 1
        if pos >= step:
            pos -= step; out.append(s / c); s, c = 0.0, 0
    return np.array(out, np.float32)
for th, sc in [(0.25, 1.0), (0.2, 1.5), (0.1, 2.0)]:
    evalkws.THRESHOLD, evalkws.SCORE = th, sc
    k = evalkws.spotter()
    a, b = sorted(HELD.glob("HELLO_*.wav")), sorted(Path(".").glob("HELLO_*_48k.wav"))
    assert len(a) == len(b) == 48, (len(a), len(b))
    direct = sum(bool(evalkws.fires(k, evalkws.read(str(p)))) for p in a)
    boxed = sum(bool(evalkws.fires(k, box(read48(str(p))))) for p in b)
    print(f"threshold {th}: held positives caught, 16 kHz direct {direct}/{len(a)}, 48 kHz through the worklet's resampling {boxed}/{len(b)}")
