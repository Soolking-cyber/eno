/**
 * MARKETPLACE-EDITION STUB for visa-provider.ts.
 *
 * eno.vn is a licensed sàn TMĐT and may not offer — or even mention — the e-visa service, so the
 * partner's name and the provider-of-record disclosure must not exist in anything eno.vn serves.
 * `next.config.ts` aliases the real module here on a marketplace build. Every call site already
 * gates its RENDER on IS_SERVICES; the alias is what additionally removes the WORDS from the
 * artifact, which a runtime gate cannot do (measured — see src/lib/edition-services-copy.ts).
 *
 * ⚠️ EMPTY STRINGS, NOT AN EXPLANATION. A stub that helpfully said "this service is unavailable on
 * eno.vn" would put the vocabulary straight back into the bundle it exists to keep it out of, and
 * would do it in the one file nobody re-reads.
 *
 * ⚠️ `false` IS THE SAFE VALUE for the licence flag and it is safe in the right direction: it means
 * "not cleared to advertise", which is the correct answer on a domain that may never advertise it.
 *
 * ⚠️ TYPESCRIPT NEVER SEES THIS FILE — the alias is a bundler resolution, so `tsc` checks every
 * consumer against the REAL module. A missing or reshaped export here is a runtime crash that no
 * typecheck catches; src/components/marketplace/edition-stubs.test.ts pins the two surfaces
 * together. Change the real module's exports and you must change these.
 */

export type VisaProvider = {
  brand: string
  legalName: string
  legalNameEn: string
  taxCode: string
  licenceNo: string
  licenceIssuer: string
  licenceIssuerEn: string
  address: string
  licenceOnFile: boolean
}

export const VISA_PROVIDER: VisaProvider = {
  brand: '',
  legalName: '',
  legalNameEn: '',
  taxCode: '',
  licenceNo: '',
  licenceIssuer: '',
  licenceIssuerEn: '',
  address: '',
  licenceOnFile: false,
}

export const PROVIDER_LICENCE_ON_FILE = VISA_PROVIDER.licenceOnFile

export const PROVIDER_OF_RECORD = {
  en: '',
  vi: '',
  shortEn: '',
  shortVi: '',
}
