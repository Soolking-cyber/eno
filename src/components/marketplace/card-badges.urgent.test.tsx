/**
 * ONE urgent flag, two words: "Bán gấp / Urgent" on a sale, "Tuyển gấp / Urgent hiring" on a JOB
 * (owner, 2026-10-01). An urgent job card that said "Bán gấp" told candidates the post was a sale.
 */
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ lang: 'en' as 'en' | 'vi' }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: h.lang, tr: (en: string, vi: string) => (h.lang === 'vi' ? vi : en) }),
}))

const { CardBadges } = await import('./card-badges')

const urgent = (listingType?: string) => renderToString(
  <CardBadges listing={{ urgent: true, prevPrice: null, price: 25_000_000, postedAt: null, listingType } as never} />,
)

describe('CardBadges — urgent label follows the intent', () => {
  it('a job reads "Urgent hiring" / "Tuyển gấp"', () => {
    h.lang = 'en'
    expect(urgent('job')).toContain('Urgent hiring')
    h.lang = 'vi'
    expect(urgent('job')).toContain('Tuyển gấp')
    expect(urgent('job')).not.toContain('Bán gấp')
  })

  it('a sale keeps "Urgent" / "Bán gấp"', () => {
    h.lang = 'en'
    expect(urgent('sell')).toContain('Urgent')
    expect(urgent('sell')).not.toContain('hiring')
    h.lang = 'vi'
    expect(urgent('sell')).toContain('Bán gấp')
    expect(urgent(undefined)).toContain('Bán gấp') // a card builder that never sent the type
  })
})
