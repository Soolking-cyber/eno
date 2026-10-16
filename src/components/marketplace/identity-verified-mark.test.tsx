// @vitest-environment jsdom
/**
 * The card's "Identity verified" tick (owner, 2026-10-15): a NAMED IMAGE — role="img", its label as name and title, in
 * English and Vietnamese ("xác minh", never "xác thực") — and never a control: no tab stop, no button, no link (the card
 * link owns every tap; it names the tick in its description). The glyph inside is decoration (aria-hidden).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { IdentityVerifiedMark } from './identity-verified-mark'

afterEach(cleanup)

const mount = (lang: 'en' | 'vi', props: { id?: string; className?: string } = {}) =>
  render(<LanguageProvider initialLang={lang} initialViDict={{}}><IdentityVerifiedMark {...props} /></LanguageProvider>).container

describe('IdentityVerifiedMark', () => {
  it.each([
    ['en', 'Identity verified'],
    ['vi', 'Đã xác minh danh tính'],
  ] as const)('%s: role=img, named and titled "%s"', (lang, label) => {
    const c = mount(lang, { id: 'm1' })
    const mark = c.querySelector('[data-identity-mark]')!
    expect(mark.getAttribute('role')).toBe('img')
    expect(mark.getAttribute('aria-label')).toBe(label)
    expect(mark.getAttribute('title')).toBe(label)
    expect(mark.id).toBe('m1')
    expect(c.innerHTML).not.toMatch(/xác thực|Verified by eno/i)
  })

  it('is never a control: no tabindex, button or link — and the glyph is hidden from assistive tech', () => {
    const c = mount('en')
    expect(c.querySelector('[tabindex], button, a')).toBeNull()
    const svg = c.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(c.textContent).toBe('')
  })

  it('takes a caller class beside its own', () => {
    const mark = mount('en', { className: 'mt-0.5' }).querySelector('[data-identity-mark]')!
    expect(mark.className).toContain('mt-0.5')
    expect(mark.className).toContain('shrink-0')
  })
})
