import { SITE_NAME } from '@/lib/edition'
import { SITE_ORIGIN } from '@/app/md/markdown-response'

/**
 * The body of /pricing.md (served by src/app/md/pricing/route.ts — a route module may export only its handlers, so the
 * builder and the fee table live here). Every sentence restates a clause of Operating Regulations Art. 8 or the Terms' fees
 * section; src/app/md/pricing/route.test.ts checks the table and the clauses against the Regulations source.
 */

/**
 * ⛔ THE PARTNER FEE ROWS RESTATE THE TABLE IN Operating Regulations Art. 8 (src/app/[lang]/regulations/page.tsx, `id: 'fees'`),
 * which a page module cannot export; route.test.ts reads that file and fails the moment a rate or a basis here differs.
 */
export const PARTNER_FEES: ReadonlyArray<{ listing: string; rate: string; on: string; when: string }> = [
  { listing: 'Second-hand goods, rentals of anything other than real property', rate: '10%', on: 'Sale price, or the whole rental contract', when: 'When the deal closes' },
  { listing: 'Apartment, house or office, lease of 1 year or longer', rate: '20%', on: 'One month’s rent', when: 'Once, when the tenant signs the lease' },
  { listing: 'Apartment, house or office, lease of 6 months to under 1 year', rate: '15%', on: 'One month’s rent', when: 'Once, when the tenant signs the lease' },
]

export function pricingMarkdown(): string {
  return `# ${SITE_NAME} pricing

> Creating an account, browsing, posting and contacting sellers are currently free. What the operator does charge, under Article 8 of the Operating Regulations, is listed below: partner service fees, and commissions. Amounts are in Vietnamese đồng (VND).

## Free

| What | Price |
| --- | --- |
| Browsing and searching listings | 0 VND |
| Creating an account | 0 VND |
| Posting your own listings | 0 VND (no listing fee; anyone who posts their own listings pays no partner service fee, including for apartments, houses and offices) |
| Contacting a seller | 0 VND (in-app chat for a listing posted on ${SITE_NAME}; a linked listing is answered on its source site) |

## Partner service fees

Paid by a service partner that has signed an agreement under Article 3, to the operator, when it closes a deal with a customer the operator sent. Rates include value-added tax. A deal that does not close incurs no fee. Buyers and tenants never pay these.

| Listing | Rate | Charged on | When paid |
| --- | --- | --- | --- |
${PARTNER_FEES.map((f) => `| ${f.listing} | ${f.rate} | ${f.on} | ${f.when} |`).join('\n')}

## What a buyer pays, and to whom

- The operator collects no money from buyers for transactions on the platform, makes no payment on anyone’s behalf and holds no one’s money.
- Where a service on the platform is provided by a licensed third party, what the operator receives is a commission under its contract with that provider. The buyer pays the provider directly, by the method the provider publishes, not the platform.
- The operator may earn a commission from some partners and linked shops when a buyer purchases through a link on the platform. The buyer does not pay that commission, and it does not change the price the buyer pays; links that can earn it are labelled “Ad”.

## If this changes

The fees are set by Article 8 of the [Operating Regulations](${SITE_ORIGIN}/regulations#fees) and the fees section of the [Terms](${SITE_ORIGIN}/terms). If paid services for sellers are introduced later, or the rates above change, the price list is published there in Vietnamese dong at least 20 days before they apply.
`
}
