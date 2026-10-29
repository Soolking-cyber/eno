// @vitest-environment jsdom
/**
 * A GoPlus room's own page on goplus.com.vn (owner, 2026-10-29: "all goplus apartments should have a link that leads to
 * that apartment in goplus website") — the listing page passes the href it built from the row's externalId.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

import { GoplusRoomLink } from './goplus-room-link'

const LINK = /View on GoPlus/
afterEach(cleanup)

describe('GoplusRoomLink', () => {
  it('links to the room on goplus.com.vn in a new tab, without a referrer', () => {
    render(<GoplusRoomLink href="https://goplus.com.vn/phong/d1c036ae6826f5254ba9e8d9" />)
    const a = screen.getByRole('link', { name: LINK })
    expect(a.getAttribute('href')).toBe('https://goplus.com.vn/phong/d1c036ae6826f5254ba9e8d9')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
    expect(a.getAttribute('rel')).toContain('noreferrer')
  })
})
