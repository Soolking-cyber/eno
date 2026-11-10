import { describe, expect, it } from 'vitest'
import { appendLine, captionLines, nextPace } from './captions'

describe('caption lines', () => {
  it('a saved line: the Vietnamese help first, then the English — either may be missing', () => {
    expect(captionLines('Cô hỏi: con thích ăn gì?', 'What do you like?')).toEqual([
      { text: 'Cô hỏi: con thích ăn gì?', vi: true }, { text: 'What do you like?', vi: false },
    ])
    expect(captionLines(undefined, 'Hello!')).toEqual([{ text: 'Hello!', vi: false }])
    expect(captionLines('  ', '')).toEqual([])
  })
  it('streamed sentences: one kind in a row is one paragraph; a change of language starts a new line', () => {
    let l = appendLine([], 'Con giỏi lắm.', true)
    l = appendLine(l, 'Cô sẽ hỏi lại nhé.', true)
    l = appendLine(l, 'Great job!', false)
    l = appendLine(l, 'What else?', false)
    expect(l).toEqual([{ text: 'Con giỏi lắm. Cô sẽ hỏi lại nhé.', vi: true }, { text: 'Great job! What else?', vi: false }])
  })
  it('never mutates what it was given', () => {
    const a = [{ text: 'Hi.', vi: false }]
    appendLine(a, 'There.', false)
    expect(a).toEqual([{ text: 'Hi.', vi: false }])
  })
})

describe('nextPace — one button, in rotation', () => {
  it('Slow → Normal → Fast → Slow; a two-pace range toggles; an unknown pace starts from the slowest', () => {
    const three = ['slowest', 'natural', 'quick'] as const
    expect(nextPace(three, 'slowest')).toBe('natural')
    expect(nextPace(three, 'natural')).toBe('quick')
    expect(nextPace(three, 'quick')).toBe('slowest')
    expect(nextPace(['gentle', 'natural'], 'natural')).toBe('gentle')
    expect(nextPace(['slowest', 'natural', 'quick'], 'gentle')).toBe('slowest')
  })
})
