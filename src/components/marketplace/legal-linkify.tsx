import type { ReactNode } from 'react'
import { COMPANY, OPERATOR_REGISTERED } from '@/lib/site-legal'

/**
 * LINKS INSIDE LEGAL PROSE — the document paths and mailboxes a policy names, made clickable without
 * touching a word of it.
 *
 * ⚠️ WHY A TOKENISER AND NOT LINKS IN THE COPY. /terms, /privacy and /returns keep their paragraphs as
 * plain strings (they are translation keys, and a legal paragraph is approved as a whole), and
 * /regulations renders fixed Vietnamese/English literals. So "published at /regulations" and
 * "write to support@eno.vn" reached a reader as dead text — 0 links in /terms' body on a phone
 * (C-LEGAL-UX, measured 2026-09-29). This finds exactly those two token shapes and wraps them; the
 * VISIBLE TEXT IS UNCHANGED, so the legal wording and every translation key stay what they were.
 *
 * ⚠️ ONLY THE SITE'S OWN DOCUMENT PATHS, NAMED. A generic "/anything" rule would link a fraction
 * ("1/2"), a date or a unit ("đ/tháng"). A path glued to a word, a slash or a dot is refused (the
 * `lead` group below), so "eno.vn/safety" (a domain, already readable as one) stays text; the lookahead refuses a
 * longer path ("/terms-of-sale"). An email's trailing sentence full stop is never part of the match.
 * Machine-translated Vietnamese that rewrites a path ("/ privacy") simply stays unlinked — it fails
 * soft, as text.
 *
 * Plain `<a>`, not next/link: this runs in server pages (/regulations) and inside LinkifiedTr alike,
 * and a legal cross-reference is a full navigation anyway — the same choice /returns made for its
 * Dispute Center link and /regulations for its document list. No `'use client'`: server-safe.
 */
// ⚠️ `/terms/v1` and `/regulations/v1` are the ARCHIVED versions (src/lib/compliance/legal-archive.ts):
// the amended texts point readers at the version still in force during a notice window. Only those two
// documents carry versions, so only they take the `/vN` suffix — `/privacy/v1` stays text.
// ⛔ NO LOOKBEHIND (2026-11-06 audit). This module ships in client chunks (LegalText, LinkifiedTr), and a regex with
// `(?<!…)` is a SyntaxError that takes the whole chunk down on Safari below 16.4 — inside the browserslist (package.json:
// safari >= 16). The character before a path or a phone is CAPTURED instead (`lead`) and given back as text, so the
// boundary rule is the one it always was and no character of the text moves.
// ⚠️ THE OPERATOR'S OWN PHONE IS LINKED TOO, AND ONLY IT: "or call 0772007921" on /privacy and Article 2's "Điện thoại:"
// were the one contact on those pages a phone could not tap, while the email beside it was a link. It is COMPANY.phone
// (site-legal.ts), never a generic number rule, which would also link the ten-digit business registration number; on an
// edition whose phone is still the placeholder, nothing is added. The href is E.164, so it dials from a foreign SIM too.
// Only for a REGISTERED operator, /contact's own rule for its tel: button (2026-11-06 review): before registration the
// number stays text wherever the prose prints it.
const PHONE = OPERATOR_REGISTERED && /^0\d{8,10}$/.test(COMPANY.phone) ? COMPANY.phone : null
const PATH = String.raw`(\/(?:(?:regulations|terms)(?:\/v\d+)?|privacy|prohibited|returns|disputes|contact|trust|safety|legal\/ranking))(?![\w/-])`
const TOKEN = new RegExp(
  String.raw`([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(^|[^\w/.])(?:${PATH}${PHONE ? String.raw`|(${PHONE})(?!\d)` : ''})`,
  'g',
)

const LINK = 'font-semibold text-accent-foreground hover:underline'

export function linkifyLegal(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    const [token, email, lead = '', path, phone] = m
    const start = m.index ?? 0
    // The boundary character stays text; only the email, the path or the number is the link.
    const at = email ? start : start + lead.length
    if (at > last) out.push(text.slice(last, at))
    out.push(
      email ? (
        <a key={at} href={`mailto:${email}`} className={LINK}>{email}</a>
      ) : path ? (
        <a key={at} href={path} className={LINK}>{path}</a>
      ) : (
        <a key={at} href={`tel:+84${phone.slice(1)}`} className={LINK}>{phone}</a>
      ),
    )
    last = start + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
