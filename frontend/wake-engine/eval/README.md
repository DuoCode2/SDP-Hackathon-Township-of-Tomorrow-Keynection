# Measuring the wake word

Measurement scripts, kept so the numbers in `../README.md` and the pull request can be checked and rerun. They are
not part of the app and nothing imports them. They need a Mac (the test voices are macOS's `say`), Python 3.13 with
`sherpa-onnx==1.13.8 numpy sentencepiece` and the model from `../build.sh`; `parity.cjs` needs Node and the built
`.wasm`/`.data`/`.js` next to it.

| Script | What it does |
|---|---|
| `gen.py <repo> <out> [kinds]` | Synthetic set: positives, near-misses and the app's own sentences read aloud (en, ms, zh, ta), voices split into a tuning half and a held-out half |
| `genctl.py <out>` | The same voices saying other phrases: the model's own (control), "Hello/Hey neighbour" (`ALT=1`), near-misses for it (`ALT=near`); `SPLIT=tune|held` |
| `evalkws.py <model> <data> <keywords> <threshold> <boost> [splits]` | Recall (clean, pink noise 15 dB, other speech 10 dB), near-miss firings, false wakes per hour on the long speech |
| `nearbreak.py <model> <keywords>` | Per-phrase near-miss firings and false wakes per language, at four settings in one pass |
| `boxcheck.py` | The capture worklet's 48 → 16 kHz averaging against 16 kHz audio fed directly |
| `parity.cjs`, `parity_py.py` | The WebAssembly build against the Python package, same clips, same feeding |

`keywords/` holds the keyword lines measured: "Hey Keynection" (one and four spellings), "Hello Neighbour" (used),
and the model's own phrases used as the control.
