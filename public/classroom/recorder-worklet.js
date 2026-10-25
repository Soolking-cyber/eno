// eno Classroom — the learner's microphone, frame by frame (src/components/classroom/session/use-recorder.ts).
// An AudioWorklet so capture never stutters with the page's own work; it only hands the raw Float32 frames to the page,
// which keeps them in memory, downsamples them to 16 kHz mono PCM16 (src/lib/classroom/wav.ts) and sends ONE WAV per
// turn. Nothing here stores, encodes or sends anything. A same-origin file because the CSP allows no blob: scripts.
class ClassroomRecorder extends AudioWorkletProcessor {
  constructor() {
    super()
    this.on = false
    this.port.onmessage = (e) => { this.on = e.data === 'start' }
  }

  // ⚠️ `outputs` stay untouched (silence): the node is wired to the speakers only so WebKit runs it (use-recorder.ts).
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (this.on && channel && channel.length) this.port.postMessage(channel.slice(0))
    return true
  }
}

registerProcessor('classroom-recorder', ClassroomRecorder)
