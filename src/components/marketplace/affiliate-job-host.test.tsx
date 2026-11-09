import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * A linked job says which site its Apply button opens (best-practice gap 2026-11-10): "Opens careers.nordanglia.com" under
 * the button — on its own line, so the apply-by countdown that arrives after mount never wraps it — and only on a job.
 */

let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), t: (k: string) => k, setLang: () => {} }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))

import { AffiliateBooking } from './affiliate-booking'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const job = (props: Partial<React.ComponentProps<typeof AffiliateBooking>> = {}) => renderToString(
  <AffiliateBooking url="https://careers.nordanglia.com/job/123" partnerName="Nord Anglia Education" listingId="j1" booking={false} job applyBy="2026-11-17" host="careers.nordanglia.com" {...props} />,
)

describe('a linked job names the site its Apply button opens', () => {
  it('under the button, after the apply-by line, in English and Vietnamese', () => {
    LANG = 'en'
    const en = text(job())
    expect(en).toContain('Opens careers.nordanglia.com')
    expect(en.indexOf('Apply by')).toBeLessThan(en.indexOf('Opens careers.nordanglia.com'))
    LANG = 'vi'
    expect(text(job())).toContain('Mở careers.nordanglia.com')
    LANG = 'en'
  })

  it('on its own line from the first render (never appended to the countdown line)', () => {
    const html = job()
    const line = html.match(/<p[^>]*>Opens careers\.nordanglia\.com<\/p>/)
    expect(line).not.toBeNull()
    expect(line![0]).toContain('[overflow-wrap:anywhere]')
  })

  it('a job with no apply-by date still says where it goes', () => {
    expect(text(job({ applyBy: null }))).toContain('Opens careers.nordanglia.com')
  })

  it('nothing without a host, and never on a rental or a shop item', () => {
    expect(text(job({ host: null }))).not.toContain('Opens careers')
    const rental = text(renderToString(<AffiliateBooking url="https://www.nhatot.com/1.htm" partnerName="Nhatot.com" listingId="r1" booking={false} rental host="nhatot.com" />))
    expect(rental).not.toContain('Opens nhatot.com')
  })
})
