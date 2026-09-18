import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

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
const SLUG = 'best-place-to-buy-iphone-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Buying guide',
  h1: 'Where to buy an iPhone in Vietnam',
  intro:
    'Vietnam has five distinct kinds of iPhone shop, and the cheapest price in a search result almost never comes from the same kind as the safest purchase. This guide explains what each kind is, what the price difference actually buys, and the one question that settles whether a shop is selling you what you think it is.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/mua-iphone-o-dau-uy-tin' },
  sections: [
    {
      id: 'five-kinds-of-shop',
      title: 'The five kinds of shop, and who each one suits',
      body: (
        <>
          <P>
            <strong>Apple Authorised Resellers</strong> — the big chains with an Apple-branded section
            — sell only chính hãng VN/A stock with the full Apple Vietnam warranty. Prices sit at or
            just under Apple&rsquo;s recommended figure, they issue a red VAT invoice without being
            asked, and a fault is handled by an authorised service centre rather than by the shop. If
            you want the purchase to be boring, this is the boring option.
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
            country and the warranty is the shop&rsquo;s own, typically 6 to 12 months, honoured at
            that shop and nowhere else. Fine if the shop is established and you live nearby; a
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
            this one. The lowest prices and no warranty at all. Everything depends on meeting in
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
            import? It is a completely ordinary question here, nobody is offended by it, and the
            answer changes who fixes the phone when it breaks. A VN/A unit carries the Apple Vietnam
            warranty and any authorised service centre will take it. An imported unit is warranted by
            the shop that sold it, which is a promise only as good as that shop.
          </P>
          <P>
            Then verify rather than trust: open <strong>Settings › General › About</strong> and read
            the Model Number. A VN/A unit ends in <code>VN/A</code>. <code>LL/A</code> is a US unit,
            <code> ZA/A</code> Singapore, <code>J/A</code> Japan. The number is set at manufacture and
            a shop cannot change it, which is why it beats any verbal assurance. Check the IMEI on
            Apple&rsquo;s own coverage page while you are standing there.
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
            The spread between the cheapest import and the authorised-reseller price on the same model
            is usually a few million đồng — meaningful, but smaller than people expect once the shop
            has discounted. What the extra buys is not the handset, which is identical, but three
            things around it: a warranty Apple honours anywhere in the country, a VAT invoice, and
            somebody else&rsquo;s problem if the unit is faulty out of the box.
          </P>
          <Ul>
            <li>Staying more than a year, or buying for work: the VN/A warranty is worth the gap.</li>
            <li>Visiting for a few months, comfortable with the risk and saving the difference: the import is a reasonable trade.</li>
            <li>Buying on instalments: you will almost certainly end up on VN/A anyway, because that is what the finance companies underwrite.</li>
            <li>Claiming the airport VAT refund on the way out: you need the red invoice, which import shops usually cannot issue.</li>
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
            carries the shop&rsquo;s tax code and the handset&rsquo;s IMEI, and it is what you need for
            a company expense claim or an airport VAT refund. A handwritten receipt is not that — it
            is proof of purchase for the shop&rsquo;s own warranty and nothing more.
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
            If you are leaving within 60 days, keep the red invoice and claim the VAT refund at the
            departure terminal before check-in. It returns most of the 10% on invoices over 2,000,000 ₫
            from a registered shop, which on a flagship is a real sum. And every Vietnamese network
            issues eSIM, so an eSIM-only imported handset works here without a physical SIM at all.
          </P>
          <P>
            You can see what Vietnamese retailers are asking today on <HereLink href="/iphone-18-vietnam">
            the live iPhone 18 price page</HereLink>, which reads the marketplace&rsquo;s own listings
            rather than a press release.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Where is the cheapest place to buy an iPhone in Vietnam?',
      a: 'Specialist import shops selling xách tay units are normally the cheapest new price, followed by large independent chains during a promotion. The cheapest of all is a private seller, with no warranty at all. The saving over an authorised reseller is usually a few million đồng on a current flagship.',
    },
    {
      q: 'Is it safe to buy an iPhone from a small shop in Vietnam?',
      a: 'Generally yes, and the vast majority of shops are straightforward. Reduce the remaining risk the same way locals do: check the model number in Settings › General › About, check the IMEI on Apple’s coverage page, get the warranty terms in writing, and prefer a shop with a physical address you could return to.',
    },
    {
      q: 'What does VN/A mean?',
      a: 'It is the suffix on the model number of a handset distributed by Apple Vietnam. It carries the 12-month Apple Vietnam warranty that any authorised service centre will honour. LL/A is a US unit, ZA/A Singapore and J/A Japan — all imported, all warranted by the shop that sold them rather than by Apple Vietnam.',
    },
    {
      q: 'Can a foreigner buy an iPhone in Vietnam on a passport?',
      a: 'Yes, for an outright purchase at any retailer. Instalment plans are different: they usually require a Vietnamese ID or residence card and proof of income, because a finance company rather than the shop is taking the risk.',
    },
    {
      q: 'Should I buy an iPhone in Vietnam or bring one from home?',
      a: 'Vietnamese retail includes 10% VAT and generally sits above US and Singapore pricing once converted, so an imported handset is genuinely cheaper. The trade is warranty: only a VN/A unit is covered by Apple Vietnam. People staying a while usually take the VN/A price; short-term visitors often do not.',
    },
    {
      q: 'Do I need a Vietnamese phone number to set up an iPhone here?',
      a: 'No. Setup works on Wi-Fi with any Apple ID. You will want a local number for banking and delivery apps, and all four networks issue eSIM, so you can add one without giving up a home SIM.',
    },
    {
      q: 'What is a hóa đơn đỏ and do I need one?',
      a: 'It is the official VAT invoice, carrying the shop’s tax code and the handset’s IMEI. You need it for a company expense claim or an airport VAT refund. For a personal purchase you can live without it, but a shop that refuses to issue one is telling you something about how it operates.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Where to buy an iPhone in Vietnam — the five kinds of shop | ${SITE_NAME}`,
  description:
    'The five kinds of iPhone shop in Vietnam, what the price gap between them actually buys, how to tell a VN/A unit from an import in ten seconds, and what a foreigner needs to buy one.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function BestPlaceToBuyIPhoneVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
