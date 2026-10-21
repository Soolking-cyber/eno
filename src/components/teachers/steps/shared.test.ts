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
    expect(errText('experience.0', 'incomplete')).toBe('Fill in the role and the school or company, or remove this job.')
  })

  it('the other certificate codes keep their own words', () => {
    expect(errText('certificates.0', 'duplicate')).toBe('This certificate is already listed.')
    expect(errText('certificates.0', 'hours_range')).toBe('Please enter between 1 and 2,000 hours.')
  })

  // ⛔ Owner, 2026-10-21: "I am unable to know which word that is" — a refused text now QUOTES the teacher's own words.
  it('a refused text quotes the teacher\'s own words; with none to point at, the general line stays', () => {
    expect(errText('bio', 'banned_words', ['I hold a valid work visa until March.'])).toBe('We can’t publish this: “visa”. Please rephrase or remove it.')
    expect(errText('bio', 'contact_in_text', ['Call me on 0901 234 567 any time.'])).toMatch(/^Please remove this: “[^”]*0901 234 567[^”]*” — the person you are chatting with/)
    expect(errText('bio', 'banned_words')).toBe('This contains a word we do not allow. Please rephrase it.')
    expect(errText('bio', 'banned_words', ['I teach young learners.'])).toBe('This contains a word we do not allow. Please rephrase it.')
    expect(errText('experience.1', 'banned_words', ['Teacher', 'Visa help desk', 'Hanoi'])).toBe('We can’t publish this: “Visa”. Please rephrase or remove it.')
    // A name cannot be reworded: the human route instead.
    expect(errText('fullName', 'banned_words', ['Visa Mäkinen'])).toBe('We can’t publish this: “Visa”. If this is your name as written on your ID, tell us from the Help page.')
  })

  it('⛔ eno.vn\'s own words name no visa (licensing): only the teacher\'s quote can', () => {
    const line = errText('bio', 'banned_words', ['Thẻ cào lậu giá rẻ'])
    expect(line).toBe('We can’t publish this: “Thẻ cào lậu”. Please rephrase or remove it.')
    expect(line.replace(/“[^”]*”/g, '')).not.toMatch(/visa|thị thực|thi thuc/i)
    expect(errText('bio', 'banned_words', ['work visa']).replace(/“[^”]*”/g, '')).not.toMatch(/visa|thị thực|thi thuc/i)
  })
})
