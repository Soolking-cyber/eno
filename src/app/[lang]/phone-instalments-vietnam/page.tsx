import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * PHONE INSTALMENTS — the English half; Vietnamese half at /mua-dien-thoai-tra-gop.
 *
 * ⛔ NO LENDER, CARD OR FINANCE COMPANY IS NAMED, AND NO RATE IS QUOTED AS A FACT. Terms here move
 * constantly and vary by handset, promotion and applicant; a specific APR in an evergreen article is
 * a claim that goes stale silently and that a reader may act on. The durable, checkable advice is
 * the one question that makes any two offers comparable — total amount payable — and that is what
 * this page teaches instead.
 */
const SLUG = 'phone-instalments-vietnam'

const CONTENT: ArticleContent = {
  eyebrow: 'Buying guide',
  h1: 'Phone instalments in Vietnam, and the 0% that is not 0%',
  intro:
    'Almost every phone shop in Vietnam advertises trả góp 0% — 0% instalments. Some of it genuinely is; much of it carries fees that put the real cost somewhere quite different. This guide explains the two mechanisms behind the sign, what paperwork each needs, the fees that do the damage, and the single question that makes two offers comparable.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'en',
  alternate: { lang: 'vi', href: '/mua-dien-thoai-tra-gop' },
  sections: [
    {
      id: 'two-mechanisms',
      title: 'Two completely different things wear the same sign',
      body: (
        <>
          <P>
            <strong>Credit-card instalments</strong> convert a purchase you already made on your own
            card into monthly payments, arranged by your bank. The interest genuinely can be 0%,
            because the shop is paying the bank a subsidy to move the handset. What is often not 0% is
            the <em>conversion fee</em> — a percentage of the purchase, charged once, up front. A
            plan at &ldquo;0% over 12 months&rdquo; with a conversion fee is simply a loan with the
            interest collected at the start.
          </P>
          <P>
            <strong>Consumer-finance instalments</strong> are a loan from a finance company, arranged
            at the counter by an agent, for people without a credit card. Approval is fast and the
            documentation is light, which is the product&rsquo;s whole appeal. The headline rate is
            frequently 0% while the cost sits in a file fee, a compulsory loan-insurance premium, and
            a deposit — commonly 10&ndash;40% of the handset paid on the day.
          </P>
        </>
      ),
    },
    {
      id: 'the-one-question',
      title: 'The one question that makes offers comparable',
      body: (
        <>
          <P>
            Do not ask the interest rate. Ask: <strong>&ldquo;What is the total I will have paid by
            the end?&rdquo;</strong> — deposit, every monthly payment, and every fee, as one number.
            Then compare that against the cash price of the same handset. The difference is what the
            credit costs you, and it is the only figure that survives the different ways these plans
            are described.
          </P>
          <P>
            Ask for it in writing before signing. A 0% plan whose total equals the cash price is
            exactly what it says. A 0% plan whose total is 8% above the cash price is an 8% loan with
            a different label, and both exist in the same shop on the same afternoon.
          </P>
        </>
      ),
    },
    {
      id: 'paperwork',
      title: 'What the paperwork requires',
      body: (
        <>
          <Ul>
            <li>
              <strong>Credit-card route:</strong> a Vietnamese-issued credit card with enough available
              limit, and that is broadly it. A foreign-issued card generally cannot be converted by a
              local shop.
            </li>
            <li>
              <strong>Finance-company route:</strong> a Vietnamese ID card (CCCD), usually a second
              document, and some evidence of income or address. A driving licence or household
              registration is commonly accepted as the second item.
            </li>
            <li>
              <strong>Foreigners:</strong> this is the practical barrier. Most consumer-finance
              products require a CCCD, so a passport alone will not open one. With a residence card, a
              local bank account and a Vietnamese-issued credit card, the card route is usually
              available; without them, buying outright is normally the only option.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'fees',
      title: 'The fees that do the damage',
      body: (
        <>
          <P>
            <strong>Conversion fee</strong> on the card route, taken once, as a percentage of the
            purchase. <strong>File or arrangement fee</strong> on the finance route. <strong>Loan
            insurance</strong>, often presented as compulsory and occasionally not — ask. <strong>
            Early-settlement fee</strong>, which is the one people meet by surprise: paying a loan off
            early can cost a percentage of the outstanding balance, so clearing it in month three may
            save less than expected.
          </P>
          <P>
            Late payment is where a cheap plan becomes expensive. Penalties are steep, and consumer
            finance in Vietnam reports to the national credit information centre, so a missed month
            follows you into any future borrowing here.
          </P>
        </>
      ),
    },
    {
      id: 'is-it-worth-it',
      title: 'When instalments make sense',
      body: (
        <>
          <P>
            A genuine 0% plan with no fees is free credit, and taking it while your money sits in a
            savings account is straightforwardly sensible. The case weakens fast as fees appear: at
            6&ndash;8% all-in on a flagship, you are paying for the convenience of not waiting, which
            is a legitimate choice but a different one.
          </P>
          <P>
            The alternative worth pricing first is a cheaper handset outright. A previous-generation
            flagship or a strong mid-range phone bought with cash often costs less than the finance
            charges on the newest model, and leaves you owning it outright on day one. Current prices
            for the newest line are on{' '}
            <HereLink href="/iphone-18-vietnam">the iPhone 18 price page</HereLink>.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Is trả góp 0% in Vietnam really 0%?',
      a: 'Sometimes genuinely, and often not. The interest can truly be zero while the cost sits in a conversion fee, a file fee or compulsory loan insurance. Ask for the total amount payable by the end of the plan and compare it against the cash price — if they match, it is really 0%.',
    },
    {
      q: 'Can a foreigner buy a phone on instalments in Vietnam?',
      a: 'Usually only with a Vietnamese-issued credit card, by converting the purchase through your own bank. Consumer-finance plans generally require a Vietnamese ID card (CCCD), so a passport alone is not enough. Buying outright needs nothing but a passport.',
    },
    {
      q: 'What documents do I need for phone instalments?',
      a: 'For the credit-card route, a Vietnamese credit card with available limit. For a finance company, a CCCD plus usually a second document such as a driving licence, and some evidence of income or address. Approval at the counter typically takes under an hour.',
    },
    {
      q: 'What deposit is normal?',
      a: 'Finance-company plans commonly ask for 10–40% of the handset price on the day, and a larger deposit usually buys a lower monthly payment or a shorter term. Credit-card conversion normally requires no deposit because you have already paid in full.',
    },
    {
      q: 'Can I pay an instalment plan off early?',
      a: 'Usually yes, but check the early-settlement fee first — it is often a percentage of the outstanding balance, which can cancel most of the interest you hoped to save. Ask for the figure before signing rather than at the point of settling.',
    },
    {
      q: 'What happens if I miss a payment?',
      a: 'Penalty charges are steep, and consumer-finance lenders report to Vietnam’s national credit information centre, so a missed month can affect later borrowing here. If you expect to be short, contacting the lender before the due date is far better than missing it.',
    },
  ],
  related: phoneGuidesIn('en', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Phone instalments in Vietnam — the 0% that is not 0% | ${SITE_NAME}`,
  description:
    'How trả góp works in Vietnam: credit-card conversion versus consumer finance, what paperwork each needs, the conversion and insurance fees that turn a 0% plan into an 8% one, and the one question that makes offers comparable.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function PhoneInstalmentsVietnamPage() {
  return <SeoArticle content={CONTENT} />
}
