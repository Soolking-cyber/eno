#!/usr/bin/env node
/**
 * BUILD THE CATEGORY TILE ARTWORK from the supplied icon pack.
 *
 *   node scripts/gen-category-art.mjs --src "/path/to/Eno Categories Icon pack"
 *
 * The pack is 19 PNG renders at 184x184, one per top-level category, numbered rather than named
 * after the slug — so the mapping lives here, in one table, checked against CATEGORY_ART's own key
 * list at runtime. Emits `public/icons/categories/<slug>.webp`.
 *
 * ⛔ WHY THESE ARE NOT `currentColor` LIKE EVERY OTHER GLYPH IN THE APP. category-art.tsx spends a
 * paragraph explaining that tile glyphs are inlined SVG precisely so they inherit the tile's text
 * colour, which is what carried hover, selected, and dark mode. These are full-colour 3D renders:
 * there is no single colour to inherit. The owner asked for this pack specifically, with grey when
 * unpressed and the pack's own blue when pressed, so the state now rides a `grayscale()` filter
 * instead of the text colour. That is a real trade and it is written down in the component.
 *
 * ⚠️ THE PACK IS NOT IN THE REPO. It is a design asset the owner keeps outside the tree, so this
 * script takes `--src` and the OUTPUT is what gets committed. Re-run it when the pack changes;
 * do not hand-edit anything under public/icons/categories/.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const SRC = arg('src')
if (!SRC) { console.error('--src "<icon pack dir>" required'); process.exit(1) }

const OUT = 'public/icons/categories'

/**
 * ⛔ THE TWO SERVICES TILES GO IN THEIR OWN FOLDER SO THE MARKETPLACE IMAGE CAN PRUNE THEM WHOLE.
 * `public/` is the one place the edition split does not reach — the Dockerfile says so at length —
 * and it prunes by PREFIX precisely so new services artwork inherits the rule by being named for
 * the surface it belongs to. A visa icon sitting at /icons/categories/evisa.webp on eno.vn would be
 * fetchable from a licensed sàn TMĐT's own origin, and the standing rule names SERVING as the
 * failure, not linking. A separate directory is the clearest version of that prefix.
 */
const OUT_SERVICES = 'public/icons/services'
const OUT_NAV = 'public/icons/nav'
const OUT_UI = 'public/icons/ui'

/**
 * ⚠️ KEYED BY THE TILE KEY, NOT A TAXONOMY SLUG — these are eno's OWN products, not categories.
 * `SERVICES_DESK_TILES` in src/lib/edition-services-copy.ts calls them `evisa` and `trip`, and that
 * module is aliased to a stub on a marketplace build, which is what keeps even the PATH STRING out
 * of the eno.vn artifact. Do not move these paths to a module that both editions compile.
 */
const SERVICES_MAP = {
  'Vietnam e-Visa.png': 'evisa',
  'Trip planner.png': 'trip',
}

/**
 * ⚠️ THE BOTTOM NAV, FROM THE SAME PACK AND THE SAME SUBFOLDER (owner, 2026-08-28: "also use these
 * icons for navbar similar to category icons"). Numbered like the category files and mapped here
 * for the same reason — the numbers are the designer's order, the keys are the app's.
 * ⛔ THESE SHIP TO BOTH EDITIONS, unlike `SERVICES_MAP` next door. A house, a heart, a plus, a
 * speech bubble and a person describe no regulated service, so `public/icons/nav/` is deliberately
 * NOT added to the Dockerfile's marketplace prune — the bottom bar is identical on eno.forum and
 * pruning it would leave that edition with five broken images.
 */
/**
 * ⚠️ THE OUTLINE SET — the pack's `Icons_Outline/` subfolder (owner, 2026-08-29: "also replace
 * remaining outline icons on top navbar and view type icons line grid map and video gray by default
 * blue when pressed"). Same generator, same grey-until-pressed contract as the category tiles and
 * the bottom bar, so the app has ONE story about what a 3D icon does when it is chosen.
 * ⛔ BOTH EDITIONS, like the nav set and unlike the services set: a magnifier and a bell describe no
 * regulated service, so `public/icons/ui/` is deliberately absent from the Dockerfile's prune.
 */
const OUTLINE_MAP = {
  'Icons_Outline/AI.png': 'ai',
  'Icons_Outline/Arrow.png': 'arrow',
  'Icons_Outline/Grid.png': 'grid',
  'Icons_Outline/List.png': 'list',
  'Icons_Outline/Map.png': 'map',
  'Icons_Outline/Notification.png': 'bell',
  'Icons_Outline/Play.png': 'play',
  'Icons_Outline/Search.png': 'search',
  'Icons_Outline/User.png': 'user',
}

const NAV_MAP = {
  'Navigation bar/Navigation bar-01.png': 'explore',
  'Navigation bar/Navigation bar-02.png': 'saved',
  'Navigation bar/Navigation bar-03.png': 'post',
  'Navigation bar/Navigation bar-04.png': 'messages',
  'Navigation bar/Navigation bar-05.png': 'account',
}

/**
 * ⚠️ THE PACK'S FILENAMES ARE NUMBERED, NOT SLUGGED, so this table is the only thing tying the two
 * together — and it is asserted against CATEGORY_ART below rather than trusted. The numbers are the
 * designer's ordering; the slugs are the taxonomy's, which is immutable and DB-mirrored.
 * ⚠️ Two files ship a second version. `dont use/` already holds Electronics Ver 1, so Ver 2 is the
 * chosen one there. Pets ships BOTH versions in the main folder with nothing marking a preference —
 * Ver 1 is taken here, and that is a judgement call worth a look rather than a fact.
 */
const MAP = {
  '1_All.png': 'all',
  '2_Electronics_Ver2.png': 'electronics',
  '3_Services.png': 'services',
  '4_Travel.png': 'tickets-travel',
  '5_Home.png': 'furniture-appliances',
  '6_Fashion.png': 'fashion-beauty',
  '7_Community.png': 'community-events',
  '8_Food.png': 'food-drink',
  '9_Hobbies.png': 'hobbies-sports',
  '10_Jobs.png': 'jobs',
  '11_Kids.png': 'baby-kids',
  '12_Moving.png': 'moving-sale',
  '13_Pets_Ver 1.png': 'pets',
  '14_Property.png': 'property',
  '15_Rentals.png': 'rentals',
  '16_Vehicles.png': 'vehicles',
  '17_Free & Giveaways.png': 'free',
  '18_ Wanted.png': 'wanted',
  '19_Wholesale.png': 'wholesale',
}

/**
 * ⛔ NATIVE 184px AT QUALITY 50 — MEASURED, NOT PICKED. The tile paints at 44x44 CSS (48 on hover),
 * so a 3x phone wants ~145 device px and the pack only has 184 to give. Two things came out of
 * sweeping size against quality, comparing each encode back against the source resampled to a real
 * 2x device size (88px):
 *   · QUALITY BARELY MATTERS AND SIZE DOES. Almost all the error is the downscale, not the codec —
 *     which is why keeping the native 184 and dropping quality hard beats shrinking at high
 *     quality: 184@q50 is 4.6 KB at mean error 2.46, while 144@q80 is 5.9 KB at 2.49. Bigger AND
 *     cheaper AND slightly better.
 *   · q50 IS THE KNEE. Below it error climbs faster than bytes fall (q30: 4.0 KB, 2.87); above it
 *     bytes climb faster than error falls (q60: 4.9 KB, 2.33). `nearLossless` costs 12.4 KB for
 *     error 1.38 — 2.7x the bytes for a difference invisible at 44px.
 * ⚠️ `alphaQuality: 80` is separate from `quality` and matters here: these are cut-out renders, so
 * a mushy alpha channel shows as a halo on the tile background long before the colour does.
 * ⚠️ Re-measure rather than trusting these numbers if the pack is ever redrawn at a different size.
 */
const EDGE = 184
const QUALITY = 50
const ALPHA_QUALITY = 80

/**
 * ⛔ AVIF FIRST, WEBP AS THE FALLBACK — AND THIS IS MEASURED, NOT FASHION. Owner, 2026-08-29: "make
 * thos icons larger and crisper with maximum compression, also all png icons find the way to make
 * them even smaller by KB size without loosing quality".
 *
 * Sweeping both codecs over five icons from the pack, comparing each encode against the source
 * resampled to a real 3x device size AND COMPOSITED OVER THE PAGE'S OWN BACKGROUND (the first run
 * compared raw RGBA and was wrong — the RGB of a fully transparent pixel is undefined, which
 * punished WebP for something invisible):
 *     webp q50 (what shipped)   3.69 KB   error 1.222
 *     webp q80                  4.99 KB   error 1.006
 *     webp LOSSLESS            15.73 KB   error 0.625
 *     avif q50                  3.35 KB   error 0.464   ← smaller than q50 AND better than lossless
 *     avif q65                  4.40 KB   error 0.324
 * AVIF at q50 is 9% SMALLER than the WebP we shipped and 2.6x more accurate — better than WebP
 * LOSSLESS at a fifth of the bytes. That is the whole ask in one number, which is why the quality
 * is 50 and not higher.
 * ⚠️ 62 WAS TRIED AND REVERTED, because it answers only half of it: crisper, yes, but the AVIF set
 * then totalled 161 KB against the 140 KB of WebP it replaces, so every visitor downloaded MORE.
 * "Smaller without losing quality" is a two-sided constraint and q50 is the point that satisfies
 * both sides; going up trades away the half the owner asked for first.
 *
 * ⛔ THE WEBP TWIN IS NOT OPTIONAL, AND THE BROWSERSLIST FLOOR IS WHY. This app supports
 * `safari >= 16`; AVIF decoding landed in Safari 16.4. Shipping AVIF alone would show 16.0–16.3 a
 * BROKEN IMAGE, which is far worse than a slightly soft one — so every icon is emitted twice and
 * the components render a `<picture>`. Each browser downloads exactly one of them, so per-visitor
 * bytes go DOWN even though the repo carries both.
 * ⚠️ Raising the floor to 16.4 would delete the fallback and is not this change's call to make.
 */
const AVIF_QUALITY = 50

/**
 * Encode one source file to both formats and write them side by side. Returns the bytes written so
 * the caller can report a total, and feeds BOTH buffers into the stamp — a redraw must bust the
 * cache for whichever twin a given browser happens to be holding.
 */
async function emit(srcFile, outDir, key, stamp) {
  const base = sharp(srcFile).resize(EDGE, EDGE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  const webp = await base.clone().webp({ quality: QUALITY, alphaQuality: ALPHA_QUALITY, effort: 6 }).toBuffer()
  // ⚠️ `effort: 6` on AVIF too — it is encode-time only, costs nothing at runtime, and this script
  // runs by hand when the pack changes rather than on every build.
  const avif = await base.clone().avif({ quality: AVIF_QUALITY, effort: 6 }).toBuffer()
  writeFileSync(join(outDir, `${key}.webp`), webp)
  writeFileSync(join(outDir, `${key}.avif`), avif)
  stamp.update(webp)
  stamp.update(avif)
  return webp.length + avif.length
}

async function main() {
  const present = new Set(readdirSync(SRC))
  const missing = Object.keys(MAP).filter((f) => !present.has(f))
  if (missing.length) { console.error(`pack is missing: ${missing.join(', ')}`); process.exit(1) }

  /**
   * ⛔ THE SLUGS MUST MATCH `CATEGORY_ART_SLUGS` EXACTLY, AND THIS CHECK USED TO SKIP ITSELF.
   * The first version `await import(...)`ed a TypeScript module from node, which always throws, and
   * the `.catch(() => null)` turned that into "no registry, nothing to verify" — a guard that
   * printed nothing and proved nothing. Read as TEXT instead, which is what a .mjs can actually do.
   *
   * ⚠️ AND IT CHECKS THE LIB LIST, NOT THE GENERATED ONE. `src/lib/category-art.ts` holds the
   * hand-kept `CATEGORY_ART_SLUGS`, and that is the list `hasCategoryArt()` gates rendering on —
   * so it is the list that decides whether a tile gets a file or renders nothing. Asserting against
   * `src/generated/icon-paths.ts` instead, as the first version did, checks a list that no longer
   * controls anything here. A reviewer spotted the two had drifted apart in exactly that way.
   */
  const lib = readFileSync('src/lib/category-art.ts', 'utf8')
  const block = lib.slice(lib.indexOf('CATEGORY_ART_SLUGS = ['), lib.indexOf('] as const'))
  const known = [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1])
  if (known.length < 10) { console.error('could not parse CATEGORY_ART_SLUGS — the check would be vacuous'); process.exit(1) }
  const unknown = Object.values(MAP).filter((s) => !known.includes(s))
  const uncovered = known.filter((s) => !Object.values(MAP).includes(s))
  if (unknown.length) { console.error(`slugs not in CATEGORY_ART_SLUGS: ${unknown.join(', ')}`); process.exit(1) }
  if (uncovered.length) { console.error(`no artwork for: ${uncovered.join(', ')} — those tiles would render NOTHING`); process.exit(1) }

  const missingSvc = Object.keys(SERVICES_MAP).filter((f) => !present.has(f))
  if (missingSvc.length) { console.error(`pack is missing services art: ${missingSvc.join(', ')}`); process.exit(1) }

  // ⚠️ CHECKED WITH `existsSync`, NOT AGAINST `present` — the nav files live in a SUBFOLDER, and
  // `readdirSync(SRC)` only lists the top level, so every one of them would read as missing.
  const missingNav = Object.keys(NAV_MAP).filter((f) => !existsSync(join(SRC, f)))
  if (missingNav.length) { console.error(`pack is missing nav art: ${missingNav.join(', ')}`); process.exit(1) }

  // ⚠️ `existsSync` again — these live in a SUBFOLDER that `readdirSync` of the pack root cannot see.
  const missingUi = Object.keys(OUTLINE_MAP).filter((f) => !existsSync(join(SRC, f)))
  if (missingUi.length) { console.error(`pack is missing outline art: ${missingUi.join(', ')}`); process.exit(1) }

  const uiBlock = lib.slice(lib.indexOf('UI_ART_KEYS = ['), lib.indexOf('] as const', lib.indexOf('UI_ART_KEYS = [')))
  const uiKnown = [...uiBlock.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1])
  if (!uiKnown.length) { console.error('could not parse UI_ART_KEYS — the check would be vacuous'); process.exit(1) }
  const uiUnknown = Object.values(OUTLINE_MAP).filter((k) => !uiKnown.includes(k))
  const uiUncovered = uiKnown.filter((k) => !Object.values(OUTLINE_MAP).includes(k))
  if (uiUnknown.length) { console.error(`outline keys not in UI_ART_KEYS: ${uiUnknown.join(', ')}`); process.exit(1) }
  if (uiUncovered.length) { console.error(`no artwork for: ${uiUncovered.join(', ')} — those controls would render NOTHING`); process.exit(1) }

  /**
   * ⚠️ ASSERTED AGAINST THE APP'S OWN LIST, exactly as the category slugs are. `NAV_ART_KEYS` in
   * src/lib/category-art.ts is what the bottom bar renders from, so a key here that is not there
   * writes a file nothing loads, and a key there that is not here renders a broken image in the
   * one component that is on every mobile screen.
   */
  const navBlock = lib.slice(lib.indexOf('NAV_ART_KEYS = ['), lib.indexOf('] as const', lib.indexOf('NAV_ART_KEYS = [')))
  const navKnown = [...navBlock.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1])
  // ⚠️ "DID THE PARSE WORK", not "are there five". Asserting the count made a SIXTH tab fail with
  // "could not parse", which is a misleading error for a correct change — a reviewer caught it.
  // Whether the keys are the RIGHT ones is what the two checks below are for.
  if (!navKnown.length) { console.error('could not parse NAV_ART_KEYS — the check would be vacuous'); process.exit(1) }
  const navUnknown = Object.values(NAV_MAP).filter((k) => !navKnown.includes(k))
  const navUncovered = navKnown.filter((k) => !Object.values(NAV_MAP).includes(k))
  if (navUnknown.length) { console.error(`nav keys not in NAV_ART_KEYS: ${navUnknown.join(', ')}`); process.exit(1) }
  if (navUncovered.length) { console.error(`no artwork for nav: ${navUncovered.join(', ')} — those tabs would render NOTHING`); process.exit(1) }

  mkdirSync(OUT, { recursive: true })
  mkdirSync(OUT_SERVICES, { recursive: true })
  mkdirSync(OUT_NAV, { recursive: true })
  mkdirSync(OUT_UI, { recursive: true })
  let bytes = 0
  const stamp = createHash('sha256')
  for (const [file, slug] of Object.entries(MAP)) {
    const n = await emit(join(SRC, file), OUT, slug, stamp)
    bytes += n
    process.stdout.write(`  ${(slug + '').padEnd(22)} ${String(n).padStart(6)} B (avif+webp)\n`)
  }
  for (const [file, key] of Object.entries(SERVICES_MAP)) {
    const n = await emit(join(SRC, file), OUT_SERVICES, key, stamp)
    bytes += n
    process.stdout.write(`  ${(key + ' (services)').padEnd(22)} ${String(n).padStart(6)} B (avif+webp)\n`)
  }

  for (const [file, key] of Object.entries(NAV_MAP)) {
    const n = await emit(join(SRC, file), OUT_NAV, key, stamp)
    bytes += n
    process.stdout.write(`  ${(key + ' (nav)').padEnd(22)} ${String(n).padStart(6)} B (avif+webp)\n`)
  }

  for (const [file, key] of Object.entries(OUTLINE_MAP)) {
    const n = await emit(join(SRC, file), OUT_UI, key, stamp)
    bytes += n
    process.stdout.write(`  ${(key + ' (ui)').padEnd(22)} ${String(n).padStart(6)} B (avif+webp)\n`)
  }

  /**
   * ⚠️ THE STAMP RIDES IN THE QUERY, NEVER IN THE FILENAME — the rule next.config.ts states and
   * scripts/gen-icons.mjs already follows. eno.vn edge-caches its HTML for hours, so a hashed
   * FILENAME 404s out of already-cached HTML after a deploy; a query is not part of the path, so
   * the file always answers, while a CHANGED query is a different browser cache key. It is also
   * what earns these the `max-age=31536000, immutable` rule, which keys off `v` being PRESENT.
   */
  const v = stamp.digest('hex').slice(0, 8)
  writeFileSync('src/generated/category-art-stamp.ts',
    `// AUTO-GENERATED by scripts/gen-category-art.mjs — do not edit by hand.\n` +
    `// Content hash of EVERY file this generator writes — public/icons/categories,\n// public/icons/services, public/icons/nav and public/icons/ui — so a redrawn pack busts the\n// cache for all of them, on both editions. One stamp on purpose: four would be four things to\n// keep in step, and the whole set is redrawn together anyway.\n` +
    `export const CATEGORY_ART_STAMP = '${v}'\n`)
  const n = Object.keys(MAP).length + Object.keys(SERVICES_MAP).length + Object.keys(NAV_MAP).length + Object.keys(OUTLINE_MAP).length
  console.log(`\n${n} icons · ${(bytes / 1024).toFixed(0)} KB total → ${OUT} + ${OUT_SERVICES} + ${OUT_NAV} + ${OUT_UI}  (v=${v})`)
}

main().catch((e) => { console.error(e); process.exit(1) })
