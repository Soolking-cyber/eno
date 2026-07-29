import { describe, expect, it } from 'vitest'
import { evaluatePassportImageQuality, evaluatePortraitImageQuality, PORTRAIT_ADVISORY_CODES } from './image-quality'
import { emptyVisaPayload, validateVisaForReview } from './schema'

/**
 * The 2026-07-29 portrait relaxation: four of eleven checks stopped blocking, and `unavailable`
 * stopped blocking at all. Both are policy decisions with money behind them — the government fee
 * is non-refundable — so they are pinned here rather than left to be re-derived from the maps.
 */

const ALL_PORTRAIT_CHECKS = {
  correctPortraitPhoto: true, singlePerson: true, clearImage: true, straightFace: true,
  noHat: true, noGlasses: true, formalClothes: true, whiteBackground: true,
  faceCentered: true, headAndShouldersVisible: true, evenLighting: true,
}

describe('portrait severity split', () => {
  it('a perfect portrait passes with nothing to say', () => {
    const result = evaluatePortraitImageQuality(ALL_PORTRAIT_CHECKS)
    expect(result.status).toBe('passed')
    expect(result.issues).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it.each([
    ['whiteBackground', 'use_plain_white_background'],
    ['formalClothes', 'wear_formal_clothes'],
    ['faceCentered', 'center_face_in_photo'],
    ['evenLighting', 'portrait_lighting_uneven'],
  ])('%s only WARNS — the photo still passes', (check, code) => {
    const result = evaluatePortraitImageQuality({ ...ALL_PORTRAIT_CHECKS, [check]: false })
    // The status is what schema.ts gates the applicant on. If this ever flips to 'failed' the
    // demotion has been silently undone.
    expect(result.status).toBe('passed')
    expect(result.issues).toEqual([])
    expect(result.warnings).toContain(code)
  })

  it.each([
    ['correctPortraitPhoto', 'not_compliant_portrait'],
    ['singlePerson', 'portrait_must_show_one_person'],
    ['clearImage', 'portrait_image_blurry'],
    ['straightFace', 'face_must_look_straight'],
    ['noHat', 'remove_hat'],
    ['noGlasses', 'remove_glasses'],
    ['headAndShouldersVisible', 'show_head_and_shoulders'],
  ])('%s still BLOCKS', (check, code) => {
    const result = evaluatePortraitImageQuality({ ...ALL_PORTRAIT_CHECKS, [check]: false })
    expect(result.status).toBe('failed')
    expect(result.issues).toContain(code)
  })

  it('the two buckets never overlap, so a code cannot be both a wall and a warning', () => {
    const failEverything = evaluatePortraitImageQuality({})
    const overlap = failEverything.issues.filter((code) => failEverything.warnings.includes(code))
    expect(overlap).toEqual([])
    expect(failEverything.issues).toHaveLength(7)
    expect(failEverything.warnings).toHaveLength(4)
    expect([...PORTRAIT_ADVISORY_CODES].sort()).toEqual(failEverything.warnings.sort())
  })

  it('reproduces the real 2026-07-28 abandonment, and shows what changed for it', () => {
    // The only applicant who ever reached this step, attempt 1 (from the portrait_analyzed event):
    // correctPortraitPhoto / clearImage / whiteBackground / headAndShouldersVisible all false.
    const attemptOne = evaluatePortraitImageQuality({
      ...ALL_PORTRAIT_CHECKS,
      correctPortraitPhoto: false, clearImage: false, whiteBackground: false, headAndShouldersVisible: false,
    })
    // Still refused — three of their four problems were real and remain blocking. This change was
    // never going to rescue that photo, and the tests should not pretend otherwise.
    expect(attemptOne.status).toBe('failed')
    expect(attemptOne.issues).toEqual(['not_compliant_portrait', 'portrait_image_blurry', 'show_head_and_shoulders'])
    // But the background complaint is now advice rather than a fourth wall — and on their second
    // attempt three minutes later the model swapped it for `wear_formal_clothes`, which is the
    // noise this split exists to stop charging people for.
    expect(attemptOne.warnings).toEqual(['use_plain_white_background'])
  })

  it('passport advisory checks are untouched by the portrait change', () => {
    const result = evaluatePassportImageQuality({
      correctPassportBiodataPage: true, singleDataPage: true, clearImage: true, printedTextReadable: true,
      noSignificantGlare: false, fullPageVisible: true, allCornersVisible: true, mrzReadable: true,
    })
    expect(result.status).toBe('passed')
    expect(result.warnings).toContain('passport_image_has_glare')
  })
})

describe('⚠️ `unavailable` is our outage and must not block the applicant', () => {
  // validateVisaForReview emits plenty of other codes for an empty payload; this suite asserts
  // only on the portrait document code, which is the one the status drives.
  const portraitIssues = (status: string) =>
    validateVisaForReview(emptyVisaPayload('a@b.com'), [
      { kind: 'portrait', validation_status: status },
      { kind: 'passport', validation_status: 'passed' },
    ])

  it('does not raise portrait_image_not_verified when the check never ran', () => {
    // Written on three paths that say nothing about the image: rate limits (per-user AND the
    // shared ai-global budget), getGemini() null, and any thrown error. Nothing could clear it —
    // the extract routes are the only writers of validation_status in either app, so before this
    // change an applicant who caught an outage was stuck with no action available to them.
    expect(portraitIssues('unavailable')).not.toContain('portrait_image_not_verified')
  })

  it('still blocks on failed — the check ran and refused the photo', () => {
    expect(portraitIssues('failed')).toContain('portrait_image_not_verified')
  })

  it('still blocks on pending — the analysis is in flight, do not race it', () => {
    expect(portraitIssues('pending')).toContain('portrait_image_not_verified')
  })

  it('passes when the portrait passed', () => {
    expect(portraitIssues('passed')).not.toContain('portrait_image_not_verified')
  })
})
