import { describe, expect, it } from 'vitest'
import { answerExcerpt } from './help-excerpt'

describe('answerExcerpt — why a search found an answer whose question lacks the word', () => {
  const body = '## Before you go\n\n• Meet in a public place, in daylight.\n• **Never** pay a deposit before you have seen the item. A seller who asks for one by bank transfer is the most common scam on any marketplace in Vietnam, and the money does not come back.'
  it('the words around the match, from a word\'s start, markup dropped, cut at a word', () => {
    const out = answerExcerpt(body, 'deposit')!
    expect(out).toContain('deposit')
    expect(out).not.toMatch(/[#*•]/)
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(162)
    expect(out).toMatch(/^…[A-Za-z]/)
  })
  it('case-insensitive; a match near the start has no leading ellipsis', () => {
    expect(answerExcerpt('Meet in a public place.', 'MEET')).toBe('Meet in a public place.')
  })
  it('no needle, or no match: nothing', () => {
    expect(answerExcerpt(body, '')).toBeNull()
    expect(answerExcerpt(body, 'zzzz')).toBeNull()
  })
})
