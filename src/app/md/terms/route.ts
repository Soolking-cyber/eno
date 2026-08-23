import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { COMPANY, OPERATOR_REGISTERED, TOS_VERSION } from '@/lib/site-legal'
import { markdownResponse, SITE_ORIGIN } from '../markdown-response'

/**
 * The markdown representation of `/terms`, reached by the Accept-header rewrite in next.config.ts.
 *
 * ⛔ SUMMARY-AND-LINK, FOR THE SAME REASON AS THE /privacy SIBLING — read that file's header. The
 * specific hazard here: `src/app/terms/page.tsx` inserts two whole sections on the services build
 * (`provider`, `documents`, from the aliased TERMS_SERVICES_COPY module), so any section list typed
 * into this file would be *silently incomplete* on eno.forum and would need services vocabulary to
 * be complete — vocabulary that must not exist in eno.vn's artifact at all. Enumerating nothing is
 * the only shape that is correct on both editions.
 *
 * ⚠️ THE VERSION STRING IS LOAD-BEARING. `TOS_VERSION` is what gets stamped onto Profile.tosVersion
 * at acceptance, so an agent quoting "version 1" from this document and a user's stored acceptance
 * record refer to the same text by construction. Do not print a date here instead: site-legal.ts
 * explains at length why dated version strings implied a history the account table does not hold.
 *
 * ⚠️ NO CLAUSE IS PARAPHRASED. Summarising a limitation of liability or a governing-law clause in
 * "plainer" words creates a second, weaker statement of the same obligation — and the reader is a
 * machine that will quote whichever one it found. The list below names the SUBJECTS covered and
 * sends the reader to the binding text.
 */

// ⛔ THE DESCRIPTION IS EDITION-SPECIFIC AND BOTH BRANCHES USED TO SAY "classifieds marketplace".
// A reviewer caught it: on the services build that is a machine-readable legal document asserting
// this site is only a venue between members, when the operator also sells its own services here.
// Wrong in the direction that matters — it is the sentence a machine quotes about what we are.
// Kept deliberately generic rather than enumerating what those services are: this file is shared,
// and naming them belongs in the binding HTML Terms, not in a summary.
const WHAT_WE_ARE = IS_SERVICES
  ? 'an online marketplace, on which the operator also offers services of its own'
  : 'an online classifieds marketplace'

const operatorLine = OPERATOR_REGISTERED
  ? `${SITE_NAME} is ${WHAT_WE_ARE}, operated by ${COMPANY.name} (${COMPANY.nameEn}), business registration no. ${COMPANY.erc} (${COMPANY.ercIssued}), head office ${COMPANY.address}.`
  : `${SITE_NAME} is ${WHAT_WE_ARE}. The operating company is currently being registered in Vietnam; its registered name, business registration number and head-office address are published on the HTML page as soon as the certificate is issued.`

const BODY = `# Terms of Service — ${SITE_NAME}

> This is a short machine-readable summary. **The full Terms of Service at ${SITE_ORIGIN}/terms are the authoritative text** and are the version that binds. Where this summary and that page differ, that page is correct.

Version in force: ${TOS_VERSION}

## Operator

${operatorLine}

Contact: ${COMPANY.email}

## The two points most often needed by an agent

- **Listings are posted by third parties.** Sellers write their own descriptions and set their own prices, and they are responsible for the accuracy and legality of what they post.
- **${SITE_NAME} is an intermediary, not a party to peer-to-peer deals.** ${IS_SERVICES ? 'Listings between members carry no checkout and no escrow: buyers and sellers agree and settle between themselves. Services sold by the operator itself are the exception and are paid for on-site; the full Terms govern those.' : 'There is no checkout and no escrow; buyers and sellers agree and settle between themselves.'} Trust scores and badges reduce risk — they are not a guarantee or an endorsement.

## What the full Terms cover

Acceptance and scope · eligibility and accounts · listings posted by third parties · posting rules and conduct · trust, verification and moderation · the platform's role · fees · your content · disclaimers and limitation of liability · complaints and reports · suspension and termination · governing law and disputes · related sites · how changes are announced.

## Related documents

- [Terms of Service (full text, authoritative)](${SITE_ORIGIN}/terms)
- [Privacy Policy](${SITE_ORIGIN}/privacy)
- [Operating Regulations](${SITE_ORIGIN}/regulations)
- [Prohibited items](${SITE_ORIGIN}/prohibited)
- [Site index for agents](${SITE_ORIGIN}/llms.txt)
`

/**
 * ⚠️ EXPLICIT, NOT INHERITED. The safety of this route rests on its `no-store` (see
 * markdown-response.ts): these bytes are served from the SAME URL as an HTML page, so anything
 * that stores them under that key serves markdown to browsers. Next 15+ leaves GET route handlers
 * uncached by default, which means `no-store` alone is enough TODAY — and that is precisely the
 * kind of framework default that changes under you in a major bump. Declaring it here makes the
 * guarantee local to the file whose comment claims it.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return markdownResponse(BODY)
}
