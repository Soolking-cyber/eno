import { cutText } from './feed-text'

/**
 * A PROVIDER-SUPPLIED NAME, MADE SAFE TO SEED A PROFILE WITH (Sign in with Apple plan, A5).
 *
 * ensureProfile (src/lib/profile.ts) seeds `displayName` from `user_metadata.full_name` / `name`, and the
 * public handle is claimed from it. Those values come from an identity provider — Google's profile, Apple's
 * name sheet (the app writes it with updateUser) or a form_post `user` field — and nothing capped or cleaned
 * them: a name could carry a newline, a bidi override that reverses the text around it ("Trojan Source"
 * style), zero-width characters that make two names look identical, or a few kilobytes of text.
 *
 * ⚠️ WHAT IT REMOVES, EXACTLY (the plan's list):
 *   · C0/C1 control characters (`\p{Cc}`) — the whitespace ones (tab, newlines, NEL) become a space first,
 *     so "John\nDoe" stays two words;
 *   · U+061C ARABIC LETTER MARK, U+200B–U+200F (zero-width space/joiners, LRM/RLM), U+202A–U+202E (bidi
 *     embeddings and overrides), U+2066–U+2069 (bidi isolates), U+FEFF (BOM / zero-width no-break space).
 * Then NFC, whitespace collapsed to single spaces, trimmed, and cut to 80 UTF-16 units by `cutText`, which
 * never splits a surrogate pair (an emoji at the cut is dropped whole rather than halved).
 *
 * Returns '' for anything that is not a string or cleans down to nothing — callers fall back (the masked
 * email handle in ensureProfile).
 */
export const DISPLAY_NAME_MAX = 80

const WHITESPACE_CONTROLS = /[\t\n\v\f\r\u0085]/g
const CONTROLS = /\p{Cc}/gu
// ⚠️ ESCAPED, NEVER WRITTEN LITERALLY (opus gate O3, 2026-10-08): the raw characters are invisible in an editor and
// a diff and raise GitHub's hidden-Unicode banner — on the one file meant to defend against them — and ESLint's
// no-irregular-whitespace, were it switched on (it is not in this repo's config; forced on, the literal form failed
// at U+200B and U+FEFF). display-name.test.ts fails on any of them appearing raw in this file.
const INVISIBLE_FORMATTING = /[\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g

export function cleanDisplayName(raw: unknown, max: number = DISPLAY_NAME_MAX): string {
  if (typeof raw !== 'string') return ''
  const cleaned = raw
    .normalize('NFC')
    .replace(WHITESPACE_CONTROLS, ' ')
    .replace(CONTROLS, '')
    .replace(INVISIBLE_FORMATTING, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cutText(cleaned, max).trim()
}
