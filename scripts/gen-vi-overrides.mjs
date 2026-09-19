#!/usr/bin/env node
/**
 * CURATED VIETNAMESE FOR THE WHOLE UI STRING SET, TRANSLATED ON THIS MACHINE AND COMMITTED.
 *
 *   node scripts/gen-vi-overrides.mjs            # fill every gap
 *   node scripts/gen-vi-overrides.mjs --limit 80 # a small slice, for a first look
 *   node scripts/gen-vi-overrides.mjs --dry-run  # report the gap, translate nothing
 *
 * ⛔ WHY THIS EXISTS: THE HOME MARKET WAS PAYING PER PAGE VIEW. `VI_OVERRIDES` covered 428 of the
 * 2,198 UI strings, and `useTr` (src/context/language-context.tsx) falls through to `/api/translate`
 * for anything missing — so Vietnamese visitors, the people this marketplace is FOR, generated
 * machine-translation requests for ~80% of the interface. Owner, 2026-09-19, looking at a Google
 * bill that was 90% Cloud Translation: "hook agy for small translations".
 *
 * ⚠️ agy IS A CLI ON A LAPTOP, NOT A SERVICE THE BOX CAN CALL. That is the whole shape of this fix:
 * the work happens HERE, once, and the OUTPUT is committed. Production ships a static dictionary and
 * makes no translation call for UI copy at all. It is not a cheaper provider; it deletes the request.
 *
 * ⚠️ IT ADDS AND IT REMOVES, BUT IT NEVER RE-TRANSLATES. An existing entry's wording is left exactly
 * as it is — a rerun fills the gap and is therefore resumable — but the licensing filter below is
 * applied to the MERGED set on every write, so a forbidden entry already in the file is dropped even
 * when this run translates nothing. An earlier version of this note claimed the script "only ever
 * adds", which stopped being true the moment the filter gained a removal path.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const DRY = process.argv.includes('--dry-run')
const LIMIT = Number(arg('limit') ?? Infinity)

const SRC = 'src/generated/ui-strings.ts'
const OUT = 'src/generated/vi-overrides.ts'

/** The generated files are literal arrays/objects, so they are parsed as JSON rather than imported
 *  (a .ts module cannot be `import`ed from a .mjs, and the earlier generator in this repo learned
 *  that the hard way — see the note in scripts/gen-category-art.mjs). */
/* ⚠️ ANCHORED ON THE ASSIGNMENT, NOT ON THE FIRST BRACKET. `indexOf('[')` finds the `[]` in the TYPE
   (`UI_STRINGS: string[] = [`) and the parse dies on "unexpected character after JSON" — which reads
   like a corrupt generated file rather than a bad slice. Cut from the `=` that follows the name. */
const literalAfter = (src, name, open, close) => {
  const at = src.indexOf(name)
  if (at < 0) throw new Error(`${name} not found`)
  const eq = src.indexOf('=', at)
  const lit = src.slice(src.indexOf(open, eq), src.lastIndexOf(close) + 1)
  /* ⚠️ TRAILING COMMAS ARE LEGAL TYPESCRIPT AND ILLEGAL JSON, and both generated files carry them.
     Stripped before parsing rather than banned in the writer, so this reads whatever a previous
     generator (or a hand edit) left behind. */
  return JSON.parse(lit.replace(/,(\s*[}\]])/g, '$1'))
}
const readStrings = () => literalAfter(readFileSync(SRC, 'utf8'), 'UI_STRINGS', '[', ']')
const readOverrides = () => literalAfter(readFileSync(OUT, 'utf8'), 'VI_OVERRIDES', '{', '}')

/**
 * ⚠️ BATCHED, AND THE SIZE IS SET BY argv NOT BY TASTE. `agy -p` takes the prompt as an ARGV string,
 * which the OS caps (ARG_MAX) — second-opinion.mjs documents the same limit and the E2BIG failure it
 * produces, where agy silently returns nothing. 40 UI strings is a few KB, far inside the cap, and
 * small enough that one bad batch costs little to redo.
 */
const BATCH = Number(arg('batch') ?? 40)

const PROMPT = (items) => `You are translating UI copy for eno.vn, a second-hand marketplace used by expats and locals in Vietnam.

Translate each English string into natural Vietnamese as it would appear in a polished consumer app.

Rules:
- Return ONLY a JSON object mapping each exact English source string to its Vietnamese translation. No prose, no code fence.
- Keep placeholders such as {count}, {name}, %s, {0} EXACTLY as they appear.
- Keep it short — these are buttons, labels and headings, not sentences to explain.
- Use the informal-but-respectful register Vietnamese marketplaces use (Shopee, Chợ Tốt), not formal/legal Vietnamese.
- Leave brand names (eno, eno.vn, Zalo, PayPal, VietQR) untranslated.
- If a string is already Vietnamese, or is a number/symbol with no words, return it unchanged.

Strings:
${JSON.stringify(items, null, 0)}`

const askAgy = (items) => {
  const out = execFileSync(
    'agy',
    ['-p', PROMPT(items), '--model', 'Gemini 3.8 Flash (High)', '--dangerously-skip-permissions', '--print-timeout', '300s'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  /* ⚠️ THE MODEL SOMETIMES WRAPS THE JSON IN PROSE DESPITE BEING TOLD NOT TO, so the object is cut
     out by braces rather than trusted to be the whole reply. A batch that still will not parse is
     SKIPPED and reported, never half-applied — a partial dictionary is worse than a missing one
     because nothing downstream can tell the difference. */
  const start = out.indexOf('{')
  const end = out.lastIndexOf('}')
  if (start < 0 || end < 0) throw new Error('no JSON object in agy output')
  return JSON.parse(out.slice(start, end + 1))
}

/**
 * ⛔ THE LICENSED-MARKETPLACE FILTER, AND IT IS NOT OPTIONAL. `VI_OVERRIDES` is serialised into the
 * HTML of every `vi` page on BOTH editions, so a visa/itinerary/PayPal string translated in here is
 * published in eno.vn's page source — and eno.vn is a licensed sàn TMĐT that may not surface those
 * services at all. `UI_STRINGS` contains that copy, so the gap this script fills includes it.
 *
 * ⛔ KEYWORDS ALONE ARE NOT ENOUGH, AND THREE REVIEWERS PROVED IT ON THE FIRST VERSION. That version
 * reused the guard's own pattern and still shipped `"Multiple entry": "Nhập cảnh nhiều lần"`,
 * `"Plan my trip in chat"` and the free day-by-day-plan offer — because `nhập cảnh` does not match
 * `xuất nhập cảnh`, and English service copy that never says the word "visa" matches nothing at all.
 * So there are two independent tests and a string is dropped if EITHER fires:
 *   1. VOCABULARY — the guard's terms plus the service phrases that slipped past it, checked against
 *      the English key AND the Vietnamese value (a translation can introduce `hộ chiếu` on its own).
 *   2. PROVENANCE — the string is used ONLY by restricted surfaces (`.svc.`, vietnam-evisa, visa,
 *      itinerary, trips). This is the structural half: it needs no vocabulary to be right.
 *
 * ⚠️ "ONLY", NOT "ANY", AND THE DIFFERENCE WAS MEASURED. Dropping every string that appears anywhere
 * in a restricted file removes 301 entries — "Add", "Apply", "Back", "About" — because a visa page
 * also has buttons. That guts Vietnamese for common UI words and buys no licensing safety. Scoped to
 * strings used exclusively there, it is 13 entries, and they are the right 13.
 */
const FORBIDDEN =
  /visa|itinerar|paypal|thị thực|lịch trình|hộ chiếu|xuất nhập cảnh|nhập cảnh|multiple entry|single entry|plan my trip|day-by-day|machine-readable|passport|chuyến đi/i
const RESTRICTED_SURFACE = /\.svc\.|vietnam-evisa|\/visa\/|visa-|itinerar|\/trips\/|trip-|evisa/i

/** Every source file's text, read once, so provenance is a scan rather than 2,000 greps. */
const sourceFiles = (() => {
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const full = join(d, e)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(full) && !full.includes('/generated/')) out.push([full, readFileSync(full, 'utf8')])
    }
  }
  walk('src')
  return out
})()

/** True when a string appears in source and EVERY file using it is a restricted surface. */
const onlyOnRestrictedSurfaces = (text) => {
  const hits = sourceFiles.filter(([, c]) => c.includes(text)).map(([f]) => f)
  return hits.length > 0 && hits.every((f) => RESTRICTED_SURFACE.test(f))
}

const barred = (k, v = '') => FORBIDDEN.test(k) || FORBIDDEN.test(v) || onlyOnRestrictedSurfaces(k)

const strings = readStrings()
const existing = readOverrides()
const missing = strings.filter((s) => !(s in existing) && !barred(s))

console.log(`${strings.length} UI strings · ${Object.keys(existing).length} already curated · ${missing.length} missing`)
/* ⛔ ONLY `--dry-run` EXITS EARLY. `!missing.length` used to short-circuit here too, and a reviewer
   caught what that costs: once every allowed string is covered there is nothing to translate, so the
   script would exit BEFORE the licensing filter runs over the existing file — leaving a forbidden
   entry in place and reporting success. The filter is applied on WRITE, so the write must always
   happen. A run with nothing to do still has something to check. */
if (DRY) process.exit(0)

const todo = missing.slice(0, Number.isFinite(LIMIT) ? LIMIT : missing.length)
const added = {}
let failed = 0

for (let i = 0; i < todo.length; i += BATCH) {
  const chunk = todo.slice(i, i + BATCH)
  process.stdout.write(`  ${i + 1}–${Math.min(i + BATCH, todo.length)} of ${todo.length} … `)
  try {
    const got = askAgy(chunk)
    let n = 0
    for (const s of chunk) {
      const v = got[s]
      /* ⚠️ ONLY A NON-EMPTY STRING THAT ACTUALLY CHANGED. A model echoing the English back is a MISS,
         not a translation, and storing it would permanently mask the string from the runtime
         fallback — the dictionary would claim coverage it does not have. */
      if (typeof v === 'string' && v.trim() && v.trim() !== s) { added[s] = v.trim(); n++ }
    }
    console.log(`${n}/${chunk.length}`)
  } catch (e) {
    failed += chunk.length
    console.log(`FAILED (${String(e.message).slice(0, 60)})`)
  }
}

/* ⚠️ FILTERED AGAIN ON THE WAY OUT, over the MERGED set — the source-side filter above only screens
   what this run translates, and the file may already hold a forbidden entry from an earlier run or a
   hand edit (it did). Screening both the English key and the Vietnamese value, because the guard
   greps the rendered LINE and a translation can introduce "hộ chiếu" from a key that says passport. */
const merged = Object.fromEntries(
  Object.entries({ ...existing, ...added }).filter(([k, v]) => !barred(k, v)),
)
/* Sorted, so a rerun produces a reviewable diff instead of a reshuffle. */
const keys = Object.keys(merged).sort()
const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(merged[k])},`).join('\n')

writeFileSync(
  OUT,
  `// AUTO-GENERATED hand-quality Vietnamese for the whole UI string set.\n` +
    `// Maps the English source string -> curated Vietnamese. Consulted FIRST for the\n` +
    `// vi language (before any machine translation) by language-context.\n` +
    `// Regenerate with: node scripts/gen-vi-overrides.mjs\n` +
    `export const VI_OVERRIDES: Record<string, string> = {\n${body}\n}\n`,
)

console.log(`\n+${Object.keys(added).length} added · ${keys.length} total · ${failed ? `${failed} failed` : 'no failures'}`)
