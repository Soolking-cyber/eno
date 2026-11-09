/**
 * The one audio format a learner turn travels in: WAV, PCM 16-bit, mono, 16 kHz — what the recorder worklet writes
 * (public/classroom/recorder-worklet.js) and what Azure's short-audio API takes as is. Client-safe and pure: the browser
 * encodes with `encodeWav`, the server checks every upload with `parseWav` before a byte goes anywhere.
 */
export const SAMPLE_RATE = 16_000

/** 16-bit PCM samples → a WAV file (44-byte header). */
export function encodeWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const data = pcm.byteLength
  const out = new Uint8Array(44 + data)
  const v = new DataView(out.buffer)
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)) }
  ascii(0, 'RIFF'); v.setUint32(4, 36 + data, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  ascii(36, 'data'); v.setUint32(40, data, true)
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44)
  return out
}

export type WavInfo = { ms: number; peak: number }

/**
 * Is this exactly the format we send — RIFF/WAVE, PCM, mono, 16 kHz (or `rate`: the own-voice recording's 24 kHz), 16-bit,
 * data length consistent — and how long is it? Null for anything else. `peak` is the loudest sample (0–32767): near-silence
 * never needs a speech service.
 */
export function parseWav(bytes: Uint8Array, rate: number = SAMPLE_RATE): WavInfo | null {
  if (bytes.length < 44) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data') return null
  if (v.getUint32(16, true) !== 16 || v.getUint16(20, true) !== 1 || v.getUint16(22, true) !== 1) return null
  if (v.getUint32(24, true) !== rate || v.getUint16(34, true) !== 16) return null
  // Every field that restates the format must agree with it (core review, codex): the byte rate, the block size, and
  // the RIFF size against the real length — a header that contradicts itself is not the file we send.
  if (v.getUint32(28, true) !== rate * 2 || v.getUint16(32, true) !== 2) return null
  if (v.getUint32(4, true) !== bytes.length - 8) return null
  const dataLen = v.getUint32(40, true)
  if (dataLen % 2 !== 0 || dataLen !== bytes.length - 44) return null
  let peak = 0
  for (let i = 44; i + 1 < bytes.length; i += 2) {
    const s = Math.min(32_767, Math.abs(v.getInt16(i, true))) // -32768 counts as full scale, 32767
    if (s > peak) peak = s
  }
  return { ms: Math.round((dataLen / 2 / rate) * 1000), peak }
}

/** The low-pass's taps: a Hann-windowed sinc, unity gain at DC, `half` taps either side of the centre. */
export function lowPassTaps(cutoff: number, half: number): Float32Array {
  const taps = new Float32Array(2 * half + 1)
  let sum = 0
  for (let k = -half; k <= half; k++) {
    const x = 2 * cutoff * k
    const sinc = k === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
    const w = 0.5 + 0.5 * Math.cos((Math.PI * k) / (half + 1))
    taps[k + half] = sinc * w
    sum += sinc * w
  }
  for (let k = 0; k < taps.length; k++) taps[k] /= sum
  return taps
}

/** The low-pass in front of the decimation (lowPassTaps). */
function lowPass(input: Float32Array, cutoff: number, half: number): Float32Array {
  const taps = lowPassTaps(cutoff, half)
  const out = new Float32Array(input.length)
  for (let i = 0; i < input.length; i++) {
    let acc = 0
    const lo = Math.max(0, i - half)
    const hi = Math.min(input.length - 1, i + half)
    for (let j = lo; j <= hi; j++) acc += input[j] * taps[j - i + half]
    out[i] = acc
  }
  return out
}

/**
 * THE OWN-VOICE TAKE BROUGHT UP TO FULL LEVEL (owner, 2026-11-09: "it says voice too quiet and even i speak close to phone it
 * barely picks up"): its loudest moment at `target` by one plain gain — a volume change, which a clone does not hear as
 * processing. ⛔ NOTHING IS CLIPPED (a percentile gain flattened every strong "p"/"t" — gate, opus), and ⛔ A CLICK DOES NOT
 * SET THE GAIN (a knock, a tap thump anywhere in the take — gate, codex + opus): the voice's own level is the 98th
 * percentile of its 10 ms window peaks, and only a window far louder than that (> TRANSIENT × the voice) is brought down
 * to the voice's level, its edges eased over the neighbouring windows — normal speech peaks (up to TRANSIENT × the voice)
 * are never touched. At most `maxGain` (+26 dB). Returns a new array and the gain used; silence comes back as it was.
 */
export function peakNormalize(input: Float32Array, target = 0.89, maxGain = 20, rate = 48_000): { samples: Float32Array; gain: number } {
  if (!(peakOf(input) > 0)) return { samples: input, gain: 1 }
  const w = Math.max(1, Math.round(rate / 100))
  const windows = Math.ceil(input.length / w)
  const peaks = new Float32Array(windows)
  for (let k = 0; k < windows; k++) peaks[k] = peakOf(input.subarray(k * w, Math.min(input.length, (k + 1) * w)))
  const sorted = Float32Array.from(peaks).sort()
  const voice = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] || peakOf(input)
  // Each window's own gain: 1, or down to the voice's level for a transient; eased linearly between window centres.
  const wg = Float32Array.from(peaks, (p) => (p > TRANSIENT * voice ? voice / p : 1))
  const out = new Float32Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const x = i / w - 0.5
    const k0 = Math.max(0, Math.min(windows - 1, Math.floor(x)))
    const k1 = Math.min(windows - 1, k0 + 1)
    const t = Math.max(0, Math.min(1, x - k0))
    const g = Math.min(wg[Math.max(0, Math.min(windows - 1, Math.round(i / w - 0.5)))], wg[k0] + (wg[k1] - wg[k0]) * t)
    out[i] = input[i] * g
  }
  const peak = peakOf(out)
  const gain = Math.min(maxGain, target / peak)
  for (let i = 0; i < out.length; i++) out[i] *= gain
  return { samples: out, gain }
}
/** A window this many times louder than the voice's level is a click, a knock or a tap — not speech. */
const TRANSIENT = 2.5

/** The loudest sample, 0–1. */
export function peakOf(input: Float32Array): number {
  let peak = 0
  for (let i = 0; i < input.length; i++) { const a = Math.abs(input[i]); if (a > peak) peak = a }
  return peak
}

/** The take without its first and last `ms` — where the Start and Stop taps land, and nobody is speaking yet. */
export function trimEnds(input: Float32Array, rate: number, ms = 150): Float32Array {
  const cut = Math.round((rate * ms) / 1000)
  return input.length > cut * 4 ? input.subarray(cut, input.length - cut) : input
}

/**
 * Float32 samples at the device's rate → 16 kHz Int16. ⛔ LOW-PASS FIRST (round 10, opus): plain interpolation from
 * 44.1/48 kHz folds everything above 8 kHz — the sibilants — back into the speech band, and Azure's pronunciation scores
 * pay for it. So a windowed-sinc low-pass at 6.7 kHz (0.42 of the output rate) runs at the input rate, then linear
 * interpolation picks the 16 kHz samples. A device at 16 kHz or slower has nothing above its own Nyquist to fold: it is
 * only interpolated (an 8 kHz headset upsamples).
 */
export function toPcm16k(input: Float32Array, inputRate: number): Int16Array {
  return toPcmAt(input, inputRate, SAMPLE_RATE)
}

/** toPcm16k at any output rate (the own-voice recording's 24 kHz — iOS ignores a rate asked of its AudioContext). */
export function toPcmAt(input: Float32Array, inputRate: number, outRate: number): Int16Array {
  if (!(inputRate > 0) || !(outRate > 0) || !input.length) return new Int16Array(0)
  const ratio = inputRate / outRate
  const src = ratio > 1 ? lowPass(input, (0.42 * outRate) / inputRate, Math.round(11 * ratio)) : input
  const n = Math.floor(src.length / ratio)
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const x = i * ratio
    const i0 = Math.floor(x)
    const i1 = Math.min(i0 + 1, src.length - 1)
    const s = src[i0] + (src[i1] - src[i0]) * (x - i0)
    out[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)))
  }
  return out
}

/**
 * toPcm16k FOR A STREAM (live listening, live-stt.ts): the same low-pass and interpolation, fed frame by frame — the filter
 * keeps its history across frames, so a frame boundary leaves no seam (cutting the stream into separately filtered pieces
 * would put a click every 100 ms into what Soniox hears). Returns a function: Float32 frames in, 16 kHz Int16 out.
 */
export function streamTo16k(inputRate: number): (frame: Float32Array) => Int16Array {
  const ratio = inputRate / SAMPLE_RATE
  const half = ratio > 1 ? Math.round(11 * ratio) : 0
  const taps = ratio > 1 ? lowPassTaps((0.42 * SAMPLE_RATE) / inputRate, half) : null
  let buf = new Float32Array(0)
  // The next output sample's position in `buf`: it needs `half` samples of history before it.
  let pos = half
  const at = (i: number) => {
    if (!taps) return buf[i]
    let acc = 0
    for (let k = -half; k <= half; k++) acc += buf[i + k] * taps[k + half]
    return acc
  }
  return (frame) => {
    if (!(inputRate > 0) || !frame.length) return new Int16Array(0)
    const joined = new Float32Array(buf.length + frame.length)
    joined.set(buf)
    joined.set(frame, buf.length)
    buf = joined
    const out: number[] = []
    while (Math.floor(pos) + 1 + half < buf.length) {
      const i0 = Math.floor(pos)
      const a = at(i0)
      const s = a + (at(i0 + 1) - a) * (pos - i0)
      out.push(Math.max(-32768, Math.min(32767, Math.round(s * 32767))))
      pos += ratio
    }
    const keep = Math.max(0, Math.floor(pos) - half)
    buf = buf.slice(keep)
    pos -= keep
    return Int16Array.from(out)
  }
}
