// The microphone as 16 kHz mono, 100 ms at a time, for the wake word worker. Browsers capture at 44.1 or 48 kHz;
// each output sample is the average of the input samples it covers (a simple low-pass, then decimation), which is
// what the keyword spotter was measured against (frontend/wake-engine/README.md).
const OUT_RATE = 16000
const CHUNK = 1600

class Capture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.step = sampleRate / OUT_RATE
    this.buf = new Float32Array(CHUNK)
    this.n = 0
    this.pos = 0
    this.sum = 0
    this.count = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i]
      this.count++
      this.pos += 1
      if (this.pos >= this.step) {
        this.pos -= this.step
        this.buf[this.n++] = this.sum / this.count
        this.sum = 0
        this.count = 0
        if (this.n === CHUNK) {
          this.port.postMessage(this.buf, [this.buf.buffer])
          this.buf = new Float32Array(CHUNK)
          this.n = 0
        }
      }
    }
    return true
  }
}

registerProcessor('keynection-capture', Capture)
