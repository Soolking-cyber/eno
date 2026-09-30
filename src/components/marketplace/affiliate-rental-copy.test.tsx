import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * THE WORDS ON AN IMPORTED RENTAL'S PAGE (SEO wave B, P3; copy sheet CS-2 P3-1..P3-4, approved
 * 2026-09-30). The rental safety line, the QR title and caption, and the screen-reader heading said
 * "the partner's own website", "Rent only through…" and "Rent from this partner": the portals are not
 * partners (no code or contract records one) and a tenant rents from a landlord, not through a
 * classifieds site. This pins the approved words, in both languages, on the rendered components.
 */

let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  // 'fr' stands for a machine-translated language whose translator translated the placeholder.
  // 'fr' / 'de' stand for machine-translated languages whose translator translated the placeholder /
  // kept it and added another.
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : LANG === 'fr' ? en.replace('{site}', '{sitio}') : LANG === 'de' ? en.replace('{site}', '{site} ({seite})') : en), t: (k: string) => k, setLang: () => {} }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))

import { SafetyStrip } from './safety-strip'
import { AffiliateBooking } from './affiliate-booking'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const rental = () => text(renderToString(
  <AffiliateBooking url="https://www.nhatot.com/123.htm" partnerName="Nhatot.com" listingId="l1" booking={false} rental />,
))
const strip = () => text(renderToString(<SafetyStrip categorySlug="rentals" variant="affiliate-rental" />))

describe('imported rental wording (P3)', () => {
  it('P3-1: the safety line, in English and Vietnamese', () => {
    LANG = 'en'
    expect(strip()).toContain('See the place and meet the landlord or agent before you pay anything. eno never takes rent or a deposit for these listings and cannot refund one.')
    LANG = 'vi'
    expect(strip()).toContain('Hãy đến xem nhà và gặp chủ nhà hoặc môi giới trước khi trả bất kỳ khoản tiền nào. eno không bao giờ nhận tiền thuê hay tiền cọc cho các tin này và không thể hoàn tiền.')
  })

  it('P3-2..P3-4: the heading, the QR title and the QR caption with the site filled in', () => {
    LANG = 'en'
    const en = rental()
    expect(en).toContain('Open the original ad')
    expect(en).toContain('Scan to open this rental on your phone')
    expect(en).toContain('Opens the original ad on Nhatot.com.')
    // The owner's own CTA wording is left alone (2026-09-21).
    expect(en).toContain('Rent on Nhatot.com')
    LANG = 'vi'
    const vi = rental()
    expect(vi).toContain('Mở tin gốc')
    expect(vi).toContain('Quét để mở tin cho thuê này trên điện thoại')
    expect(vi).toContain('Mở tin gốc trên Nhatot.com.')
  })

  it('a machine translation that mangled {site} — lost, translated or joined by another token — falls back to the English template', () => {
    for (const lang of ['fr', 'de']) {
      LANG = lang
      const out = rental()
      expect(out).toContain('Opens the original ad on Nhatot.com.')
      expect(out).not.toMatch(/\{/)
    }
  })

  it('no "partner", no "đối tác", and no "eno.vn" (the strip renders on both editions) on a rental', () => {
    for (const lang of ['en', 'vi']) {
      LANG = lang
      for (const out of [strip(), rental()]) {
        expect(out).not.toMatch(/partner|đối tác|eno\.vn|rent only through|chỉ thuê qua/i)
      }
    }
  })
})
