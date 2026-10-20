"""Score the sherpa-onnx keyword spotter on the synthetic set.

Positives (clean and with noise mixed in) count as caught when the keyword fires at least once. Near-misses and the
long-form speech count every firing; the long-form rate is false wakes per hour of audio.

usage: python -I evalkws.py <model_dir> <data_dir> <keywords_file> <threshold> <score> [split ...]
Prints one JSON line per configuration, plus the misses and false wakes for reading.
"""
import json
import os
import sys
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx

MODEL, DATA, KW = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
THRESHOLD, SCORE = float(sys.argv[4]), float(sys.argv[5])
SPLITS = sys.argv[6:] or ["tune"]
SR = 16000
rng = np.random.default_rng(11)


def read(path: str) -> np.ndarray:
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getnchannels() == 1 and w.getsampwidth() == 2, path
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768


def spotter() -> sherpa_onnx.KeywordSpotter:
    return sherpa_onnx.KeywordSpotter(
        tokens=str(MODEL / "tokens.txt"),
        encoder=str(MODEL / "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx"),
        decoder=str(MODEL / ("decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx" if os.environ.get("DEC") == "int8" else "decoder-epoch-12-avg-2-chunk-16-left-64.onnx")),
        joiner=str(MODEL / "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx"),
        num_threads=1, max_active_paths=4, keywords_file=str(KW),
        keywords_score=SCORE, keywords_threshold=THRESHOLD, num_trailing_blanks=1, provider="cpu")


def fires(kws: sherpa_onnx.KeywordSpotter, audio: np.ndarray) -> list[float]:
    """Seconds at which the keyword fired, feeding 100 ms at a time like the microphone will."""
    s = kws.create_stream()
    audio = np.concatenate([np.zeros(SR // 2, np.float32), audio, np.zeros(SR, np.float32)])
    hits, step = [], SR // 10
    for i in range(0, len(audio), step):
        s.accept_waveform(SR, audio[i:i + step])
        while kws.is_ready(s):
            kws.decode_stream(s)
            if kws.get_result(s):
                hits.append(round(i / SR, 2))
                kws.reset_stream(s)
    return hits


def mix(clean: np.ndarray, noise: np.ndarray, snr_db: float) -> np.ndarray:
    if len(noise) < len(clean):
        noise = np.tile(noise, len(clean) // len(noise) + 1)
    start = rng.integers(0, len(noise) - len(clean) + 1)
    n = noise[start:start + len(clean)]
    p_s, p_n = np.mean(clean ** 2) + 1e-10, np.mean(n ** 2) + 1e-10
    return clean + n * np.sqrt(p_s / (p_n * 10 ** (snr_db / 10)))


def pink(n: int) -> np.ndarray:
    f = np.fft.rfft(rng.standard_normal(n))
    f /= np.sqrt(np.arange(1, len(f) + 1))
    return np.fft.irfft(f, n).astype(np.float32)


def main() -> None:
    manifest = json.loads((DATA / "manifest.json").read_text())
    kws = spotter()
    longs = [m for m in manifest if m["split"] == "long"]
    babble = np.concatenate([read(m["path"]) for m in longs[:6]]) if longs else np.zeros(SR, np.float32)  # other speech under the wake word
    noise = pink(SR * 60) * 0.1
    report = {"threshold": THRESHOLD, "score": SCORE, "keywords": KW.read_text().strip().splitlines()}
    misses, false = [], []
    for split in SPLITS:
        pos = [m for m in manifest if m["split"] == split and m["kind"] == "pos"]
        near = [m for m in manifest if m["split"] == split and m["kind"] == "near"]
        if not pos:
            continue
        for cond in (("clean",) if os.environ.get("CLEAN_ONLY") else ("clean", "pink15", "babble10")):
            caught = 0
            for m in pos:
                a = read(m["path"])
                if cond == "pink15":
                    a = mix(a, noise, 15)
                elif cond == "babble10":
                    a = mix(a, babble, 10)
                if fires(kws, a):
                    caught += 1
                elif cond == "clean":
                    misses.append(f"{split} {m['voice']} r{m['rate']} {m['text']!r}")
            report[f"{split}.recall.{cond}"] = f"{caught}/{len(pos)} = {caught / len(pos):.1%}"
        by = {}
        for line in misses:
            if line.startswith(split + " "):
                t = line.split(" r", 1)[1].split(" ", 1)[1]
                by[t] = by.get(t, 0) + 1
        per = len(pos) // len({m["text"] for m in pos})
        report[f"{split}.missed_clean_by_text(of {per})"] = by
        nf = 0
        for m in near:
            h = fires(kws, read(m["path"]))
            if h:
                nf += 1
                false.append(f"near {split} {m['voice']} {m['text']!r}")
        report[f"{split}.near_fired"] = f"{nf}/{len(near)}"
    if "long" in SPLITS or SPLITS == ["all"]:
        secs, n = 0.0, 0
        for m in longs:
            a = read(m["path"])
            secs += len(a) / SR
            h = fires(kws, a)
            n += len(h)
            false += [f"long {m['kind']} {Path(m['path']).name} at {t}s" for t in h]
        report["long.hours"] = round(secs / 3600, 2)
        report["long.false_wakes"] = n
        report["long.per_hour"] = round(n / (secs / 3600), 2)
    print(json.dumps(report, ensure_ascii=False))
    print("MISSES", len(misses), *misses[:40], sep="\n  ")
    print("FALSE", len(false), *false[:40], sep="\n  ")


if __name__ == "__main__":
    main()
