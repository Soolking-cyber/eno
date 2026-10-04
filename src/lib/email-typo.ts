/**
 * The sign-in form's three small email helpers (auth-06, 2026-10-04): when the address is complete
 * enough to send to, which common-domain typo to offer a fix for, and which webmail to offer on the
 * "check your email" screen. Pure, so they are pinned in email-typo.test.ts without rendering the form.
 *
 * ⚠️ A SUGGESTION, NEVER A REWRITE. The visitor taps "@gmail.com?" to take it, or sends what they
 * typed. A real but rare domain one letter from a big one (mail.com beside gmail.com) is allowlisted,
 * and anything we do not know stays exactly as typed.
 */

/** "Complete enough to send": something@something.tld — a '.' after the '@' with a label on each
 *  side. The button used to enable on a bare '@', so "an@gmail" was sent and bounced (auth-06). */
export function emailLooksComplete(raw: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(raw.trim())
}

/**
 * How long typing must pause before the form offers a fix. Every Gmail address passes through
 * 'gmail.co' — one edit from gmail.com — on its way to being typed, so a suggestion computed on each
 * keystroke flashed "@gmail.com?" (and moved the row under it) for nearly every visitor. A typist's
 * keystrokes are far closer together than this; someone who stopped at 'gmail.co' sees it.
 */
export const EMAIL_TYPO_PAUSE_MS = 700

/** The webmail domains a typo is measured against — what the visitors here actually use. */
const POPULAR = ['gmail.com', 'yahoo.com', 'yahoo.com.vn', 'hotmail.com', 'outlook.com', 'icloud.com', 'live.com'] as const

/** Real providers that sit within a typo of a popular one — never "corrected". */
// 'email.com' is the mail.com family's own domain — one letter from gmail.com, and real.
const REAL = new Set([
  'mail.com', 'email.com', 'gmx.com', 'ymail.com', 'msn.com', 'me.com', 'mac.com', 'aol.com', 'live.co.uk', 'hotmail.co.uk',
  'outlook.co.uk', 'yahoo.co.uk', 'yahoo.co.jp', 'yahoo.fr', 'hotmail.fr', 'live.fr', 'gmail.vn',
])

/**
 * A big provider's own COUNTRY domain: yahoo.com.au, yahoo.com.sg, yahoo.ca, hotmail.ca, outlook.com.vn.
 * Real mail, and common among expats here: two letters from yahoo.com.vn, or '.ca' beside '.com', is the
 * distance between two countries, not a slip. On this shape only a ONE-edit miss is offered
 * (yahoo.com.vm → yahoo.com.vn, yahoo.co → yahoo.com). Gmail has no country domains, so 'gmail.co'
 * keeps the full budget.
 */
const PROVIDER_COUNTRY = /^(yahoo|hotmail|outlook|live)\.(com?\.)?[a-z]{2}$/

/** Optimal-string-alignment distance (Levenshtein + one adjacent transposition): 'gmial' → 'gmail' is 1. */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/**
 * The popular domain the typed one is probably a typo of ('gmial.com', 'gmail.con', 'gmail.co',
 * 'hotmal.com' …), or null. Only for a complete address, only within 2 edits (1 for a short domain or a
 * provider's country domain), and never for a popular or allowlisted real domain. Ties go to the first
 * in POPULAR (gmail).
 * ⚠️ The form asks only once typing pauses (sign-in-form.tsx): 'gmail.co' is one keystroke from done.
 */
export function suggestEmailDomain(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  if (!emailLooksComplete(email)) return null
  const domain = email.slice(email.lastIndexOf('@') + 1)
  if ((POPULAR as readonly string[]).includes(domain) || REAL.has(domain)) return null
  const budget = domain.length <= 7 || PROVIDER_COUNTRY.test(domain) ? 1 : 2
  let best: { d: string; n: number } | null = null
  for (const p of POPULAR) {
    const n = editDistance(domain, p)
    if (n <= budget && (!best || n < best.n)) best = { d: p, n }
  }
  return best?.d ?? null
}

/** `raw` with its domain swapped for `domain` (the local part kept exactly as typed). */
export function withEmailDomain(raw: string, domain: string): string {
  const email = raw.trim()
  return `${email.slice(0, email.lastIndexOf('@') + 1)}${domain}`
}

/** The webmail to offer on the "check your email" screen, by domain — Gmail or Outlook, else none. */
export function webmailFor(raw: string): { name: 'Gmail' | 'Outlook'; url: string } | null {
  const email = raw.trim().toLowerCase()
  const domain = email.slice(email.lastIndexOf('@') + 1)
  if (domain === 'gmail.com' || domain === 'googlemail.com') return { name: 'Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' }
  if (/^(outlook|hotmail|live|msn)\.(com|com\.vn|co\.uk|fr)$/.test(domain)) return { name: 'Outlook', url: 'https://outlook.live.com/mail/' }
  return null
}
