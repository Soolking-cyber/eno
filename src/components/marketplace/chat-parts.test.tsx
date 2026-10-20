// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string) => en, lang: 'en' }) }))

import { MessageBubble } from './chat-parts'
import { jobsDeskLinks } from '@/lib/chat-links'

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

describe('MessageBubble — chips come from the sender\'s own words', () => {
  it('a translation that carries a number the sender never typed gets no chip', () => {
    const translated = 'The kitchen is small, call 0909 123 456'
    const { queryByText } = render(<MessageBubble chipsFrom="Bếp khá nhỏ">{translated}</MessageBubble>)
    expect(queryByText('Zalo')).toBeNull()
  })
  it('the sender\'s own number keeps its chip while the translation is shown', () => {
    const translated = 'Call me at 0909 123 456'
    const { getByText } = render(<MessageBubble chipsFrom="Gọi em 0909 123 456 nhé">{translated}</MessageBubble>)
    expect(getByText('Zalo')).toBeTruthy()
  })
})

/**
 * TAPPABLE LINKS (jobs desk, 2026-10-20): only when the thread page passes `linkify` — every other bubble is plain text,
 * exactly as before — and the string stays the string, so the line cap and the Zalo/WhatsApp scanner still read it.
 */
describe('MessageBubble links', () => {
  afterEach(cleanup)
  const textOf = (c: HTMLElement) => c.querySelector('.whitespace-pre-line')!.textContent ?? ''
  const dm ='Hi Anna, this is Alex from eno.vn.\n1. Cover lesson — District 7\n   https://eno.vn/listings/cmjob1\n2. https://evil.io/x'

  it('draws no link without `linkify` — a URL in an ordinary message stays text', () => {
    const { container } = render(<MessageBubble>{dm}</MessageBubble>)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('https://eno.vn/listings/cmjob1')
  })

  it('draws the allowed link, opening outside the app with noopener/noreferrer/nofollow — and nothing else', () => {
    const { container } = render(<MessageBubble linkify={jobsDeskLinks}>{dm}</MessageBubble>)
    const as = [...container.querySelectorAll('a')]
    expect(as).toHaveLength(1)
    expect(as[0].getAttribute('href')).toBe('https://eno.vn/listings/cmjob1')
    expect(as[0].getAttribute('target')).toBe('_blank')
    expect(as[0].getAttribute('rel')).toBe('noopener noreferrer nofollow')
    expect(as[0].textContent).toBe('https://eno.vn/listings/cmjob1')
    // A long URL wraps inside the bubble rather than pushing the thread sideways.
    expect(as[0].className).toContain('[overflow-wrap:anywhere]')
  })

  it('keeps every character and every line of the message', () => {
    const { container } = render(<MessageBubble linkify={jobsDeskLinks}>{dm}</MessageBubble>)
    expect(textOf(container)).toBe(dm)
    expect(textOf(container).split('\n')).toHaveLength(4)
  })

  it('still offers Zalo / WhatsApp for a phone number in a linkified message', () => {
    const withPhone = 'Call 0901 234 567 or see https://eno.vn/listings/1'
    const { container } = render(<MessageBubble linkify={jobsDeskLinks}>{withPhone}</MessageBubble>)
    const labels = [...container.querySelectorAll('a')].map((a) => a.textContent)
    expect(labels).toEqual(expect.arrayContaining(['https://eno.vn/listings/1', 'Zalo', 'WhatsApp']))
  })

  it('wears the bubble\'s own ink: accent on a received bubble, white on a sent one', () => {
    const url = 'https://eno.vn/listings/1'
    const received = render(<MessageBubble linkify={jobsDeskLinks}>{url}</MessageBubble>).container.querySelector('a')!
    expect(received.className).toContain('text-accent-foreground')
    cleanup()
    const sent = render(<MessageBubble mine linkify={jobsDeskLinks}>{url}</MessageBubble>).container.querySelector('a')!
    expect(sent.className).toContain('text-white')
  })
})
