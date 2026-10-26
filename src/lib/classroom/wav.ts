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
 * Is this exactly the format we send — RIFF/WAVE, PCM, mono, 16 kHz, 16-bit, data length consistent — and how long is it?
 * Null for anything else. `peak` is the loudest sample (0–32767): near-silence never needs a speech service.
 */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data') return null
  if (v.getUint32(16, true) !== 16 || v.getUint16(20, true) !== 1 || v.getUint16(22, true) !== 1) return null
  if (v.getUint32(24, true) !== SAMPLE_RATE || v.getUint16(34, true) !== 16) return null
  // Every field that restates the format must agree with it (core review, codex): the byte rate, the block size, and
  // the RIFF size against the real length — a header that contradicts itself is not the file we send.
  if (v.getUint32(28, true) !== SAMPLE_RATE * 2 || v.getUint16(32, true) !== 2) return null
  if (v.getUint32(4, true) !== bytes.length - 8) return null
  const dataLen = v.getUint32(40, true)
  if (dataLen % 2 !== 0 || dataLen !== bytes.length - 44) return null
  let peak = 0
  for (let i = 44; i + 1 < bytes.length; i += 2) {
    const s = Math.min(32_767, Math.abs(v.getInt16(i, true))) // -32768 counts as full scale, 32767
    if (s > peak) peak = s
  }
  return { ms: Math.round((dataLen / 2 / SAMPLE_RATE) * 1000), peak }
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
 * Float32 samples at the device's rate → 16 kHz Int16. ⛔ LOW-PASS FIRST (round 10, opus): plain interpolation from
 * 44.1/48 kHz folds everything above 8 kHz — the sibilants — back into the speech band, and Azure's pronunciation scores
 * pay for it. So a windowed-sinc low-pass at 6.7 kHz (0.42 of the output rate) runs at the input rate, then linear
 * interpolation picks the 16 kHz samples. A device at 16 kHz or slower has nothing above its own Nyquist to fold: it is
 * only interpolated (an 8 kHz headset upsamples).
 */
export function toPcm16k(input: Float32Array, inputRate: number): Int16Array {
  if (!(inputRate > 0) || !input.length) return new Int16Array(0)
  const ratio = inputRate / SAMPLE_RATE
  const src = ratio > 1 ? lowPass(input, (0.42 * SAMPLE_RATE) / inputRate, Math.round(11 * ratio)) : input
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
