// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderIdentityOutcomeEmail } from './identity-verification'
import { renderVerificationOutcomeEmail } from './business-verification'

/**
 * ⚠️ THE MESSAGE SITS INSIDE THE CARD (sweep, 2026-10-22). renderBrandEmail's bodyHtml is the card's content ROWS; the
 * two verification outcome emails passed bare <h1>/<p>/<a>, which an HTML parser foster-parents out of the card's
 * <table> — every KYC and business-verification outcome rendered on the grey canvas above an empty card. Parsed here
 * the way a mail client parses it (jsdom applies the same HTML table rules).
 */
function cardHolds(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const card = doc.querySelector('table[width="600"]')!
  expect(card, 'the 600px card table').toBeTruthy()
  return { h1: !!card.querySelector('h1'), cta: [...card.querySelectorAll('a')].some((a) => /dashboard\/(verification|settings)/.test(a.getAttribute('href') ?? '')) }
}

describe('verification outcome emails — the message is inside the card', () => {
  const site = { origin: 'https://eno.vn', siteName: 'eno.vn' }
  for (const outcome of ['approved', 'rejected'] as const) {
    for (const lang of ['en', 'vi'] as const) {
      it(`identity ${outcome} (${lang})`, () => {
        const m = renderIdentityOutcomeEmail({ ...site, tier: 'B', outcome, reason: outcome === 'rejected' ? 'blurry' : null, note: null, lang } as never)
        expect(cardHolds(m.html)).toEqual({ h1: true, cta: true })
      })
      it(`business ${outcome} (${lang})`, () => {
        const m = renderVerificationOutcomeEmail({ ...site, outcome, note: outcome === 'rejected' ? 'Licence unreadable' : null, lang })
        expect(cardHolds(m.html)).toEqual({ h1: true, cta: true })
      })
    }
  }
})
