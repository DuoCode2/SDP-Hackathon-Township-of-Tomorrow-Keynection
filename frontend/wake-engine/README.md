# The wake word's engine

> **中文**：免提唤醒词 “Hello Neighbour” 在设备本机识别：sherpa-onnx 的关键词检测（编译成 WebAssembly，在 worker 里跑），说出唤醒词之前没有任何声音离开设备。这一页写引擎从哪来、怎么重编、怎么换词、量过什么。`frontend/public/wake/` 里的文件全是 `build.sh` 编出来的，不要手改。

**What it is.** `frontend/public/wake/` holds the keyword spotter that hears "Hello Neighbour" on the resident's own device: [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)'s keyword spotting compiled to WebAssembly, with a 3.3 M-parameter English model. The page runs it in a worker (`kws-worker.js`) and feeds it 16 kHz audio from an audio worklet (`capture-worklet.js`); `frontend/src/wake.ts` turns it on and off. Nothing leaves the worker except "the phrase was heard".

**Size.** 18.9 MB as built, 8.2 MB gzipped. Only the gzipped `.wasm` and `.data` are kept; the server sends them as they are (`wake_file` in `backend/app/main.py`), so a browser downloads 8 MB once, when the household first switches hands-free on.

## Where every file comes from

| File | From | SHA-256 (uncompressed) |
|---|---|---|
| `sherpa-onnx-wasm-kws-main.wasm` | built by `build.sh` | `b66cf5f61645a8145f4d8f100d89cde63ea3be4911f6ea306b65df654d8e76a9` |
| `sherpa-onnx-wasm-kws-main.data` | the model below, packed by the build | `46caf9924617db2402ee32d1ba840fbac7623cd921efef05e409c98e939c6448` |
| `sherpa-onnx-wasm-kws-main.js` | built by `build.sh` (Emscripten's loader) | `7b1116024a79650bb8879d18854d7c2b152636a12e891521ec55646c06db3157` |
| `sherpa-onnx-kws.js` | sherpa-onnx `wasm/kws/sherpa-onnx-kws.js`, unchanged | `03b44e372795fd907e84eecd29419e1d052dc6704ac06935c9bf9fe19b3e3434` |
| `kws-worker.js`, `capture-worklet.js` | written for Keynection | — |

- **sherpa-onnx** `v1.13.8` (commit `11afbd0`), Apache License 2.0. Its build pulls onnxruntime 1.28.2's WebAssembly static library (MIT) from `csukuangfj/onnxruntime-libs`, pinned there by SHA-256 `88688849…232a`, and kaldi-native-fbank, OpenFst and simple-sentencepiece (Apache 2.0).
- **Emscripten** 4.0.23 (MIT).
- **Model** `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01` from sherpa-onnx's `kws-models` release; its README states Apache License 2.0. Files used: the int8 encoder (`1e721676…e678`), the fp32 decoder (`f61ebd3e…63a3`), the int8 joiner (`eae9da0c…624c`) and `tokens.txt` (`fd2ded40…ba53`). The `-mobile` re-export of this model on ModelScope fails in sherpa-onnx 1.13.8 (a reshape error on every input), so it is not used.

## Rebuild

```bash
frontend/wake-engine/build.sh      # prints the SHA-256 of what it built; compare with the table above
```

## Changing the phrase

The phrase is a line of the model's word pieces (`KEYWORDS` in `frontend/src/wake.ts`), with a boost (`SCORE`) and a threshold. Word pieces come from the model's `bpe.model` with SentencePiece:

```python
import sentencepiece as spm
spm.SentencePieceProcessor(model_file="bpe.model").encode("HELLO NEIGHBOUR", out_type=str)
# ['▁HE', 'LL', 'O', '▁NE', 'IG', 'H', 'B', 'O', 'UR']
```

Measure before changing it: this model was not trained on any wake word, and how well it hears one depends on the words.

## What was measured (20 Oct 2026)

Synthetic voices only (macOS's built-in voices, English with US, UK, Irish, Australian, South African and Indian accents, plus the Malay, Tamil and Chinese voices saying the English phrase), each at three speaking rates. Voices were split in two: thresholds were chosen on one half, recall is reported on the other (the Malay and Tamil voices are in that held-out half). The false-wake test is the app's own sentences read aloud in English, Malay, Chinese and Tamil (product name removed). The scripts are in `eval/`.

| | Hey Keynection (first choice) | Hello Neighbour (used: threshold 0.15, boost 1.5) |
|---|---|---|
| Clean, tuning voices | 36–63% (even at the loosest settings) | 100% (42/42) |
| Clean, held-out voices | — | **91.7% (44/48)** |
| Pink noise at 15 dB, held out | — | 77.1% |
| Other speech under it at 10 dB, held out | — | 79.2% |
| False wakes: the app's sentences read aloud, en 3.3 h, ms 1.2 h, zh 1.3 h, ta 0.2 h | — | **0 in 6.0 h** |
| Control: the model's own phrases ("Hello world", "Alexa", "Hey Siri"), same voices | 82–84% | |

"Keynection" is a made-up word; the macOS voices also say it close to "connection".

The threshold is the loosest with no false wake: at 0.1 one Chinese sentence woke it, and so did "Hello there. Say hello to the neighbours." run together (the browser walk's near-miss recording); 0.15 to 0.25 never did. What it still gets wrong, measured: the Malay voice missed all three of its clips (Malay-accented speakers may need to say it clearly), and phrases that sound almost the same wake it often ("Yellow neighbour", "Hollow neighbour" about 60%, "Hello labour" about 35%). "Hello neighbourhood" wakes it, as it contains the phrase.

A first run counted 21 "false wakes" in Chinese and 4 in Malay: the app's own new strings were in the negatives and say "Hello Neighbour" themselves (免提：说 “Hello Neighbour”). The negatives now leave out any line that says the phrase.

The engine compiled here and the Python package scored the same clips with the same settings: 67 of 68 clips agreed on whether it fired, and where both fired the time was identical. The worklet's resampling (48 kHz → 16 kHz by averaging) caught the same held-out clips as 16 kHz audio fed directly (43/48 against 43/48 at 0.25).
