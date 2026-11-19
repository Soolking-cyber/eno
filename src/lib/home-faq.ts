/**
 * The home page's questions and answers as FAQPage JSON-LD (owner 2026-11-17, from the AEO checker's "FAQPage or HowTo schema" and
 * "FAQ/Q&A patterns": "fix ALL of these").
 *
 * ⛔ ONE LIST SINCE 2026-11-19: the FAQ's short pairs and the "About eno.vn" answers said the same things twice on the page (owner:
 * "looks weird ... show less without losing scores"), so they are one accordion of seven questions (src/lib/home-about.ts holds
 * them). The JSON-LD is built from those same questions and their whole answers, so the markup never says what the page does not
 * show (Google's rule for FAQ structured data; an accordion's closed answer is on the page, hidden until opened or found).
 * The rules for the copy itself (no new claims, the 200-character cap) live in home-about.ts.
 */
import { HOME_ABOUT, type AboutSection, type AboutText } from '@/lib/home-about'

export type FaqText = AboutText

/** The block's visible label. Not a heading: each question is the H2, so a bare label H2 would be an empty section. */
export const HOME_FAQ_HEADING: FaqText = { en: 'Questions about eno.vn', vi: 'Câu hỏi thường gặp về eno.vn' }

/** A question's whole answer in one language: the direct answer first, then the rest, as the page draws them. */
export function answerText(s: AboutSection, lang: 'en' | 'vi'): string {
  return [...s.open, ...s.more.flat()].map((t) => t[lang]).join(' ')
}

/** FAQPage JSON-LD in the server variant's language (en, or vi on the vi variant), from the questions the page draws. */
export function homeFaqJsonLd(lang: string): Record<string, unknown> {
  const l = lang === 'vi' ? 'vi' : 'en'
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: l,
    mainEntity: HOME_ABOUT.map((s) => ({ '@type': 'Question', name: s.q[l], acceptedAnswer: { '@type': 'Answer', text: answerText(s, l) } })),
  }
}
