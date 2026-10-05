import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * ⚠️ THE Z LADDER'S NAMES MUST BE TAUGHT TO tailwind-merge, OR AN OVERRIDE SILENTLY LOSES. The ladder
 * in globals.css (`@theme { --z-index-* }`, D-Z 2026-09-29) mints `z-overlay`, `z-fab` … — and
 * tailwind-merge's stock `z` group accepts only integers, `auto` and arbitrary values, so it would
 * keep BOTH of `cn('z-overlay', 'z-[70]')` and leave stylesheet order to pick one (the concatenation
 * trap CLAUDE.md warns about). Tailwind sorts `z-[70]` before `z-overlay`, so the caller would lose.
 * Keep this list equal to the `--z-index-*` names in globals.css.
 *
 * ⚠️ THE FOUR HOUSE CURVES NEED THE SAME TREATMENT, FOR THE SAME REASON (D-LINT, 2026-09-29). Once they
 * became theme tokens (`@theme static { --ease-* }` in globals.css) the primitives spell the NAMED
 * utility (`ease-spring-snappy`) where they used the arbitrary var() form. tailwind-merge put the
 * arbitrary form in its `ease` group, but its stock theme knows only `in`, `out` and `in-out`, so a
 * named curve is an unknown class: `cn('ease-spring-snappy', 'ease-out')` kept BOTH, and Tailwind
 * emits the named curves after `ease-out`, so the primitive beat every caller (rental-check-pill's
 * 200ms `ease-out` entrance on <Button>, the theme Switch thumb in preferences-inline). `theme.ease`
 * is the key tailwind-merge's `ease` group reads, i.e. the same namespace as Tailwind's `--ease-*`.
 * Keep this list equal to the `--ease-*` names in that block; utils.test.ts reads both.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      ease: ['out-strong', 'spring', 'spring-snappy', 'bounce'],
    },
    classGroups: {
      z: [{ z: ['raised', 'sticky', 'nav', 'fab', 'overlay', 'tooltip', 'splash', 'consent', 'map-overlay', 'nested-popover'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** The single brand blue (`--primary` in globals.css). Use for inline styles that can't
 *  reach the Tailwind token — e.g. the fallback background of an initials avatar. */
export const BRAND_BLUE = '#0a66c2'

/** A trailing generational suffix is not a surname: "… Montgomery III" is CM, not CI. ⚠️ Never a bare "V":
 *  "Lan V." abbreviates Vũ/Võ, and "Studio V" is a shop (codex + opus, 2026-10-05). Applied only from three
 *  words up, so a two-word shop name like "Studio III" keeps its last word. */
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i
const LETTER = /[\p{L}\p{N}]/u
/**
 * A word's initial: its first letter or digit WITH any combining marks after it (Thai "ศุ", a decomposed
 * "Â"), skipping a Thai/Lao leading vowel — those are written BEFORE the consonant they follow, so "ใจดี"'s
 * initial is จ. Emoji and punctuation are never an initial.
 * ⚠️ A REGEX, NOT Intl.Segmenter (opus, 2026-10-05): Firefox 111–124 is inside the browserslist floor and has
 * no Segmenter, so a server-rendered avatar and that client would disagree — a hydration mismatch. Letter +
 * combining marks is the part of grapheme clustering initials need, and it is identical on every runtime.
 */
const INITIAL = /(?![\u0E40-\u0E44\u0EC0-\u0EC4])[\p{L}\p{N}]\p{M}*/u
/** Viramas (Devanagari ्, Bengali ্, Tamil ், Khmer coeng ្, Myanmar ္ …) join a consonant to the NEXT one; at
 *  the end of an initial they would fuse it with the surname's initial into a conjunct (codex, 2026-10-05). */
const TRAILING_VIRAMA = /[\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0BCD\u0C4D\u0CCD\u0D4D\u0DCA\u0E3A\u1039\u103A\u17D2]+$/u
const initialOf = (word: string) => (word.match(INITIAL)?.[0] ?? '').replace(TRAILING_VIRAMA, '')

/** "Nguyễn Văn An" → "NA" — the app-wide avatar-initials rule: the first letters of the FIRST and LAST
 *  word, uppercased (break-ui, 2026-10-05). It used to take the first two words, so a third of the country
 *  ("Nguyễn Văn …", "… Thị …") shared "NV"/"NT", every "Công Ty …" company read "CT", "🦊 Fox" printed a
 *  broken half-emoji "�F", and leading spaces gave an empty circle. Now: whitespace runs collapse, words
 *  with no letter (an emoji) are skipped, the initial is a letter with its combining marks, a generational
 *  suffix is not the surname, a Thai/Lao leading vowel is skipped. One word (or CJK, written without
 *  spaces) → one initial. Nothing usable → "?". */
export function getInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter((w) => LETTER.test(w))
  if (words.length > 2 && NAME_SUFFIX.test(words[words.length - 1])) words.pop()
  if (!words.length) return '?'
  const first = initialOf(words[0])
  const last = words.length > 1 ? initialOf(words[words.length - 1]) : ''
  // Uppercase PER INITIAL and keep one letter: "ß" uppercases to "SS" (codex, 2026-10-05).
  const up = (i: string) => i.toUpperCase().match(INITIAL)?.[0] ?? i
  return up(first) + (last ? up(last) : '') || '?'
}

/** Privacy-safe stand-in for a missing display name: first 2 chars of the email
 *  local part + '***' ("mi***"). Distinguishable to a counterparty, but never the
 *  address itself — raw emails must not reach chat payloads or public reviews
 *  (PII sweep 2026-07-06). */
export function maskEmailHandle(email: string | null | undefined): string | null {
  const local = (email || '').split('@')[0]
  if (!local) return null
  return `${local.slice(0, 2)}***`
}
