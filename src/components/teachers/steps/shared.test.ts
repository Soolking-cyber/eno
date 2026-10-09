/**
 * The teacher form's error words (steps/shared.tsx makeErrText): a code is worded for the FIELD it sits on wherever a
 * generic line would not say what to do.
 */
import { describe, expect, it } from 'vitest'
import { makeErrText } from './shared'

const errText = makeErrText((en) => en)

describe('makeErrText', () => {
  it('⛔ a certificate row with no type says what to do — never the teaching-job words (gate review, 2026-10-08)', () => {
    // Only a draft from the previous form holds one: it added a row before its type was picked.
    expect(errText('certificates.0', 'incomplete')).toBe('It has no type — remove it, then tap the right certificate above.')
    expect(errText('certificates.3', 'incomplete')).not.toMatch(/role|school|job/)
    expect(errText('experience.0', 'incomplete')).toBe('Fill in the role and the school, or remove this job.')
  })

  it('the other certificate codes keep their own words', () => {
    expect(errText('certificates.0', 'duplicate')).toBe('This certificate is already listed.')
    expect(errText('certificates.0', 'hours_range')).toBe('Please enter between 1 and 2,000 hours.')
  })
})
