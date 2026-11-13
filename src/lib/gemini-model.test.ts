import { describe, expect, it } from 'vitest'
import { GEMINI_MODEL, GEMINI_MODEL_FALLBACK, quickThinking, takesThinkingLevel, THINKING_ROOM } from './gemini-model'

// 4 Hydrogen refuses thinkingBudget (400) and still thinks at LOW; 2.x takes a budget and refuses a level (measured
// on Vertex 2026-11-13). A wrong pairing is a 400 on every call of that path, so the routing is pinned here.
describe('quickThinking', () => {
  it('the app model is 4 Hydrogen and takes a thinking LEVEL, with room for it beside the answer', () => {
    expect(GEMINI_MODEL).toBe('gemini-4-hydrogen')
    expect(quickThinking(GEMINI_MODEL, 256)).toEqual({ thinkingConfig: { thinkingLevel: 'LOW' }, maxOutputTokens: 256 + THINKING_ROOM })
  })
  it('never sends a budget to a 3.x or 4.x model', () => {
    for (const m of ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-4-hydrogen', 'gemini-4-argon']) {
      expect(takesThinkingLevel(m)).toBe(true)
      expect(quickThinking(m, 10).thinkingConfig).not.toHaveProperty('thinkingBudget')
    }
  })
  it('the fallback is 3.8 Flash (owner, 2026-11-13) and takes a level too', () => {
    expect(GEMINI_MODEL_FALLBACK).toBe('gemini-3.8-flash')
    expect(quickThinking(GEMINI_MODEL_FALLBACK, 768)).toEqual({ thinkingConfig: { thinkingLevel: 'LOW' }, maxOutputTokens: 768 + THINKING_ROOM })
  })
  it('a 2.x model gets a zero budget and no level (a 2.5 model refuses the field)', () => {
    expect(takesThinkingLevel('gemini-2.5-flash')).toBe(false)
    expect(quickThinking('gemini-2.5-flash', 768)).toEqual({ thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 768 })
  })
})
