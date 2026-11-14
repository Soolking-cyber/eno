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

const { CardBadges, Badge } = await import('./card-badges')

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

// ⛔ ON A PHOTO EVERY BADGE IS THE ONE WHITE PILL (owner-approved 2026-11-14, cook r05: "over a photo: only white plates …
// 26 tall badges 700 13"): ink on the plate, no slate fill, no red fill. In a text row (`variant="inline"`) the tones stay.
describe('CardBadges — the photo pill', () => {
  const cls = (html: string) => (html.match(/class="([^"]*)"/)?.[1] ?? '').split(' ')

  it('Urgent and the price drop are `.photo-badge`, with no fill or ink of their own', () => {
    h.lang = 'en'
    for (const html of [urgent('sell'), renderToString(<CardBadges listing={{ urgent: false, prevPrice: 2_000_000, price: 1_500_000, listingType: 'sell' } as never} />)]) {
      const c = cls(html)
      expect(c).toContain('photo-badge')
      for (const tone of ['bg-foreground', 'text-background', 'bg-destructive', 'text-destructive-foreground', 'shadow-sm']) expect(c).not.toContain(tone)
    }
  })

  it('no signal renders nothing — and there is no "Just in" / "Mới đăng" for a fresh listing', () => {
    for (const lang of ['en', 'vi'] as const) {
      h.lang = lang
      expect(renderToString(<CardBadges listing={{ urgent: false, prevPrice: null, price: 1, listingType: 'sell', isNew: true, postedAt: new Date().toISOString() } as never} />)).toBe('')
    }
  })

  it('variant="inline" (the compact row) keeps its toned chips', () => {
    const label = '−24%'
    expect(cls(renderToString(<Badge kind="drop" variant="inline">{label}</Badge>))).toEqual(expect.arrayContaining(['bg-destructive', 'text-destructive-foreground', 'text-3xs']))
    expect(cls(renderToString(<Badge kind="urgent" variant="inline">{label}</Badge>))).toEqual(expect.arrayContaining(['bg-foreground', 'text-background']))
    expect(cls(renderToString(<Badge kind="drop" variant="inline">{label}</Badge>))).not.toContain('photo-badge')
  })
})
