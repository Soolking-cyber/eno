/**
 * BUILD MODEL LINEAGE — derive each electronics brand's product LINES from the model strings the
 * catalogue actually carries, and emit `src/generated/model-lineage.ts`.
 *
 *   npx tsx scripts/build-model-lineage.ts --brands apple,samsung   # try a few
 *   npx tsx scripts/build-model-lineage.ts                          # all electronics brands
 *   npx tsx scripts/build-model-lineage.ts --dry                    # print, write nothing
 *
 * ⛔ THE OUTPUT IS AN IMPROVEMENT, NEVER A GATE. `splitModel` is total without it: a model string
 * imported after the last deploy still resolves to a usable line. Both plan reviewers refuted an
 * earlier design where a build-time table was consulted per request, because anything new would
 * silently drop out of every line. Nothing here may become load-bearing that way.
 *
 * WHERE jev IS USED, AND WHERE IT DELIBERATELY IS NOT — this split came out of probing it:
 *   ✅ Assigning a model string to one of N proposed lines. Measured 9/9, including "Alpine Loop"
 *      -> apple-watch (it is a watch band).
 *   ✅ Confirming ONE proposed pair is the same product. Measured 4/4: "S8" vs "Series 8" 0.95,
 *      "SE 2" vs "SE 2022" 0.93, and correctly SEPARATED "17 Pro" vs "17 Pro Max" (0.04).
 *   ⛔ Judging whether a product is real or new. It scored "iPhone 17 Pro Max" 0.19 and "MacBook
 *      Air" 0.98 — its training predates the lineup. Nothing about recency is asked of it.
 *   ⛔ DISCOVERING pairs to merge. Similarity is not transitive: a vague "AirPods Pro" scores
 *      "same" against both "Pro 2" and "Pro 3", so union-find over pairwise scores re-merges what
 *      jev itself separated at 0.05. Candidates are proposed deterministically by `modelKey` and
 *      by year/integer collision; jev only ever confirms a specific pair.
 */
import { config } from 'dotenv'
import { writeFileSync, mkdirSync } from 'node:fs'
import { splitModel, modelKey } from '../src/lib/model-lineage'
import type { PrismaClient } from '../src/generated/prisma/client'

config({ path: '.env', quiet: true })
config({ path: '.env.local', quiet: true })

const API = 'https://api.typesafe.ai/v1/systemone'
const MODEL = process.env.TYPESAFE_DECISIONS_MODEL?.replace(/^~?typesafe\//, '') || 'jev-latest'
const KEY = process.env.TYPESAFE_API_KEY
/** jev calls are independent; the wall-clock at 4,832 strings is the whole cost of this script. */
const CONCURRENCY = 8
const SAME = 0.8 // a proposed merge must clear this to be applied

let db: PrismaClient

type Answers = Record<string, { noul?: number; choice?: string }>

async function ask(state: unknown, questions: unknown, tries = 3): Promise<Answers | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, state, questions }),
      })
      if (res.ok) return (await res.json()).answers as Answers
      // ⚠️ A 429 IS NOT A VERDICT. Retrying matters here in a way it did not in the demand
      // engine: a dropped call there costs one match, a dropped call here silently leaves a
      // product line out of the generated table for everyone, until someone regenerates it.
      if (res.status !== 429 && res.status < 500) return null
    } catch { /* network flake — fall through to the backoff */ }
    await new Promise((r) => setTimeout(r, 400 * 2 ** i))
  }
  return null
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++
      out[k] = await fn(items[k])
    }
  }))
  return out
}

/**
 * Propose candidate line names from token-prefix frequency.
 *
 * ⚠️ LONGEST-FIRST WITH A COVERAGE TEST, because the obvious "most common prefix wins" picks
 * "Galaxy" and buries Fold, Flip, Tab and Watch under one line. A longer prefix is preferred
 * whenever it still covers two or more distinct models — that is what keeps "Galaxy Z Fold"
 * separate from "Galaxy S", and "Apple Watch SE" from "Apple Watch Series". A reviewer predicted
 * SE 2 / Ultra 2 / Series 2 would collapse into one bucket; they do, but only if this function
 * stops at "Apple Watch", which is exactly what it is written to avoid.
 */
/** True when the brand legitimately owns a line with this name (Apple owns "iPhone"). */
const OWNS: Record<string, RegExp> = {
  apple: /^(iphone|ipad|macbook|airpods|apple watch|apple|airtag|mac|studio|magic|imac)/i,
  samsung: /^galaxy/i,
}

function candidateLines(models: string[], brand = ''): string[] {
  const brandOwns = (p: string) => OWNS[brand]?.test(p) ?? false
  /** lowercase key -> the spelling to show, so folding case does not also lose it. */
  const display = new Map<string, string>()
  const count = new Map<string, Set<string>>()
  for (const m of models) {
    const toks = m.replace(/\s+/g, ' ').trim().split(' ')
    for (let n = 1; n <= Math.min(4, toks.length); n++) {
      let p = toks.slice(0, n).join(' ')
      /**
       * ⛔ SPLIT INSIDE THE LAST TOKEN AT THE LETTER/DIGIT SEAM, OR SAMSUNG LOSES ITS FLAGSHIP.
       * "Galaxy S26 Ultra" tokenises to ["Galaxy","S26","Ultra"], so the 2-token prefix is
       * "Galaxy S26" — rejected by the no-digit rule below — and "Galaxy S" can never form from
       * whole tokens. Measured on the first generated table: samsung had Z Fold, Z Flip, Tab A,
       * Watch, Buds and Note, and NO "Galaxy S" at all, so every S25/S26 fell into a generic
       * "Galaxy" bucket. Both commit reviewers caught it independently.
       */
      const seam = toks[n - 1]?.match(/^(\p{L}+)\d+$/u)
      if (seam) {
        const stem = toks.slice(0, n - 1).join(' ')
        /**
         * ⚠️ NOT WHEN THE STEM IS ALREADY A WHOLE MODEL. "MacBook Air M3" and "iPad Air M2" split
         * to "MacBook Air M" / "iPad Air M" on the first run — the M is a CHIP, not a series, and
         * it fragmented a real line in two. "MacBook Air" and "iPad Air" exist as model strings in
         * their own right; "Galaxy" and "Galaxy Tab" do not, which is exactly the difference. So
         * the seam only applies where the stem is not itself a product.
         */
        if (models.some((m) => m.toLowerCase() === stem.toLowerCase())) continue
        p = [...toks.slice(0, n - 1), seam[1]].join(' ')
      }
      // A one- or two-character line name ("M", "T") is a SKU fragment, not a product line.
      if (p.trim().length < 3) continue
      /**
       * ⛔ A LINE NAME CONTAINS NO NUMBER ANYWHERE, not merely no number at the END. Guarding only
       * the last token produced "iPhone 17 Pro", "iPhone 16 Pro" … as twelve separate LINES on the
       * first real run, because each covers two models ({17 Pro, 17 Pro Max}) and the longest-wins
       * rule then preferred them over "iPhone". A generation is exactly the part that varies, so
       * any candidate carrying one has cut the tree at the wrong level. This also kills the spec
       * forms "iPad Air 11 inch" and "iPad Pro 11inch".
       */
      if (/\d/.test(p)) continue
      // ⚠️ Fold case here or the catalogue's own inconsistency becomes two lines: "iPad Mini" and
      // "iPad mini" are both live values on Apple today.
      const key = p.toLowerCase()
      if (!count.has(key)) count.set(key, new Set())
      count.get(key)!.add(m)
      if (!display.has(key)) display.set(key, p)
    }
  }
  /**
   * ⚠️ DROP LINES THAT NAME ANOTHER BRAND'S PRODUCT. 117 accessory rows carry the device they FIT
   * in `model` ("Baseus … model: iPhone 12"), which handed Samsung an "iPhone" and an "iPad" line.
   * Under an accessory brand that is useful — Spigen -> iPhone 17 is how you shop for a case — but
   * under a rival handset maker it is nonsense.
   */
  const FOREIGN = /^(iphone|ipad|macbook|airpods|apple watch|galaxy)\b/i
  /**
   * ⚠️ A LINE NAME IS A NOUN, NOT A SENTENCE FRAGMENT. Prefix frequency alone shipped "The"
   * (kmore), "Gravity:" (dfrobot, colon included) and "New Gen" (Apple) as product lines — they
   * are common words that happen to start several titles. A line must be wordlike, must not end
   * in punctuation, and must not be one of the filler words a catalogue string starts with.
   */
  const JUNK = /^(the|new|gen|for|with|and|set|bo|combo|chinh hang|genuine|original)$/i
  const viable = [...count.entries()]
    .filter(([, s]) => s.size >= 2)
    .filter(([p]) => !(FOREIGN.test(p) && !brandOwns(p)))
    .filter(([p]) => {
      const d = display.get(p) ?? p
      if (/[^\p{L}\p{N}\s.+-]/u.test(d)) return false        // "Gravity:" — punctuation is not a line
      const words = d.split(/\s+/)
      // ⚠️ THE LAST WORD DECIDES. A word-count guard let "iPad New Gen" through at three words;
      // a line ending in "Gen"/"New"/"For" is a truncated title, not a product line.
      if (JUNK.test(words[words.length - 1]) || (words.length <= 2 && words.some((w) => JUNK.test(w)))) return false
      return true
    })
  // Keep a shorter prefix only where no longer one already covers its models.
  const byLen = viable.sort((a, b) => b[0].length - a[0].length)
  const taken = new Set<string>()
  const lines: string[] = []
  for (const [p, models_] of byLen) {
    const fresh = [...models_].filter((m) => !taken.has(m))
    if (fresh.length >= 2) {
      lines.push(display.get(p) ?? p)
      for (const m of models_) taken.add(m)
    }
  }
  return lines.sort((a, b) => b.length - a.length).slice(0, 24)
}

type BrandLineage = { lines: string[]; aliases: Record<string, string> }

async function buildBrand(brand: string, models: string[]): Promise<BrandLineage> {
  const cands = candidateLines(models, brand)
  if (!cands.length) return { lines: [], aliases: {} }

  // ── jev assigns each model string to one candidate line ───────────────────
  const criteria: Record<string, string> = Object.fromEntries(cands.map((c) => [c, `the ${c} product line`]))
  criteria.other = 'none of these lines'
  const votes = await pool(models, CONCURRENCY, async (m) => {
    const a = await ask({ brand, model_string: m, candidate_lines: cands },
      { line: { type: 'choice', instructions: 'Which product line does this model belong to? Pick the MOST SPECIFIC line that fits.', criteria } })
    return { m, line: a?.line?.choice ?? 'other', failed: a === null }
  })
  /**
   * ⛔ AN API OUTAGE MUST NOT QUIETLY PRODUCE AN EMPTY TABLE. `ask` returns null on failure and
   * every vote then defaults to "other", so with Typesafe down this function would return zero
   * lines for every brand and the script would cheerfully overwrite the generated file with a
   * table that disables the whole feature — green, silent, and wrong. A quarter failing is enough
   * to stop.
   */
  const failed = votes.filter((v) => v.failed).length
  if (failed > models.length / 4) {
    throw new Error(`${brand}: ${failed}/${models.length} jev calls failed — refusing to emit a degraded table`)
  }

  // A line earns its place by holding two or more models; a line of one is a column with a single
  // row in it, which is a worse experience than not drilling at all.
  const held = new Map<string, number>()
  for (const v of votes) if (v.line !== 'other') held.set(v.line, (held.get(v.line) ?? 0) + 1)
  let lines = cands.filter((c) => (held.get(c) ?? 0) >= 2)

  /**
   * ⛔ A LETTER GENERATION IS NOT A LINE. The first real run put "iPhone Xr", "iPhone Xs" and
   * "iPhone Xs Max" in the line column as siblings of "iPhone": the no-digits rule above cannot
   * see that "Xr" is a generation, because it has no digit in it.
   *
   * ⚠️ AND THE TEST IS "DOES IT HAVE ITS OWN NUMBERED GENERATIONS", NOT A JUDGEMENT. jev was asked
   * this first — "is X a distinct line or a generation within Y" — and answered a reasonable
   * taxonomy question rather than the one that matters: it demoted "Apple Watch Series" into
   * "Apple Watch" and "AirPods Pro" into "AirPods", which is defensible as naming and terrible as
   * a picker, because every Series 1-12 then collapses to the variant level and the
   * newest-first column empties out. Structure answers it exactly and for free:
   *   · "Apple Watch Series" has Series 1..12 under it -> a line.
   *   · "AirPods Pro"        has Pro 1..3 under it    -> a line.
   *   · "iPhone Xr"          has nothing numbered     -> a generation of iPhone.
   * Using a model where the data already decides is how the SE-2022 sort bug got in.
   */
  const numberedChildren = (cand: string) => models.filter((m) => {
    if (!m.toLowerCase().startsWith(cand.toLowerCase())) return false
    return /^\s*\d/.test(m.slice(cand.length))
  }).length
  const demoted = new Set(lines.filter((long) => lines.some((short) =>
    short !== long
    && long.toLowerCase().startsWith(short.toLowerCase() + ' ')
    && numberedChildren(long) < 2)))
  lines = lines.filter((l) => !demoted.has(l))

  // ── merge candidates: deterministic first, jev only to confirm ────────────
  const aliases: Record<string, string> = {}
  const byKey = new Map<string, string[]>()
  for (const m of models) {
    const k = modelKey(m)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(m)
  }
  // Same deterministic key = same product, no judgement needed. Canonical = the longest spelling,
  // which is the one a human wrote out in full ("Apple Watch Series 8" over "Apple Watch S8").
  for (const group of byKey.values()) {
    if (group.length < 2) continue
    /**
     * ⚠️ TIE-BREAK ON CASING, NOT JUST LENGTH. "Zflip 4" and "zflip 4" are the same length, so a
     * pure length sort picked whichever the DB happened to return first and canonicalised Samsung
     * onto the lowercase spelling. Longest wins, then the one that looks like a product name.
     */
    const canon = [...group].sort((a, b) =>
      b.length - a.length || Number(/^[A-Z]/.test(b)) - Number(/^[A-Z]/.test(a)) || a.localeCompare(b))[0]
    for (const m of group) if (m !== canon) aliases[m] = canon
  }

  /**
   * ⚠️ THE YEAR/INTEGER PAIRS ARE THE ONLY THING jev IS ASKED TO MERGE, and they are proposed by
   * collision inside ONE line, never by similarity across the brand. "Apple Watch SE 2022" and
   * "Apple Watch SE 2" are offered; "iPhone 17 Pro" and "iPhone 17 Pro Max" never are, because
   * neither is a year form. That structural restriction is what keeps this O(n) and keeps
   * non-transitivity out of it.
   */
  const parsed = models.map((m) => ({ m, p: splitModel(m, lines) }))
  const proposals: [string, string][] = []
  for (const y of parsed.filter((x) => x.p.genIsYear && !aliases[x.m])) {
    for (const s of parsed.filter((x) => !x.p.genIsYear && x.p.gen !== null && x.p.line === y.p.line && !aliases[x.m])) {
      proposals.push([y.m, s.m])
    }
  }
  const confirmed = await pool(proposals, CONCURRENCY, async ([a, b]) => {
    const r = await ask({ brand, a, b },
      { same: { type: 'noul', instructions: 'Do these two strings name the SAME product, one written with its release year and the other with its generation number?' } })
    return { a, b, score: r?.same?.noul ?? 0 }
  })
  // Highest-scoring partner only, so a year form cannot be merged into two different generations.
  const best = new Map<string, { b: string; score: number }>()
  for (const c of confirmed) {
    if (c.score < SAME) continue
    const prev = best.get(c.a)
    if (!prev || c.score > prev.score) best.set(c.a, { b: c.b, score: c.score })
  }
  for (const [a, { b }] of best) aliases[a] = b

  return { lines, aliases }
}

async function main() {
  const argv = process.argv
  const only = argv.includes('--brands') ? argv[argv.indexOf('--brands') + 1].split(',') : null
  const dry = argv.includes('--dry')
  if (!KEY) throw new Error('TYPESAFE_API_KEY missing — it lives in .env.local')
  db = (await import('../src/lib/db')).db

  const rows = await db.$queryRaw<{ brandSlug: string; model: string }[]>`
    SELECT DISTINCT l."brandSlug", l.model
    FROM "Listing" l JOIN "Category" c ON c.id = l."categoryId"
    WHERE l.verified AND l.status = 'active' AND l."listingType" = 'sell'
      AND c.slug = 'electronics' AND l.model IS NOT NULL AND l."brandSlug" IS NOT NULL
      AND l."brandSlug" <> ''`

  const byBrand = new Map<string, string[]>()
  for (const r of rows) {
    if (only && !only.includes(r.brandSlug)) continue
    if (!byBrand.has(r.brandSlug)) byBrand.set(r.brandSlug, [])
    byBrand.get(r.brandSlug)!.push(r.model)
  }
  // A brand with one or two models has no hierarchy worth drilling into.
  const work = [...byBrand.entries()].filter(([, m]) => m.length >= 4).sort((a, b) => b[1].length - a[1].length)
  console.log(`${work.length} brand(s), ${work.reduce((n, [, m]) => n + m.length, 0)} distinct model strings\n`)

  const out: Record<string, BrandLineage> = {}
  let done = 0
  for (const [brand, models] of work) {
    const r = await buildBrand(brand, models)
    done++
    if (r.lines.length) {
      out[brand] = r
      console.log(`${String(done).padStart(3)}/${work.length} ${brand.padEnd(18)} ${String(models.length).padStart(4)} models -> ${r.lines.length} lines, ${Object.keys(r.aliases).length} aliases`)
      if (only) for (const l of r.lines) console.log(`        · ${l}`)
    } else {
      console.log(`${String(done).padStart(3)}/${work.length} ${brand.padEnd(18)} ${String(models.length).padStart(4)} models -> no lines`)
    }
  }
  if (only) for (const [b, r] of Object.entries(out)) for (const [a, c] of Object.entries(r.aliases)) console.log(`  alias ${b}: "${a}" -> "${c}"`)

  if (dry) { console.log('\n--dry: nothing written'); await db.$disconnect(); return }

  mkdirSync('src/generated', { recursive: true })
  writeFileSync('src/generated/model-lineage.ts', `/**
 * GENERATED by scripts/build-model-lineage.ts — do not edit by hand.
 *
 * Per-brand product lines derived from the model strings in the live catalogue, plus the alias
 * map that folds a catalogue's spelling variations ("Apple Watch S8" -> "Apple Watch Series 8")
 * onto one canonical string.
 *
 * ⛔ THIS FILE IMPROVES \`splitModel\`, IT DOES NOT GATE IT. A model string absent from here still
 * resolves — to a generically-parsed line instead of a curated one. That is deliberate: an
 * earlier design consulted a table like this per request and would have silently dropped every
 * string imported after the last deploy.
 */
export type BrandLineage = { lines: string[]; aliases: Record<string, string> }

export const MODEL_LINEAGE: Record<string, BrandLineage> = ${JSON.stringify(out, null, 2)}

/**
 * Curated lines for a brand, or [] — never undefined, so callers cannot forget the empty case.
 * ⚠️ \`Object.hasOwn\` GUARDS BOTH LOOKUPS. These are plain object literals, so a brand or model
 * string of "constructor" or "__proto__" would otherwise return a Function off the prototype and
 * blow up at the call site rather than missing cleanly.
 */
export function linesFor(brandSlug: string | null | undefined): string[] {
  if (!brandSlug || !Object.hasOwn(MODEL_LINEAGE, brandSlug)) return []
  return MODEL_LINEAGE[brandSlug].lines
}

/** The canonical spelling of a model string, or the string itself when nothing is folded onto it. */
export function canonicalModel(brandSlug: string | null | undefined, model: string): string {
  if (!brandSlug || !Object.hasOwn(MODEL_LINEAGE, brandSlug)) return model
  const { aliases } = MODEL_LINEAGE[brandSlug]
  return Object.hasOwn(aliases, model) ? aliases[model] : model
}
`)
  console.log(`\n${Object.keys(out).length} brands -> src/generated/model-lineage.ts`)
  await db.$disconnect()
}

main().catch(async (e) => { console.error(e); await db?.$disconnect(); process.exit(1) })
