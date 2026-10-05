import { SCHOOL_LOGO_STAMPS } from '@/generated/school-logos'

/**
 * A school's logo tile (public/schools/logos, made by scripts/build-school-logos.mjs from the logo on the
 * school's own website): its content stamp, or null when there is none and the page draws the monogram.
 * Read on the server only and sent per row, so the whole slug → stamp table never ships to the browser.
 */
export function schoolLogo(slug: string): string | null {
  return Object.hasOwn(SCHOOL_LOGO_STAMPS, slug) ? SCHOOL_LOGO_STAMPS[slug] : null
}
