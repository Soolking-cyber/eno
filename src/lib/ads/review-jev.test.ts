import { describe, expect, it } from 'vitest'
import { AD_QUESTIONS, AD_QUESTION_KEYS, JEV_AD_CALIBRATION, JEV_AD_MODEL, PERMIT_CLASSES, adReviewKey, jevAdVerdict, reviewCountsHere } from './review-jev'
import { REVIEW_REASONS } from './review-reasons'

/** The review's questions (owner 2026-11-25): every refusing class names a reason the policy page and the API can state. */
describe('review-jev', () => {
  it('every banned class and claim refuses with a reason that exists (the policy page renders them all)', () => {
    for (const k of AD_QUESTION_KEYS) {
      const q = AD_QUESTIONS[k] as { family: string; refusal?: string }
      if (q.family === 'permit') { expect(q.refusal, k).toBeUndefined(); continue }
      expect(q.refusal && Object.hasOwn(REVIEW_REASONS, q.refusal), k).toBe(true)
    }
    const refusals = AD_QUESTION_KEYS.map((k) => (AD_QUESTIONS[k] as { refusal?: string }).refusal).filter(Boolean)
    expect(new Set(refusals).size).toBe(refusals.length)
  })
  it('⛔ permit classes never refuse (owner 2026-11-25); visa services always do', () => {
    const all = Object.fromEntries(AD_QUESTION_KEYS.map((k) => [k, 0.01])) as Record<(typeof AD_QUESTION_KEYS)[number], number>
    for (const p of PERMIT_CLASSES) expect(jevAdVerdict({ ...all, [p]: 0.99 })).toEqual({ refusals: [], permitClasses: [p] })
    expect(jevAdVerdict({ ...all, visa_legal: 0.9 }).refusals).toEqual(['banned_visa_legal'])
  })
  it('⛔ the calibration belongs to the pinned model: re-pin JEV_AD_MODEL and this fails until a new measurement is recorded', () => {
    expect(JEV_AD_CALIBRATION?.model).toBe(JEV_AD_MODEL)
  })
  it('the review key names the models, the calibration and the thresholds; a provisional one counts only with the switch', () => {
    expect(adReviewKey('g#1')).toMatch(/^jev-1\.14\.0\+g#1@2026-11-25:t0\.5\/0\.6\/0\.5:q[0-9a-f]{8}$/)
    delete process.env.AD_REVIEW_ALLOW_PROVISIONAL
    expect(reviewCountsHere(adReviewKey('g'))).toBe(true)
    const provisional = adReviewKey('g').replace('@2026-11-25:', '@provisional:')
    expect(reviewCountsHere(provisional)).toBe(false)
    process.env.AD_REVIEW_ALLOW_PROVISIONAL = '1'
    expect(reviewCountsHere(provisional)).toBe(true)
    delete process.env.AD_REVIEW_ALLOW_PROVISIONAL
  })
})
