// The wake word, heard on the device: sherpa-onnx's keyword spotter, compiled to WebAssembly (see frontend/wake-engine/README.md),
// run off the page's main thread. Nothing leaves this worker except "the phrase was heard".
//
// In:  {type: 'start', keywords, threshold, score}  once, then
//      {type: 'audio', samples: Float32Array}       16 kHz mono, about 100 ms each
//      {type: 'reset'}                              forget what was heard so far (after a pause)
// Out: {type: 'ready'} | {type: 'wake', keyword} | {type: 'error', message}

let config = null
let kws = null
let stream = null
let runtime = false

// A download that fails half way (the engine is 8 MB) must say so at once, not leave the page waiting: Chrome then
// retries over another connection when the page starts a new worker (seen: HTTP/3 failing through a home router).
const fail = (e) => self.postMessage({ type: 'error', message: String((e && (e.message || e.reason)) || e) })
self.addEventListener('unhandledrejection', (e) => fail(e.reason))
self.addEventListener('error', (e) => fail(e.message))

self.Module = {
  onAbort: (what) => fail(what),
  locateFile: (file) => new URL(file, self.location.href).href,
  onRuntimeInitialized: () => {
    runtime = true
    begin()
  },
  print: () => {},
  printErr: () => {},
}

function begin() {
  if (!runtime || !config || kws) return
  try {
    kws = createKws(self.Module, {
      featConfig: { samplingRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: './encoder-epoch-12-avg-2-chunk-16-left-64.onnx',
          decoder: './decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
          joiner: './joiner-epoch-12-avg-2-chunk-16-left-64.onnx',
        },
        tokens: './tokens.txt', provider: 'cpu', modelType: '', numThreads: 1, debug: 0, modelingUnit: 'bpe', bpeVocab: '',
      },
      maxActivePaths: 4,
      numTrailingBlanks: 1,
      keywordsScore: config.score,
      keywordsThreshold: config.threshold,
      keywords: config.keywords,
    })
    stream = kws.createStream()
    self.postMessage({ type: 'ready' })
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e && e.message || e) })
  }
}

self.onmessage = (e) => {
  const m = e.data
  if (m.type === 'start') {
    config = m
    begin()
  } else if (m.type === 'reset' && stream) {
    stream.free()
    stream = kws.createStream()
  } else if (m.type === 'audio' && stream) {
    stream.acceptWaveform(16000, m.samples)
    while (kws.isReady(stream)) {
      kws.decode(stream)
      const r = kws.getResult(stream)
      if (r.keyword) {
        kws.reset(stream)
        self.postMessage({ type: 'wake', keyword: r.keyword })
      }
    }
  }
}

try {
  importScripts('sherpa-onnx-wasm-kws-main.js', 'sherpa-onnx-kws.js')
} catch (e) {
  self.postMessage({ type: 'error', message: String(e && e.message || e) })
}
