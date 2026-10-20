// Runs the compiled WebAssembly keyword spotter on WAV files, 100 ms at a time like the microphone, and prints the
// seconds at which it fired, one JSON line per file (same feeding and padding as evalkws.py).
const fs = require('fs'), path = require('path');
const [, , kwFile, th, sc, ...files] = process.argv;
globalThis.Module = { locateFile: (p) => path.join(__dirname, p) };
const Module = require('./sherpa-onnx-wasm-kws-main.js');
function readWav(f) {
  const b = fs.readFileSync(f); let o = 12, data, sr;
  while (o < b.length) { const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') sr = b.readUInt32LE(o + 12); if (id === 'data') data = b.subarray(o + 8, o + 8 + n); o += 8 + n + (n & 1); }
  if (sr !== 16000) throw new Error('need 16 kHz: ' + f);
  const a = new Float32Array(data.length / 2); for (let i = 0; i < a.length; i++) a[i] = data.readInt16LE(2 * i) / 32768; return a;
}
Module.onRuntimeInitialized = () => {
  const { createKws } = require('./sherpa-onnx-kws.js');
  const kws = createKws(Module, {
    featConfig: { samplingRate: 16000, featureDim: 80 },
    modelConfig: { transducer: { encoder: './encoder-epoch-12-avg-2-chunk-16-left-64.onnx', decoder: './decoder-epoch-12-avg-2-chunk-16-left-64.onnx', joiner: './joiner-epoch-12-avg-2-chunk-16-left-64.onnx' },
      tokens: './tokens.txt', provider: 'cpu', modelType: '', numThreads: 1, debug: 0, modelingUnit: 'bpe', bpeVocab: '' },
    maxActivePaths: 4, numTrailingBlanks: 1, keywordsScore: Number(sc), keywordsThreshold: Number(th),
    keywords: fs.readFileSync(kwFile, 'utf8').trim(),
  });
  for (const f of files) {
    const s = kws.createStream(), audio = readWav(f), all = new Float32Array(8000 + audio.length + 16000);
    all.set(audio, 8000); const hits = [];
    for (let i = 0; i < all.length; i += 1600) {
      s.acceptWaveform(16000, all.subarray(i, i + 1600));
      while (kws.isReady(s)) { kws.decode(s); const r = kws.getResult(s); if (r.keyword) { hits.push(Math.round(i / 160) / 100); kws.reset(s); } }
    }
    s.free(); console.log(JSON.stringify({ file: path.basename(path.dirname(f)) + '/' + path.basename(f), hits }));
  }
  kws.free();
};
