// The byline under every article (owner, 2026-11-26: "under each blog content write author — English version Shanazar
// Babakulyyev COO and image for authority, and Lap Nguyen CEO for the Vietnamese version, with images from the partner page"),
// then, told partner.eno.vn names Lập's role "Marketing Executive": "use marketing executive then".
//
// ⛔ CHOSEN BY THE ARTICLE'S LANGUAGE (`ArticleContent.lang`), NEVER THE VISITOR'S — like the rest of the article's chrome
// (seo-article.tsx DATE_LINE): an English guide is Shanazar's for every reader, a Vietnamese one is Lập's.
// The photos are the team cards of partner.eno.vn (eno's own partner page), cropped square to 256 px; the titles are that page's, in
// the article's language: "COO" (the owner's word for its "Chief Operating Officer"), "Chuyên viên Marketing" (its Vietnamese for
// "Marketing Executive"). The Vietnamese byline writes his name the Vietnamese way, as eno's legal pages do ("Nguyễn Quốc Lập").
// ⚠️ [en, vi] keys are LISTING-STYLE article text, not interface copy: plain constants, never tr() (the article's language).

export type ArticleAuthor = {
  name: string
  /** schema.org Person.jobTitle, and the line under the name — in the article's language. */
  jobTitle: string
  /** Public path of the square photo. */
  image: string
  /** The small label above the name, in the article's language. */
  label: string
  /**
   * The author's public LinkedIn profile (owner, 2026-11-27: "attach linkedin profiles to content author"): the byline's name
   * links to it, and the JSON-LD Person carries it as `url` and `sameAs`, so a search engine can tie the byline to a real person.
   */
  profile: string
}

export const ARTICLE_AUTHORS: Readonly<Record<'en' | 'vi', ArticleAuthor>> = {
  en: { name: 'Shanazar Babakulyyev', jobTitle: 'COO', image: '/team/shanazar-babakulyyev.webp', label: 'Written by', profile: 'https://www.linkedin.com/in/babakulyyev-shanazar-8068b1188/' },
  vi: { name: 'Nguyễn Quốc Lập', jobTitle: 'Chuyên viên Marketing', image: '/team/nguyen-quoc-lap.webp', label: 'Tác giả', profile: 'https://www.linkedin.com/in/lap-nguyen-233219265/' },
}

/** The JSON-LD author: a Person who works for the site's Organization node (by `@id` on the marketplace). */
export function authorPersonLd(a: ArticleAuthor, origin: string, siteName: string, orgRef: { '@id'?: string }) {
  return {
    '@type': 'Person',
    name: a.name,
    jobTitle: a.jobTitle,
    image: `${origin}${a.image}`,
    url: a.profile,
    sameAs: [a.profile],
    worksFor: { '@type': 'Organization', ...orgRef, name: siteName, url: origin },
  }
}
