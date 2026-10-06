// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isExternalUrl } from './native-browser'

// ── What may be handed to the in-app browser sheet (@capacitor/browser) ─────────────────────────────
// Since 2026-10-06 both apps render eno.vn and eno.forum is NOT in allowNavigation. A forum link must
// leave through the SYSTEM browser — never the sheet, which would render the forum on top of the
// licensed company's app — so isExternalUrl must say false for it, exactly as for the app's own origin.

describe('isExternalUrl', () => {
  it('keeps the app origin in the WebView', () => {
    for (const u of ['https://eno.vn/c/rentals', 'https://www.eno.vn/listings/x', 'https://ENO.VN/', '/listings/x'])
      expect(isExternalUrl(u)).toBe(false)
  })

  it('never hands the sister site to the in-app sheet', () => {
    for (const u of ['https://www.eno.forum/vietnam-evisa', 'https://eno.forum/', 'http://www.eno.forum/help'])
      expect(isExternalUrl(u)).toBe(false)
  })

  it('sends a genuinely third-party page to the sheet — look-alike hosts included', () => {
    for (const u of ['https://www.google.com/maps?q=1', 'https://eno.vn.evil.example/', 'https://www.eno.forum.evil.example/', 'https://evil-eno.vn/'])
      expect(isExternalUrl(u)).toBe(true)
  })

  it('leaves non-http schemes to the platform', () => {
    for (const u of ['mailto:support@eno.vn', 'tel:+84772007921', 'sms:+84772007921'])
      expect(isExternalUrl(u)).toBe(false)
  })
})
