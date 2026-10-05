// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string) => en, lang: 'en' }) }))

import { MessageBubble } from './chat-parts'

/** A message's line breaks render, but a flood cannot make a bubble thousands of lines tall (break-ui). */
describe('MessageBubble line breaks', () => {
  afterEach(cleanup)
  const textOf = (c: HTMLElement) => c.querySelector('.whitespace-pre-line')!.textContent ?? ''
  it('keeps an address on its lines', () => {
    const address = 'Địa chỉ:\n123 Nguyễn Văn Linh\nQuận 7'
    const { container } = render(<MessageBubble>{address}</MessageBubble>)
    expect(textOf(container).split('\n')).toHaveLength(3)
  })
  it('collapses a run of blank lines to one blank line', () => {
    const flood = ['a', 'b'].join('\n'.repeat(1997))
    const { container } = render(<MessageBubble>{flood}</MessageBubble>)
    expect(textOf(container)).toBe('a\n\nb')
  })
  it('treats CR as a line break too, so it cannot slip past the cap', () => {
    const cr = Array.from({ length: 200 }, () => 'x').join('\r')
    const { container } = render(<MessageBubble>{cr}</MessageBubble>)
    expect(textOf(container).split('\n').length).toBeLessThanOrEqual(30)
  })
  it('treats U+2028/U+2029 as line breaks too', () => {
    const ls = Array.from({ length: 200 }, () => 'x').join('\u2028')
    const { container } = render(<MessageBubble>{ls}</MessageBubble>)
    expect(textOf(container).split('\n').length).toBeLessThanOrEqual(30)
    expect(textOf(container)).not.toContain('\u2028')
  })
  it('caps the rendered line breaks at 30 and flows the rest on as spaces', () => {
    const list = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
    const { container } = render(<MessageBubble>{list}</MessageBubble>)
    expect(textOf(container).split('\n').length).toBeLessThanOrEqual(30)
    expect(textOf(container)).toContain('line 199')
  })
})
