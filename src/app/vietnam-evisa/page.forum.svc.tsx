import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { CrossSitePromo } from '@/components/marketplace/cross-site-promo'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG } from '@/lib/taxonomy'
import { PROVIDER_OF_RECORD } from '@/lib/visa-provider'
import { evisaRelated } from './links'
import { visaServiceLd } from './service-jsonld'

// ⚠️ 24h, NOT the 7d the other landing pages use. Those sell a category; this cluster's whole
// argument is "compare the prices on the cards below", and those cards render live
// `Listing.price` values into ISR HTML. A weekly window means an admin can change a visa price
// and this page keeps quoting the old one for six more days — on the one surface where being
// wrong about money costs the most trust. The prose is static and cheap to re-render; the prices
// are the reason for the shorter window.
export const revalidate = 86400

// The e-visa hub. Fourteen of the site's thirty-two live listings are e-visa products and until
// 2026-07-27 there was no page targeting the query at all — /visa, /evisa, /vietnam-evisa and
// /e-visa each 404'd. The incumbents on these searches are mid-tier agent sites rather than
// platform giants, which is why this is the one query set worth contesting from a new domain.
//
// ⚠️ THE CATEGORY/SUBCATEGORY PAIR COMES FROM taxonomy.ts, NOT FROM STRING LITERALS HERE. A landing
// page that restates 'services'/'visa-legal' would keep rendering a plausible-looking rail after a
// taxonomy rename — empty, or worse, full of the wrong listings — and nothing would fail.
const CONTENT: SeoContent = {
  eyebrow: 'e-Visa · Vietnam',
  h1: 'Vietnam e-Visa: prices, processing times and how to apply',
  // ⚠️ OWNER-AUTHORED COPY, PASTED VERBATIM (2026-08-17). It replaces a definition-first paragraph
  // about what an e-visa IS with a welcome that leads on the offer. Do not "tidy" it: the em
  // dashes, the curly apostrophe in "we're", the wave emoji and the tick lines are the author's.
  //
  // ⚠️ IT CARRIES MARKDOWN, WHICH THIS FIELD DID NOT USED TO. The intro renders through RichBlock
  // now (seo-landing.tsx) — **bold** becomes <strong>, the ✓ lines become a list. Through the bare
  // <p> that was here before, the asterisks would have shown literally and the four tick lines
  // would have MERGED into one run-on sentence.
  //
  // ⛔ WHAT LEFT WITH THE OLD PARAGRAPH, SO NOBODY REDISCOVERS IT LATER: the provider-of-record
  // disclosure ("provided by a licensed Vietnamese travel company, not by eno.forum") used to sit
  // in this intro, ABOVE the price cards. It is still on the page — `sections` carries
  // PROVIDER_OF_RECORD.en under "Who provides these services" — but it is now BELOW the cards, and
  // the comment on that section says plainly why above was chosen: the reader should see who is
  // selling before they open a listing. If it should also lead, add it as a line under this intro
  // rather than rewording it here; the constant is the single source.
  intro: `Welcome to Eno 👋

Your trusted starting point for Vietnam.

We make essential services simpler for internationals — from **Vietnam e-Visas** with flexible processing options to **free trip planning and booking support**.

✓ Clear options & upfront pricing
✓ Standard and express e-Visa processing
✓ Friendly support when you need help
✓ Built for foreigners navigating Vietnam

Not sure which option is right for you? **Message us before ordering — we’re happy to help.**

**Eno — e-commerce with no drama.**`,
  categorySlug: VISA_CATEGORY_SLUG,
  subcategorySlug: VISA_SUBCATEGORY_SLUG,
  cta: 'See all e-visa options',
  sections: [
    {
      title: 'What you are choosing between',
      body: 'Two decisions, and they price independently. Entry type: single entry is one crossing, multiple entry lets you leave and come back within the same 90 days. Processing speed: standard, 3, 2 or 1 working days, or express at 4 hours, 2 hours or 1 hour. Speed is the expensive axis — the one-hour tier costs several times the standard one — so pay for it only if your travel date genuinely requires it.',
    },
    {
      title: 'Express tiers run on daily cutoffs',
      body: 'The hour-based tiers are not "any time, one hour later". Each has fixed intake times in Vietnamese working hours, and an application handed in after the last one is worked at the next intake — the following working day if that falls on a weekend or public holiday. The working-day tiers have no such gate: those you can queue at any hour. The listing and the application flow both show you the next real cutoff rather than an optimistic estimate.',
    },
    {
      title: 'How applying works here',
      body: 'Open the listing for the option you want and message the desk. The government form is filled in step by step in that chat — passport details, photo, entry date and port — and your passport scan is checked for readability and data mismatches before anything is submitted, which is where most refusals come from. The desk confirms the price and how to pay before submitting; nothing is charged at the moment you start, and no card details are taken in the chat.',
    },
    // ⚠️ THIS SECTION NOW CARRIES BOTH HALVES, AND THE SPLIT IS THE POINT (owner, 2026-08-17: "we
    // fully refund if visa is not accepted change visa info almost guaranteed that our agents will
    // process visa on time"). The two claims are about DIFFERENT things and only one of them is
    // ours to make:
    //   · PROCESSING ON TIME is the agent's own work — a near-guarantee here is a promise about
    //     something they actually control, and "almost" is doing real work in that sentence.
    //   · APPROVAL is the Immigration Department's decision. Nothing may promise it, and the
    //     original wording of this section is kept verbatim for that reason.
    // The refund is what bridges them: it is how the outcome we cannot promise is made safe.
    {
      title: 'What is guaranteed, and what is not',
      // ⚠️ "PREPARED AND SUBMITTED WITHIN THE HANDLING TIME", NOT "PROCESSED ON TIME" — reviewer
      // fix. Beside price cards that sell "1 hour" and "2 hours", "we process your application on
      // time" reads as a promise that the VISA arrives in that time, which is the department's
      // half and cannot be promised. What the agents control is their own turnaround, and saying
      // exactly that keeps the near-guarantee honest instead of quietly annexing the decision.
      body: 'Your application is prepared and submitted within the handling time you paid for — that part is our agents’ own work, so a delay there is on them, not on you, and it is as close to a guarantee as this gets. The decision is a different thing: no provider can guarantee approval, override the Immigration Department, or make it decide faster than it does. What faster tiers buy is priority handling of your paperwork, not a different answer, and anyone promising a guaranteed approval is describing something they do not control. If the department refuses you, your money comes back in full — see below.',
    },
    // ⚠️ A REFUND PROMISE IS A COMMERCIAL COMMITMENT, NOT MARKETING COPY, AND IT IS PUBLISHED HERE
    // AND IN THE FAQ IN THE SAME WORDS ON PURPOSE. Two versions of a money promise on one page is
    // how a dispute starts. ⚠️ Note what it costs: the government fee is genuinely NOT refundable
    // by the Immigration Department, so "in full" means eno absorbs that fee itself on a refusal —
    // that is the owner's decision (2026-08-17), and the copy states it plainly rather than
    // implying the department gives it back.
    {
      title: 'Refused? You get a full refund',
      // ⚠️ "REFUSED", NOT "NOT ACCEPTED", AND THAT IS A REVIEWER FIX. "Not accepted" is broad enough
      // to be read as covering a withdrawn application, one rejected at intake for missing
      // documents, or merely a late one — a money promise should not have a vaguer trigger than it
      // needs. A refusal by the Immigration Department is a specific, checkable event.
      //
      // ⚠️ AND IT NAMES WHO OWES IT. eno.forum is the intermediary and a licensed Vietnamese travel
      // company is the provider of record, so "we refund you" in the same breath as "our agents"
      // left a reader unable to tell who is on the hook — a reviewer called that out and was right.
      // This is an eno guarantee sitting ON TOP of the provider's service, which is exactly the kind
      // of promise a platform can make without becoming the provider.
      body: 'If the Immigration Department refuses your application, eno refunds everything you paid — including the government fee, which the department does not return to anyone. This is a guarantee from eno as the platform, on top of the service the provider performs, so you do not have to take it up with them: message the desk in the same chat you applied in and it is handled there.',
    },
    // ⚠️ THE DISCLOSURE IS A SECTION, NOT A FOOTNOTE, AND IT COMES FROM src/lib/visa-provider.ts.
    // This is the page that sells the service, so the reader has to be able to see who is selling it
    // before they open a listing — not in small print under the fold, and never reworded here. The
    // constant is the single source; retyping it is how two versions of a legal statement start
    // disagreeing.
    { title: 'Who provides these services', body: PROVIDER_OF_RECORD.en },
  ],
  // The machine-readable half of the same statement: `provider` is the partner, `broker` is this
  // site. Visible copy that disclaims responsibility while the structured data claims the service
  // would be the worst of both — see src/app/vietnam-evisa/service-jsonld.ts.
  jsonLd: [visaServiceLd()],
  related: evisaRelated(),
  faqs: [
    {
      q: 'How long is a Vietnam e-visa valid?',
      a: 'Up to 90 days, for both single and multiple entry. Multiple entry lets you exit and re-enter within that window; single entry is one crossing.',
    },
    {
      q: 'How fast can I get one?',
      a: 'The fastest tier listed is one hour from submission, subject to that tier’s daily intake cutoffs and Vietnamese working days. Standard processing is the cheapest and takes several working days.',
    },
    {
      q: 'What does it cost?',
      a: 'It depends on entry type and speed — every combination is priced on its own listing above, so you can see the exact cost of going faster instead of being quoted after you have handed over your documents.',
    },
    {
      q: 'Do I pay when I apply?',
      a: 'No. Applying opens a chat with the visa desk and the government form is completed there. The desk confirms the price and payment before your application is submitted.',
    },
    {
      q: 'Can I get a refund if I am refused?',
      // ⚠️ THIS ANSWER USED TO SAY THE OPPOSITE — "the government fee is not refundable … ask the
      // desk what happens to the handling fee". That was accurate about the DEPARTMENT and is now
      // superseded by an eno policy that covers the difference (owner, 2026-08-17). Kept in the
      // same words as the section above; a refund promise that is worded twice will eventually be
      // worded differently.
      a: 'Yes — in full. If the Immigration Department does not accept your application we refund everything you paid, including the government fee, which the department itself does not return. Message the desk in the chat you applied in.',
    },
    {
      q: 'Will my visa be handled on time?',
      a: 'Almost always, yes — the handling time is our agents’ own work and they prepare and submit to the tier you paid for, including the express intake cutoffs. What nobody can promise is when the Immigration Department decides, or that it decides in your favour, which is why a refusal is refunded in full.',
    },
  ],
}

export const metadata: Metadata = {
  title: `Vietnam e-Visa — Prices, Processing Times & How to Apply | ${SITE_NAME}`,
  description:
    'Vietnam e-visa, 90 days, single or multiple entry, at seven processing speeds from standard to 1-hour express. Every option priced on its own listing — compare before you apply.',
  alternates: { canonical: '/vietnam-evisa' },
  openGraph: {
    title: `Vietnam e-Visa — Prices, Processing Times & How to Apply | ${SITE_NAME}`,
    description:
      `Single or multiple entry, standard to 1-hour express. Every combination priced up front on ${SITE_NAME}, provided by a licensed Vietnamese travel partner.`,
  },
}

/**
 * ⚠️ THE CROSS-SITE PROMO GOES *BELOW* EVERYTHING, AND ON THIS PAGE SPECIFICALLY.
 *
 * This is the surface where introducing eno.vn is honest rather than opportunistic: somebody
 * reading about a Vietnam e-visa is, by construction, about to be in Vietnam and about to need
 * somewhere to live and something to ride. `after` renders it at the end of <main>, so nothing a
 * visitor came here for is displaced by it.
 *
 * ⚠️ IT MAY NOT SPREAD, and the rule for where it may go is on the component itself — long-form
 * services-only pages whose reader is planning a move, never the header, feed, chat or a listing.
 * This file is `.svc.`, so a marketplace build never compiles it and the import cannot reach eno.vn
 * even before the alias in next.config.ts is considered.
 */
export default function Page() {
  return <SeoLanding content={CONTENT} after={<CrossSitePromo />} />
}
