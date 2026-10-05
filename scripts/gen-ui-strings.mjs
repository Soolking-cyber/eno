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
  'src/app/[lang]/vietnam-evisa/', 'src/app/[lang]/itinerary/', 'src/app/[lang]/services-for-expats-vietnam/',
  // The e-visa pages' shared modules, moved out of the route directory 2026-10-01 (see
  // scripts/marketplace-route-prune.mjs). Same surface, new path.
  'src/lib/vietnam-evisa/',
  'src/app/[lang]/dashboard/visa/', 'src/app/[lang]/dashboard/trips/', 'src/app/[lang]/admin/visas/', 'src/app/[lang]/admin/trips/',
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
  'src/app/[lang]/checkout/', 'src/app/[lang]/dashboard/payout/', 'src/app/[lang]/dashboard/wallet/', 'src/app/[lang]/dashboard/payments/', 'src/app/[lang]/dashboard/services/', 'src/app/api/wallet', 'src/app/api/seller/payout',
  /**
   * ⚠️ THE CROSS-SITE PROMO IS SERVICES-ONLY EVEN THOUGH ITS PATH LOOKS SHARED, and this line is
   * the only thing that says so. Every other entry above is recognisably a visa/trip surface;
   * `src/components/marketplace/cross-site-promo.tsx` sits among the shared components and its
   * copy — "Already in Vietnam? Find housing, jobs and furniture on eno.vn" — contains no
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
  if (SERVICES_SOURCES.some((d) => rel.startsWith(d))) return true
  // A `.svc.` module only compiles on the services edition (pageExtensions), so its copy is services-only.
  if (/\.svc\.tsx?$/.test(rel)) return true
  if (!/\.tsx?$/.test(rel)) return false
  /**
   * ⚠️ A MODULE WITH A `.stub` TWIN IS SERVICES-ONLY BY CONSTRUCTION: next.config.ts aliases it to the
   * stub on a marketplace build (edition-services-copy, privacy-services-copy, cross-site-links, …), so
   * its copy never renders on eno.vn and must not ride eno.vn's catalogue either. The authored-pair
   * harvest below reaches these files' `{ en, vi }` tables, which the literal scans never did.
   */
  return !/\.stub\.tsx?$/.test(rel) && existsSync(rel.replace(/\.(tsx?)$/, '.stub.$1'))
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

/**
 * ⚠️ IS THIS THE VIETNAMESE HALF OF A PAIR? The t('A','B') helpers below come in BOTH orders —
 * `t(en, vi)` in most files, `t(vi, en)` in post-wizard.tsx — so the scan used to take both arguments,
 * and ~100 Vietnamese strings ("Lưu thay đổi", "Đăng tin") entered the catalogue as if they were English
 * sources. Each was sent to the translator for nine languages, came back unchanged (the provider is told
 * the source is English), and sat in the DB as a "translation" identical to its source. Nothing renders
 * them — the helpers hand only the English to tr() — so they were pure cost. A string is Vietnamese when
 * at least half its words carry a letter only Vietnamese uses; an English sentence quoting one term
 * ("Listings marked Bán gấp, meaning urgent") stays English.
 */
const VI_ONLY = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i
const viRatio = (s) => {
  const words = s.split(/[^\p{L}]+/u).filter(Boolean)
  return words.length ? words.filter((w) => VI_ONLY.test(w)).length / words.length : 0
}
const looksVietnamese = (s) => viRatio(s) >= 0.5

/**
 * Where an authored pair is UI copy. NOT: tests (fixtures are full of title/titleVi rows), admin and
 * /developers (English-only by convention), API routes, the long-form fixed-language pages, and the legal
 * documents — /regulations is printed in both languages at once and never machine-translated, and the
 * other legal texts translate lazily, on the page that shows them, under an "English is authoritative"
 * note. Nor the place-name tables: a district is never machine-translated (PlaceName's rule).
 */
const PAIR_SCOPE = (f) => {
  const rel = f.split('\\').join('/')
  if (/\.(test|spec)\.|\.stub\./.test(rel)) return false
  if (/^src\/app\/(\[lang\]\/)?(admin|developers)\/|^src\/components\/admin\/|^src\/app\/api\//.test(rel)) return false
  if (/^src\/app\/\[lang\]\/(privacy|terms|regulations|returns|prohibited)\//.test(rel)) return false
  if (/listings-explorer\.constants\.ts$|honeycomb-listing\.ts$|batdongsan|district-|provinces|vn-admin/.test(rel)) return false
  // Server-side trip data (places, booking resources): read by the itinerary API and the .docx export, shown
  // through en/vi `loc()`, never through tr() — ~340 tourist names and blurbs the warm batch would download
  // and pay for in nine languages for nothing.
  if (/^src\/lib\/itinerary-(places|resources)\.ts$/.test(rel)) return false
  return !LONGFORM.has(rel)
}
// The fixed-language article and hub pages — the same files eslint.config.mjs exempts from the i18n gate.
const LONGFORM = new Set(
  // ONLY the i18n gate's ignore list — the block from its banner to its `rules:` — not any path the config names.
  [...(readFileSync('eslint.config.mjs', 'utf8').split('// ── i18n gate')[1]?.split('rules:')[0] ?? '').matchAll(/"(src\/[^"*]+\.tsx)"/g)].map((m) => m[1].replace(/\\\\/g, '')),
)
// The list is read out of eslint.config.mjs's string literals; if that file's shape ever changes, an empty
// set would quietly start warming every article and legal page — refuse instead.
if (LONGFORM.size < 20) {
  console.error(`\n✗ gen-ui-strings: read only ${LONGFORM.size} fixed-language pages out of eslint.config.mjs — its i18n ignore list changed shape.\n`)
  process.exit(1)
}

/**
 * ⛔ THE t(key) DICTIONARY LIVES IN src/lib/i18n/static-dicts.ts. This block used to read it out of
 * language-context.tsx, and when the dictionary moved the harvest went quietly empty — the header's
 * "Free Post" stopped being warmed in every machine-translated language. Only the keys some file
 * actually CALLS are harvested: the dictionary still carries dozens of dead keys, and warming them
 * would pay a translator for words nobody sees.
 */
const tKeys = new Map() // key -> the files that call t(key)
for (const file of walk('src')) {
  if (/\.(test|spec)\./.test(file)) continue // a test's own t('x.y') is not app copy
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/\bt\(\s*'([a-z][\w-]*\.[\w.-]+)'\s*\)/g)) tKeys.set(m[1], [...(tKeys.get(m[1]) ?? []), file])
}
{
  const dicts = readFileSync('src/lib/i18n/static-dicts.ts', 'utf8')
  const enBlock = dicts.split(/export const EN\b/)[1]?.split(/export const VI\b/)[0] || ''
  // Each value is added once PER CALLING FILE, so a key only a services surface calls stays services-only.
  const found = new Set()
  for (const m of enBlock.matchAll(/'([\w.-]+)'\s*:\s*'((?:[^'\\]|\\.)*)'/g)) {
    for (const f of tKeys.get(m[1]) ?? []) { currentFile = f; add(unesc(m[2])); found.add(m[1]) }
  }
  currentFile = ''
  // ⛔ A called key whose English this parse could not read is the silent failure this block exists to end —
  // said out loud, but NOT fatal: this script is the edit hook, and a stray t('x.y') in a comment must not
  // stop it regenerating the catalogue.
  const unread = [...tKeys.keys()].filter((k) => !found.has(k))
  if (unread.length) {
    console.error(`⚠ gen-ui-strings: t() is called with ${unread.join(', ')}, but no single-quoted English value for it was read out of src/lib/i18n/static-dicts.ts — it will not be pre-translated.`)
  }
}

for (const file of walk('src')) {
  currentFile = file
  const src = readFileSync(file, 'utf8')
  // tr('English', ...) — first arg is the English source
  for (const m of src.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)) add(unesc(m[1]))
  for (const m of src.matchAll(/\btr\(\s*"((?:[^"\\]|\\.)*)"/g)) add(unesc(m[1]))
  // t('A','B') delegated helpers — whichever argument is the English one (see looksVietnamese)
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)) {
    // Only the clear-cut case drops a half: one side carries Vietnamese letters and the other carries
    // none ("Lưu thay đổi" / "Save changes"). Anything less certain keeps both, as the scan always did —
    // a wasted translation costs a cent, a dropped English line costs a visitor a flash of English.
    const [a, b] = [unesc(m[1]), unesc(m[2])]
    const [va, vb] = [VI_ONLY.test(a), VI_ONLY.test(b)]
    if (va && !vb) add(b)
    else if (vb && !va) add(a)
    else { add(a); add(b) }
  }
  // <Tr text="literal"> / <Tr text={'literal'}>
  for (const m of src.matchAll(/<Tr\s+text=\{?\s*'((?:[^'\\]|\\.)*)'/g)) add(unesc(m[1]))
  for (const m of src.matchAll(/<Tr\s+text="((?:[^"\\]|\\.)*)"/g)) add(unesc(m[1]))
  // <Bilingual en="literal"> / en={'literal'} — server pages' authored pairs; the nine MT languages
  // translate the English, so it belongs in the warm batch like any tr() literal.
  for (const m of src.matchAll(/<Bilingual\b[^<>]*?\sen=\{?\s*'((?:[^'\\]|\\.)*)'/g)) add(unesc(m[1]))
  for (const m of src.matchAll(/<Bilingual\b[^<>]*?\sen="((?:[^"\\]|\\.)*)"/g)) add(unesc(m[1]))
  if (PAIR_SCOPE(file)) harvestPairs(src)
}

/**
 * ⚠️ AUTHORED PAIRS THAT REACH THE SCREEN THROUGH A VARIABLE. Copy written as `{ en: '…', vi: '…' }`,
 * `{ label: '…', labelVi: '…' }`, `{ labelEn: '…', labelVi: '…' }` — or as a component's
 * `title="…" titleVi="…"` props — is rendered as `tr(x.en, x.vi)` / `<Bilingual en={x.label} …>`, a
 * call the literal scans above cannot see. Vietnamese is unaffected (it is authored), but the nine
 * machine-translated languages used to get each of these through a lazy per-string request and an
 * English flash — or, where the call site picked `lang === 'vi' ? vi : en`, never at all (2026-10-04).
 * The rule is structural, not a file list: a string is harvested when its key has a `…Vi` / `vi`
 * sibling IN THE SAME OBJECT (or the same JSX tag), which is exactly the shape of an authored pair.
 * ⚠️ CAPPED AT 200 CHARACTERS ON PURPOSE. The legal pages hold hundreds of paragraph-long pairs; they
 * translate lazily on the page that shows them, and warming them would add every clause of the privacy
 * policy to the dictionary every machine-translated visitor downloads on their first page.
 */
// A function declaration, not a const: the harvest loop above runs before this line is reached.
function unmask(v) { return v.replace(/\u0001/g, '{').replace(/\u0002/g, '}') }

function harvestPairs(src) {
  const STR = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`
  const pairsIn = (body, sep) => {
    const vals = new Map()
    for (const m of body.matchAll(new RegExp(String.raw`(?:^|[\s,{(])([A-Za-z_]\w*)\s*${sep}\s*(?:${STR})`, 'g'))) {
      const v = m[2] ?? m[3]
      if (v != null && !vals.has(m[1])) vals.set(m[1], unmask(unesc(v)))
    }
    for (const [k, v] of vals) {
      if (!v || v.length > 200 || /^(\/|https?:|mailto:)/.test(v)) continue
      // A language-code table (`{ en: 'en', vi: 'vi', … }`) is not copy — only a code-shaped value equal to its key.
      if (v === k && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(v)) continue
      // A pair whose two halves are identical is a proper noun (a brand, "TikTok") — nothing to translate.
      const twin = k === 'en' ? vals.get('vi') : /En$/.test(k) ? vals.get(k.slice(0, -2) + 'Vi') : vals.get(k + 'Vi')
      if (twin === v) continue
      const english =
        (k === 'en' && vals.has('vi')) ||
        (/En$/.test(k) && vals.has(k.slice(0, -2) + 'Vi')) ||
        (!/(?:Vi|En)$/.test(k) && k !== 'vi' && vals.has(k + 'Vi'))
      // A mis-keyed Vietnamese value is skipped; an English line naming a Vietnamese place ("Đà Nẵng guide")
      // is not — hence a stricter bar than the t(a, b) comparison above.
      if (english && viRatio(v) < 0.75) add(v)
    }
  }
  // ⚠️ A `{placeholder}` INSIDE A STRING IS NOT AN OBJECT BRACE. `{ en: 'QR code to book on {site}', vi: … }`
  // has braces in its values, so the no-nested-braces scan below never matched it and every authored
  // TEMPLATE pair was silently left out of the warm batch (found 2026-10-05). Braces inside string
  // literals are masked for the scan and put back in each value.
  // One left-to-right pass over comments AND string literals, so a quote or backtick inside a comment
  // cannot open a "string" that masks the braces of real code after it, and a `//` inside a string is
  // not a comment. Comments are blanked (commented-out code is not copy); strings keep their text.
  const masked = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (tok) =>
    tok.startsWith('/*') || tok.startsWith('//') ? tok.replace(/[^\n]/g, ' ') : tok.replace(/\{/g, '\u0001').replace(/\}/g, '\u0002'))
  // Object literals with no nested braces — `{ en: 'Sold', vi: 'Đã bán' }`.
  for (const m of masked.matchAll(/\{([^{}]{0,1200})\}/g)) pairsIn(m[1], ':')
  // A JSX tag's string props — `<ContentSection title="Contact" titleVi="Liên hệ">`.
  for (const m of masked.matchAll(/<[A-Z][\w.]*\s([^<>]{0,1200}?)\/?>/g)) pairsIn(m[1], '=')
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
  // The post wizard's category-aware placeholders and hints — rendered as tr(copy.title, copy.titleVi).
  ['src/lib/post-copy.ts', ['title', 'hint', 'model']],
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
