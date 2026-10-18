import { TEACH_BASE, guideEntry, isLive, releasedGuides, teachPath } from './registry'

/**
 * LINKS INTO THE TEACH-IN-VIETNAM LIBRARY FROM THE REST OF THE SITE (teacher visibility plan, 2026-10-18).
 *
 * ⛔ THE HUB AND ITS GUIDES WERE AN ISLAND. Measured on production 2026-10-18: the string "teach-in-vietnam" appeared
 * 0 times in the HTML of /, /c/jobs, /c/teachers, /jobs-vietnam-expats, /schools, /about and /hcmc-rent-index — while
 * the guides drew 41.5% of eno.vn's Google impressions in their launch week (Search Console, Oct 11–17) and the hub,
 * the page meant to own "teach English in Vietnam", drew 21. Google found the library through the sitemap alone.
 * Internal links from the pages people already reach are the in-site lever for discovery and relevance.
 *
 * ⚠️ EVERY LINK INTO THE LIBRARY IS BUILT HERE, from the registry: a guide that is renamed, withdrawn or not yet
 * released (registry.ts `isLive`) drops out of every page at once instead of leaving a 404 behind. The link text is the
 * guide's own `label` — never a keyword anchor typed into a page.
 * ⚠️ ENGLISH ONLY, like the library: where the text around a link is Vietnamese, the caller marks the link `lang="en"`
 * (the /c Guides block, the rent index line). The English landings (/jobs-vietnam-expats, /housing-vietnam-expats) need
 * nothing — their copy, "Keep reading" included, is English on every render.
 * ⚠️ MARKETPLACE PAGES ONLY: eno.forum 308s the library to eno.vn (next.config.ts), so a link there is a redirect.
 */
export type TeachLink = { href: string; label: string; blurb: string }

/**
 * The hub — or null before the first guide is released, when the hub itself is a 404 (teach-in-vietnam/page.tsx:
 * "no guide = no hub"). The blurb restates the hub's own meta description, so it promises nothing the page lacks.
 */
export function teachHubLink(now: Date = new Date()): TeachLink | null {
  if (!releasedGuides(now).length) return null
  return {
    href: TEACH_BASE,
    label: 'Teach English in Vietnam',
    blurb: 'What you need, what you earn and how to start, Ho Chi Minh City first, with live job, school and rent numbers.',
  }
}

/** The released guides among `slugs`, in that order — an unknown or unreleased slug drops out rather than linking a 404. */
export function teachGuideLinks(slugs: readonly string[], now: Date = new Date()): TeachLink[] {
  return slugs.flatMap((slug) => {
    const e = guideEntry(slug)
    return e && isLive(e, now) ? [{ href: teachPath(slug), label: e.label, blurb: e.blurb }] : []
  })
}

/** The hub (when it exists), then the released guides among `slugs`. */
export function teachLinks(slugs: readonly string[], now: Date = new Date()): TeachLink[] {
  const hub = teachHubLink(now)
  return [...(hub ? [hub] : []), ...teachGuideLinks(slugs, now)]
}
