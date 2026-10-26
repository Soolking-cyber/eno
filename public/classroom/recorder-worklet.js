// eno Classroom — the learner's microphone, frame by frame (src/components/classroom/session/use-recorder.ts).
// An AudioWorklet so capture never stutters with the page's own work. Two jobs on the audio thread:
//  1. TURNS — while recording, hand every raw Float32 frame to the page, which keeps them in memory, downsamples them
//     to 16 kHz mono PCM16 (src/lib/classroom/wav.ts) and sends ONE WAV per turn. Nothing here stores or sends anything.
//  2. HANDS-FREE — a level detector with a learned noise floor says when the learner starts and stops speaking, like a
//     video call (owner, 2026-10-26: "student can talk directly like in a video call"). On speech-start it switches
//     recording on ITSELF (no round trip to the page, so no syllable is lost) and hands the page the last PRE_ROLL of
//     audio, so the first sound of the turn is in it too.
// A same-origin file because the CSP allows no blob: scripts.
class ClassroomRecorder extends AudioWorkletProcessor {
  constructor() {
    super()
    this.recording = false
    /** { minLevel, startRatio, endRatio, startMs, endMs, preRollMs } while listening hands-free, else null. */
    this.vad = null
    this.floor = 0.004
    this.speech = false
    this.aboveMs = 0
    this.belowMs = 0
    this.preRoll = []
    this.preRollMs = 0
    this.port.onmessage = (e) => {
      const m = e.data
      if (m === 'start') this.recording = true
      else if (m === 'stop') this.recording = false
      else if (m && m.type === 'vad') { this.vad = m.vad; this.speech = false; this.aboveMs = 0; this.belowMs = 0 }
      else if (m && m.type === 'vad-off') { this.vad = null; this.speech = false; this.preRoll = []; this.preRollMs = 0 }
    }
  }

  // ⚠️ `outputs` stay untouched (silence): the node is wired to the speakers only so WebKit runs it (use-recorder.ts).
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch || !ch.length) return true
    if (this.recording) this.port.postMessage(ch.slice(0))
    const v = this.vad
    if (!v) return true
    const ms = (ch.length / sampleRate) * 1000
    let sum = 0
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]
    const level = Math.sqrt(sum / ch.length)
    const startAt = Math.max(v.minLevel, this.floor * v.startRatio)
    if (!this.speech) {
      // The last PRE_ROLL of audio, so a turn that starts on a soft consonant keeps it.
      this.preRoll.push(ch.slice(0))
      this.preRollMs += ms
      while (this.preRollMs > v.preRollMs && this.preRoll.length > 1) { this.preRollMs -= (this.preRoll.shift().length / sampleRate) * 1000 }
      // The noise floor is learned from quiet frames only — a room's hum, a fan — and slowly, so speech never raises it.
      if (level < startAt) this.floor = this.floor * 0.995 + level * 0.005
      this.aboveMs = level >= startAt ? this.aboveMs + ms : Math.max(0, this.aboveMs - ms)
      if (this.aboveMs >= v.startMs) {
        this.speech = true
        this.belowMs = 0
        this.recording = true
        this.port.postMessage({ type: 'speech-start', preRoll: this.preRoll, level, floor: this.floor })
        this.preRoll = []
        this.preRollMs = 0
      }
    } else {
      const endAt = Math.max(v.minLevel * 0.7, this.floor * v.endRatio)
      this.belowMs = level < endAt ? this.belowMs + ms : 0
      if (this.belowMs >= v.endMs) {
        this.speech = false
        this.aboveMs = 0
        this.port.postMessage({ type: 'speech-end', silenceMs: this.belowMs })
      }
    }
    return true
  }
}

registerProcessor('classroom-recorder', ClassroomRecorder)
