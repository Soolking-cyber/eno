import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { clampPace, defaultPace, paceOptions, paceRange, stepPace, VOICE_PACES, voiceStyle } from './pace'

/**
 * THE AVATAR'S PACE (owner, 2026-10-26: "kids very loud clear and slowly, adults may adjust pace by saying talk more
 * slowly"): where a learner starts, how far they may move, and that the speech server knows exactly these names.
 */
describe('pace', () => {
  it('a child starts at the slowest and can never be made faster than gentle; a teen or an adult may use them all', () => {
    expect(defaultPace('child-young', 'B2')).toBe('slowest')
    expect(defaultPace('child', 'C1', 'natural')).toBe('slowest')
    expect(paceRange('child')).toEqual(['slowest', 'gentle'])
    expect(stepPace('gentle', 'faster', 'child')).toBe('gentle')
    expect(stepPace('slowest', 'faster', 'child-young')).toBe('gentle')
    expect(paceRange('adult')).toEqual(VOICE_PACES)
    expect(paceRange('teen')).toEqual(VOICE_PACES)
  })
  it('a beginner, or a teacher who chose "Slow & simple", starts gentle; anyone else natural', () => {
    expect(defaultPace('adult', 'A1')).toBe('gentle')
    expect(defaultPace('teen', 'A2')).toBe('gentle')
    expect(defaultPace('adult', 'B1', 'slow')).toBe('gentle')
    expect(defaultPace('adult', 'B1', 'natural')).toBe('natural')
  })
  it('one step per request, inside the range; no room → the same pace', () => {
    expect(stepPace('natural', 'slower', 'adult')).toBe('gentle')
    expect(stepPace('gentle', 'slower', 'adult')).toBe('slowest')
    expect(stepPace('slowest', 'slower', 'adult')).toBe('slowest')
    expect(stepPace('natural', 'faster', 'adult')).toBe('quick')
    expect(stepPace('quick', 'faster', 'adult')).toBe('quick')
  })
  it('a saved choice is read back inside the learner\'s range NOW (a teen\'s "quick" never reaches them as a child — or junk at all)', () => {
    expect(clampPace('quick', 'child', 'slowest')).toBe('gentle')
    expect(clampPace('natural', 'child-young', 'slowest')).toBe('gentle')
    expect(clampPace('slowest', 'adult', 'natural')).toBe('slowest')
    expect(clampPace('NaN', 'adult', 'natural')).toBe('natural')
    expect(clampPace(undefined, 'child', 'slowest')).toBe('slowest')
  })
  it('the tutor is told which way the pace may still go', () => {
    expect(paceOptions('slowest', 'adult')).toEqual({ now: 'slowest', slower: false, faster: true })
    expect(paceOptions('gentle', 'child')).toEqual({ now: 'gentle', slower: true, faster: false })
    expect(paceOptions('natural', 'teen')).toEqual({ now: 'natural', slower: true, faster: true })
  })
  it('a child\'s voice is louder with longer pauses; a teen\'s or an adult\'s pause follows its pace', () => {
    expect(voiceStyle('child-young', 'slowest')).toEqual({ pace: 'slowest', loud: true, gapMs: 450, pauseMs: 500 })
    expect(voiceStyle('child', 'gentle')).toMatchObject({ loud: true, pauseMs: 400 })
    expect(voiceStyle('adult', 'quick')).toEqual({ pace: 'quick', loud: false, gapMs: 120, pauseMs: 40 })
    expect(voiceStyle('teen', 'natural').pauseMs).toBe(80)
    expect(voiceStyle('adult', 'gentle').pauseMs).toBeLessThan(voiceStyle('adult', 'slowest').pauseMs)
    expect(voiceStyle('adult', 'slowest').pauseMs).toBeLessThan(voiceStyle('child', 'slowest').pauseMs)
  })
  it('⛔ the speech server knows exactly these pace names (it maps NAMES to Phonon numbers — never a number from the app)', () => {
    const server = readFileSync('infra/vn-node/classroom-speech/server.py', 'utf8')
    const table = /^PACES = \{([^}]*)\}/m.exec(server)?.[1] ?? ''
    expect([...table.matchAll(/'(\w+)':/g)].map((m) => m[1])).toEqual([...VOICE_PACES])
  })
})
