// @vitest-environment jsdom
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * A linked job says which site its Apply button opens (best-practice gap 2026-11-10) and when it closes, on ONE line under the
 * button since UI climb batch 95 (owner-approved 2026-11-14, decision 3, "the job page says it once"): "careers.nordanglia.com ·
 * closes 17 Nov (5 days)" — the host first, then the deadline; only on a job. The countdown is client-only and its width is
 * reserved from the first render (job-apply-guard.test.tsx), so this server render holds the host and the day.
 */

let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), t: (k: string) => k, setLang: () => {} }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))

import { AffiliateBooking } from './affiliate-booking'

/** What a reader sees: the rendered text without the countdown cell's invisible, aria-hidden sizers. */
const seen = (el: Element) => {
  const c = el.cloneNode(true) as Element
  for (const h of c.querySelectorAll('[aria-hidden]')) h.remove()
  return (c.textContent ?? '').replace(/\s+/g, ' ').trim()
}
const box = (props: Partial<React.ComponentProps<typeof AffiliateBooking>> = {}) => {
  const div = document.createElement('div')
  div.innerHTML = renderToString(
    <AffiliateBooking url="https://careers.nordanglia.com/job/123" partnerName="Nord Anglia Education" listingId="j1" booking={false} job applyBy="2026-11-17" host="careers.nordanglia.com" {...props} />,
  )
  return div
}
/** The caption: the paragraphs that hold the host or the deadline. */
const captions = (div: Element) => [...div.querySelectorAll('p')].filter((p) => /careers\.nordanglia\.com|closes|hạn/.test(seen(p)))

describe('a linked job: one caption under Apply — the site it opens, then the deadline', () => {
  it('one <p>, host first, then "closes <day>" with a <time>, in English and Vietnamese', () => {
    LANG = 'en'
    const en = captions(box())
    expect(en).toHaveLength(1)
    expect(seen(en[0])).toBe('careers.nordanglia.com · closes 17 Nov 2026')
    expect(en[0].querySelector('time')?.getAttribute('dateTime')).toBe('2026-11-17')
    LANG = 'vi'
    try {
      expect(seen(captions(box())[0])).toBe('careers.nordanglia.com · hạn 17/11/2026')
    } finally {
      LANG = 'en'
    }
  })

  it('sits right under the button (8px: `-mt-2` against the column\'s gap), breaks a long host anywhere, and says "Opens" nowhere', () => {
    const div = box()
    const p = captions(div)[0]
    expect(p.className.split(/\s+/)).toEqual(expect.arrayContaining(['-mt-2', 'text-xs', 'text-body', 'lg:text-sm', '[overflow-wrap:anywhere]']))
    // The caption is the section's next element after the button's wrapper (provenance is never on a job).
    const cta = div.querySelector('[data-affiliate-cta]')!
    const kids = [...div.querySelector('section')!.children]
    expect(kids[kids.findIndex((k) => k === cta || k.contains(cta)) + 1]).toBe(p)
    expect(seen(div)).not.toMatch(/\bOpens careers|Mở careers|Apply by|Hạn nộp/)
  })

  it('the year is the page\'s call (decided from data): without it, "closes 17 Nov" / "hạn 17/11"', () => {
    expect(seen(captions(box({ applyByYear: false }))[0])).toBe('careers.nordanglia.com · closes 17 Nov')
    LANG = 'vi'
    try {
      expect(seen(captions(box({ applyByYear: false }))[0])).toBe('careers.nordanglia.com · hạn 17/11')
    } finally {
      LANG = 'en'
    }
  })

  it('a job with no apply-by date still says where it goes; one with no host says when it closes', () => {
    expect(seen(captions(box({ applyBy: null }))[0])).toBe('careers.nordanglia.com')
    expect(seen(captions(box({ applyBy: 'soon' }))[0])).toBe('careers.nordanglia.com')
    expect(seen(captions(box({ host: null }))[0])).toBe('closes 17 Nov 2026')
    expect(captions(box({ host: null, applyBy: null }))).toHaveLength(0)
  })

  it('never on a rental or a shop item', () => {
    const div = document.createElement('div')
    div.innerHTML = renderToString(<AffiliateBooking url="https://www.nhatot.com/1.htm" partnerName="Nhatot.com" listingId="r1" booking={false} rental host="nhatot.com" applyBy="2026-11-17" />)
    expect(seen(div)).not.toMatch(/nhatot\.com ·|closes|Opens nhatot/)
    expect(div.querySelector('time')).toBeNull()
  })
})
