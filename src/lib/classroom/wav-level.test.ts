import { describe, expect, it } from 'vitest'
import { encodeWav, parseWav, peakNormalize, toPcmAt, trimEnds } from './wav'

// Owner, 2026-11-09: "it says voice too quiet and even i speak close to phone it barely picks up need to up sensitivity".
describe('the own-voice take is brought up to full level before it is sent', () => {
  const tone = (amp: number, n = 24_000) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 7))
  it('a quiet take (close speech without gain, ~-26 dBFS) comes out near full scale — and passes the server\'s check', () => {
    const { samples, gain } = peakNormalize(tone(0.05))
    expect(gain).toBeGreaterThan(15)
    const wav = encodeWav(toPcmAt(samples, 48_000, 24_000), 24_000)
    expect(parseWav(wav, 24_000)!.peak).toBeGreaterThan(25_000)
  })
  it('one gain for the whole take: the shape of the voice is unchanged', () => {
    const input = tone(0.1, 4_000)
    const { samples, gain } = peakNormalize(input)
    for (let i = 1; i < 200; i++) expect(samples[i] / input[i]).toBeCloseTo(gain, 5)
  })
  it('a tap thump in the last 150 ms is trimmed off before anything is measured', () => {
    const take = tone(0.03, 48_000)
    for (let i = 47_200; i < 47_400; i++) take[i] = 0.8 // a 4 ms thump in the last 150 ms (the Stop tap)
    expect(peakNormalize(trimEnds(take, 48_000)).gain).toBeGreaterThan(15)
  })
  it('⛔ a knock in the MIDDLE of the take (or a Stop thump 250 ms before the end) does not hold the voice down', () => {
    for (const at of [24_000, 48_000 - 12_000]) {
      const take = tone(0.03, 48_000)
      for (let i = at; i < at + 200; i++) take[i] = 0.8
      const { samples, gain } = peakNormalize(take)
      expect(gain).toBeGreaterThan(15)
      expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.89 + 1e-6)
      // …and the voice away from the knock is exactly the voice times the gain.
      expect(samples[5_000] / take[5_000]).toBeCloseTo(gain, 5)
    }
  })
  it('⛔ nothing is ever clipped: speech peaks above the rest stay their shape', () => {
    const take = tone(0.03, 48_000)
    take[20_000] = 0.06 // a plosive twice the rest
    const { samples } = peakNormalize(take)
    expect(samples[20_000]).toBeCloseTo(0.89, 5)
    expect(samples[20_000] / samples[20_007]).toBeCloseTo(0.06 / take[20_007], 5)
  })
  it('the first and last 150 ms (where the taps land) are left out', () => {
    expect(trimEnds(new Float32Array(48_000), 48_000).length).toBe(48_000 - 2 * 7_200)
    expect(trimEnds(new Float32Array(1_000), 48_000).length).toBe(1_000) // too short to trim
  })
  it('⛔ a take that is only room noise is not blown up past +26 dB, and silence stays silence', () => {
    expect(peakNormalize(tone(0.002)).gain).toBe(20)
    const silent = new Float32Array(100)
    expect(peakNormalize(silent)).toEqual({ samples: silent, gain: 1 })
  })
  it('a take already loud is turned down a touch, never clipped', () => {
    const { samples, gain } = peakNormalize(tone(1))
    expect(gain).toBeCloseTo(0.89, 2)
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.89 + 1e-6)
  })
})
