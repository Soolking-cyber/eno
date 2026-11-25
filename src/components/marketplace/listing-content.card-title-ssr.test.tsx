import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { titleShownTranslatedInEnglish } from '@/lib/detect-lang'
import { LocalizedText, localizedPlan } from './listing-content'

/**
 * ⛔ THE ENGLISH PAGE'S SERVER HTML CARRIES A VIETNAMESE TITLE'S ENGLISH (Seobility, 2026-11-25: "4 text blocks invisible to
 * AI bots"). translate.ts localizeListingTitles now embeds `titleI18n.en` for such a title; this pins that the card's render
 * reads it on the SERVER — no client translation — and that the server's rule and the card's are one rule.
 */

const VI = 'Căn Hộ 1 Phòng Ngủ Ngay Landmark 81'
const EN = '1-Bedroom Apartment Right at Landmark 81'
const SLOT = '1-bedroom apartment, 55 m² · Nassim Thảo Điền, District 2'
const SLOT_VI = 'Căn hộ 1 phòng ngủ 55 m² · Nassim Thảo Điền, Quận 2'

const html = (node: React.ReactNode, lang: 'en' | 'vi' = 'en') =>
  renderToString(<LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>)

describe('a card title in the English server render', () => {
  it('a Vietnamese title with its embedded English: the English is in the HTML, the Vietnamese is not', () => {
    const out = html(<LocalizedText text={VI} vi={null} i18n={{ en: EN }} />)
    expect(out).toContain(EN)
    expect(out).not.toContain('Phòng Ngủ')
  })

  it('the English slot of a bilingual row renders as written, whatever en the cache holds', () => {
    const out = html(<LocalizedText text={SLOT} vi={SLOT_VI} i18n={{ en: 'a stale English→English row' }} />)
    expect(out).toContain('Nassim Thảo Điền, District 2')
    expect(out).not.toContain('stale')
  })

  it('the Vietnamese page keeps the Vietnamese', () => {
    expect(html(<LocalizedText text={VI} vi={null} i18n={{ en: EN }} />, 'vi')).toContain('Phòng Ngủ')
  })

  it('one rule: the card uses titleI18n.en exactly when the server embeds it', () => {
    const rows: [string, string | null][] = [[VI, null], [VI, VI], [SLOT, SLOT_VI], ['Sofa for sale', 'Bán sofa'], ['소파 판매', null], ['Sofa', null]]
    for (const [title, titleVi] of rows) {
      const usesEn = localizedPlan(title, titleVi, { en: 'EN' }, 'en', 'title').embedded === 'EN'
      expect(usesEn, title).toBe(titleShownTranslatedInEnglish(title, titleVi))
    }
  })
})
