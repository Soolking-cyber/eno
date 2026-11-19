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
import { organizationId, siteOrigin } from '@/lib/site-identity'

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

/** The day the questions block went live (7709fd349); `dateModified` moves when its answers are re-approved. */
export const HOME_QUESTIONS_PUBLISHED = '2026-11-19'
export const HOME_QUESTIONS_MODIFIED = '2026-11-19'

/**
 * Article JSON-LD for the questions block (owner 2026-11-19, "do lower risk one": an AEO checker asks for Article schema with an
 * author and datePublished once it sees a byline, which the founder quote's attribution is).
 * ⚠️ IT DESCRIBES THE BLOCK, NOT THE PAGE: `isPartOf` the home WebPage, never its `mainEntityOfPage`, because the home page's main
 * content is the marketplace feed, and structured data must not claim otherwise. The author is eno.vn, the Organization node the
 * layout declares (the same @id the guides' Article uses), not a person: the answers are the company's, the quote is the founder's.
 */
export function homeQuestionsArticleJsonLd(lang: string, webPageId: string): Record<string, unknown> {
  const l = lang === 'vi' ? 'vi' : 'en'
  const origin = siteOrigin().replace(/\/+$/, '')
  const org = { '@type': 'Organization', '@id': organizationId(origin), name: 'eno.vn', url: origin }
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: HOME_FAQ_HEADING[l],
    description: HOME_ABOUT[0].open.map((t) => t[l]).join(' '),
    inLanguage: l,
    author: org,
    publisher: { '@id': organizationId(origin) },
    datePublished: HOME_QUESTIONS_PUBLISHED,
    dateModified: HOME_QUESTIONS_MODIFIED,
    isPartOf: { '@id': webPageId },
    articleSection: HOME_ABOUT.map((s) => s.q[l]),
  }
}
