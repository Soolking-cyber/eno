// Harvest every static UI string the app renders and write them to a bundled
// TS file. The language provider warms ALL of these in ONE batch on language
// change (then caches to localStorage), so the in-language swap is instant
// instead of dozens of lazy /api/translate round-trips. Re-run when UI copy
// changes:  node scripts/gen-ui-strings.mjs

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...walk(p))
    else if (/\.(tsx|ts)$/.test(e) && !p.includes('generated')) out.push(p)
  }
  return out
}

/**
 * ⚠️ TWO CATALOGUES, SPLIT BY WHERE THE STRING CAME FROM.
 *
 * eno.vn is a licensed sàn TMĐT and may not surface visa or itinerary services — and this catalogue
 * is shipped to the browser to pre-warm translations, so a single combined file put 26 e-Visa
 * strings ("Download e-Visa PDF", "Open the e-Visa chat", the passport wizard copy) into every
 * marketplace client. Nothing rendered them; they were simply in the artifact, which is the standard
 * this split is held to.
 *
 * A string is SERVICES-ONLY when every file it was found in is a services surface. One appearance in
 * a shared file makes it core — that direction is deliberate: wrongly calling a string core costs a
 * few bytes, wrongly calling it services-only means an untranslated label on eno.forum.
 */
const SERVICES_SOURCES = [
  'src/app/vietnam-evisa/', 'src/app/itinerary/', 'src/app/services-for-expats-vietnam/',
  'src/app/dashboard/visa/', 'src/app/dashboard/trips/', 'src/app/admin/visas/', 'src/app/admin/trips/',
  'src/app/api/visa/', 'src/app/api/trips/', 'src/app/api/itineraries/', 'src/app/api/admin/trips/',
  'src/lib/visa/', 'src/lib/trips/', 'src/lib/itinerary-',
  'src/components/marketplace/visa-cards', 'src/components/marketplace/trip-cards',
  'src/components/itinerary/', 'src/components/marketplace/visa-start',
  // eno.forum's home banner. Same trap as cross-site-promo below: the PATH looks shared
  // (`src/lib/promo-slides-*`, right beside the marketplace's own slides) while the copy is
  // services-only. Without this line its strings are harvested into ui-strings.ts, which eno.vn
  // ships to every browser and pays Google to translate.
  'src/lib/promo-slides-services',
  /**
   * ⛔ THE PAYMENT SURFACES, ADDED AFTER MEASURING THE LEAK RATHER THAN BEFORE. eno.vn is
   * deliberately paymentless, and the checkout and payout copy — "Scan to pay", "Transfer note",
   * "Account holder name" — was harvested straight into the SHARED catalogue and shipped in the
   * marketplace client bundle. The pages themselves are `.svc.` and never compile there; their
   * STRINGS travelled separately, through this file, which is precisely the trap the two comments
   * below record for other surfaces. Grep a marketplace build for the copy, not for the route.
   * ⚠️ THE CLIENT COMPONENTS ARE PLAIN `.tsx` because only a ROUTE can carry `.svc.` — so their
   * paths look shared and nothing but these lines says otherwise.
   */
  'src/app/checkout/', 'src/app/dashboard/payout/', 'src/app/dashboard/wallet/', 'src/app/api/wallet', 'src/app/api/seller/payout',
  /**
   * ⚠️ THE CROSS-SITE PROMO IS SERVICES-ONLY EVEN THOUGH ITS PATH LOOKS SHARED, and this line is
   * the only thing that says so. Every other entry above is recognisably a visa/trip surface;
   * `src/components/marketplace/cross-site-promo.tsx` sits among the shared components and its
   * copy — "Already in Vietnam? Find housing, jobs and motorbikes on eno.vn" — contains no
   * services vocabulary at all, so nothing about it looks like it belongs here.
   *
   * It belongs here because of WHERE it renders, not what it says. The component introduces eno.vn
   * to eno.forum's visitors, is aliased away on a marketplace build (next.config.ts), and would
   * otherwise put a pitch for eno.vn into `ui-strings.ts` — the catalogue eno.vn itself ships to
   * every browser. The alias cannot catch that: the leak would be through a GENERATED file the
   * component never imports and nothing links back to it.
   *
   * ⚠️ IT IS A PREFIX, SO IT COVERS `cross-site-promo.stub.tsx` TOO. That is correct and not an
   * accident — the stub must stay wordless, and a stub that ever gained copy would at least not
   * also get it harvested into the shared catalogue.
   */
  'src/components/marketplace/cross-site-promo',
]
const isServicesFile = (f) => {
  const rel = f.split('\\').join('/')
  return SERVICES_SOURCES.some((d) => rel.startsWith(d))
}

/** string -> true when EVERY file it appeared in is a services surface. */
const origin = new Map()
let currentFile = ''
const strings = new Set()
const add = (s) => {
  if (!(s && s.trim() && s.length <= 400 && /[a-zA-Z]/.test(s))) return
  const v = s.trim()
  strings.add(v)
  const svc = currentFile ? isServicesFile(currentFile) : false
  origin.set(v, origin.has(v) ? (origin.get(v) && svc) : svc)
}
const unesc = (s) => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`')

for (const file of walk('src')) {
  currentFile = file
  const src = readFileSync(file, 'utf8')
  // EN dictionary values (the t(key) strings)
  if (file.endsWith('language-context.tsx')) {
    const enBlock = src.split('const EN:')[1]?.split('const VI:')[0] || ''
    for (const m of enBlock.matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)) add(unesc(m[1]))
  }
  // tr('English', ...) — first arg is the English source
  for (const m of src.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)) add(unesc(m[1]))
  for (const m of src.matchAll(/\btr\(\s*"((?:[^"\\]|\\.)*)"/g)) add(unesc(m[1]))
  // t('A','B') delegated helpers — capture both args
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)) { add(unesc(m[1])); add(unesc(m[2])) }
  // <Tr text="literal"> / <Tr text={'literal'}>
  for (const m of src.matchAll(/<Tr\s+text=\{?\s*'((?:[^'\\]|\\.)*)'/g)) add(unesc(m[1]))
  for (const m of src.matchAll(/<Tr\s+text="((?:[^"\\]|\\.)*)"/g)) add(unesc(m[1]))
}
currentFile = '' // everything below is shared copy, never services-only
// price unit suffixes
for (const u of ['month', 'month (est.)', 'hour', 'visit (from)', 'service (from)', 'day', 'year', 'week']) add(u)

// Taxonomy display strings — category/subcategory names, facet labels + option
// labels, listing types, intent shortcuts. These render via <Tr text={variable}>
// or tr(label, labelVi) (category tiles, facet bar, post wizard), so the literal
// scans above never see them; without this block they were NEVER pre-warmed and
// depended entirely on the lazy paid path (2026-07-06 i18n audit — the partially
// English RU homepage). Harvest the EN display fields by regex.
//
// ⚠️ MORE THAN ONE FILE. taxonomy.ts no longer owns every taxonomy word: the seven
// e-visa processing-speed labels live in src/lib/visa/speed.ts (VISA_SPEED_SPECS),
// which taxonomy.ts IMPORTS to build the `visaSpeed` facet options rather than
// restating them — so a taxonomy-only scan silently missed real chip copy and sent
// it down the lazy paid path in all 9 machine-translated languages. Whenever
// taxonomy display copy is deduplicated out of taxonomy.ts, add its file here.
//
// Why this stays English-only: the shape is `name`/`label` immediately followed by
// `:`, so `nameVi:` / `labelVi:` never match (the `Vi` sits between the word and the
// colon). The inline Vietnamese is the translation SOURCE's counterpart, not a
// target — letting it into this batch would ask the translator to render Vietnamese
// into Vietnamese and would poison the cache keyed on English.
// ⚠️ `titleEn` IS IN THE ALTERNATION FOR why-eno.tsx, AND IT IS HERE BECAUSE OF A NEAR-MISS.
// The home page's "Why eno" row holds its five claims in a `REASONS` table and renders them with
// `tr(r.titleEn, r.titleVi)` — a variable call, so the literal scans above never saw a single one
// of them. Four had therefore NEVER been pre-warmed. The fifth, "Trust scores you can check", was
// in the catalogue purely by accident: the product page happened to render the SAME sentence as a
// literal `<Tr text=…>`, and harvesting that one copy covered its twin. Deleting that product-page
// line on 2026-08-08 dropped the string, and two independent reviewers read the result as a fresh
// regression. It was not fresh — it was the accident ending, which is the more useful finding.
//
// Vietnamese is unaffected either way (`tr()` returns the inline `titleVi` directly); the cost lands
// on the ~11 machine-translated languages, which fall back to a per-string /api/translate plus a
// repaint — English text that flips a beat later, on the home page's first screen.
//
// Harvesting `titleEn` and NOT `titleVi` is the same rule the name/label pair follows: the inline
// Vietnamese is the source's counterpart, not a target, and feeding it to the translator would ask
// for Vietnamese→Vietnamese and poison a cache keyed on English.
// ⚠️ EACH FILE CARRIES ITS OWN FIELD LIST — DO NOT COLLAPSE THIS INTO ONE SHARED ALTERNATION.
// A reviewer caught the first version doing exactly that: `titleEn` was applied to every path in
// the loop, including `src/lib/visa/speed.ts`. Nothing breaks today (that file has no `titleEn`),
// but this block sets `currentFile = ''`, which means everything harvested here is classified CORE
// unconditionally — it BYPASSES the services-origin classifier that keeps visa vocabulary out of
// the catalogue eno.vn ships to browsers. Widening a pattern here widens that bypass. Keep each
// file's fields to the minimum that file actually needs.
//
// ⚠️ PRE-EXISTING AND WORTH KNOWING: the seven `VISA_SPEED_SPECS` labels are ALREADY in the shared
// catalogue for this reason ("Within 1 hour", "2 working days", "Standard" — verified 2026-08-08).
// They are harmless in substance, which is exactly why nobody noticed: they are generic time
// phrases with no visa vocabulary, unlike the "Download e-Visa PDF" class the split was built for.
// It is a latent classification hole, not a live leak — but if visa copy with real vocabulary is
// ever deduplicated into a file listed here, it ships to eno.vn silently.
const VARIABLE_RENDERED_COPY = [
  // Taxonomy display copy — rendered via <Tr text={variable}> / tr(label, labelVi).
  ['src/lib/taxonomy.ts', ['name', 'label']],
  ['src/lib/visa/speed.ts', ['name', 'label']],
  // ⚠️ why-eno.tsx WAS HERE AND THE FILE IS GONE (deleted 2026-08-13, commit 357c1c27, as an
  // orphaned component with zero importers). Its row stayed behind and made this generator throw
  // ENOENT on every run — which matters more than a dead row, because the PostToolUse hook that
  // keeps src/generated/ui-strings.ts in sync IS this script. A crashing generator stops
  // regenerating silently, and the drift only surfaces later as a red CI drift-guard on a file
  // nobody edited (CLAUDE.md documents that failure mode).
  // The `titleEn` note above is kept: it records why a bare field name is in the alternation at
  // all, and the next file that renders copy through a variable will need the same treatment.
]
// Every path above must exist — a stale entry here is a silently-stopped generator, not a no-op.
for (const [path] of VARIABLE_RENDERED_COPY) {
  if (!existsSync(path)) {
    console.error(`\n✗ gen-ui-strings: VARIABLE_RENDERED_COPY lists "${path}", which does not exist.\n` +
      `  Remove the row, or restore the file. Leaving it makes this script throw on every run.\n`)
    process.exit(1)
  }
}
for (const [path, fields] of VARIABLE_RENDERED_COPY) {
  const tax = readFileSync(path, 'utf8')
  const f = fields.join('|')
  for (const m of tax.matchAll(new RegExp(`\\b(?:${f})\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'g'))) add(unesc(m[1]))
  for (const m of tax.matchAll(new RegExp(`\\b(?:${f})\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g'))) add(unesc(m[1]))
}

const all = [...strings].sort()
const core = all.filter((v) => !origin.get(v))
const services = all.filter((v) => origin.get(v))

const banner = (what) => `// AUTO-GENERATED by scripts/gen-ui-strings.mjs — do not edit by hand.
// ${what}
// Warmed in one batch per language so the translation swap is instant.
// Re-run the script when UI copy changes.
`

const dest = 'src/generated/ui-strings.ts'
mkdirSync(dirname(dest), { recursive: true })
writeFileSync(dest, banner('Static UI strings shared by BOTH editions.') +
  `export const UI_STRINGS: string[] = ${JSON.stringify(core, null, 2)}\n`)

// ⚠️ SERVICES-ONLY STRINGS LIVE IN THEIR OWN FILE, and next.config.ts aliases this one to an empty
// stub on a marketplace build. That alias is the ONLY thing that keeps the e-Visa vocabulary out of
// eno.vn's client chunks: a runtime `IS_SERVICES ? …` cannot, because the flag is not
// dead-code-eliminated across module boundaries (measured — see src/lib/edition.ts).
const svcDest = 'src/generated/ui-strings.services.ts'
writeFileSync(svcDest, banner('Strings that appear ONLY on services surfaces (visa, itinerary).') +
  `export const UI_STRINGS_SERVICES: string[] = ${JSON.stringify(services, null, 2)}\n`)

console.log(`Wrote ${core.length} shared + ${services.length} services-only UI strings`)
