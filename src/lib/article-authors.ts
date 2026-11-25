// The byline under every article (owner, 2026-11-26: "under each blog content write author — English version Shanazar
// Babakulyyev COO and image for authority, and Lap Nguyen CEO for the Vietnamese version, with images from the partner page").
//
// ⛔ CHOSEN BY THE ARTICLE'S LANGUAGE (`ArticleContent.lang`), NEVER THE VISITOR'S — like the rest of the article's chrome
// (seo-article.tsx DATE_LINE): an English guide is Shanazar's for every reader, a Vietnamese one is Lập's.
// The photos are the team cards of partner.eno.vn (eno's own partner page), cropped square to 256 px; the titles are the owner's
// ("COO", "CEO"). The Vietnamese byline writes his name the Vietnamese way, as eno's legal pages do ("Nguyễn Quốc Lập").
// ⚠️ [en, vi] keys are LISTING-STYLE article text, not interface copy: plain constants, never tr() (the article's language).

export type ArticleAuthor = {
  name: string
  /** schema.org Person.jobTitle. */
  jobTitle: 'COO' | 'CEO'
  /** Public path of the square photo. */
  image: string
  /** The small label above the name, in the article's language. */
  label: string
}

export const ARTICLE_AUTHORS: Readonly<Record<'en' | 'vi', ArticleAuthor>> = {
  en: { name: 'Shanazar Babakulyyev', jobTitle: 'COO', image: '/team/shanazar-babakulyyev.webp', label: 'Written by' },
  vi: { name: 'Nguyễn Quốc Lập', jobTitle: 'CEO', image: '/team/nguyen-quoc-lap.webp', label: 'Tác giả' },
}

/** The JSON-LD author: a Person who works for the site's Organization node (by `@id` on the marketplace). */
export function authorPersonLd(a: ArticleAuthor, origin: string, siteName: string, orgRef: { '@id'?: string }) {
  return {
    '@type': 'Person',
    name: a.name,
    jobTitle: a.jobTitle,
    image: `${origin}${a.image}`,
    worksFor: { '@type': 'Organization', ...orgRef, name: siteName, url: origin },
  }
}
