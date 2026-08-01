/**
 * MARKETPLACE-EDITION STUB for prohibited-services-copy.ts.
 *
 * eno.vn is a licensed sàn TMĐT and may not offer — or even mention — the e-visa service, so the
 * /prohibited addendum describing how those listings are policed must not exist in anything eno.vn
 * serves. next.config.ts aliases the real module here on a marketplace build. The page already gates
 * the RENDER on IS_SERVICES; the alias is what additionally removes the WORDS from the artifact,
 * which a runtime gate cannot do (measured — see src/lib/edition-services-copy.ts).
 *
 * ⚠️ EMPTY VALUES, NOT AN EXPLANATION. A stub that helpfully said "visa rules do not apply on
 * eno.vn" would put the vocabulary straight back into the bundle it exists to keep it out of, and
 * would do it in the one file nobody re-reads.
 *
 * ⚠️ AN EMPTY `items` ARRAY IS LOAD-BEARING, NOT COSMETIC. The page derives both the section and its
 * left-rail entry from `items.length`, so an empty list is what stops a marketplace build rendering
 * a headingless section and an anchor to `#`. Do not "helpfully" put a placeholder string in it.
 *
 * ⚠️ TYPESCRIPT NEVER SEES THIS FILE — the alias is a bundler resolution, so `tsc` checks the page
 * against the REAL module. A missing or reshaped export here is a runtime crash that no typecheck
 * catches; src/components/marketplace/edition-stubs.test.ts pins the two surfaces together. Change
 * the real module's exports and you must change these.
 */

export type ProhibitedServicesSection = {
  id: string
  label: string
  title: string
  intro: string
  items: string[]
}

export const PROHIBITED_SERVICES_SECTION: ProhibitedServicesSection = {
  id: '',
  label: '',
  title: '',
  intro: '',
  items: [],
}

export type ProhibitedServicesCrosslink = {
  lead: string
  href: string
  label: string
}

export const PROHIBITED_SERVICES_CROSSLINK: ProhibitedServicesCrosslink = {
  lead: '',
  href: '',
  label: '',
}
