import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TRUST } from '../../../lib/trust-math'
import { VI_OVERRIDES } from '@/generated/vi-overrides'

/**
 * ⛔ /trust PUBLISHES ONLY BANDS A SCORE CAN REACH.
 *
 * The ladder opened with "Elite · 160 and up" for as long as Trust v2 has clamped every score at
 * TRUST.MAX = 150 (composeScore) — a tier the page described, in colour, that no account could ever
 * be in (C-TRUST, removed 2026-09-29 with the owner's approval). trust-score.ts keeps 160 as internal
 * headroom deliberately; the defect was only ever the PUBLIC claim, so this test reads the page, not
 * the display bands.
 *
 * If TRUST.MAX is ever raised, the top band's upper bound here fails first — re-add the band then.
 */
describe('/trust ladder matches the score range', () => {
  // Comments may name the removed band to explain it; only code and copy count.
  const src = readFileSync('src/app/[lang]/trust/page.tsx', 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, '$1')
  const bands = [...src.matchAll(/<Band score=\{(\d+)\}[^>]*?range="(\d+)(?:–(\d+))?"/g)].map((m) => ({
    score: Number(m[1]),
    low: Number(m[2]),
    high: m[3] === undefined ? null : Number(m[3]),
  }))

  it('finds the numeric bands (the scan is not vacuous)', () => {
    expect(bands.length).toBeGreaterThanOrEqual(3)
  })

  it.each(bands)('band at score $score (from $low) is reachable', ({ score, low, high }) => {
    expect(score).toBeLessThanOrEqual(TRUST.MAX)
    expect(low).toBeLessThanOrEqual(TRUST.MAX)
    if (high !== null) {
      expect(high).toBeLessThanOrEqual(TRUST.MAX)
      expect(score).toBeGreaterThanOrEqual(low)
      expect(score).toBeLessThanOrEqual(high)
    }
  })

  it('the top band ends exactly at TRUST.MAX', () => {
    const highs = bands.map((b) => b.high ?? 0)
    expect(Math.max(...highs)).toBe(TRUST.MAX)
  })

  it('the unreachable Elite band is not published', () => {
    expect(src).not.toMatch(/name="Elite"/)
    expect(src).not.toMatch(/160 and up/)
  })
})

/**
 * ⛔ THE VERIFICATION ROW STATES TRUST'S OWN GATES (owner, 2026-10-15): a verified identity counts +V_KYC while it is
 * current — not "one-time", and never business verification — and its curated Vietnamese says the same, with "xác minh"
 * (Decree 69/2024 reserves "xác thực"). The pattern of scam-hold-copy.test.ts: the page's own literal, then its override.
 */
describe('/trust Verification row states TRUST’s gates', () => {
  const src = readFileSync('src/app/[lang]/trust/page.tsx', 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, '$1')
  const row = src.match(/\['Verification', (\d+), '([^']+)'\]/)
  const sub = row?.[2] ?? ''

  it('finds the row (the scan is not vacuous)', () => { expect(row).toBeTruthy() })

  it('its points and every gate are TRUST’s', () => {
    expect(Number(row?.[1])).toBe(TRUST.V_PHONE + TRUST.V_KYC + TRUST.V_AGE)
    expect(sub).toContain(`verified phone +${TRUST.V_PHONE}`)
    expect(sub).toContain(`+${TRUST.V_KYC} while it is current`)
    expect(sub).toContain(`older than ${TRUST.V_AGE_DAYS} days +${TRUST.V_AGE}`)
    expect(sub).not.toMatch(/business identity|\(KYC\)|One-time/)
  })

  it('its curated Vietnamese says the same — "xác minh", never "xác thực"', () => {
    const vi = VI_OVERRIDES[sub]
    expect(vi).toBeTruthy()
    expect(vi).toContain(`+${TRUST.V_KYC} khi còn hiệu lực`)
    expect(vi).toContain('xác minh')
    expect(vi).not.toContain('xác thực')
  })
})
