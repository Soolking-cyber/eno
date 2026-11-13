/**
 * THE TEACHER CARD'S PROOF LINE (owner, 2026-11-12: "build 2" — round-8 blind A/B test 4; the tested mock is
 * round8 variants6/teacher-proof.js). A teacher card reads NAME → rate → PROOF → the info line, and PROOF is the 1–2
 * strongest facts the teacher states about themselves, at most PROOF_MAX_CHARS: the best certificate (DELTA > CELTA >
 * PGCE > TEFL > TESOL > Teaching licence > TKT; "Other" never), the experience band from one year up (the experience
 * facet's own labels, "5–10 yrs"), a PhD or Master's, a second certificate, a Bachelor's — in that order. A band alone
 * reads the same short label since batch 86 ("5–10 yrs"; the profile keeps its phrase, EXPERIENCE_BAND_PHRASE). Under a year, no degree and an
 * associate degree are not proof (NOT_PROOF) and are never printed.
 * ⛔ SELF-STATED: no document is ever uploaded (profile.ts — "QUALIFICATIONS ARE DATA, NEVER DOCUMENTS"), so the line
 * carries no tick and never says "verified".
 *
 * TWO HALVES, ONE VOCABULARY:
 *   · SERVER — `teacherProofFacts` (serialize.ts serializeListingCard): Listing.facetTokens → at most two facet SLUGS, best
 *     first. The column also holds where a teacher will teach or cover, so it never ships whole: only these slugs leave,
 *     as the card's `teacherProof`. The cert, band and degree vocabularies are disjoint, so a slug alone says what it is.
 *   · CLIENT — `teacherProofLine` (listing-card.tsx): those slugs → the line in the reader's language, or null.
 * ⚠️ IMPORT-LIGHT ON PURPOSE: only facet-tokens.ts, which imports nothing. Importing taxonomy.ts or profile.ts here would
 * put the whole taxonomy in every card's bundle — so the labels below are restated, and card-proof.test.ts pins each one
 * against the taxonomy's own `label` / `labelVi` (and the vocabulary against TEACHER_OPTIONS) instead.
 * ⚠️ THE BUDGET IS CHECKED ON WHAT `tr()` RETURNS, so the nine machine-translated languages fall back the same way as en
 * and vi (the pair → the first fact, or the band phrase); a single long fact is cut by the card's `truncate`.
 */
import { parseFacetTokens } from '@/lib/facet-tokens'

type Pair = { en: string; vi: string }

/** Best first. 'other-cert' is never proof (NOT_PROOF). */
const CERT_RANK = ['delta', 'celta', 'pgce', 'tefl', 'tesol', 'teaching-license', 'tkt'] as const
/** A certificate's NAME — the same in every language, so it never goes through tr(). */
const CERT_NAME: Readonly<Record<string, string>> = { delta: 'DELTA', celta: 'CELTA', pgce: 'PGCE', tefl: 'TEFL', tesol: 'TESOL', tkt: 'TKT' }
const TEACHING_LICENCE: Pair = { en: 'Teaching licence', vi: 'Giấy phép giảng dạy' }
/** The experience facet's labels (taxonomy.ts) for the bands that are proof — 'under-1-year' is left out. */
const BAND_SHORT: Readonly<Record<string, Pair>> = {
  '1-3-years': { en: '1–3 yrs', vi: '1–3 năm' },
  '3-5-years': { en: '3–5 yrs', vi: '3–5 năm' },
  '5-10-years': { en: '5–10 yrs', vi: '5–10 năm' },
  'over-10-years': { en: '10+ yrs', vi: '10 năm trở lên' },
}
/**
 * "How long have you been teaching?" — the experience facet's five bands, as a phrase. ONE table for two readers: the
 * profile's facts line under the headline (teacher-profile-view.tsx, which prints all five) and a teacher card whose only
 * fact is its band (never 'under-1-year' there — NOT_PROOF). Moved here from teacher-profile-view.tsx (batch 80).
 */
export const EXPERIENCE_BAND_PHRASE: Readonly<Record<string, Pair>> = {
  'under-1-year': { en: 'Under 1 year teaching', vi: 'Dạy dưới 1 năm' },
  '1-3-years': { en: '1–3 years teaching', vi: 'Dạy 1–3 năm' },
  '3-5-years': { en: '3–5 years teaching', vi: 'Dạy 3–5 năm' },
  '5-10-years': { en: '5–10 years teaching', vi: 'Dạy 5–10 năm' },
  'over-10-years': { en: '10+ years teaching', vi: 'Dạy 10 năm trở lên' },
}
const HIGH_DEGREE: Readonly<Record<string, Pair>> = {
  phd: { en: 'PhD', vi: 'Tiến sĩ' },
  master: { en: "Master's", vi: 'Thạc sĩ' },
}
const BACHELOR: Pair = { en: "Bachelor's", vi: 'Cử nhân' }

/** The line's budget, in characters of what is printed (the mock's MAX). */
export const PROOF_MAX_CHARS = 22
/** The taxonomy values that are never proof — pinned complementary to the printable ones by card-proof.test.ts. */
export const NOT_PROOF = { experience: ['under-1-year'], cert: ['other-cert'], degree: ['associate', 'no-degree'] } as const

/** Own keys only: a slug from a payload or a token is never allowed to reach a prototype key (`__proto__`, `constructor`). */
const has = (o: object, k: string) => Object.hasOwn(o, k)

/**
 * SERVER (serializeListingCard): a teacher row's facetTokens → the line's facts, best first, at most two slugs; null when
 * none is printable. Order = the mock's `proofOf`: best certificate, band, PhD/Master's, second certificate, Bachelor's.
 * Two are enough: the line never prints more than two, and the band, when there is one, is always among the first two.
 */
export function teacherProofFacts(tokens: string | null | undefined): string[] | null {
  const pairs = parseFacetTokens(tokens)
  const of = (key: string) => pairs.filter((p) => p.key === key).map((p) => p.value)
  const certs = CERT_RANK.filter((c) => of('cert').includes(c))
  const band = of('experience').find((b) => has(BAND_SHORT, b))
  const degrees = of('degree')
  const high = degrees.find((d) => has(HIGH_DEGREE, d))
  const facts: string[] = []
  if (certs[0]) facts.push(certs[0])
  if (band) facts.push(band)
  if (high) facts.push(high)
  if (certs[1]) facts.push(certs[1])
  if (degrees.includes('bachelor')) facts.push('bachelor')
  return facts.length ? facts.slice(0, 2) : null
}

/**
 * CLIENT (ListingCard): the line, or null. `tr` = useLanguage().tr. Unknown slugs (a newer server, version skew) are
 * dropped.
 * ⚠️ `facts` IS TYPED `unknown` ON PURPOSE: /saved paints whole card payloads out of localStorage with no TTL
 * (favorites-context.tsx), written by whatever build was live then. Today the key is a string array; if its shape ever
 * changes, an old or new payload must render the reserved empty line, never crash the card.
 */
export function teacherProofLine(facts: unknown, tr: (en: string, vi?: string) => string): string | null {
  const say = (s: string): string | null =>
    has(CERT_NAME, s) ? CERT_NAME[s]
      : s === 'teaching-license' ? tr(TEACHING_LICENCE.en, TEACHING_LICENCE.vi)
        : has(BAND_SHORT, s) ? tr(BAND_SHORT[s].en, BAND_SHORT[s].vi)
          : has(HIGH_DEGREE, s) ? tr(HIGH_DEGREE[s].en, HIGH_DEGREE[s].vi)
            : s === 'bachelor' ? tr(BACHELOR.en, BACHELOR.vi)
              : null
  const list: readonly unknown[] = Array.isArray(facts) ? facts : []
  const known = list
    .flatMap((s) => {
      const text = typeof s === 'string' ? say(s) : null
      return text == null ? [] : [{ slug: s as string, text }]
    })
    .slice(0, 2)
  if (!known.length) return null
  // ⛔ A BAND STANDING ALONE READS SHORT TOO — "1–3 yrs" / "1–3 năm", as beside a certificate (UI climb batch 86, 2026-11-13;
  // blind A/B, Opus 7.20 → 7.26; owner, 2026-11-13: "minimal wording only whats necessary"). It read the profile's phrase
  // ("1–3 years teaching" / "Dạy 1–3 năm"), so one card in a row said it the long way and its neighbour the short way. The
  // profile keeps the phrase (EXPERIENCE_BAND_PHRASE, teacher-profile-view.tsx), where it stands in a sentence of facts.
  const first = known[0]
  if (known.length === 1) return first.text
  const pair = `${first.text} · ${known[1].text}`
  return pair.length <= PROOF_MAX_CHARS ? pair : first.text
}
