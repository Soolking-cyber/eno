import type { Metadata } from 'next'
import { SeoLanding, type SeoContent } from '@/components/marketplace/seo-landing'
import { VISA_CATEGORY_SLUG, VISA_SUBCATEGORY_SLUG } from '@/lib/taxonomy'
import { EVISA_HUB_PATH, evisaRelated } from '../links'

// ⚠️ 24h, NOT the 7d the other landing pages use. Those sell a category; this cluster's whole
// argument is "compare the prices on the cards below", and those cards render live
// `Listing.price` values into ISR HTML. A weekly window means an admin can change a visa price
// and this page keeps quoting the old one for six more days — on the one surface where being
// wrong about money costs the most trust. The prose is static and cheap to re-render; the prices
// are the reason for the shorter window.
export const revalidate = 86400

// ⚠️ CLAIMS ABOUT OUR OWN CHECKS ARE LIMITED TO WHAT src/lib/visa/{mrz,image-quality}.ts ACTUALLY
// DO — MRZ check-digit validation and a set of named blocking checks on the passport page and
// portrait. "We catch the mistakes that cause refusals" would be a bigger claim than the code
// supports: a refusal can rest on grounds no upload check can see. The copy below is deliberately
// scoped to the document problems, because that is the part we can stand behind.
const CONTENT: SeoContent = {
  eyebrow: 'e-Visa · Refusals',
  h1: 'Vietnam e-visa rejected — what to do next',
  intro:
    'A refusal notice from the Immigration Department rarely explains itself. It does not have to: the department is not obliged to give reasons, and no agent can appeal on your behalf. What you can do is work out which of the fixable causes applies, correct it, and apply again — which is allowed, and is what most refused applicants end up doing.',
  categorySlug: VISA_CATEGORY_SLUG,
  subcategorySlug: VISA_SUBCATEGORY_SLUG,
  cta: 'Start a new application',
  sections: [
    {
      title: 'The fixable causes, in rough order of frequency',
      body: 'A name that does not match the passport exactly, including the order of given names and surname. A passport number mistyped by one character. A passport with under six months of validity left at your entry date. A photo of the passport page that is cropped, glared out or too blurry to read. A portrait that is not a plain-background, head-and-shoulders, hat-and-glasses-free photo. An entry date or port of entry that does not match your ticket. Every one of these is a document problem, and every one of them is correctable before a second attempt.',
    },
    {
      title: 'The ones you cannot fix by reapplying',
      body: 'Immigration history — a prior overstay, a previous refusal, a removal — is a decision about you rather than about the paperwork, and a cleaner form will not change it. Neither will paying for a faster tier. If you are in this category, an agent promising to "handle it" is selling you the same application at a higher price.',
    },
    {
      title: 'What a second application costs',
      body: 'The government fee for a refused application is not returned; a fresh application means a fresh fee. That makes the second attempt the expensive one to get wrong, and it is the reason to have the passport page and the entered details checked before submitting rather than after.',
    },
    {
      title: 'How eno.vn tries to catch this before submission',
      body: 'The application is completed in chat, step by step, and your uploads are checked as you go: the passport page has to be the right page, in one piece, sharp enough to read, and its machine-readable strip is verified against the passport number, date of birth and expiry date you entered — a mismatch shows up as a mismatch rather than as a refusal three days later. The portrait is checked against the same rules the department applies. It cannot catch grounds nobody can see from a document, but it removes the causes that are visible in one.',
    },
  ],
  related: [
    { href: EVISA_HUB_PATH, label: 'All Vietnam e-visa options', blurb: 'Every entry type and speed, priced, in one place.' },
    ...evisaRelated('rejected'),
  ],
  faqs: [
    {
      q: 'Can I reapply after a Vietnam e-visa refusal?',
      a: 'Yes. There is no waiting period for a fresh application, but fix whatever caused the refusal first — an identical resubmission usually gets an identical answer.',
    },
    {
      q: 'Do I get the fee back if I am refused?',
      a: 'The government fee is not refundable. Ask the provider what happens to their handling fee before you submit — that part is their policy, not the department’s.',
    },
    {
      q: 'Will the department tell me why I was refused?',
      a: 'Usually not. Refusal notices are typically issued without reasons, and there is no appeal process for an e-visa.',
    },
    {
      q: 'Would paying for faster processing have helped?',
      a: 'No. Speed tiers change how quickly your paperwork is handled, not the decision made on it. A faster tier applied to a flawed application returns a faster refusal.',
    },
  ],
}

export const metadata: Metadata = {
  title: 'Vietnam e-Visa Rejected — What to Do Next | eno.vn',
  description:
    'Vietnam e-visa refused? The fixable causes (name mismatches, passport validity, photo quality), the ones reapplying will not solve, and what a second application costs.',
  alternates: { canonical: '/vietnam-evisa/rejected' },
  openGraph: {
    title: 'Vietnam e-Visa Rejected — What to Do Next | eno.vn',
    description: 'Which refusal causes you can correct, which you cannot, and what reapplying costs.',
  },
}

export default function Page() {
  return <SeoLanding content={CONTENT} />
}
