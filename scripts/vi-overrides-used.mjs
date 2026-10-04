/**
 * WHICH ENGLISH STRINGS CAN STILL ASK THE VIETNAMESE DICTIONARY FOR A TRANSLATION.
 *
 * Shared by scripts/gen-vi-overrides.mjs, which drops every VI_OVERRIDES entry outside this set, and
 * src/lib/i18n/vi-overrides-unused.guard.test.ts, which fails when such an entry is committed anyway.
 *
 * ⛔ WHY AN UNUSED ENTRY IS NOT HARMLESS. The dictionary is ONE chunk, downloaded whole by every
 * Vietnamese page view (loadViOverrides in src/lib/i18n/mt-client.ts). An entry whose English the code
 * no longer holds is never looked up — and still shipped. Measured 2026-10-03/04: 312 of 2,152 keys
 * were outside the harvested catalogue, and the dead ones included retired CLAIMS eno.vn deliberately
 * stopped making ("No fakes, no bait prices, no wasted trips", "This listing has been physically
 * verified by an eno.vn agent. Photos, location, and price are 100% accurate."). Unrendered is not
 * unpublished: the chunk is a public URL.
 *
 * ⚠️ THE SET IS WIDER THAN src/generated/ui-strings.ts, AND IT HAS TO BE. That catalogue is the harvest
 * of LITERAL tr()/<Tr> calls and cannot see copy that reaches <Tr> through a prop:
 * `<ContentSection title="At a glance">` renders `<Tr text={title}>` inside content-page.tsx, so
 * /about's heading is translated by this dictionary while appearing in no catalogue (37 kept keys are
 * held only as a literal, measured 2026-10-04). Pruning to the catalogue alone would have flipped those
 * headings back to English. So a key is USED when it is
 *   1. in the harvested catalogue, core or services (UI_STRINGS + UI_STRINGS_SERVICES — the price-unit
 *      words the harvester injects itself exist nowhere else), or
 *   2. a string literal, a template literal without `${}`, or JSX text in a SHIPPED source file. The
 *      dictionary is keyed on exact English, and code can only hold a fixed English string as a
 *      literal somewhere. This over-keeps on purpose ("verified" stays because a status is compared
 *      against it): spare bytes are the cheap direction, a Vietnamese heading turning English the
 *      dear one; or
 *   3. in STORED_VALUE_KEYS below — copy that reaches <Tr> as DATA, not as a literal.
 *
 * ⚠️ READ WITH THE TYPESCRIPT PARSER, NOT A REGEX OR A SUBSTRING SCAN — a comment is not a use. The
 * comments that record a removal quote the removed wording ("Active account" WAS REMOVED…), so a text
 * scan keeps exactly the entries this exists to drop; and a regex comment-stripper cuts `//` inside a
 * string (the trap src/app/[lang]/safety/safety-copy.test.ts records).
 *
 * ⚠️ TESTS AND FIXTURES ARE NOT SHIPPED SOURCE. A test quotes retired copy to assert it is GONE, and
 * counting that would keep the retired entry alive on the strength of the test guarding its removal.
 *
 * ⚠️ NOT SEEN, AND ACCEPTED: a key assembled at runtime (string concatenation, a template with `${}`). It
 * has no literal to find. A dropped entry of that kind degrades to machine translation, not to a blank —
 * and model-cascade.tsx already rules template-literal keys out for the harvester's sake. (Checked for
 * the 2026-10-04 prune: no source builds any dropped key — the old price chips "Under ₫10M", "₫2M+"
 * included — and 565 of 567 prerendered Vietnamese HTML/RSC files came out byte-identical, the other two
 * differing only in their build-time fetch timestamp.)
 *
 * ⚠️ IT IS AN UPPER BOUND, NOT A CALL GRAPH. "Used" here means "still held as a fixed string somewhere
 * the dictionary could be asked for it", so a key survives on an unrelated literal ("verified", a status
 * value). The guard therefore proves the opposite direction exactly — nothing in the file is a string
 * the code no longer holds at all — which is the direction retired copy fails.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'

/**
 * ⛔ STORED VALUES THAT ARE RENDERED THROUGH <Tr>, KEPT ALTHOUGH NO LITERAL HOLDS THEM.
 *
 * The listing page renders a listing's free-text `condition` and its unlabelled attribute VALUES as
 * `<Tr text={…}>` (src/app/[lang]/listings/[id]/(pdp)/page.tsx — the Condition row and the Details
 * list), so a value a listing STORES is looked up here exactly like UI copy. `condition` is free text
 * in the database (facet-counts.ts buckets 'Like New', 'Good', 'fair' as they come; prisma/seed.ts
 * writes 'Good'), and these keys are the old taxonomy's option labels — the shape a listing posted or
 * imported under that taxonomy would have stored. Dropping one would turn such a listing's Vietnamese
 * row back into English.
 *
 * ⚠️ UNMEASURED, SO KEPT. Whether any listing still stores them is a database question, and the
 * read-only query that answers it was not run when this list was written (2026-10-04). Run it; every
 * key it finds no row for can be deleted here, after which `node scripts/gen-vi-overrides.mjs --prune`
 * drops its entry:
 *   SELECT condition, count(*) FROM "Listing" WHERE condition = ANY($1) GROUP BY 1;
 *   SELECT k, count(*) FROM "Listing", unnest($1::text[]) k
 *     WHERE attributes LIKE '%' || to_json(k)::text || '%' GROUP BY 1;   -- $1 = this list
 */
export const STORED_VALUE_KEYS = [
  // condition
  'Like New', 'Good', 'Fair', 'New / Like New', 'Used / Pre-owned',
  // attribute values
  '1 Bedroom', '2 Bedrooms', '3+ Bedrooms', '3+ BR', '4+ BR', 'Studio Room',
  'Fully Furnished', 'Partially / Unfurnished', 'Manual / Semi-Auto',
  'Fabric', 'Fabric / Cushion', 'Wood (Oak/Teak)', 'Under Active Warranty', 'English Required',
  'Available', 'N/A',
]

/**
 * ⚠️ THE t() DICTIONARIES ARE SOURCE, BUT THEIR VALUES ARE NOT LOOKUPS HERE. `t(key)` resolves through
 * STATIC[lang][key] (src/lib/i18n/static-dicts.ts) and never consults VI_OVERRIDES, so an English
 * VALUE in that file is no reason to keep a dictionary entry. It mattered because that file carried
 * retired claims as values ('Guaranteed real prices and real photos.', 'Your Trusted Vietnam
 * Network.') under keys nothing calls — measured 2026-10-04, only t('header.postBtn') is used — and
 * counting them as uses would have kept those claims in this chunk too. (The claim keys themselves
 * were deleted from static-dicts.ts the same day; the rule stays for whatever that file holds next.)
 */
const NOT_A_LOOKUP = new Set(['src/lib/i18n/static-dicts.ts'])

/** The generated files are literal arrays/objects, so they are parsed as JSON rather than imported
 *  (a .ts module cannot be `import`ed from a .mjs, and the earlier generator in this repo learned
 *  that the hard way — see the note in scripts/gen-category-art.mjs). */
/* ⚠️ ANCHORED ON THE ASSIGNMENT, NOT ON THE FIRST BRACKET. `indexOf('[')` finds the `[]` in the TYPE
   (`UI_STRINGS: string[] = [`) and the parse dies on "unexpected character after JSON" — which reads
   like a corrupt generated file rather than a bad slice. Cut from the `=` that follows the name. */
export const literalAfter = (src, name, open, close) => {
  const at = src.indexOf(name)
  if (at < 0) throw new Error(`${name} not found`)
  const eq = src.indexOf('=', at)
  const lit = src.slice(src.indexOf(open, eq), src.lastIndexOf(close) + 1)
  /* ⚠️ TRAILING COMMAS ARE LEGAL TYPESCRIPT AND ILLEGAL JSON, and both generated files carry them.
     Stripped before parsing rather than banned in the writer, so this reads whatever a previous
     generator (or a hand edit) left behind. */
  return JSON.parse(lit.replace(/,(\s*[}\]])/g, '$1'))
}

/** Shipped = what a build compiles: no generated output, no tests, no test support. */
const isShipped = (rel) =>
  /\.(ts|tsx)$/.test(rel) &&
  !rel.includes('/generated/') &&
  !/\.(test|spec)\.tsx?$/.test(rel) &&
  !rel.startsWith('src/test/') &&
  !/\/__(fixtures|tests|mocks)__\//.test(rel) &&
  !NOT_A_LOOKUP.has(rel)

/* ⚠️ JSX DECODES HTML ENTITIES AND THE PARSER DOES NOT. `title="Price, area &amp; photos"` reaches <Tr> as
   "Price, area & photos", while the node's text keeps the `&amp;`. Every literal containing `&` is
   recorded decoded as well — for a JS string that is over-keeping, the cheap direction. */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', middot: '\u00b7' }
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : ENTITIES[e.toLowerCase()] ?? m)

/** Every fixed string one source file holds, as the parser reads it. Comments never appear here. */
export function literalsOf(text, fileName) {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind)
  const out = []
  const add = (s) => {
    for (const v of s.includes('&') ? [s, decodeEntities(s)] : [s]) {
      out.push(v)
      if (v.trim() !== v) out.push(v.trim())
    }
  }
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text)
    else if (ts.isJsxText(node)) {
      // JSX collapses the whitespace between lines; a child handed on to <Tr> arrives that way.
      const t = node.text.replace(/\s+/g, ' ').trim()
      if (t) add(t)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** Every fixed string in shipped source under `root`/src. */
export function shippedSourceStrings(root = '.') {
  const set = new Set()
  for (const full of walk(join(root, 'src'))) {
    const rel = relative(root, full).split(sep).join('/')
    if (!isShipped(rel)) continue
    for (const s of literalsOf(readFileSync(full, 'utf8'), rel)) set.add(s)
  }
  return set
}

/** The harvested catalogue, both halves (scripts/gen-ui-strings.mjs). */
export function harvestedUiStrings(root = '.') {
  const read = (file, name) => literalAfter(readFileSync(join(root, file), 'utf8'), name, '[', ']')
  return new Set([
    ...read('src/generated/ui-strings.ts', 'UI_STRINGS'),
    ...read('src/generated/ui-strings.services.ts', 'UI_STRINGS_SERVICES'),
  ])
}

/** The English strings a VI_OVERRIDES key must be one of. */
export function usedEnglishStrings(root = '.') {
  const used = shippedSourceStrings(root)
  for (const s of harvestedUiStrings(root)) used.add(s)
  for (const s of STORED_VALUE_KEYS) used.add(s)
  return used
}
