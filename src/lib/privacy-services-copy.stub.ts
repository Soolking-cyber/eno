/**
 * MARKETPLACE-EDITION STUB for privacy-services-copy.ts.
 *
 * /privacy is one file rendered by both editions — a privacy policy cannot 404 on the licensed
 * marketplace — so a marketplace build compiles the page and everything it imports. next.config.ts
 * aliases the real copy module here, which is what keeps the services-only paragraphs out of eno.vn's
 * artifact; the page's own IS_SERVICES gate is what keeps them off the screen. Both, not either.
 *
 * ⚠️ EMPTY ARRAYS, NOT AN EXPLANATION. A stub that helpfully said "this section applies only to
 * eno.forum" would put the vocabulary back into the bundle it exists to remove, in the one file
 * nobody re-reads. The emptiness is also the second line of defence: the page splices these in with
 * a spread, so if the gate is ever lost, nothing renders rather than an empty heading.
 *
 * ⚠️ TYPESCRIPT NEVER SEES THIS FILE — the alias is a bundler resolution, so `tsc` checks /privacy
 * against the REAL module. A missing or renamed export here is a runtime crash on eno.vn that no
 * typecheck catches; src/components/marketplace/edition-stubs.test.ts pins the two surfaces
 * together. Add an export there, add it here.
 */

export type PrivacySection = [string, string, string[]]

export const PRIVACY_SERVICES_CONTROLLER: string[] = []

export const PRIVACY_SERVICES_COLLECT: string[] = []

export const PRIVACY_SERVICES_PURPOSES: string[] = []

export const PRIVACY_SERVICES_RECIPIENTS: string[] = []

export const PRIVACY_SERVICES_RETENTION: string[] = []

export const PRIVACY_SERVICES_SECTIONS: PrivacySection[] = []
