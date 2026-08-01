import { VISA_PROVIDER, PROVIDER_OF_RECORD } from '@/lib/visa-provider'

/**
 * SERVICES-EDITION-ONLY PRIVACY COPY — the paragraphs of /privacy that describe visa-applicant data.
 *
 * ⚠️ WHY THIS IS A MODULE AND NOT A BRANCH INSIDE THE PAGE. src/app/privacy/page.tsx is ONE file
 * rendered by BOTH editions (a privacy policy cannot 404 on the licensed marketplace), so a
 * marketplace build compiles it. `IS_SERVICES ? a : b` inside that page stops the RENDER but leaves
 * every literal in the artifact — measured in src/lib/edition.ts. Moving the literals behind a
 * module boundary lets next.config.ts alias the lot to an empty stub on a marketplace build, which
 * is the only mechanism that removes strings rather than declining to render them. Same pattern,
 * same reason, as src/lib/edition-services-copy.ts.
 *
 * ⚠️ AND THERE IS A SECOND PATH OUT THAT IS EASY TO WALK INTO. scripts/gen-ui-strings.mjs harvests
 * `<Tr text="…">` JSX literals into src/generated/ui-strings.ts, which is SHIPPED TO THE BROWSER to
 * pre-warm translations. /privacy happens to render its paragraphs from an array (`<Tr text={p} />`),
 * which the harvester does not match — measured 2026-08-01: not one of that page's paragraphs is in
 * the catalogue. So that path is not open TODAY. It opens the moment somebody adds a sentence the
 * obvious way, as a `<Tr text="…">` literal in the JSX, and then the words are in the one file every
 * eno.vn visitor downloads on every page. Keeping the vocabulary in an aliased module closes both
 * paths and does not depend on anyone remembering which shape is safe.
 *
 * ⚠️ THE HARVESTER DOES NOT SEE THESE STRINGS EITHER, and that is the intended trade: they are plain
 * array entries, so they enter NEITHER catalogue. The page renders them through `<Tr>` exactly like
 * its own paragraphs, which still translates them — lazily, via /api/translate, rather than from the
 * pre-warmed batch, which is already how every long paragraph on that page behaves. Do NOT "fix"
 * that by wrapping them in tr(...) here; that would put the vocabulary straight back into the
 * catalogue the alias exists to keep it out of. (Same trade already accepted for PROVIDER_OF_RECORD.)
 *
 * ⚠️ EVERY EXPORT IS AN ARRAY, DELIBERATELY. The page splices them in with
 * `...(IS_SERVICES ? X : [])`, so if a gate is ever dropped, the marketplace build renders the STUB's
 * empty arrays — nothing appears rather than an empty heading. Belt and braces: the alias controls
 * the artifact, the gate controls behaviour, and neither is trusted alone.
 *
 * ⚠️ THE STUB IS NOT TYPE-CHECKED AGAINST THIS FILE. An alias is a bundler resolution; `tsc` only
 * ever sees this module. Adding an export here and using it in the page is a green typecheck and a
 * crash on eno.vn. src/components/marketplace/edition-stubs.test.ts pins the two export surfaces
 * together — add an export here, add it there.
 *
 * ⚠️ ACCURACY NOTES, so nobody softens or hardens these claims by guesswork. Each of the factual
 * statements below was read out of the code, not assumed:
 *   · encryption — src/lib/visa/crypto.ts stores applicant payloads as AES-256-GCM envelopes and
 *     FAILS CLOSED (`visa_encryption_not_configured`) when the key is absent, so "stored encrypted"
 *     has no plaintext fallback path to be wrong about;
 *   · private storage — src/lib/visa/storage.ts uploads to a private bucket and hands out 300-second
 *     signed URLs to owner/admin-gated callers only;
 *   · automated checks — src/lib/visa/image-quality.ts, image-normalization.ts and mrz.ts;
 *   · retention — src/app/api/cron/visa-retention writes nothing itself: `retention_until` is set on
 *     the TERMINAL transitions only, and the sweep deletes objects fail-closed before the row. That
 *     is why the copy says the window starts at the final outcome and DOES NOT NAME A NUMBER OF
 *     DAYS. Do not add one here — the number lives in the data, changes without touching this file,
 *     and a policy that promises the wrong one is a false statement rather than a stale comment.
 */

/**
 * A section of the policy, in the page's own shape: [anchor id, title, paragraphs].
 *
 * ⚠️ THE ID IS CARRIED, NOT DERIVED FROM POSITION. /privacy used to build anchors as `s${index}`,
 * and this array is spliced into the MIDDLE of the page on the services edition — so `#s5` pointed
 * at a different section on each edition and re-pointed again whenever a section was added. Privacy
 * anchors get quoted in rights requests and complaint threads; they have to keep meaning the same
 * thing. /terms carries its ids for the same reason.
 */
export type PrivacySection = [string, string, string[]]

/** Appended to "Who is responsible for your data" — the one place eno is a PROCESSOR, not a controller. */
export const PRIVACY_SERVICES_CONTROLLER: string[] = [
  `There is one exception to the paragraph above. For a Vietnam e-visa application, ${VISA_PROVIDER.brand} — the licensed travel company that actually performs the service — is the data controller for the application dossier, and we act as its data processor: we collect and check the documents on its instructions and pass them on. What that means in practice is set out under “Visa applications” below.`,
]

/** Appended to "What personal data we collect". */
export const PRIVACY_SERVICES_COLLECT: string[] = [
  'Visa application information: if you apply for a Vietnam e-visa through this site, we collect the applicant’s identity documents and the details the application requires. Some of that is sensitive personal data under Vietnamese law, so it is described separately in the next section rather than buried in this list.',
]

/** Appended to "Why we use your data, and on what basis". */
export const PRIVACY_SERVICES_PURPOSES: string[] = [
  `To collect, check and hand over a visa application dossier to ${VISA_PROVIDER.brand} so the service you asked for can be performed — on your express consent, and on that company’s instructions as the controller of that dossier.`,
]

/** Appended to "Who else receives your data". */
export const PRIVACY_SERVICES_RECIPIENTS: string[] = [
  `${VISA_PROVIDER.brand}, the licensed Vietnamese travel company that provides the e-visa service listed on this site, receives the applicant’s documents and application details so it can prepare and submit the application. It is the controller for that dossier and handles it under its own privacy policy and its own obligations under Vietnamese law. We pass it nothing else about you — not your listings, your messages, or your activity on the site.`,
]

/** Appended to "How long we keep your data". */
export const PRIVACY_SERVICES_RETENTION: string[] = [
  'Visa application data follows the separate schedule described under “Visa applications”: a retention window starts when the application reaches a final outcome, and at the end of it the documents, the application details and the issued visa file are deleted automatically. Identity documents are not kept indefinitely.',
]

/**
 * Whole sections spliced into the policy, services edition only.
 *
 * Placed after "What personal data we collect" by the page, because it is the detail that section
 * points at. The first paragraph is PROVIDER_OF_RECORD so the "who is answerable" sentence is
 * authored once, in src/lib/visa-provider.ts, and cannot drift between the legal pages.
 */
export const PRIVACY_SERVICES_SECTIONS: PrivacySection[] = [
  [
    'visa-applications',
    'Visa applications: documents, consent and the provider',
    [
      PROVIDER_OF_RECORD.en,
      'To prepare a Vietnam e-visa application we collect: an image of the applicant’s passport data page, a portrait photograph, and the details the immigration authorities require on the form — full name, date and place of birth, sex, nationality, passport number with its issue and expiry dates, intended dates and port of entry and exit, address in Vietnam, and contact details. Where the application type calls for them, we also collect supporting documents you upload.',
      'Identity-document images and a portrait photograph used to identify a person are sensitive personal data under Vietnamese law. We process them only on your express consent, given separately for this purpose and before anything is uploaded, and only to prepare and submit the application. You can withdraw that consent at any time; if you withdraw it while an application is in progress, we and the provider stop processing the dossier, which means the application cannot be completed.',
      `Application details are stored in encrypted form, and document images are held in private storage that is not reachable from the internet — they can only be opened through short-lived links issued to you, to our reviewers, and to ${VISA_PROVIDER.brand}. What is handed to ${VISA_PROVIDER.brand} is limited to what the application needs: the passport image, the portrait, and a data sheet of the form fields.`,
      'Uploaded documents are checked automatically before they are handed over — for readability, image quality, portrait requirements, and consistency between the photo of the passport and the details on the form. A check can block or flag an upload. If you think an automated check has got it wrong, write to us and a person will review it.',
      `Payment for the visa service is taken by ${VISA_PROVIDER.brand} on its own systems. We never receive or store your card or bank details.`,
      'When the application reaches a final outcome — issued, refused or cancelled — a retention window starts. At the end of it the documents, the application details and the issued visa file are deleted from our systems automatically, and the download link stops working. That deletion is the point: we do not hold identity documents longer than the service needs them. Copies held by the provider after the handover are governed by its own retention obligations as controller.',
    ],
  ],
]
