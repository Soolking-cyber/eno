/**
 * MARKETPLACE-EDITION STUB for terms-services-copy.ts.
 *
 * eno.vn is a licensed sàn TMĐT and may not offer — or even mention — the e-visa service, so the
 * provider-of-record paragraphs of /terms must not exist in anything eno.vn serves. /terms is one
 * file rendered by both editions, so a marketplace build DOES compile it; `next.config.ts` aliases
 * the real copy module here, which is what keeps the words out of the artifact. The page's
 * `IS_SERVICES` gate is what keeps them off the screen.
 *
 * ⚠️ EMPTY, NOT EXPLANATORY. A stub that said "this section does not apply on eno.vn" would put the
 * vocabulary back into the bundle it exists to remove, in the one file nobody re-reads. Empty
 * strings and empty arrays render nothing, and the page additionally drops any section with no
 * title or no paragraphs, so a future call site that forgets the gate still renders nothing here.
 *
 * ⚠️ TYPESCRIPT NEVER SEES THIS FILE — the alias is a bundler resolution, so `tsc` checks /terms
 * against the REAL module. A missing or reshaped export here is a runtime crash on eno.vn that no
 * typecheck catches; src/components/marketplace/edition-stubs.test.ts pins the two together.
 */
export type TermsSection = { title: string; paras: string[] }

export const TERMS_SERVICES_COPY: {
  providerSection: TermsSection
  documentsSection: TermsSection
  feesParas: string[]
  liabilityParas: string[]
  complaintParas: string[]
} = {
  providerSection: { title: '', paras: [] },
  documentsSection: { title: '', paras: [] },
  feesParas: [],
  liabilityParas: [],
  complaintParas: [],
}
