// ── THE HUMAN-FACING CASE NUMBER ──────────────────────────────────────────────────
//
// The owner: "so 8 hex character should be easily eligible though and sequantial also".
// The pack's folder was named from the first 8 hex of the application uuid (`3f2a91bc`),
// which is unreadable down a phone line, unsayable in a Zalo message, and carries no
// order — two of them tell you nothing about which case came first. This module replaces
// it with `EV-1042`: a prefix a human recognises and a decimal number that only ever
// counts up.
//
// SHAPE, and why each part of it:
//   · `EV` — e-Visa. Two letters, no vowel confusion, unambiguous when spelled out.
//   · a HYPHEN — one visual break, so the digits are read as a number and not as a year.
//   · DECIMAL DIGITS ONLY. No hex (b/6, 0/O, 1/l are read wrong over a phone), no
//     checksum letter, no zero padding. The number IS the order: bigger came later.
//
// ⚠️ WHAT A SEQUENTIAL NUMBER GIVES AWAY, stated rather than assumed. A pure counter
// starting at 1 tells the first applicant they are eno's first customer, and tells anyone
// holding two references exactly how many applications eno took between them. The BASE
// below removes the first leak completely — EV-1001 says nothing about volume — and it is
// free. It does NOT remove the second: any strictly monotonic reference leaks the count
// between two of them, because that is the same property that makes it orderable, which
// is what the owner asked for. Hiding the delta would need randomised jumps, which costs
// the desk the one thing this number is for. So: base yes, randomisation no, and the
// residual is written down here rather than discovered later.
//
// ⚠️ THE REFERENCE IS ASSIGNED ONCE AND NEVER CHANGES. It is printed on the applicant's
// email, on the result PDF's chat card and on the pack the agent files from, so it is
// stored as TEXT in `visa_applications.reference` (scripts/visa-reference-column.mjs)
// rather than recomputed from a counter at read time — a later edit to the prefix or the
// base can then never rewrite a number a customer already has in their inbox. That script
// carries the same two literals in SQL, and reference.test.ts fails if the two drift.

/** Prefix on every reference. ASCII, uppercase, no digits — see the header. */
export const VISA_REFERENCE_PREFIX = 'EV'

/**
 * Added to the raw sequence value before it is printed, so the first case reads EV-1001
 * and not EV-1. Never lower this: it would make new references collide with issued ones.
 */
export const VISA_REFERENCE_BASE = 1000

/** Highest sequence value that still formats to an exactly-representable number. */
const MAX_SEQ = Number.MAX_SAFE_INTEGER - VISA_REFERENCE_BASE

/**
 * Whitespace at the ENDS only, plus the zero-width characters an HTML-email copy/paste
 * drags along (BOM, ZWSP/ZWNJ/ZWJ). Deliberately not applied inside the digits: a
 * zero-width space between two digits is a corrupt reference, not a formatting artefact.
 */
const EDGE_BLANK = /^[\s\u200B-\u200D\uFEFF]+|[\s\u200B-\u200D\uFEFF]+$/g

/**
 * Canonical `EV-<digits>` with two documented tolerances and nothing else:
 *   · the separator may be a hyphen, one of the Unicode dashes a mail client or a Word
 *     document substitutes for it, a single space (or the non-breaking one HTML email
 *     emits), or absent entirely — someone told the number over the phone writes
 *     "EV 1042" or "EV1042";
 *   · case is irrelevant (`ev-1042`).
 * Everything else is rejected: no leading zeros, no separators inside the digits, no
 * prefix, suffix or punctuation of any kind. That strictness is load-bearing — a parsed
 * reference is re-emitted by formatVisaReference into a FILENAME and a Content-Disposition
 * header, so the only characters that can ever reach one are `EV`, `-` and digits.
 */
const REFERENCE_RE = /^EV[-\u2010-\u2015\u2212 \u00A0]?([1-9][0-9]{0,17})$/

/**
 * The reference a human reads, from the raw sequence value the database issued.
 *
 * THROWS on a value that is not a whole non-negative number in range. This is the one
 * definition of the format in the codebase; being handed something that cannot be one is
 * a programming error (or a corrupt row), and inventing a placeholder reference for a real
 * case would be worse than failing loudly — a customer would be told a number that
 * belongs to nobody.
 */
export function formatVisaReference(seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 0 || seq > MAX_SEQ) {
    throw new RangeError('visa_reference_seq_out_of_range')
  }
  return `${VISA_REFERENCE_PREFIX}-${VISA_REFERENCE_BASE + seq}`
}

/**
 * The inverse: the sequence value behind a reference the desk pasted back, or null when
 * the text is not one. Exact round trip in both directions —
 * `parseVisaReference(formatVisaReference(n)) === n`, and
 * `formatVisaReference(parseVisaReference(t)!) === t` for every canonical `t`.
 *
 * Never throws: this is the entry point for text a human typed, and "not a reference" is
 * an ordinary answer, not an exception.
 */
export function parseVisaReference(text: string): number | null {
  if (typeof text !== 'string') return null
  const match = REFERENCE_RE.exec(text.replace(EDGE_BLANK, '').toUpperCase())
  if (!match) return null
  const digits = match[1]
  const value = Number(digits)
  // A digit run that does not survive the round trip through a double has lost precision;
  // resolving it to the wrong case is worse than not resolving it at all.
  if (!Number.isSafeInteger(value) || String(value) !== digits) return null
  if (value < VISA_REFERENCE_BASE) return null
  return value - VISA_REFERENCE_BASE
}

/**
 * A stored or pasted reference reduced to its canonical form, or null when it is not a
 * reference at all.
 *
 * ⚠️ This is the sanitiser in front of every place a reference becomes a STRING WE EMIT —
 * a zip folder name, a download filename, a Content-Disposition header. It cannot pass
 * through a slash, a quote, a newline or a non-ASCII character, because it does not pass
 * through anything it did not parse. Call it on the database value; never interpolate the
 * raw column.
 */
export function normalizeVisaReference(text: string | null | undefined): string | null {
  if (!text) return null
  const seq = parseVisaReference(text)
  return seq === null ? null : formatVisaReference(seq)
}
