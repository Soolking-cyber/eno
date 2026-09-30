import type { ReactNode } from 'react'

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
 * ("1/2"), a date or a unit ("đ/tháng"). The lookbehind refuses a path glued to a word, a slash or a
 * dot, so "eno.vn/safety" (a domain, already readable as one) stays text; the lookahead refuses a
 * longer path ("/terms-of-sale"). An email's trailing sentence full stop is never part of the match.
 * Machine-translated Vietnamese that rewrites a path ("/ privacy") simply stays unlinked — it fails
 * soft, as text.
 *
 * Plain `<a>`, not next/link: this runs in server pages (/regulations) and inside LinkifiedTr alike,
 * and a legal cross-reference is a full navigation anyway — the same choice /returns made for its
 * Dispute Center link and /regulations for its document list. No `'use client'`: server-safe.
 */
const TOKEN =
  /([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(?<![\w/.])(\/(?:regulations|privacy|prohibited|terms|returns|disputes|contact|trust|safety|legal\/ranking))(?![\w/-])/g

const LINK = 'font-semibold text-accent-foreground hover:underline'

export function linkifyLegal(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const [token, email, path] = m
    out.push(
      email ? (
        <a key={at} href={`mailto:${email}`} className={LINK}>{email}</a>
      ) : (
        <a key={at} href={path} className={LINK}>{path}</a>
      ),
    )
    last = at + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
