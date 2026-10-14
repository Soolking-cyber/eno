/**
 * MARKETPLACE-EDITION STUB for prohibited-services-copy.ts.
 *
 * Since 2026-10-14 eno.vn publishes the e-Visa listing rules itself (the owner's decision — the e-Visa subcategory is
 * open to every seller on both sites, live after eno's licence check), so the real module holds only eno.forum's note
 * about eno.vn. This stub exists so that eno.vn's build never carries that sentence and its URL: on eno.vn it would be
 * the page linking to itself. next.config.ts aliases the real module here on a marketplace build; the page gates the
 * RENDER on IS_SERVICES and `href`, and the alias removes the WORDS, which a runtime gate cannot do.
 *
 * ⚠️ EMPTY VALUES, NOT AN EXPLANATION. A stub that helpfully explained itself would put the words straight back into
 * the bundle it exists to keep them out of, in the one file nobody re-reads.
 *
 * ⚠️ TYPESCRIPT NEVER SEES THIS FILE — the alias is a bundler resolution, so `tsc` checks the page
 * against the REAL module. A missing or reshaped export here is a runtime crash that no typecheck
 * catches; src/components/marketplace/edition-stubs.test.ts pins the two surfaces together. Change
 * the real module's exports and you must change these.
 */

export type ProhibitedServicesCrosslink = {
  lead: string
  leadVi: string
  href: string
  label: string
}

export const PROHIBITED_SERVICES_CROSSLINK: ProhibitedServicesCrosslink = {
  lead: '',
  leadVi: '',
  href: '',
  label: '',
}
