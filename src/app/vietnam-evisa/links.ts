/**
 * The /vietnam-evisa hub and its long-tail children, in ONE list.
 *
 * ⚠️ THE SITEMAP'S LANDING LIST IS HARD-CODED, so a new route is not picked up automatically —
 * that is exactly how a page gets built, deployed, and then never submitted to Google. Rather than
 * add six more string literals to `src/app/sitemap.xml/route.ts` and rely on the next person
 * remembering to add a seventh, the sitemap IMPORTS `VIETNAM_EVISA_PATHS` from here. Adding a
 * child to `EVISA_CHILDREN` therefore adds it to the sitemap, to the hub's link list, and to every
 * sibling's link list at once. The one thing it does not do is create the route — but a listed
 * path with no `page.tsx` is a 404 in the sitemap, which is loud, while a live page in no sitemap
 * is silent. Loud is the failure mode to choose.
 *
 * Each child targets a query the incumbent agent sites underserve. They are not variations on one
 * keyword: a visitor searching "vietnam visa 1 hour" and one searching "e-visa vs visa on arrival"
 * want different answers, and a page that gives both gives neither.
 */
export type EvisaChild = {
  /** URL segment under /vietnam-evisa. */
  slug: string
  /** Link text used by the hub and by sibling pages. */
  label: string
  /** One line of what the page answers — the link's whole reason to be clicked. */
  blurb: string
}

export const EVISA_HUB_PATH = '/vietnam-evisa'

export const EVISA_CHILDREN: readonly EvisaChild[] = [
  {
    // ⚠️ THIS ONE IS AN ARTICLE, NOT A LANDING PAGE, and the registry does not care — which is the
    // point of keeping it a list of slugs and link text rather than a list of components. It renders
    // <SeoArticle> (no listing rail, contextual links inside its prose) while its five siblings
    // render <SeoLanding>. Being in this array is what puts it in the sitemap and in every sibling's
    // "Keep reading" block; how the route draws itself is the route's business.
    slug: 'official-process',
    label: 'The official process, the official fee, and what a service can add',
    blurb:
      'What evisa.gov.vn does, what the government charges, and the honest limits of what any agent can do for you.',
  },
  {
    slug: '1-hour-urgent',
    label: 'Urgent Vietnam visa in 1 hour',
    blurb: 'What the express tiers really promise, the daily cutoffs they depend on, and when 1 hour is not possible at any price.',
  },
  {
    slug: 'multiple-entry-cost',
    label: 'Multiple entry e-visa: what it costs',
    blurb: 'When a 90-day multiple-entry visa is worth the difference, and when a single entry is the cheaper right answer.',
  },
  {
    slug: 'rejected',
    label: 'Vietnam e-visa rejected — what now',
    blurb: 'Why applications get refused, what you can fix, and what the fee situation is on a second attempt.',
  },
  {
    slug: 'vs-visa-on-arrival',
    label: 'E-visa vs visa on arrival',
    blurb: 'Two different things sold under similar names. Which one you can actually use depends on how you arrive.',
  },
  {
    slug: 'by-nationality',
    label: 'Who needs a Vietnam e-visa',
    blurb: 'Every nationality can apply — but some do not need to at all. How to tell which case you are in.',
  },
] as const

/** Route path for a child, e.g. `/vietnam-evisa/1-hour-urgent`. */
export const evisaChildPath = (slug: string) => `${EVISA_HUB_PATH}/${slug}`

/** Hub + every child, for the sitemap. */
export const VIETNAM_EVISA_PATHS: readonly string[] = [
  EVISA_HUB_PATH,
  ...EVISA_CHILDREN.map((c) => evisaChildPath(c.slug)),
]

/**
 * Crawlable links to the other pages in the cluster. Pass the current page's slug so it does not
 * link to itself (the hub passes nothing and gets all five).
 */
export function evisaRelated(exceptSlug?: string) {
  return EVISA_CHILDREN.filter((c) => c.slug !== exceptSlug).map((c) => ({
    href: evisaChildPath(c.slug),
    label: c.label,
    blurb: c.blurb,
  }))
}
