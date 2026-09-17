/**
 * ⚠️ KEEP `revalidate` — the same reason /terms carries it. Nothing on this page is time-derived
 * today, but it is a LEGAL page, and src/lib/edition.ts records twice what a prerendered legal page
 * costs when a value inside it goes stale or an edition gate arrives too late to reach on-disk HTML.
 */
export const revalidate = 3600

import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { COMPANY, OPERATOR_REGISTERED } from '@/lib/site-legal'

// ── Returns and exchanges ───────────────────────────────────────────────────────────────
//
// ⛔ THIS PAGE EXISTS BECAUSE GOOGLE MERCHANT CENTER REFUSES TO VERIFY A STORE WITHOUT ONE, AND
// THAT IS EXACTLY WHY IT HAS TO BE TRUE RATHER THAN CONVENIENT. Merchant Center's Returns setup
// demands a "Return policy URL … needed for Merchant Center verification", and the obvious move —
// publish a generic 30-day no-questions policy so the form goes green — would have this marketplace
// promising, on behalf of sellers it does not employ, something none of them agreed to. On a
// licensed sàn TMĐT in Vietnam that is a consumer-protection exposure, not a growth hack.
//
// ⚠️ SO THE SCOPE IS DELIBERATELY NARROW, AND IT MATCHES WHAT THE FEED ACTUALLY CONTAINS. Owner's
// decision, 2026-09-17: the published policy binds the VERIFIED BUSINESS STOREFRONTS (the official
// partners whose catalogues are what Shopping surfaces), on a 7-day window — the window Vietnamese
// electronics retailers actually run, so the page states something the sellers will honour. Private
// person-to-person sales are described honestly as what they are: inspect before you pay, no
// platform return right, the Dispute Center still open to you.
//
// ⚠️ THE PAGE AND THE MERCHANT CENTER FORM MUST AGREE, FIELD BY FIELD. Google's three steps ask for
// country, returns yes/no, exchanges yes/no, condition + window, and method + fees; a policy page
// that answers fewer of those than the form does is the classic reason a review comes back. Each
// section below is written against one of those steps — country (Vietnam), returns accepted for
// defective AND non-defective, exchanges accepted, 7 days, who pays the return shipping. Change one
// and change the other in the same sitting.
//
// ⚠️ NO COMPANY NAME, ERC OR NUMBER IS TYPED HERE — COMPANY comes from src/lib/site-legal.ts, and
// `OPERATOR_REGISTERED` forks the operator sentence exactly as /terms does. eno.forum's operator is
// still unincorporated; asserting eno.vn's company on that edition would misstate who is legally
// responsible for this promise.
//
// ⚠️ EDITION-NEUTRAL BY CONSTRUCTION. This route compiles on BOTH builds, so no word here may name
// a visa, an itinerary or PayPal. The subject is physical goods sold by storefronts, which is
// common ground; keep it that way rather than adding a gate.
//
// ⚠️ ENGLISH SOURCE THROUGH `<Tr>`, like /terms — NOT the curated bilingual pairs /regulations
// uses. That page is the instrument FILED with MoIT, where the Vietnamese text is the legally
// operative one and must render unconditionally. This is a consumer-facing policy, so it follows
// the /terms precedent: one English source and the translation layer for `vi`, with the visible
// disclaimer that the English text is the authoritative one.
//
// ⛔ THE CURATED VIETNAMESE COVERS THE CHROME AND THE HEADINGS, NOT THE BODY — AND THAT IS A
// CONSTRAINT, NOT AN OMISSION TO TIDY UP LATER. An earlier draft of this note promised curated
// Vietnamese "for the load-bearing sentences"; a reviewer checked vi-overrides.ts and it was not
// there, so the promise is removed rather than half-kept. The reason it cannot simply be added:
// VI_OVERRIDES is keyed on the EXACT English string, and every paragraph below interpolates
// `SITE_NAME`. The same paragraph is therefore a different key on eno.vn and on eno.forum, so an
// override written against one edition silently misses on the other — a per-edition landmine that
// is worse than an honest machine translation under a disclaimer.
// ✅ What IS curated is everything with a stable key: the page title, the seven section headings,
// the footer link and the two meta lines. ⚠️ Note that `Your return window` deliberately does NOT
// carry the number any more — it used to read `Your ${WINDOW_DAYS}-day return window`, which meant
// changing the constant silently orphaned its Vietnamese override and left one heading in English.
// The number lives in the body, where nothing is keyed on it.

/** The published window, in days. ⚠️ Named because the copy, the FAQ and the Merchant Center form
 *  all have to say the same number, and a literal typed three times drifts on the first edit. */
const WINDOW_DAYS = 7

export const metadata: Metadata = {
  // ⚠️ SENTENCE CASE, MATCHING THE H1 AND THE `vi` OVERRIDE KEYED ON IT. It read "Returns and
  // Exchanges" while the heading read "Returns and exchanges" — only the heading has curated
  // Vietnamese, so the two drifted by case as well as by locale. /terms keeps its title and its H1
  // identical for the same reason; a reviewer spotted this one.
  title: `Returns and exchanges | ${SITE_NAME}`,
  description: `How returns and exchanges work on ${SITE_NAME}: a ${WINDOW_DAYS}-day window on items bought from verified business storefronts, who pays return shipping, how to start a return, and what private person-to-person sales mean for buyers.`,
  alternates: { canonical: '/returns' },
}

type Section = { id: string; title: string; paras: string[] }

// ⚠️ THE OPERATOR SENTENCE FORKS, AND IT IS NOT A FORMALITY — see the identical note in /terms.
// "Operated by X, business registration no. Y" is a false statement on an edition whose operator is
// not incorporated, and a field reading "đang cập nhật" next to the words "registration no." does
// not read as a disclaimer to anybody.
const operatorPara = OPERATOR_REGISTERED
  ? `${SITE_NAME} is an online classifieds marketplace operated by ${COMPANY.name} (${COMPANY.nameEn}), business registration no. ${COMPANY.erc} (${COMPANY.ercIssued}). This policy applies to purchases made in Vietnam.`
  : `${SITE_NAME} is an online classifieds marketplace for people living in, moving to and visiting Vietnam. The operating company is currently being registered; its registered name and business registration number will be published here and in the Operating Regulations as soon as the certificate is issued. This policy applies to purchases made in Vietnam.`

const sections: Section[] = [
  {
    id: 'who',
    title: 'Who this policy covers',
    paras: [
      operatorPara,
      `${SITE_NAME} does not sell anything itself. There is no checkout on this site: every item is offered by the person or business that listed it, and the money passes between buyer and seller directly. That shapes everything below, so it is worth stating plainly before the rules rather than in a footnote after them.`,
      `This policy is the returns commitment of the verified business storefronts on ${SITE_NAME} — the registered companies whose catalogues appear in product listings and in shopping results. Where you buy from one of them, the terms on this page apply to your purchase and the storefront is required to honour them.`,
      `A listing posted by a private individual is a person-to-person sale, and there is no return right attached to it. Inspect the item, test it, and agree the price before any money changes hands. If something goes wrong afterwards you can still open a case in the Dispute Center, and we can act against a seller who misrepresented what they sold — but we cannot compel a private seller to take an item back.`,
    ],
  },
  {
    id: 'window',
    title: 'Your return window',
    paras: [
      `You have ${WINDOW_DAYS} days from the day you receive an item bought from a verified business storefront to return it. The window covers both faulty items and items you simply do not want, and it runs from delivery or collection, not from the order date.`,
      `To be returned, an item must be complete — accessories, cables, manuals, free gifts and original packaging — and in the condition you received it, beyond whatever handling was needed to check that it works. An item that has been installed, activated, modified or damaged after delivery is outside this policy.`,
      `Keep proof of purchase. The invoice, the order confirmation or the message thread on ${SITE_NAME} all count; the thread is usually the easiest, because it is already a dated record both sides can see.`,
    ],
  },
  {
    id: 'fees',
    title: 'Who pays, and what you get back',
    paras: [
      `If the item is faulty, damaged in transit, incomplete, counterfeit or materially different from its listing, the seller pays the return shipping and you choose between a full refund — including the original delivery charge — a replacement, or a repair under warranty. You are never out of pocket for a seller's mistake.`,
      `If the item is exactly as described and you have simply changed your mind, the return is still accepted inside the ${WINDOW_DAYS} days, but you pay the return shipping and the original delivery charge is not refunded. The item must be unused and resalable.`,
      `Refunds are made by the seller, by the same method you paid, within 7 working days of the item arriving back with them. Because payment on ${SITE_NAME} is arranged directly between buyer and seller, the refund comes from the seller and not from the platform.`,
    ],
  },
  {
    id: 'exchanges',
    title: 'Exchanges',
    paras: [
      `Verified business storefronts accept exchanges on the same ${WINDOW_DAYS}-day window and the same conditions as a return. You can exchange for a different size, colour, configuration or model.`,
      `Where the replacement costs more, you pay the difference; where it costs less, the difference is refunded to you. If the exchange is because the item was faulty or not as described, the seller covers the shipping in both directions.`,
    ],
  },
  {
    id: 'how',
    title: 'How to start a return',
    paras: [
      `Message the seller from the listing on ${SITE_NAME} and tell them what you are returning and why. Keep it in the in-app thread rather than moving to another app: the thread is timestamped, neither side can edit it, and it is the record we read if the return is ever disputed.`,
      `The seller should answer within 3 working days and tell you where to send the item or when they will collect it. If they do not answer, or you cannot agree, open a case in the Dispute Center. We review the thread, the listing and the evidence both sides provide, and we can restrict or remove a storefront that will not honour this policy.`,
      `You can also write to ${COMPANY.email} if you would rather raise it with us directly. Include the listing link and the seller's name so we can find the thread.`,
    ],
  },
  {
    id: 'exceptions',
    title: 'What cannot be returned',
    paras: [
      `A small set of goods is excluded, for reasons of hygiene, safety or because the item cannot be resold once it has left the seller: food and other perishables; cosmetics, underwear, swimwear and personal-care items once opened or unsealed; items made, engraved or configured to your order; and digital goods or activation codes once they have been delivered or redeemed.`,
      `An item sold explicitly as faulty, for parts, or with a disclosed defect cannot be returned for that defect — you agreed the price knowing about it. Any other fault in the same item is still covered.`,
      `Damage caused after delivery — drops, liquid, unauthorised repair, or use outside the manufacturer's instructions — is not a return. Where a manufacturer's warranty applies it is separate from this policy and survives the ${WINDOW_DAYS} days.`,
    ],
  },
  {
    id: 'rights',
    title: 'Your rights under Vietnamese law',
    paras: [
      `Nothing on this page reduces the rights Vietnamese consumer-protection law gives you, and where the law is more generous than this policy, the law applies. Business sellers owe you the statutory warranty and recall obligations that come with what they sell, and those duties are theirs whatever a listing says.`,
      `You keep the right to complain to the competent consumer-protection authority or to a consumer-protection organisation, and to take a dispute to the courts of Vietnam. Using the Dispute Center first is quicker and usually enough, but it is not a condition of anything above.`,
    ],
  },
]

export default function ReturnsPage() {
  return (
    <ContentPage
      title="Returns and exchanges"
      meta={
        <>
          <p className="mt-3 text-sm text-ink-4">
            <Tr text="Last updated: September 2026" /> · <Tr text="Applies to purchases in Vietnam" />
          </p>
          <p className="mt-2 max-w-[70ch] text-xs text-muted-foreground italic">
            <Tr text="This translation is provided for your convenience. The English version of this policy is the authoritative one." />
          </p>
        </>
      }
      intro={
        <Tr
          text={`Items bought from a verified business storefront can be returned or exchanged within ${WINDOW_DAYS} days, whether or not there is anything wrong with them. Listings posted by private individuals are person-to-person sales and work differently — this page explains both.`}
        />
      }
      sections={sections.map((s) => ({ id: s.id, label: s.title }))}
    >
      {sections.map((s) => (
        <ContentSection key={s.id} id={s.id} title={s.title}>
          <div className="space-y-2">
            {s.paras.map((p, j) => (
              <p key={j} className="text-base leading-relaxed text-body"><Tr text={p} /></p>
            ))}
            {/* ⚠️ THE DISPUTE CENTER IS A REAL LINK, NOT A PATH TYPED INTO A SENTENCE. /terms writes
                its cross-references as bare text ("published at /privacy") and that is fine for a
                document people read; this section is the PROCESS a buyer follows when a return goes
                wrong, and it is the part a Merchant Center reviewer checks is actually reachable.
                One link, appended after the paragraphs rather than threaded through them, because
                `paras` is a string array by design — see the same shape in /terms' `related`. */}
            {s.id === 'how' ? (
              <p className="text-base leading-relaxed text-body">
                <a href="/disputes" className="font-semibold text-accent-foreground hover:underline">
                  <Tr text="Open a case in the Dispute Center" />
                </a>
              </p>
            ) : null}
          </div>
        </ContentSection>
      ))}
    </ContentPage>
  )
}
