/**
 * THE LONG-FORM ARRIVAL GUIDES — one registry, so a new one cannot be built and then forgotten.
 *
 * Same idiom, and the same reason, as src/app/vietnam-evisa/links.ts: the sitemap's static page list
 * is hard-coded, which is exactly how a page ships, deploys, and is never submitted to Google. The
 * sitemap imports `EXPAT_GUIDE_PATHS` from here, so adding an entry adds the URL to the sitemap and
 * to every sibling guide's "Keep reading" block at once. It does not create the route — but a listed
 * path with no page is a 404 in the sitemap, which is loud, while a live page in no sitemap is
 * silent. Loud is the failure mode to choose.
 *
 * ⚠️ THE ROUTES ARE SERVICES-ONLY (`page.svc.tsx`) AND THIS MODULE IS NOT. That asymmetry is
 * deliberate and it constrains what may be written here: src/app/sitemap.xml/route.ts compiles on
 * BOTH editions, so every string below lands in eno.vn's server bundle even though the pages do not
 * exist there. Hence the rule for this file —
 *
 *   ⚠️ NO VISA VOCABULARY IN ANY VALUE. Not in a slug, not in a label, not in a blurb. The guides
 *   themselves discuss the e-visa at length; those words live in the `page.svc.tsx` files, which a
 *   marketplace build never compiles. Keeping this registry vocabulary-free is what lets the sitemap
 *   import it without an alias, and it is a rule you can check by reading three lines rather than by
 *   reasoning about a module graph.
 *
 * ⚠️ AND THE SITEMAP MUST STILL GATE ON IS_SERVICES. The paths are harmless words; submitting them
 * to Google from eno.vn would submit four 404s. The gate is in the sitemap, beside the e-visa one.
 */
export type ExpatGuide = {
  /** Top-level route segment. */
  slug: string
  /** Link text used by sibling guides. */
  label: string
  /** One line of what the guide answers — the link's whole reason to be clicked. */
  blurb: string
}

export const EXPAT_GUIDES: readonly ExpatGuide[] = [
  {
    slug: 'moving-to-vietnam',
    label: 'Moving to Vietnam: what to arrange before you fly',
    blurb:
      'The paperwork that has to be done at home, what to ship and what to buy secondhand, and how much cash the first month really takes.',
  },
  {
    slug: 'first-month-in-vietnam',
    label: 'Your first month in Vietnam: the checklist',
    blurb:
      'Registering your stay, a phone number that works with banking apps, reading a lease, and the deadlines that have real consequences.',
  },
] as const

/** Route path for a guide, e.g. `/moving-to-vietnam`. */
export const expatGuidePath = (slug: string) => `/${slug}`

/** Every guide path, for the sitemap. */
export const EXPAT_GUIDE_PATHS: readonly string[] = EXPAT_GUIDES.map((g) => expatGuidePath(g.slug))

/**
 * Crawlable links to the other guides. Pass the current guide's slug so a page does not link to
 * itself; pass nothing (from outside the set) to get all of them.
 */
export function expatGuidesExcept(slug?: string) {
  return EXPAT_GUIDES.filter((g) => g.slug !== slug).map((g) => ({
    href: expatGuidePath(g.slug),
    label: g.label,
    blurb: g.blurb,
  }))
}
