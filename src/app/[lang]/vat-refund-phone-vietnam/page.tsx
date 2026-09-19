import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * CLAIMING THE VAT REFUND ON A PHONE — the English half of the pair; the Vietnamese half is
 * /hoan-thue-vat-mua-dien-thoai and is written from scratch, not translated.
 *
 * ⛔ THE TWO HALVES ANSWER DIFFERENT QUESTIONS BECAUSE THE READERS ARE ON OPPOSITE SIDES OF THE
 * ELIGIBILITY LINE. The airport refund is for departing foreign passport holders, so this page is
 * the operational one: who qualifies, the invoice you can only obtain at the till, the order of
 * counters at the terminal, and the threshold that decides whether the queue pays. A Vietnamese
 * reader is, in the ordinary case, NOT eligible — so the Vietnamese page leads by saying so, then
 * covers the two things that reader actually needs: getting the invoice right when buying for a
 * departing relative, and the domestic red-invoice/input-VAT question they were probably really
 * asking. Translating either page would answer the wrong question in both languages.
 *
 * ⚠️ FIGURES ARE HEDGED WHERE THEY ARE HEDGY. The 85/15 split and the 2,000,000 ₫ floor are
 * regulatory and stated flat; the airport list, counter opening hours and customs practice vary and
 * are described as varying. No handset price appears here — /iphone-18-vietnam carries live figures
 * read from real listings, and a number typed into prose is stale the week after it ships.
 *
 * ⛔ NO SHOP IS NAMED OR RANKED, and no bank is named. The marketplace lists several of these
 * retailers and earns affiliate revenue from some; what the reader needs is which KIND of shop can
 * issue the document, which is also the version that survives a retailer joining or leaving the
 * scheme.
 */
const SLUG = 'vat-refund-phone-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Buying guide',
  h1: 'Claiming the VAT refund on a phone bought in Vietnam',
  intro:
    'Vietnam refunds most of the 10% VAT on goods a foreign passport holder carries out of the country, and a phone is one of the easiest things to claim on — high value, a serial number on the invoice, small enough for hand luggage. The scheme works. It is also narrower than people assume, and both of the usual reasons a claim fails happen long before the airport.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/hoan-thue-vat-mua-dien-thoai' },
  sections: [
    {
      id: 'who-qualifies',
      title: 'Who qualifies, and what the refund is actually worth',
      body: (
        <>
          <P>
            You qualify if you hold a passport issued by another country and you both entered and
            will leave Vietnam on it. Living here does not disqualify you &mdash; foreigners on a
            work permit and a residence card claim on exactly the same terms as someone here for a
            fortnight, because the passport is what the scheme looks at. Overseas Vietnamese
            travelling on a foreign passport qualify too. Vietnamese citizens travelling on a
            Vietnamese passport do not qualify at all, and nor do crew working the flight they leave
            on.
          </P>
          <P>
            You also have to depart through a port that runs the scheme. In practice that means the
            large international airports &mdash; Tân Sơn Nhất, Nội Bài and Đà Nẵng are the ones most
            people use, with a handful of other airports and seaports on the list. The list is set
            centrally and has been extended over the years, so confirm your own departure point
            rather than assuming. Crossing overland into Cambodia or Laos, there is nothing to claim.
          </P>
          <P>
            Now the part that surprises people: <strong>&ldquo;10% back&rdquo; is not what lands in
            your hand</strong>, and two separate deductions explain the gap. First, the 10% is
            charged on the pre-tax price, so as a share of the gross price you actually paid the tax
            component is about one eleventh &mdash; roughly 9%, not 10%. Second, you receive 85% of
            that tax; the remaining 15% is the service fee of the commercial bank operating the
            refund counter. Net, budget for something in the region of 7.5% of the figure on the till
            receipt. On a current flagship that is still a real sum, which is what the
            worth-it section below is about.
          </P>
        </>
      ),
    },
    {
      id: 'the-invoice',
      title: 'The invoice you can only get at the till',
      body: (
        <>
          <P>
            The whole claim rests on one document, and it is issued at the moment you pay or not at
            all. It is not the ordinary receipt and it is not quite the ordinary red invoice either:
            it is a <strong>combined VAT invoice and refund declaration</strong> &mdash; hóa đơn kiêm
            tờ khai hoàn thuế &mdash; carrying your name and passport number exactly as printed in
            the passport, alongside the handset&rsquo;s model and IMEI or serial number. A shop that
            is not registered in the refund programme cannot produce one, however willing the staff
            are.
          </P>
          <P>
            So take the physical passport to the shop. Not a photo of it, not a residence card, not a
            photocopy: the assistant is transcribing an identity document and most will decline
            anything else. The name on the invoice must be the person who will walk the phone through
            customs, so if a friend or a colleague is paying, the invoice is still yours.
          </P>
          <P>
            Which shops are registered? Broadly, the authorised resellers and the large retail chains
            in the central districts of the big cities, plus the outlets inside the terminals.
            Specialist import shops selling xách tay stock usually are not, and a private seller
            never is. Ask before you choose the handset rather than after &mdash; the question is
            whether the shop issues the VAT refund invoice for foreigners, and it is an entirely
            ordinary thing to ask. Our guide to{' '}
            <HereLink href="/best-place-to-buy-iphone-vietnam">the five kinds of phone shop</HereLink>{' '}
            explains which is which, and{' '}
            <HereLink href="/chinh-hang-vs-xach-tay-vietnam">the chính hãng versus xách tay split</HereLink>{' '}
            covers why the cheapest shop is usually the one that cannot help you here.
          </P>
          <P>Before you leave the counter, check the document against this list:</P>
          <Ul>
            <li>Your name spelled exactly as in the passport, including the order of the names.</li>
            <li>Your passport number, transcribed correctly &mdash; a single wrong character voids it.</li>
            <li>The purchase date. It must fall within 60 days of the day you depart.</li>
            <li>The model and the IMEI or serial, matching the handset and the box.</li>
            <li>The shop&rsquo;s name and tax code.</li>
            <li>That you are holding the original. A photocopy or a photograph is not accepted at the airport.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'airport-process',
      title: 'At the airport: the order of the counters matters',
      body: (
        <>
          <P>
            The single most common operational mistake is doing this in the wrong order. The customs
            inspection happens <strong>before check-in, in the public part of the departure hall</strong>,
            because customs has to be able to see the goods &mdash; and once the bag is on the belt,
            nobody can. Then you check in, clear security and immigration, and collect the money
            airside.
          </P>
          <Ul>
            <li>
              Arrive early. Half an hour to forty-five minutes on top of your normal buffer is a
              sensible allowance, and more again in the evening departure peak.
            </li>
            <li>
              Find the VAT refund desk in the check-in hall, before the airline counters. Present the
              original invoice, your passport, your boarding document or booking, and the phone
              itself. Keep it in the box if you still have the box.
            </li>
            <li>
              Customs verifies and stamps the declaration. They may ask to see the handset; this is
              routine, not suspicion, and it is why the phone must be in your cabin bag rather than
              your checked luggage.
            </li>
            <li>Check in as normal, then clear security and immigration.</li>
            <li>
              Find the bank&rsquo;s refund counter in the restricted area, past immigration. Hand over
              the stamped declaration and collect the cash.
            </li>
          </Ul>
          <P>
            Two practical notes. The refund is paid in đồng; the counter can often convert it, usually
            at a rate you would not accept anywhere else, so taking đồng and spending it airside is
            frequently the better call. And these counters do not all keep 24-hour hours &mdash; on a
            very early or very late departure, it is worth confirming rather than discovering it at
            05:00 with a stamped form and nowhere to present it.
          </P>
        </>
      ),
    },
    {
      id: 'is-it-worth-it',
      title: 'The threshold, and whether the queue is worth it',
      body: (
        <>
          <P>
            The legal floor is <strong>2,000,000 ₫ of goods from one shop on one day</strong>. Two
            details in that sentence do most of the work. Purchases at the same shop on the same day
            can be added together to reach it, so a handset plus a case and a charger on one invoice
            all count. Invoices from <em>different</em> shops cannot be combined, however much you
            spent in total &mdash; three shops at 1,500,000 ₫ each is three failed claims, not one
            good one.
          </P>
          <P>
            At the floor itself the economics are marginal: a claim on exactly 2,000,000 ₫ returns
            somewhere around 150,000 ₫, against forty-five minutes and two queues. The argument for
            doing it is that the refund scales with the purchase and the queue does not. On a
            mid-range handset it is a decent meal; on a current flagship it is a meaningful fraction
            of an accessory budget, and it costs the same three-quarters of an hour either way. You
            can see what Vietnamese retailers are asking today on{' '}
            <HereLink href="/iphone-18-vietnam">the live iPhone 18 price page</HereLink> and work the
            arithmetic against your own departure.
          </P>
          <P>
            If you are buying accessories anyway, buy them at the same shop on the same day and put
            them on the same invoice &mdash; it is the one free way to make a marginal claim
            worthwhile. Our{' '}
            <HereLink href="/phone-accessories-vietnam">accessories guide</HereLink> covers what is
            worth buying here rather than at home.
          </P>
        </>
      ),
    },
    {
      id: 'what-disqualifies',
      title: 'What disqualifies a claim',
      body: (
        <>
          <P>
            Almost every rejected claim is one of these, and almost all of them are decided before
            the traveller reaches the terminal:
          </P>
          <Ul>
            <li>
              <strong>The phone is in the checked bag.</strong> Far and away the most common failure.
              Customs cannot inspect what has gone through bag drop, and there is no recovering it.
            </li>
            <li>
              <strong>The shop was never registered in the scheme.</strong> An ordinary red invoice,
              however correct, is not the combined refund declaration, and it cannot be upgraded into
              one afterwards.
            </li>
            <li>
              <strong>The invoice is in the wrong name</strong>, or the passport number is mistyped,
              or the name does not match the passport character for character.
            </li>
            <li>
              <strong>The purchase is older than 60 days</strong> counted back from your departure
              date.
            </li>
            <li>
              <strong>You are under the floor at that shop</strong>, or you are trying to reach it by
              adding up invoices from several shops.
            </li>
            <li>
              <strong>You are leaving overland</strong>, or through a port that does not operate the
              scheme.
            </li>
            <li>
              <strong>You only have a copy of the invoice.</strong> Originals only &mdash; keep it
              flat, dry and out of the bag that gets checked.
            </li>
            <li>
              <strong>You bought second-hand from a private seller.</strong> There is no VAT invoice
              in that transaction to refund against; see{' '}
              <HereLink href="/buying-a-used-iphone-vietnam">the used-iPhone guide</HereLink> for what
              you do get instead.
            </li>
          </Ul>
          <P>
            None of this is exotic. It reduces to three habits: buy at a registered shop, hand over
            the passport at the till, and keep the phone and the paperwork in your cabin bag. Do
            those and the claim is a queue, not a gamble.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Can I get a VAT refund on a phone bought in Vietnam?',
      a: 'Yes, if you hold a foreign passport, entered and leave Vietnam on it, bought the phone within 60 days of departure at a shop registered in the refund programme, spent at least 2,000,000 ₫ at that shop on that day, and carry the handset in your hand luggage when you depart through an airport that operates the scheme.',
    },
    {
      q: 'How much do you actually get back from the VAT refund in Vietnam?',
      a: 'Less than 10%. VAT is charged on the pre-tax price, so the tax component of what you paid is about one eleventh of it, and you receive 85% of that — the other 15% is the service fee of the bank running the counter. Expect roughly 7.5% of the price on the receipt.',
    },
    {
      q: 'What is the minimum spend for a VAT refund in Vietnam?',
      a: '2,000,000 ₫ of goods from a single registered shop on a single day. Invoices from the same shop on the same day can be added together; invoices from different shops cannot be combined to reach the threshold.',
    },
    {
      q: 'Do I do the VAT refund before or after check-in?',
      a: 'Before. The customs inspection desk is in the public check-in hall and staff need to see the goods, which is impossible once your bag is on the belt. You get the declaration stamped first, then check in, then collect the cash at the bank counter after immigration.',
    },
    {
      q: 'Can I claim the VAT refund if I live in Vietnam?',
      a: 'Yes. A work permit or a residence card does not disqualify you — the scheme looks at your passport, not your residency. If you entered and leave on a foreign passport you claim on the same terms as a short-stay visitor.',
    },
    {
      q: 'Can I put the phone in my checked luggage and still claim?',
      a: 'No, and this is the most common reason claims fail. Customs must be able to inspect the goods at the desk before check-in. Keep the handset, the box and the original invoice in your cabin bag.',
    },
    {
      q: 'Which shops in Vietnam issue VAT refund invoices for foreigners?',
      a: 'Shops registered in the programme — in practice the authorised resellers and the large retail chains in central districts of the big cities, plus airport outlets. They display a VAT refund sign. Import specialists selling xách tay stock usually are not registered, and a private seller never is. Ask before you choose the handset.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `VAT refund on a phone in Vietnam — who qualifies and how to claim | ${SITE_NAME}`,
  description:
    'How the Vietnamese airport VAT refund works on a phone: who qualifies, the combined invoice you can only get at the till, the customs desk before check-in, the 2,000,000 ₫ threshold, and what disqualifies a claim.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function VatRefundPhoneVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
