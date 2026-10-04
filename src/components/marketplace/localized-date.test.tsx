// @vitest-environment jsdom
/**
 * <LocalizedDate>: en and vi print the SERVER's strings verbatim (no second Intl call, so hydration can
 * never disagree with them); the nine machine-translated languages — which only exist after the provider
 * swaps in an effect — get their own month name, in the Vietnam zone; a bad date keeps the English.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const language = { lang: 'en' }
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: language.lang }) }))

import { LocalizedDate } from './localized-date'

const OPTS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }
// 20:00 UTC on 4 October is already 5 October in Saigon.
const ISO = '2026-10-04T20:00:00.000Z'
const text = (lang: string, iso = ISO) => {
  language.lang = lang
  return render(<LocalizedDate iso={iso} options={OPTS} enText="SERVER-EN" viText="SERVER-VI" />).container.textContent
}

describe('<LocalizedDate>', () => {
  it('prints the server strings for en and vi, untouched', () => {
    expect(text('en')).toBe('SERVER-EN')
    expect(text('vi')).toBe('SERVER-VI')
  })
  it('formats the nine others in their own words, on the Vietnam calendar day', () => {
    expect(text('ru')).toMatch(/^5\s+октября\s+2026/)
    expect(text('fr')).toMatch(/^5\s+octobre\s+2026$/)
    expect(text('ja')).toMatch(/2026年10月5日/)
  })
  it('keeps the English for a date it cannot read', () => {
    expect(text('ru', 'not a date')).toBe('SERVER-EN')
  })
})
