/**
 * MODEL LINEAGE — split a `Listing.model` display string into the levels the cascading brand
 * picker needs: LINE (iPhone) -> GENERATION (17) -> VARIANT (Pro Max).
 *
 * This file is PURE and knows no brand. The per-brand knowledge — which token prefixes are real
 * product lines, and which strings are the same product written twice — lives in
 * `src/generated/model-lineage.ts`, built offline by `scripts/build-model-lineage.ts`.
 *
 * ⛔ NOTHING HERE ASKS A MODEL WHAT IS NEWER. The decisions model was probed on exactly that and
 * failed: it scored "iPhone 17 Pro Max" 0.19 on "is this a real product" while giving "MacBook
 * Air" 0.98, because its training predates the current lineup. Recency comes from the string.
 * Same failure CLAUDE.md records for a reviewer calling Vietnam's 63->34 province merger a
 * hallucination — a model's training date is not the world.
 *
 * ⚠️ AN UNKNOWN STRING MUST DEGRADE, NEVER DISAPPEAR. Both plan reviewers attacked an earlier
 * design that resolved strings through a build-time alias table at request time: anything imported
 * after the last deploy would silently drop out of every line. So `splitModel` is total — given no
 * table at all it still returns a usable line — and the generated table is an IMPROVEMENT on the
 * generic parse, never a gate in front of it.
 */

/** One model string, decomposed. `raw` is always the untouched input. */
export type ModelParts = {
  raw: string
  /** Product line, e.g. "iPhone", "Apple Watch Series", "Galaxy Z Fold". Never empty. */
  line: string
  /**
   * The generation number: 17 for "iPhone 17 Pro". `null` for a model with no generation
   * ("MacBook Air", "AirPods Max") — correct rather than missing, since those lines are one level
   * shallower and the picker must not invent a column for them.
   */
  gen: number | null
  /** Generation as written, so "Series 10" and "SE 2022" keep their shape in the UI. */
  genLabel: string | null
  /**
   * ⚠️ TRUE WHEN THE GENERATION IS A CALENDAR YEAR, and this flag is the whole reason the field
   * exists. "Apple Watch SE 2022" parsed naively yields generation 2022, which sorts ABOVE
   * "Apple Watch SE 3" and puts a four-year-old watch at the head of the column. A year is not
   * comparable to a sequence number, so it is tagged and ordered separately (see `byNewest`), and
   * `scripts/build-model-lineage.ts` offers year/integer pairs within one line to jev to merge —
   * that is a "are these the same product" judgement, which it does well (SE 2 vs SE 2022 = 0.93),
   * not a recency judgement, which it does not.
   */
  genIsYear: boolean
  /** What follows the generation: "Pro Max", "Ultra", "Plus". `null` when there is no suffix. */
  variant: string | null
}

/** 2000-2099 written as a generation is a release year, not a sequence number. */
const isYear = (n: number) => n >= 2000 && n <= 2099

/**
 * Tokens that look like a generation but are a SPEC. Stripped first, which is what stops
 * "MacBook Pro 14 inch M3" resolving to generation 14 — the 14 is inches.
 */
const SPEC = /\b\d+(\.\d+)?\s*(inch|in\b|"|cm|mm|gb|tb|mah|hz|w\b|nits)\b/gi

/**
 * ⚠️ A GENERATION IS NOT ALWAYS THE FIRST NUMBER. Dell's "XPS 13 9315" has two and the first is a
 * screen size; Samsung glues its number to the word ("Galaxy Z Fold7"); Apple uses a year
 * ("Apple Watch SE 2022"). `(?![\d.])` stops "9315" being read as "931" and "13.3" as 13 — a loose
 * `\d+` silently picks the wrong number and then sorts the whole column wrong, which presents as a
 * UI bug rather than a parse bug. That is why ordering never leaves this file.
 */
// ⚠️ NUMBERED GROUPS, NOT NAMED ONES. This repo's tsconfig target predates ES2018, so `(?<line>…)`
// is a compile error here even though it runs fine under the test runner's esbuild — the suite
// stayed green while `tsc` was red. Groups are [1] line, [2] generation, [3] variant.
const GEN = /^(.*?)\s*(\d{1,4})(?![\d.])\s*(.*)$/

const parts = (raw: string, line: string, gen: number | null, genLabel: string | null, variant: string | null): ModelParts => ({
  raw,
  line,
  gen,
  genLabel,
  genIsYear: gen !== null && isYear(gen),
  variant,
})

export function splitModel(raw: string, knownLines: string[] = []): ModelParts {
  const clean = raw.replace(SPEC, ' ').replace(/\s+/g, ' ').trim()

  /**
   * A KNOWN LINE WINS OUTRIGHT, and it has to: the generic parse cannot tell a line's own digits
   * from a generation. "Galaxy S26 Ultra" is line "Galaxy S" + gen 26, but nothing in the string
   * says the S belongs to the line — only the per-brand table knows. Longest match first, so
   * "Galaxy Z Fold" is not shadowed by "Galaxy".
   */
  /**
   * ⚠️ THE MATCH NEEDS A WORD BOUNDARY. A bare `startsWith` let a short line swallow an unrelated
   * model — line "iPad" matched "iPadOS Case", line "Air" matched "Airtag" — so the next character
   * must not be a letter.
   */
  const lower = clean.toLowerCase()
  const hit = [...knownLines].sort((a, b) => b.length - a.length)
    .find((l) => lower.startsWith(l.toLowerCase()) && !/\p{L}/u.test(clean[l.length] ?? ''))
  if (hit) {
    const rest = clean.slice(hit.length).trim()
    const m = rest.match(/^(\d{1,4})(?![\d.])\s*(.*)$/)
    if (!m) return parts(raw, hit, null, null, rest || null)
    return parts(raw, hit, Number(m[1]), m[1], m[2].trim() || null)
  }

  const m = clean.match(GEN)
  if (!m?.[1]?.trim()) {
    // No generation anywhere — the whole string is the line ("MacBook Air", "AirPods Max").
    return parts(raw, clean, null, null, null)
  }
  /**
   * ⚠️ A TRAILING SKU IS KEPT AS THE VARIANT ON PURPOSE. "XPS 13 9315" leaves "9315", a part
   * number rather than a marketing suffix — but it is the only thing telling two otherwise
   * identical entries apart, and a Dell buyer shops by exactly that number.
   */
  return parts(raw, m[1].trim(), Number(m[2]), m[2] ?? null, m[3]?.trim() || null)
}

/**
 * Newest generation first, which is the order the owner asked for ("iPhone 18 … to earliest").
 *
 * ⚠️ YEARS SORT AMONG THEMSELVES, BELOW SEQUENCE NUMBERS, and that placement is a deliberate
 * admission of ignorance rather than a guess. "SE 2022" and "SE 3" cannot be compared without
 * knowing which year each sequence number shipped in, and inventing that ordering is how "SE
 * 2022" ended up above "SE 3". A year that the generated table successfully merged into a
 * sequence number never reaches here as a year, so what remains in this branch is genuinely
 * unresolved and belongs at the end of the column, not interleaved into it.
 *
 * ⚠️ A NULL GENERATION SORTS LAST, and an earlier version of this function had it backwards. An
 * unnumbered entry beside numbered siblings is the OLDEST of them, not the newest: bare
 * "Apple Watch Ultra" is the first Ultra and belongs below "Ultra 2", and "iPhone Xr" belongs
 * below every numbered iPhone. Where the line has only one entry the choice is invisible, which
 * is what let the wrong order look right in the first test that covered it.
 */
export function byNewest(a: ModelParts, b: ModelParts): number {
  if (a.gen === null || b.gen === null) {
    if (a.gen === null && b.gen === null) return a.raw.localeCompare(b.raw)
    return a.gen === null ? 1 : -1
  }
  if (a.genIsYear !== b.genIsYear) return a.genIsYear ? 1 : -1
  return b.gen - a.gen
}

/**
 * Fold the spelling variations one catalogue accumulates for a single product, so "Se2", "SE 2"
 * and "Apple Watch SE 2" collapse to one key. Deterministic and case/space/punctuation blind.
 *
 * ⚠️ THIS IS THE MERGE CANDIDATE GENERATOR, NOT THE MERGE. Two strings sharing a key are the same
 * product; two strings NOT sharing one still might be ("SE 2022" vs "SE 2"), which is what the
 * offline jev confirmation is for. Both plan reviewers refuted merging by pairwise similarity
 * alone — it is not transitive, and a vague "AirPods Pro" scores "same" against both "Pro 2" and
 * "Pro 3", which would re-merge what jev had separated at 0.05. Deterministic keys first, jev only
 * to confirm a specific proposed pair, never to discover pairs.
 */
export function modelKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    // "S8" is how the catalogue writes "Series 8"; expand before punctuation is stripped.
    .replace(/\bs(?=\d)/g, 'series ')
    .replace(/\bse(?=\d)/g, 'se ')
    // ⚠️ "+" IS PART OF THE NAME, not punctuation. Stripping it merged Soundpeats "Air 5 Pro"
    // with "Air 5 Pro+" — two different products collapsed into one picker row, and the cheaper
    // one silently became the canonical spelling for both.
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
