// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

/**
 * TrustMeta is SHARED. The thread header's one-line subtitle (inbox-01) is opt-in (`singleLine`); every other
 * surface keeps the original wrapping meta exactly — no join year hidden on phones, no clipping, no ellipsis.
 */

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/components/marketplace/trust-score', () => ({ TrustScore: () => <a href="/trust" data-trust-score="" aria-label="trust" /> }))
vi.mock('@/lib/last-seen', () => ({ lastSeenBucket: (d?: string | null) => (d ? { key: 'today', en: 'Active today', vi: 'Hoạt động hôm nay' } : { key: null, en: '', vi: '' }) }))

import { TrustMeta } from './trust-meta'

afterEach(cleanup)

const props = { trustScore: 72, trustTier: 'standard', memberSinceYear: 2023, responseBucket: { key: null, en: '', vi: '' }, isNew: false, lastSeenDay: '2026-10-04' } as const
const tokens = (el: Element) => (el.getAttribute('class') || '').split(/\s+/)

describe('TrustMeta default — every surface but the thread header, exactly as before', () => {
  it('wraps; the join year always shows; nothing clips or truncates', () => {
    const { container } = render(<TrustMeta {...props} />)
    const root = container.firstElementChild!
    expect(tokens(root)).toEqual(['flex', 'flex-wrap', 'items-center', 'gap-x-2', 'gap-y-0.5', 'text-2xs', 'leading-none', 'text-muted-foreground'])
    expect(container.querySelector('[data-trust-meta-line]')).toBeNull()
    const year = Array.from(root.querySelectorAll('span')).find((s) => s.textContent === 'Joined 2023')!
    expect(tokens(year)).toEqual(['tabular-nums'])
    expect(container.querySelector('.truncate')).toBeNull()
  })
})

describe('TrustMeta singleLine — the thread header only', () => {
  it('one line: no wrap, the year steps out below sm, the text ellipses, the chip keeps its focus-ring room', () => {
    const { container } = render(<TrustMeta {...props} singleLine />)
    const root = container.querySelector('[data-trust-meta-line]')!
    const t = tokens(root)
    expect(t).toContain('flex-nowrap')
    expect(t).toContain('overflow-hidden')
    expect(t).toContain('p-1')
    expect(t).toContain('-m-1')
    const year = Array.from(root.querySelectorAll('span')).find((s) => s.textContent === 'Joined 2023')!
    expect(tokens(year)).toContain('max-sm:hidden')
    const presence = Array.from(root.querySelectorAll('span')).find((s) => s.textContent === 'Active today')!
    expect(tokens(presence)).toEqual(expect.arrayContaining(['min-w-0', 'truncate']))
  })
})

describe('TrustMeta — the response label', () => {
  // seller-metrics.ts responseBucket: 80% replied within 24h WITHOUT a sub-hour median. Every consumer reads
  // only the key's truthiness, so the new bucket renders exactly where the others do.
  it('shows the “usually within a day” bucket like any other, on both layouts', () => {
    const usual = { key: 'usuallyDay', en: 'Usually replies within a day', vi: 'Thường trả lời trong ngày' } as const
    const wrapped = render(<TrustMeta {...props} responseBucket={usual} />)
    expect(wrapped.container.textContent).toContain('Usually replies within a day')
    cleanup()
    const line = render(<TrustMeta {...props} responseBucket={usual} singleLine />)
    expect(line.container.querySelector('[data-trust-meta-line]')?.textContent).toContain('Usually replies within a day')
  })
})
