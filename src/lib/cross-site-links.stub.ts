/**
 * MARKETPLACE-EDITION STUB for cross-site-links.ts.
 *
 * On eno.vn every destination in the real module is a self-link and every label is promotional copy
 * about the site the reader is already on. next.config.ts aliases the real module here so none of
 * that vocabulary is emitted into a client chunk the licensed marketplace serves — a runtime gate
 * would decline to RENDER the links while leaving the strings in the artifact (see
 * src/lib/edition-services-copy.ts for the measurement that established this).
 *
 * ⚠️ INERT, NOT EMPTY-BUT-USABLE. `MARKETPLACE_HOME` is null and the array is empty, so the promo
 * component's own guard (`!home || !links.length`) short-circuits to null before any href is read.
 * Do not "helpfully" give these placeholder values: a stub that renders something is a stub that
 * put the words back.
 */
export type CrossSiteLink = {
  key: string
  href: string
  labelEn: string
  labelVi: string
  blurbEn: string
  blurbVi: string
}

export const CROSS_SITE_REL = 'noopener'
export const MARKETPLACE_HOME: CrossSiteLink | null = null
export const MARKETPLACE_LINKS: CrossSiteLink[] = []
