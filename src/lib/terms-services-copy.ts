/**
 * THE PARTS OF /terms THAT ONLY THE SERVICES EDITION MAY CARRY — services edition only.
 *
 * `src/app/terms/page.tsx` is ONE file rendered by BOTH deployments. The provider-of-record
 * paragraphs below belong on eno.forum and may not exist in anything eno.vn serves, so they live
 * behind a module boundary that `next.config.ts` aliases to `terms-services-copy.stub.ts` on a
 * marketplace build. The page still gates the render on `IS_SERVICES` — the gate controls
 * BEHAVIOUR, the alias controls the ARTIFACT, and you need both (measured; see
 * src/lib/edition.ts and src/lib/edition-services-copy.ts).
 *
 * ⚠️ THERE IS A SECOND, LESS OBVIOUS LEAK PATH, AND IT IS THE REASON THIS COPY MAY NOT SIMPLY BE
 * WRITTEN INLINE AS `<Tr text="…">` IN THE PAGE. scripts/gen-ui-strings.mjs harvests every literal
 * `<Tr text="…">` / `tr('…')` in src/** into a translation catalogue that is SHIPPED TO THE BROWSER
 * to pre-warm the language switcher. It splits that catalogue in two by source path — and its
 * SERVICES_SOURCES list contains no legal page, because /terms is shared. So a visa sentence typed
 * directly into the page would be classified CORE, land in `src/generated/ui-strings.ts`, and be
 * downloaded by every eno.vn visitor on every page, with nothing rendering it and no lint noticing.
 * Keeping the words in an aliased module is what avoids that; strings reached through a variable
 * (`<Tr text={p} />`) are not harvested at all.
 *
 * ⚠️ ENGLISH ONLY, DELIBERATELY. /terms is a server component and `tr(en, vi)` is a client hook, so
 * there is no way to render the curated Vietnamese of PROVIDER_OF_RECORD.vi here — the page states
 * that English is the authoritative version and the other languages come from the translation
 * layer, which is the standing posture for every legal page in this repo. The curated Vietnamese
 * still exists in src/lib/visa-provider.ts for client surfaces (badges, the CTA row); do not
 * duplicate it here, and do not make the page a client component to use it.
 *
 * ⚠️ THE PARTNER'S NAME IS READ FROM `VISA_PROVIDER`, NEVER TYPED. Same rule as everywhere else:
 * no company name, licence number or registration number is hardcoded outside its constant.
 *
 * ⚠️ TYPESCRIPT NEVER SEES THE STUB. An alias is a bundler resolution, so `tsc` checks the page
 * against THIS module — adding an export here and using it in the page is a green typecheck and a
 * runtime crash on eno.vn. src/components/marketplace/edition-stubs.test.ts pins the two surfaces
 * together; change one and you must change the other.
 */
import { SITE_NAME } from '@/lib/edition'
import { PROVIDER_OF_RECORD, VISA_PROVIDER } from '@/lib/visa-provider'

/** One rendered chunk of the Terms: a heading (which also becomes a rail anchor) and its prose. */
export type TermsSection = { title: string; paras: string[] }

/** Short local alias — the brand appears in almost every sentence below. */
const P = VISA_PROVIDER.brand

export const TERMS_SERVICES_COPY: {
  /** A whole section, inserted after "…is a platform, not a party to the deal". */
  providerSection: TermsSection
  /** A whole section, inserted straight after `providerSection`. */
  documentsSection: TermsSection
  /** Paragraphs appended to the shared sections of the same name. */
  feesParas: string[]
  liabilityParas: string[]
  complaintParas: string[]
} = {
  providerSection: {
    title: 'Vietnam e-visa services: who sells them, and who answers for them',
    paras: [
      // The canonical disclosure, single-sourced so this page, the badges and the CTA row cannot
      // drift into three slightly different descriptions of the same legal arrangement.
      PROVIDER_OF_RECORD.en,
      `In practice that means ${P} decides whether it can take your application, sets the fee, prepares and lodges the application with the Vietnamese authorities under its own licence, and answers to you for that service. ${SITE_NAME} lists the service, gives you the tools to submit and check your documents, passes the completed file to ${P}, and keeps you updated in your chat thread.`,
      `${SITE_NAME} does not carry out visa filings and does not give immigration or legal advice. Nothing on this site is advice about your eligibility, about which visa you need, or about your right to enter Vietnam. Only the Vietnamese authorities decide an application: neither ${SITE_NAME} nor ${P} can guarantee that one will be approved, or approved by any particular date, and nothing published here should be read as such a guarantee. Processing times shown on a listing are the partner's estimate of its own turnaround, not a commitment by us and not a promise about the authorities.`,
      `You are responsible for the truth and completeness of what you submit, and for meeting the entry conditions that apply to you — a valid passport, the purpose of your trip, and anything else Vietnamese law requires of you. Incorrect or incomplete information is the most common reason an application fails, and it is not something ${SITE_NAME} can put right afterwards.`,
    ],
  },
  documentsSection: {
    title: 'Your application documents',
    paras: [
      `To use the service you upload the documents ${P} needs — typically a passport page and a portrait photograph — through this site. We run automated checks on them: whether the image is readable, whether the whole page is in frame, whether the photo is in the format the authorities expect. The point is to catch avoidable problems before an application is lodged.`,
      `Those checks are a convenience, not a legal assessment. Passing them does not mean your documents will be accepted and does not indicate that an application will succeed; failing them does not mean you are ineligible. When your file is complete we hand it to ${P}, which needs it in order to do the work.`,
      `What we collect, who it is shared with, how it is protected and how to ask for it to be deleted are set out in the Privacy Policy at /privacy. Please do not upload another person's documents unless that person has asked you to apply on their behalf and knows what you are submitting on their account.`,
    ],
  },
  feesParas: [
    `The price of a listed e-visa service is ${P}'s price. It is shown on the listing, it is paid to ${P} on ${P}'s side, and ${P}'s own terms say what it does and does not include — in particular whether the government fee is part of it. ${SITE_NAME} does not take that payment from you, does not hold it at any point and does not process it. We receive a commission from ${P} for the introduction, which does not change what you pay.`,
  ],
  liabilityParas: [
    `Because ${P} is the provider of record, ${SITE_NAME} is not liable for the e-visa service itself or for its result — including a refusal, a delay, a mistake in something ${P} prepared, or a knock-on cost such as a rebooked flight, a cancelled reservation or unused accommodation. Claims about that service lie against ${P} under its terms. What ${SITE_NAME} answers for is the platform: this site, your account, and the way we handle the information you give us.`,
  ],
  complaintParas: [
    `A complaint about the e-visa service — its price, how it was handled, its outcome, or a refund — is for ${P}, and ${P}'s own complaint and refund terms apply to it. Tell us as well: we will pass the complaint on, help you reach ${P}, and give you the record of what was submitted through this site. If a partner stops meeting the standard we expect of it, we can and will stop listing it.`,
  ],
}
