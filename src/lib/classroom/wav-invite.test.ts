import { describe, expect, it } from 'vitest'
import { encodeWav, parseWav, toPcm16k, SAMPLE_RATE } from './wav'
import { INVITE_ALPHABET, INVITE_CODE_LENGTH, inviteCodeFrom, isInviteCodeShape, normalizeInviteCode } from './invite-code'

describe('the turn WAV', () => {
  it('round-trips: 1 s at 16 kHz is 1000 ms, its loudest sample measured', () => {
    const pcm = new Int16Array(SAMPLE_RATE)
    pcm[100] = 12_000
    pcm[200] = -20_000
    const info = parseWav(encodeWav(pcm))
    expect(info).toEqual({ ms: 1000, peak: 20_000 })
  })
  it('refuses anything that is not exactly 16 kHz mono PCM16 with a consistent length', () => {
    const good = encodeWav(new Int16Array(160))
    const bad = (mutate: (v: DataView) => void) => { const c = good.slice(); mutate(new DataView(c.buffer)); return parseWav(c) }
    expect(bad((v) => v.setUint32(24, 44_100, true))).toBeNull()
    expect(bad((v) => v.setUint16(22, 2, true))).toBeNull()
    expect(bad((v) => v.setUint16(20, 3, true))).toBeNull()
    expect(bad((v) => v.setUint32(40, 999, true))).toBeNull()
    expect(bad((v) => v.setUint32(4, 999, true))).toBeNull() // RIFF size
    expect(bad((v) => v.setUint32(28, 44_100, true))).toBeNull() // byte rate
    expect(bad((v) => v.setUint16(32, 4, true))).toBeNull() // block align
    expect(parseWav(new Uint8Array(10))).toBeNull()
    expect(parseWav(new TextEncoder().encode('RIFF....WAVEfmt nonsense that is long enough to pass the size check'))).toBeNull()
  })
  it('upsamples an 8 kHz device to 16 kHz inside the input (round 5, opus: no read past the end)', () => {
    const out = toPcm16k(new Float32Array(8_000).fill(0.5), 8_000)
    expect(out.length).toBe(16_000)
    expect(out.every((s) => s === 16_384)).toBe(true)
    expect(toPcm16k(new Float32Array(10), 0).length).toBe(0)
  })
  it('⛔ downsampling filters first: a 12 kHz tone does not fold into the speech band; 1 kHz passes (round 10, opus)', () => {
    const tone = (hz: number, rate: number) => Float32Array.from({ length: rate }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate))
    const rms = (a: ArrayLike<number>, scale = 1) => { let s = 0; for (let i = 200; i < a.length - 200; i++) s += (a[i] / scale) ** 2; return Math.sqrt(s / (a.length - 400)) }
    for (const rate of [48_000, 44_100]) {
      const inRms = rms(tone(1_000, rate))
      expect(rms(toPcm16k(tone(1_000, rate), rate), 32_767) / inRms).toBeGreaterThan(0.95) // speech passes
      expect(rms(toPcm16k(tone(12_000, rate), rate), 32_767) / inRms).toBeLessThan(0.05) // would alias to 4 kHz unfiltered
    }
  })
  it('downsamples 48 kHz floats to 16 kHz, clipped to PCM16', () => {
    const f = new Float32Array(48_000).fill(2)
    const out = toPcm16k(f, 48_000)
    expect(out.length).toBe(16_000)
    expect(out[0]).toBe(32_767)
  })
})

describe('invite codes', () => {
  it('12 letters from the look-alike-free alphabet', () => {
    let n = 0
    const code = inviteCodeFrom((k) => Uint8Array.from({ length: k }, () => (n++ * 37) % 256))
    expect(code).toHaveLength(INVITE_CODE_LENGTH)
    expect(isInviteCodeShape(code)).toBe(true)
    for (const c of '01ilo') expect(INVITE_ALPHABET).not.toContain(c)
  })
  it('rejection sampling never maps the bytes past the even range', () => {
    // 248 = 256 − 256 % 31: bytes ≥ 248 are skipped, so a source of only those bytes plus valid ones still yields valid letters.
    let i = 0
    const src = [255, 250, 0, 248, 30, 249, 5]
    const code = inviteCodeFrom((k) => Uint8Array.from({ length: k }, () => src[i++ % src.length]))
    expect(isInviteCodeShape(code)).toBe(true)
  })
  it('shape check refuses everything else', () => {
    expect(isInviteCodeShape('abcdefghjkmn')).toBe(true)
    expect(isInviteCodeShape('ABCDEFGHJKMN')).toBe(false)
    expect(isInviteCodeShape('abc')).toBe(false)
    expect(isInviteCodeShape('abcdefghjkm0')).toBe(false)
    expect(isInviteCodeShape(null)).toBe(false)
  })
  it('a typed code is normalised first: trimmed, lowercased', () => {
    expect(isInviteCodeShape(normalizeInviteCode(' Abcdefghjkmn '))).toBe(true)
    expect(normalizeInviteCode(42)).toBe('')
  })
})
