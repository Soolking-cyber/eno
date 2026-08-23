import { SITE_NAME } from '@/lib/edition'
import { COMPANY, OPERATOR_REGISTERED } from '@/lib/site-legal'
import { markdownResponse, SITE_ORIGIN } from '../markdown-response'

/**
 * The markdown representation of `/privacy`, reached by the Accept-header rewrite in next.config.ts.
 *
 * ⛔ THIS IS A SUMMARY WITH A POINTER, NOT A MARKDOWN PORT OF THE POLICY — AND THAT IS THE SAFE
 * CHOICE, NOT THE LAZY ONE. `src/app/privacy/page.tsx` is ~230 lines of statutory drafting whose
 * section list itself forks by edition (line 93 spreads PRIVACY_SERVICES_SECTIONS on the services
 * build, and three more sections take extra paragraphs). Hand-converting it would produce a second
 * legal text that is byte-identical to the first only until the next edit — and a markdown /privacy
 * that CONTRADICTS the HTML /privacy is a legal problem, not an SEO one. A reader who needs the
 * binding text is told, in the first line of the document, exactly where it is.
 *
 * ⚠️ EVERY OPERATOR FACT BELOW IS READ FROM `COMPANY`, NEVER TYPED. Same rule as the HTML page and
 * for the same reason: src/lib/site-legal.ts is the single source of truth, it is keyed by EDITION,
 * and a company name or ERC number typed into a page is a legal defect no lint can see. On the
 * services build these resolve to the pending-entity placeholders, which is what that page shows
 * too — consistent, and honest, because no second entity exists yet.
 *
 * ⚠️ THE `OPERATOR_REGISTERED` FORK IS NOT A FORMALITY. "Operated by X, registration no. Y" is a
 * FALSE STATEMENT on a build where no certificate has been issued, and "đang cập nhật" in a field
 * labelled "registration no." does not read as a disclaimer to anybody. The HTML page forks on the
 * same flag; if you change one branch, change both.
 *
 * ⚠️ NO STATUTORY CLOCKS, RETENTION PERIODS OR RIGHTS LISTS ARE REPEATED HERE. They exist in one
 * place, they are the part most likely to be amended, and a stale copy of a legal deadline is worse
 * than no copy: it is a published promise the operator is not actually keeping.
 */

const operatorLines = OPERATOR_REGISTERED
  ? [
      `- Operator: ${COMPANY.name} (${COMPANY.nameEn})`,
      `- Business registration no.: ${COMPANY.erc}, issued ${COMPANY.ercIssued} by ${COMPANY.ercAuthority}`,
      `- Head office: ${COMPANY.address}`,
      `- Legal representative: ${COMPANY.legalRep}`,
    ]
  : [
      `- Operator: the operating company for ${SITE_NAME} is currently being registered in Vietnam. Its registered name, business registration number and head-office address are published on the HTML page and in the Operating Regulations as soon as the certificate is issued.`,
    ]

const BODY = `# Privacy Policy — ${SITE_NAME}

> This is a short machine-readable summary. **The full Privacy Policy at ${SITE_ORIGIN}/privacy is the authoritative text**, and it is the only version that governs how personal data is handled. Where this summary and that page differ, that page is correct.

## Who to contact about personal data

${operatorLines.join('\n')}
- Personal-data contact: ${COMPANY.privacyEmail}

## What the full policy covers

The policy at ${SITE_ORIGIN}/privacy is written against Vietnam's Personal Data Protection Law 91/2025/QH15 and Decree 356/2025/ND-CP, and states in full:

- who is responsible for your data, and how to reach them;
- what categories of personal data are collected, including any sensitive categories;
- the purpose and the legal basis for each use;
- who else receives your data, and on what footing;
- whether data is processed outside Vietnam;
- your rights and the statutory deadlines for answering a request;
- how long data is kept, and what happens if there is a security breach;
- how cookies and tracking consent work, and how to withdraw consent.

## Related documents

- [Privacy Policy (full text, authoritative)](${SITE_ORIGIN}/privacy)
- [Terms of Service](${SITE_ORIGIN}/terms)
- [Operating Regulations](${SITE_ORIGIN}/regulations)
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
