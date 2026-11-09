import { describe, expect, it } from 'vitest'
import { pickScript, scriptKey, scriptMatch, scriptOf, SCRIPT_LENGTH, SCRIPT_MATCH_MIN, SENTENCES, wordsOf } from './own-voice-script'

// The sentences a teacher reads for their own voice (own-voice.ts): random, single use, checked against what was heard.
describe('the script', () => {
  it('distinct sentences from the pool, a different set each time, and the stored form round-trips', () => {
    let seed = 1
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const a = pickScript(rand)
    const b = pickScript(rand)
    expect(a).toHaveLength(SCRIPT_LENGTH)
    expect(new Set(a).size).toBe(SCRIPT_LENGTH)
    expect(a).not.toEqual(b)
    expect(scriptOf(scriptKey(a))).toEqual(a.map((i) => SENTENCES[i]))
  })
  it('⛔ a stored script that is not one is refused (out of range, repeated, malformed)', () => {
    for (const bad of ['', '1,2,3', '1,2,3,999', '1,1,2,3', 'a,b,c,d', '1;2;3;4']) expect(scriptOf(bad)).toBeNull()
  })
  it('every sentence is short enough to read in one breath and has words to match', () => {
    for (const s of SENTENCES) { expect(s.length).toBeLessThan(110); expect(wordsOf(s).length).toBeGreaterThan(5) }
  })
})

describe('⛔ the words heard must be THIS script, in order', () => {
  const script = [SENTENCES[0], SENTENCES[5], SENTENCES[12], SENTENCES[20], SENTENCES[30], SENTENCES[38]]
  it('read as written (STT punctuation and case aside): a match', () => {
    expect(scriptMatch(script.join(' ').toUpperCase().replace(/[.,?]/g, ''), script)).toBe(1)
  })
  it('a cough, a "sorry" and a re-read sentence cost nothing; a few words the STT missed stay above the bar', () => {
    const heard = `um ${script.join(' sorry ')} ${script[2]}`.replace(/\bbooks\b|\bclear\b|\bplease\b/g, '')
    expect(scriptMatch(heard, script)).toBeGreaterThanOrEqual(SCRIPT_MATCH_MIN)
  })
  it('⛔ another script (an old recording), half of this one, or the sentences out of order: refused', () => {
    expect(scriptMatch([SENTENCES[1], SENTENCES[2], SENTENCES[3], SENTENCES[4], SENTENCES[6], SENTENCES[7]].join(' '), script)).toBeLessThan(SCRIPT_MATCH_MIN)
    expect(scriptMatch(script.slice(0, 3).join(' '), script)).toBeLessThan(SCRIPT_MATCH_MIN)
    expect(scriptMatch([...script].reverse().join(' '), script)).toBeLessThan(SCRIPT_MATCH_MIN)
    expect(scriptMatch('', script)).toBe(0)
  })
})
