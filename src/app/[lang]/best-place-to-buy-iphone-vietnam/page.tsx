import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import { SITE_NAME } from '@/lib/edition'
import { guideDates } from '@/lib/expat-guides'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, OfficialLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * WHERE TO BUY AN iPHONE IN VIETNAM — the English half of the pair; the Vietnamese half is
 * /mua-iphone-o-dau-uy-tin and is written from scratch, not translated.
 *
 * ⚠️ THE ADVICE IS SPECIFIC AND CHECKABLE, because a guide that says "buy from a reputable shop"
 * ranks for nothing and helps nobody. Where a figure is a range rather than a fact, it says so.
 *
 * ⛔ NO SHOP IS RANKED OR RECOMMENDED BY NAME AS "BEST". The marketplace lists several of these
 * retailers and takes affiliate revenue from some of them, so a ranking here would be an ad wearing
 * an editorial byline. Naming what each KIND of shop is good and bad at is the honest version, and
 * it is also the version that survives a retailer changing its prices next month.
 */
export const revalidate = 3600

const SLUG = 'best-place-to-buy-iphone-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Buying guide',
  h1: 'Where to buy an iPhone in Vietnam',
  intro:
    'When buying a used iPhone, compare prices for the same model and storage and check the warranty. For a new phone, use Apple’s locator to find an authorised shop near you.',
  canonical: `/${SLUG}`,
  ...guideDates(SLUG),
  lang: 'en',
  alternate: { lang: 'vi', href: '/mua-iphone-o-dau-uy-tin' },
  railAfter: 'where-to-shop',
  sections: [
    {
      id: 'where-to-shop',
      title: 'Where to shop online or in person',
      body: (
        <Ul>
          <li><strong>Used iPhones.</strong> Use the <HereLink href="/buying-a-used-iphone-vietnam">used iPhone inspection guide</HereLink> to check the battery, repairs and Activation Lock before ordering.</li>
          <li><strong>New, in person.</strong> Enter your city in <OfficialLink href="https://locate.apple.com/vn/en/sales">Apple’s authorised reseller locator</OfficialLink>. Call the branch to confirm the colour, storage and pickup price before travelling.</li>
          <li><strong>Compare prices.</strong> Check <HereLink href="/iphone-18-vietnam">used iPhone 17 and 18 asking prices by storage</HereLink>. Open a listing to check the seller and condition, then ask about battery health, repairs and returns.</li>
        </Ul>
      ),
    },
    {
      id: 'five-kinds-of-shop',
      title: 'The five kinds of shop, and who each one suits',
      body: (
        <>
          <P>
            <strong>Apple Authorised Resellers</strong> are listed by Apple. Ask the branch for its
            outright price, a sales invoice and its exchange terms for a faulty handset.
          </P>
          <P>
            <strong>Large independent chains</strong> carry both VN/A and imported stock side by side,
            often on the same shelf with a small sign distinguishing them. They discount harder than
            the authorised resellers, run the instalment plans, and their staff will usually tell you
            straight which unit is which if you ask. This is where most Vietnamese buyers actually
            buy, and where the price you see online is most likely to be the price you pay.
          </P>
          <P>
            <strong>Specialist import shops</strong> deal mainly in xách tay — handsets brought in
            from the US, Singapore, Japan or Hong Kong. They are usually the cheapest new price in the
            country and the shop may offer its own warranty. Ask where it accepts repairs and for how long. Fine if the shop is established and you live nearby; a
            problem if you are leaving the city in a month.
          </P>
          <P>
            <strong>Second-hand and trade-in dealers</strong> sell refurbished and used handsets
            graded by condition, commonly advertised as &ldquo;99%&rdquo; or &ldquo;likenew&rdquo;.
            The good ones test and warrant for 1&ndash;6 months and will let you inspect before
            paying. This is the segment where the inspection matters most, and it has its own guide
            below.
          </P>
          <P>
            <strong>Private sellers</strong> — someone selling their own phone, on a marketplace like
            this one. Ask for the original receipt so you can check any remaining coverage. Everything depends on meeting in
            person and checking the handset properly before money moves.
          </P>
        </>
      ),
    },
    {
      id: 'the-one-question',
      title: 'The one question to ask before you pay',
      body: (
        <>
          <P>
            Ask: <em>&ldquo;Máy này là VN/A hay xách tay?&rdquo;</em> — is this a Vietnam unit or an
            import? Ask for the original sales invoice and who handles repairs where you will use the phone.
            Apple may restrict iPhone warranty service to its original country of sale. See the{' '}
            <OfficialLink href="https://www.apple.com/legal/warranty/products/ios-warranty-rest-of-apac-english.html">Apple iPhone warranty terms</OfficialLink>.
          </P>
          <P>
            Open <strong>Settings › General › About</strong> and enter the serial number on{' '}
            <OfficialLink href="https://checkcoverage.apple.com/">Apple’s coverage checker</OfficialLink>.
            For a used phone, check Carrier Lock and ask the seller to erase it so you can verify that Activation Lock is off.
          </P>
        </>
      ),
    },
    {
      id: 'what-the-gap-buys',
      title: 'What the price gap actually buys',
      body: (
        <>
          <P>
            Compare the outright price for the same storage, condition and model. Ask who handles a fault,
            where you would return the phone and what paperwork the seller supplies.
          </P>
          <Ul>
            <li>Buying for work? Ask for an invoice in the name your employer needs.</li>
            <li>Taking the phone home? Confirm which service centres can handle a claim there.</li>
            <li>Paying in instalments? Compare the total repayment with the cash price.</li>
            <li>Planning to claim a tourist VAT refund? Ask the shop if it participates before paying.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'paying-safely',
      title: 'Paying, and what a real invoice looks like',
      body: (
        <>
          <P>
            Card and bank transfer are both normal; cash is still very common and is not a red flag by
            itself. What matters is the paperwork. A <strong>hóa đơn đỏ</strong> (red VAT invoice)
            identifies the business that sold the phone. Keep the sales invoice and ask the shop to
            identify the handset on the receipt so you can document a warranty claim.
          </P>
          <P>
            Do not pay a deposit to hold stock at a shop you have not visited, and be wary of a price
            far under every other listing for the same model and storage: in this market that gap is
            usually a refurbished unit, a different storage tier, or a bundle whose &ldquo;free&rdquo;
            accessories are priced into the phone.
          </P>
        </>
      ),
    },
    {
      id: 'foreigners',
      title: 'Buying as a foreigner',
      body: (
        <>
          <P>
            A passport is enough to buy any phone outright, anywhere in Vietnam. No residence card, no
            local ID, no Vietnamese bank account. Instalment plans are the exception — those generally
            need a Vietnamese ID or a residence card plus proof of income, because a finance company
            is underwriting you rather than the shop.
          </P>
          <P>
            If a tourist VAT refund affects your decision, ask whether the shop participates before you pay.
            Check the paperwork in the <HereLink href="/vat-refund-phone-vietnam">Vietnam phone VAT refund guide</HereLink>.
          </P>
          <P>
            Apple Vietnam&rsquo;s prices, and what second-hand iPhones are listed for here, are on{' '}
            <HereLink href="/iphone-18-vietnam">the iPhone 18 price page</HereLink>.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Where is the cheapest place to buy an iPhone in Vietnam?',
      a: 'Start with Apple Vietnam’s price for the storage you want. Compare each shop’s outright price with used listings in the same condition. Ask whether a discount requires a trade-in and what it would cost to replace a worn battery.',
    },
    {
      q: 'Is it safe to buy an iPhone from a small shop in Vietnam?',
      a: 'Generally yes, and the vast majority of shops are straightforward. Reduce the remaining risk the same way locals do: read the serial number in Settings › General › About, look it up on Apple’s coverage page, get the warranty terms in writing, and prefer a shop with a physical address you could return to.',
    },
    {
      q: 'What does VN/A mean?',
      a: 'VN/A is a regional part-number suffix seen on iPhones sold for Vietnam. Ask for the sales invoice and check coverage using the serial number. Apple may restrict iPhone service to the original country of sale.',
    },
    {
      q: 'Can a foreigner buy an iPhone in Vietnam on a passport?',
      a: 'Yes, for an outright purchase at any retailer. Instalment plans are different: they usually require a Vietnamese ID or residence card and proof of income, because a finance company rather than the shop is taking the risk.',
    },
    {
      q: 'Should I buy an iPhone in Vietnam or bring one from home?',
      a: 'Compare the outright prices for the same storage, any currency conversion costs, and where you could get service after returning home. A trade-in or instalment price can make the advertised saving look larger than it is.',
    },
    {
      q: 'Do I need a Vietnamese phone number to set up an iPhone here?',
      a: 'No. Setup works on Wi-Fi with any Apple ID. You will want a local number for banking and delivery apps, and all four networks issue eSIM, so you can add one without giving up a home SIM.',
    },
    {
      q: 'What is a hóa đơn đỏ and do I need one?',
      a: 'It is the seller’s VAT invoice. Ask for it if you need to document a business purchase. For a tourist refund, check the shop’s participation and the required paperwork before paying.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = withShare({
  title: `Where to buy an iPhone in Vietnam: new and used | ${SITE_NAME}`,
  description:
    'Compare used iPhone asking prices, see how to order from a partner shop, find an authorised reseller and check warranty coverage before paying.',
  alternates: phoneGuideAlternates(SLUG),
}, { type: 'article' })

export default function BestPlaceToBuyIPhoneVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
