#!/usr/bin/env node
/**
 * CATEGORY ARTWORK GENERATOR — Solar in, two monotone SVGs per tile out.
 *
 * Run from the project root:  `node scripts/gen-category-icons.mjs`
 * Output:                     public/icons/rest/<slug>.svg
 *                             public/icons/selected/<slug>.svg
 *
 * ⚠️ WHY A GENERATOR AND NOT THIRTY PASTED SVGs. The artwork source is a 7,627-icon set. Pasting
 * the seventeen we want freezes them: nobody can tell later which Solar glyph a file came from,
 * whether it was edited, or what happens when the mapping should change. A generator makes the
 * mapping the artefact — one reviewable table below — and the SVGs disposable output. Re-running it
 * is the only supported way to change them; hand-editing a file under public/icons/ will be
 * silently overwritten the next time anyone runs this.
 *
 * ⚠️ THE SOURCE FILE IS NOT IN THE REPOSITORY, DELIBERATELY. `solar.json` is the Iconify JSON for
 * the whole Solar set and it is ~6 MB — three orders of magnitude more than the output it produces.
 * Fetch it once (`npm i -D @iconify-json/solar` then point --source at
 * node_modules/@iconify-json/solar/icons.json, or download the set JSON from Iconify) and this
 * script does the rest. It fails with that instruction rather than a stack trace when the file is
 * missing, because "where do I get this" is the only question a missing input can raise.
 *
 * ── SCOPE: 17 TILES, AND THAT IS ALL ─────────────────────────────────────────────────────────
 * These are the top-level tiles a shopper sees on the home grid and the browse rail:
 *   · the 15 categories of `TAXONOMY` / `src/lib/taxonomy-nav.ts`;
 *   · `free` — the ONE intent shortcut that exists (`INTENT_SHORTCUTS` in src/lib/taxonomy.ts is
 *     length 1; there is NO `wanted` tile anywhere in the app, despite the comments that mention
 *     "Free & Wanted" — measured 2026-08-12);
 *   · `all` — the browse rail's leading tile (`data-cat="all"` in category-rail.tsx).
 *
 * ⛔ SUBCATEGORY GLYPHS ARE OUT OF SCOPE AND STAY ON lucide. `category-icons.tsx` registers 98
 * KEYS — Archive, Armchair, Baby … — and every call site addresses artwork by that immutable,
 * DB-mirrored key (`Category.icon`), not by a slug. Those 98 keys cover 94 distinct taxonomy
 * references across categories AND subcategories; this generator covers the 17 SLUG-addressed
 * tiles. The remaining ~81 keys have no Solar artwork and must keep resolving to lucide.
 *
 * ── THE TWO VARIANTS ─────────────────────────────────────────────────────────────────────────
 * `rest` and `selected` differ in FORM, not in colour — the outline-idle / filled-active grammar
 * the owner mandated on 2026-08-07 ("use icons filling only when selected, not as default").
 *
 *   rest/      the Solar line, opacity stripped. One ink, `stroke="currentColor"`.
 *   selected/  the same paths drawn TWICE in one box: a BODY layer (class `cat-art-body`) that a
 *              stylesheet paints with the brand tint, then the untouched INK layer (class
 *              `cat-art-ink`) on top. Same trick, same reasons, as the DuotoneGlyph already in
 *              category-icons.tsx — including its hard-won rule that the tint stroke must match the
 *              ink stroke EXACTLY (both layers are the same source at stroke-width 1.5, so that is
 *              true by construction here rather than by discipline).
 *
 * ⚠️ WHY A FILLED SILHOUETTE IS NOT ENOUGH, MEASURED. "Selected = one ink, filled" was the simpler
 * design and it was tried first: fill every subpath in the brand and drop the line. Rendered at
 * 96px, `box` becomes a hexagon, `smartphone` a rounded rectangle, `settings` a flower and `case` a
 * featureless slab — four of seventeen tiles unrecognisable. A line glyph's interior detail IS the
 * drawing; you cannot fill it away. Hence two layers.
 *
 * ⚠️ NO COLOUR IS BAKED IN, AND THE TINT IS A CSS HOOK RATHER THAN AN ATTRIBUTE. `--brand-100` is
 * #cfe3f5 in light and #2b5983 in dark (globals.css:186 and :442) — a hex written into these files
 * would be wrong in one of the two themes, permanently, in a file nobody re-reads. So the ink is
 * `currentColor` (inherits the tile's own colour, exactly like the lucide glyph it replaces) and
 * the body layer ships INVISIBLE (`fill="none" stroke="none"`) carrying only a class. One CSS rule
 * turns it on:
 *
 *     @media not (forced-colors: active) {
 *       .cat-art-body { fill: var(--color-brand-100); stroke: var(--color-brand-100); }
 *     }
 *
 * (⚠️ The `forced-colors` guard is load-bearing. `fill` and `stroke` are both forced properties, so
 * in Windows High Contrast the tint and the ink become the SAME system colour and the body swallows
 * the line — every selected tile collapses into exactly the solid silhouette this two-layer design
 * exists to avoid. Guarded, the rule does not apply there and a selected tile falls back to the
 * resting outline.)
 *
 * (`--color-brand-100` is the Tailwind-namespaced alias and it EXISTS — globals.css:121, aliasing
 * `--brand-100`. Named with its line number because an unresolvable var() would fail SILENTLY: the
 * declaration becomes invalid at computed-value time, fill/stroke inherit the root `fill="none"`,
 * and the tint never appears — indistinguishable from "the rule has not been added yet".)
 *
 * A CSS rule beats a presentation attribute, and the children of that layer specify neither fill
 * nor stroke, so the rule inherits into all of them. Until that rule exists a `selected` file
 * renders identically to its `rest` twin — the failure mode is "no tint yet", never a blob.
 * (`var()` inside a presentation attribute was the other candidate; it is one un-measured browser
 * quirk away from painting every glyph solid black, and this file has no way to find out.)
 *
 * ⚠️ THE SOURCE IS SANITISED, BECAUSE THE OUTPUT IS MEANT TO BE INLINED. An inlined SVG is
 * same-origin markup, not an image: a `<script>`, an `onload=`, a `<foreignObject>` or a `<use
 * href>` in it executes or fetches with the page's authority. The set JSON is a third-party file
 * fetched from a registry, so "the source is trusted" is a supply-chain assumption, not a fact.
 * Everything written below therefore passes an ALLOW-list of elements and attributes — a shape the
 * generator does not recognise stops the run instead of being copied through.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_ROOT = join(ROOT, 'public', 'icons')
const NOTICE = join(OUT_ROOT, 'NOTICE.md')

/** Style suffix. Line Duotone is the set; `linear` is the documented fallback. */
const DUOTONE = 'line-duotone'
const LINEAR = 'linear'

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE MAPPING. One row per tile, and every row is a decision somebody can check.
//
// ⚠️ A WRONG GLYPH IS A PRODUCT BUG, NOT A STYLE NIT — a shopper who cannot find Vehicles does not
// file a ticket, they leave. So this is a literal table rather than a fuzzy name search at build
// time: a search that silently resolves `travel` to a paper aeroplane is worse than no artwork.
//
// `why` is not decoration either. Rows marked ⚠️ are the ones where Solar has no 1:1 equivalent of
// today's lucide glyph, and those are exactly the rows a reviewer should argue with. Every glyph
// below was rendered at 96px and looked at before it was written down.
//
// ⚠️ `fillExclude` — DECORATION, NOT BODY. Filling an OPEN path implicitly closes it, so a line
// that only reads as an edge (a steering column, a shoulder arc) becomes a solid wedge in the tint
// layer. Same hazard, same fix, and the same rule as `FILL_EXCLUDE` in category-icons.tsx: an entry
// is added ONLY from a rendered screenshot AT TILE SIZE. Three reviewers raised this against the
// first draft; two of the glyphs they named (`all`, `hobbies-sports`) were measured clean and the
// two below were not, which is exactly why the rule is "screenshot first".
//
// ⚠️ IT IS `{ index: geometry-prefix }`, NOT A BARE INDEX, AND THAT IS THE WHOLE SAFETY PROPERTY.
// An index is a position in a third-party file that nobody here controls: a Solar release that
// reorders a glyph's children leaves the index valid, the count unchanged and the WRONG path
// untinted — silently, which the comment on the first draft called worse than no exclusion while
// the code did exactly that. Pairing each index with the start of the path's `d` makes a reorder a
// build failure instead. If the geometry itself changes, re-render before re-pinning.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const MAP = [
  // ── the 15 categories, in TAXONOMY order ──────────────────────────────────────────────────
  { slug: 'vehicles', icon: 'scooter', lucide: 'CarFront', fillExclude: { 3: 'M12 5h.528' },
    // [3] is the steering column (`M12 5h.528…L19 13`) — an open stroke from the saddle up to the
    // bars. Filled, it closes into a solid triangle across the rider's space, which is visible as a
    // tinted wedge even at 44px. The grip hook [4] stays: it encloses a real region.
    why: '⚠️ SOLAR HAS NO CAR. Measured: 1,303 icon families, zero automobiles — the nearest are ' +
         'bus, garage, wheel-angle (a steering wheel) and traffic. `scooter` is a motorbike, which ' +
         'is not a compromise here: category-icons.tsx already carries bespoke artwork for the ' +
         'motorbike subcategory because "xe máy" is the single most posted item in Vietnam. The ' +
         'tile now shows the vehicle the category is mostly made of.' },
  { slug: 'rentals', icon: 'key', lucide: 'KeyRound', why: 'Same idea as lucide KeyRound — a key.' },
  { slug: 'property', icon: 'buildings-2', lucide: 'Building2',
    why: 'Same idea as lucide Building2. Chosen over `home`/`home-angle`, whose pentagon reads as a ' +
         'generic "home" button rather than as property.' },
  { slug: 'moving-sale', icon: 'box', lucide: 'PackageOpen',
    why: 'A packing box. Solar has no OPEN box; `box` and `box-minimalistic` are the closed and ' +
         'wireframe cubes, and only `box` keeps its lid seam when the opacity is stripped.' },
  { slug: 'furniture-appliances', icon: 'sofa', lucide: 'Sofa', why: 'Same idea as lucide Sofa.' },
  { slug: 'electronics', icon: 'smartphone', lucide: 'Smartphone',
    why: 'Same idea as lucide Smartphone. `devices` was the alternative and is two unlabelled ' +
         'rounded rectangles — it reads as a diagram, not as a phone.' },
  { slug: 'fashion-beauty', icon: 't-shirt', lucide: 'Shirt', why: 'Same idea as lucide Shirt.' },
  { slug: 'baby-kids', icon: 'balloon', lucide: 'Baby',
    why: '⚠️ THE ONE REAL GAP, AND IT IS UNRESOLVED. Solar contains no baby, stroller, pram, cot, ' +
         'pacifier, teddy or toy — searched across all 1,303 families, not just this style. The ' +
         'category is "Mẹ & Bé" (strollers, car seats, baby gear, toys, kids clothing, maternity) ' +
         'and `balloon` is the most child-coded mark the set has; `backpack` skews school-age, ' +
         '`bottle` reads as drinks and collides with food-drink, `hearts` says nothing. This row ' +
         'is the one to overrule: it wants either a bespoke first-party glyph on the 24-grid (the ' +
         'MotorbikeIcon precedent) or lucide Baby kept for this tile alone.' },
  { slug: 'hobbies-sports', icon: 'dumbbell', lucide: 'Dumbbell', why: 'Same idea as lucide Dumbbell.' },
  { slug: 'pets', icon: 'paw', lucide: 'PawPrint', why: 'Same idea as lucide PawPrint.' },
  { slug: 'jobs', icon: 'case', lucide: 'Briefcase',
    why: 'A briefcase, same idea as lucide Briefcase. Solar names it `case`; `suitcase` is the ' +
         'travel one and is deliberately NOT used here (see tickets-travel).' },
  { slug: 'services', icon: 'settings', lucide: 'Wrench',
    why: '⚠️ SOLAR HAS NO WRENCH, and no spanner, screwdriver or toolbox either. A cog is the ' +
         'conventional stand-in for repair/maintenance and it is the only inclusive option — the ' +
         'set\'s other service-shaped glyphs (`broom`, `paint-roller`, `sledgehammer`, `whisk`) ' +
         'each name ONE trade in a category that spans cleaning, repair, tutoring and beauty. ' +
         'Note the collision risk: a cog also means "settings" in UI language, so this tile must ' +
         'never sit next to an account-settings control.' },
  { slug: 'community-events', icon: 'users-group-two-rounded', lucide: 'UsersRound', fillExclude: { 1: 'M18 9c1.657', 3: 'M20 19c1.754' },
    // [1] and [3] are the flanking figures, drawn as bare arcs with no head and no body. Filled,
    // each closes into a crescent beside the centre figure and reads as a smudge — the identical
    // finding, on the identical subject, as category-icons.tsx's `UsersRound: [3]`. The centre
    // head and body still fill, which is the owner's "fill only front person" ruling.
    why: 'Two heads with shoulders. Solar\'s `users-group-rounded` is the closer name but it is ' +
         'drawn as one front figure plus arcs for the figure behind, and once the duotone opacity ' +
         'is stripped those arcs read as loose marks rather than a person — the same defect ' +
         'category-icons.tsx documents for lucide UsersRound\'s third child.' },
  { slug: 'tickets-travel', icon: 'ticket', lucide: 'Plane',
    why: '⚠️ EVERY SOLAR "PLANE" IS A PAPER PLANE. `plane`, `plane-2`, `plane-3` and `plain` are ' +
         'all the send/telegram dart, not an airliner — a 1:1 swap for lucide Plane would put a ' +
         '"send message" mark on the travel tile. `ticket` is unmistakable, and it is the first ' +
         'word of the slug. `suitcase-lines` was the runner-up and was dropped because at 44px it ' +
         'is the same rounded rectangle with a handle as `case` on the Jobs tile beside it.' },
  { slug: 'food-drink', icon: 'chef-hat-minimalistic', lucide: 'UtensilsCrossed',
    why: 'Solar has no crossed cutlery. A chef\'s hat covers both halves of "Ẩm thực" (food AND ' +
         'drink venues) better than `plate` or `cup-hot`, each of which names one of them. The ' +
         '`-minimalistic` cut rather than plain `chef-hat` because the plain one draws its band as ' +
         'a hollow stripe: tinted, it leaves a pale gap across a quarter of the glyph, which is ' +
         'the "half filled" read the owner rejected on 2026-08-07. This one carries the band as a ' +
         'single line over a filled crown.' },

  // ── the two non-taxonomy tiles ────────────────────────────────────────────────────────────
  { slug: 'free', icon: 'gift', lucide: 'Gift',
    why: 'The `free` INTENT SHORTCUT (INTENT_SHORTCUTS, length 1) — same idea as lucide Gift. ' +
         'There is no `wanted` tile in the app; the spec that asked for one was describing ' +
         'something that does not exist.' },
  { slug: 'all', icon: 'layers', lucide: 'Layers',
    why: 'The browse rail\'s leading tile (data-cat="all"), which renders lucide Layers today. ' +
         'Kept 1:1 so the swap changes the artwork source and nothing else. `widget` (a 2×2 grid) ' +
         'arguably says "all categories" more directly and is a one-word change here if anyone ' +
         'wants to make that a separate, deliberate decision.' },
]

// ─────────────────────────────────────────────────────────────────────────────────────────────

const fail = (msg) => { console.error('\n✗ ' + msg + '\n'); process.exit(1) }

/** Strip every opacity carrier. Line Duotone encodes its second tone as opacity=".5" — that IS the
 *  duotone, and removing it is what makes these monotone. Handles both quote styles because the
 *  input is third-party and one day it may not be Iconify's serialiser writing it. */
const stripOpacity = (s) => s.replace(/\s(?:fill-|stroke-)?opacity=("[^"]*"|'[^']*')/g, '')

/** Drop `fill=` / `stroke=` only. `fill-rule`, `stroke-width`, `stroke-linecap` and
 *  `stroke-linejoin` survive — the body layer must trace the ink layer exactly, and the caps are
 *  part of the geometry. */
const stripPaint = (s) => s.replace(/\s(?:fill|stroke)=("[^"]*"|'[^']*')/g, '')

// ── The sanitiser ───────────────────────────────────────────────────────────────────────────
// ⚠️ ALLOW-LIST, NOT DENY-LIST. A deny-list of `<script>` and `on*` is a list of the attacks
// someone already thought of; `<use href>`, `<image>`, `<foreignObject>`, `<animate onbegin>` and
// `style="background:url(…)"` are all the same class and none of them is in the naive list. What
// these glyphs legitimately contain is tiny and closed — five element names, geometry, and stroke
// presentation — so anything else is a reason to stop, not a shape to filter out.
const ELEMENTS = new Set(['g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon'])
const ATTRIBUTES = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points',
  'transform', 'fill', 'stroke', 'fill-rule', 'clip-rule', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  // The duotone carriers. They are ALLOWED to arrive and are stripped immediately afterwards —
  // this list gates the raw source, and refusing them here would refuse Line Duotone itself.
  'opacity', 'fill-opacity', 'stroke-opacity',
])

/**
 * Refuse anything that is not a known element carrying known, QUOTED attributes.
 *
 * ⚠️ AN ATTRIBUTE SCAN THAT KEYS ON THE QUOTE IS NOT A SANITISER, AND THIS ONE DID. The first
 * version matched `name = "value"`, which is every attribute Iconify emits and therefore looked
 * complete. HTML does not require the quotes: `<path onload=alert(1) d="…"/>` has an attribute the
 * scan cannot see, and a browser parsing the inlined markup runs it. Measured against a hostile
 * fixture built from the real set — the payload was written to public/icons/rest/pets.svg and the
 * generator exited 0. Three reviewers found it; one measurement proved it.
 *
 * So the tag is now taken apart rather than pattern-matched: every attribute must parse as
 * `name="value"` or `name='value'`, and whatever is left over after removing them all must be
 * nothing. An unquoted value, a bare boolean attribute, or a stray `<` all fail here, and the
 * failure names the icon.
 */
const TAG = /<\/?\s*([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g
const ATTR = /([A-Za-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const ATTR_D = /\sd="([^"]*)"/

function sanitise(name, body) {
  let cursor = 0
  for (const tag of body.matchAll(TAG)) {
    // Anything BETWEEN tags is text content, which these glyphs never have.
    if (body.slice(cursor, tag.index).trim()) fail(`${name}: text content between elements; a line glyph has none, so this is something else.`)
    cursor = tag.index + tag[0].length
    if (!ELEMENTS.has(tag[1])) fail(`${name}: <${tag[1]}> is not an allowed element. This markup gets INLINED into the page, so an unrecognised element is refused rather than copied through.`)
    let rest = tag[2]
    for (const attr of tag[2].matchAll(ATTR)) {
      if (!ATTRIBUTES.has(attr[1])) fail(`${name}: attribute "${attr[1]}" is not allowed. Event handlers, style, href/xlink:href and class carry script or fetch a resource once inlined.`)
      rest = rest.replace(attr[0], '')
    }
    // ⚠️ THE LEFTOVER CHECK IS THE WHOLE POINT — it is what catches the attribute the ATTR regex
    // could not see. Without it, an unquoted or valueless attribute is simply never inspected.
    if (rest.trim().replace(/\/$/, '').trim()) fail(`${name}: unparseable attribute syntax in <${tag[1]}> near "${rest.trim().slice(0, 40)}". Every attribute must be name="value"; an unquoted value is refused because it is invisible to an attribute allow-list.`)
  }
  if (body.slice(cursor).trim()) fail(`${name}: trailing content after the last element.`)
  // Belt and braces: two payload shapes that survive an attribute NAME check, in case the allow-list
  // above is ever widened without thinking about them.
  if (/url\s*\(/i.test(body)) fail(`${name}: url() in the body — an inlined SVG can fetch with the page's authority.`)
  if (/&#/.test(body)) fail(`${name}: numeric character reference in the body; refusing to guess what it decodes to.`)
}

const LEAF = /<(?:path|circle|rect|ellipse|line|polyline|polygon)\b[^>]*\/>/g

/**
 * The glyph's children, in document order, for `fillExclude`.
 *
 * ⚠️ SOLAR HAS TWO BODY SHAPES AND ASSUMING ONE OF THEM IS A BUG — `t-shirt` and `dumbbell` are a
 * BARE `<path>` carrying their own paint, while the other fifteen are a root `<g>` with the paint
 * hoisted onto it. Both are handled; anything else stops the run, because a `fillExclude` index
 * counted against a shape you guessed at excludes the wrong path in silence, which is worse than
 * not excluding at all.
 */
function children(name, body) {
  const root = body.match(/^<g([^>]*)>([\s\S]*)<\/g>$/)
  const attrs = root ? root[1] : ''
  const inner = root ? root[2] : body
  const kids = inner.match(LEAF) ?? []
  if (kids.join('') !== inner) fail(`${name}: the body holds something other than self-closing leaves (or more than one wrapping <g>); fillExclude indices would be wrong.`)
  return { attrs, kids }
}

function loadSet() {
  const flag = process.argv.find((a) => a.startsWith('--source='))
  const candidates = [
    flag?.slice('--source='.length),
    process.env.SOLAR_JSON,
    join(ROOT, 'solar.json'),
    join(ROOT, 'node_modules', '@iconify-json', 'solar', 'icons.json'),
  ].filter(Boolean)
  const found = candidates.find((p) => existsSync(p))
  if (!found) {
    fail(
      'Solar icon set not found. Looked in:\n' + candidates.map((c) => '    ' + c).join('\n') +
      '\n\n  Get it with either:\n' +
      '    npm i -D @iconify-json/solar     (then re-run; it is found automatically)\n' +
      '    node scripts/gen-category-icons.mjs --source=/path/to/solar.json',
    )
  }
  const set = JSON.parse(readFileSync(found, 'utf8'))
  if (set.prefix !== 'solar') fail(`${found} is the "${set.prefix}" set, not solar.`)
  return { set, path: found }
}

const { set, path: sourcePath } = loadSet()

// ⚠️ ATTRIBUTION IS A LICENCE OBLIGATION, SO IT IS A BUILD PRECONDITION. Solar is CC BY 4.0: we may
// ship it, and we must credit it. Tying the generator to the NOTICE means the credit cannot be
// deleted while the artwork it covers stays in the tree.
if (!existsSync(NOTICE)) fail(`public/icons/NOTICE.md is missing. Solar is ${set.info?.license?.title ?? 'CC BY 4.0'} and the attribution must ship with the artwork — restore the NOTICE before generating.`)
const PROV_OPEN = '<!-- provenance:begin -->'
const PROV_CLOSE = '<!-- provenance:end -->'
const noticeText = readFileSync(NOTICE, 'utf8')
if (!noticeText.includes(PROV_OPEN) || !noticeText.includes(PROV_CLOSE)) {
  fail(`public/icons/NOTICE.md has lost its ${PROV_OPEN} … ${PROV_CLOSE} markers. That block records WHICH bytes the artwork came from, and it is rewritten here on every run — restore the markers.`)
}

// ── Resolve every name BEFORE writing anything ──────────────────────────────────────────────
// ⚠️ RESOLVE-THEN-WRITE, NOT RESOLVE-AS-YOU-GO. A typo caught on tile 14 must not leave 13 fresh
// files and 4 stale ones on disk; that half-state is the one a build would ship without noticing.
const resolved = []
const missing = []
const fallbacks = []

for (const row of MAP) {
  const duotone = `${row.icon}-${DUOTONE}`
  const linear = `${row.icon}-${LINEAR}`
  let name = null
  let style = DUOTONE
  if (set.icons[duotone]) { name = duotone } else if (set.icons[linear]) { name = linear; style = LINEAR; fallbacks.push(row) }
  if (!name) { missing.push({ row, tried: [duotone, linear] }); continue }

  const icon = set.icons[name]
  // Iconify lets an icon override the set's viewBox. None of these do, and the output template
  // hard-codes 0 0 24 24 — so an override must stop the run rather than be silently mis-cropped.
  const override = ['left', 'top', 'width', 'height'].filter((k) => icon[k] !== undefined)
  if (override.length) fail(`${name} overrides the set viewBox (${override.join(', ')}); the 24×24 template cannot render it.`)

  // ⚠️ SANITISE THE RAW SOURCE, BEFORE ANY REWRITING. Checking the output would only ever prove
  // that our own rewrites are clean; the question is whether what arrived is.
  sanitise(name, icon.body)

  const ink = stripOpacity(icon.body)
  // ⚠️ THE OPACITY GUARD MATCHES THE WORD, NOT THE ATTRIBUTE SYNTAX. The strip handles
  // `opacity="…"`, but `style="opacity:.5"` would carry the duotone straight through a check for
  // `opacity=` — a reviewer's catch. `style` is refused outright by the sanitiser above; this is
  // the second line, so widening that allow-list cannot silently re-open the hole.
  if (/opacity/i.test(ink)) fail(`${name}: "opacity" survived the strip — these icons must be monotone, and the second tone in Line Duotone IS the opacity.`)
  if (/#[0-9a-fA-F]{3}\b/.test(ink) || /#[0-9a-fA-F]{6}\b/.test(ink)) fail(`${name}: baked hex colour in the source; the output must be currentColor only.`)
  // ⚠️ QUOTE-AGNOSTIC, LIKE THE STRIPPERS ABOVE IT. These checks used to read double quotes only
  // while `stripPaint` handled both, so `fill='red'` passed the gate and shipped into the ink of
  // both variants — the same measured hole as the attribute scan, one layer down.
  for (const [, name_, dq, sq] of ink.matchAll(ATTR)) {
    const v = dq ?? sq
    if (name_ === 'fill' && v !== 'none') fail(`${name}: unexpected fill="${v}" (only "none" is expected in a line style).`)
    if (name_ === 'stroke' && v !== 'currentColor') fail(`${name}: unexpected stroke="${v}" (only currentColor is expected).`)
  }

  const { attrs, kids } = children(name, ink)
  if (!kids.length) fail(`${name}: no drawing element in the body.`)

  // ⚠️ EVERY EXCLUSION IS CHECKED AGAINST THE PATH IT CLAIMS TO NAME. The index locates the child;
  // the pinned `d` prefix proves it is still the same drawing. A Solar release that reorders the
  // glyph fails HERE, loudly, instead of tinting some other path and looking fine in a diff.
  const exclude = Object.entries(row.fillExclude ?? {}).map(([i, pin]) => [Number(i), pin])
  for (const [i, pin] of exclude) {
    if (!Number.isInteger(i) || i < 0 || i >= kids.length) fail(`${row.slug}: fillExclude index ${i} is out of range — ${name} has ${kids.length} children.`)
    const d = kids[i].match(ATTR_D)?.[1] ?? ''
    if (!d.startsWith(pin)) fail(`${row.slug}: fillExclude[${i}] is pinned to a path starting "${pin}", but child ${i} of ${name} starts "${d.slice(0, 24)}". The artwork moved — RE-RENDER at tile size and re-pin; do not just bump the index.`)
  }
  if (exclude.length === kids.length) fail(`${row.slug}: fillExclude removes every child, so the selected variant would have no body at all.`)

  const dropped = new Set(exclude.map(([i]) => i))
  const body = `<g${stripPaint(attrs)}>${stripPaint(kids.filter((_, i) => !dropped.has(i)).join(''))}</g>`
  resolved.push({ ...row, name, style, ink, body, excluded: dropped.size })
}

if (missing.length) {
  fail(
    'These names do not exist in the Solar set — fix the table, do not guess:\n' +
    missing.map((m) => `    ${m.row.slug}: tried ${m.tried.join(', ')}`).join('\n'),
  )
}

// ── Emit ────────────────────────────────────────────────────────────────────────────────────
const BODY_CLASS = 'cat-art-body'
const INK_CLASS = 'cat-art-ink'
const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">'

const restSvg = (r) => `${OPEN}${r.ink}</svg>\n`
const selectedSvg = (r) =>
  `${OPEN}<g class="${BODY_CLASS}" fill="none" stroke="none">${r.body}</g>` +
  `<g class="${INK_CLASS}">${r.ink}</g></svg>\n`

const dirs = { rest: join(OUT_ROOT, 'rest'), selected: join(OUT_ROOT, 'selected') }
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })

// ⚠️ WRITE FIRST, PRUNE SECOND. The reverse order has a window — after the deletes, before the
// writes — in which an interrupted run leaves a directory that is missing tiles rather than merely
// holding a stale one, and a rail with three tiles is a worse state than a rail with a stale one.
// The prune only ever removes `.svg` files from these two generated directories, and it names each
// one it removes: if you keep something by hand under public/icons/, it does not belong in here.
// ⚠️ WRITE VIA A TEMP FILE AND RENAME. A `writeFileSync` that dies part-way leaves a TRUNCATED svg,
// which is the one failure the whole "resolve before writing" discipline does not cover — the name
// resolved fine and the bytes are still half an icon. `rename` within the same directory is atomic,
// so a reader ever only sees the old file or the complete new one.
const writeAtomic = (path, contents) => {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, contents)
  renameSync(tmp, path)
}

const wanted = new Set(resolved.map((r) => `${r.slug}.svg`))
for (const [variant, dir] of Object.entries(dirs)) {
  for (const r of resolved) writeAtomic(join(dir, `${r.slug}.svg`), variant === 'rest' ? restSvg(r) : selectedSvg(r))
  // ⚠️ `.tmp` IS PRUNED TOO, AND LEAVING IT OUT WAS A REAL HOLE. The prune used to filter
  // `.endsWith('.svg')`, which is exactly the set of names `writeAtomic` does NOT leave behind when
  // it dies: a run killed between the write and the rename orphans `<slug>.svg.tmp`, and both the
  // prune and the paired test skipped it — so the half-written file survived, got committed, and
  // was served from public/. Three reviewers found this within one round of the temp file being
  // introduced, which is a fair verdict on adding a safety mechanism without extending its cleanup.
  for (const f of readdirSync(dir)) {
    if ((f.endsWith('.svg') && !wanted.has(f)) || f.endsWith('.tmp')) { unlinkSync(join(dir, f)); console.log(`  pruned ${variant}/${f}`) }
  }
}
// …and in OUT_ROOT itself, because NOTICE.md is written atomically too and a run killed mid-write
// orphans `NOTICE.md.tmp` one directory ABOVE the loop that was cleaning up after the same
// mechanism. Reviewer's catch, and a fair one: a cleanup scoped narrower than the thing it cleans.
for (const f of readdirSync(OUT_ROOT)) {
  if (f.endsWith('.tmp')) { unlinkSync(join(OUT_ROOT, f)); console.log(`  pruned ${f}`) }
}

// ── Report ──────────────────────────────────────────────────────────────────────────────────
// ⚠️ PRINT THE SOURCE'S DIGEST. The set JSON is deliberately not committed, so nothing in the tree
// proves which bytes these 34 files were derived from — a reviewer's point, and a fair one for
// third-party artwork under a licence that turns on provenance. The digest is the answer: it goes
// in public/icons/NOTICE.md, and re-running against a different Solar release changes it.
const lic = set.info?.license ?? {}
const digest = createHash('sha256').update(readFileSync(sourcePath)).digest('hex')

// ⚠️ THE NOTICE IS REWRITTEN, NOT MERELY REQUIRED TO EXIST. A reviewer's point: checking that SOME
// notice file is present lets a regeneration from a different Solar release ship artwork under a
// stale — i.e. false — attribution. Nobody would notice, because the file reads correct. The
// generator owns the provenance block instead, so the credit cannot drift from the bytes, and
// there is no bootstrap trap (you cannot know a digest before you have run the thing).
const provenance = [
  PROV_OPEN,
  '<!-- ⚠️ WRITTEN BY scripts/gen-category-icons.mjs ON EVERY RUN — edit the generator, not this. -->',
  '',
  '```',
  `set          ${set.info?.name ?? 'Solar'} — ${lic.title ?? 'CC BY 4.0'} (${lic.spdx ?? 'CC-BY-4.0'})`,
  `author       ${set.info?.author?.name ?? '480 Design'}`,
  `licence      ${lic.url ?? 'https://creativecommons.org/licenses/by/4.0/'}`,
  `icons        ${Object.keys(set.icons).length} in file (info.total ${set.info?.total ?? '?'})`,
  `sha256       ${digest}`,
  '```',
  PROV_CLOSE,
].join('\n')
// Atomic like the SVGs: a truncated NOTICE is a truncated licence.
writeAtomic(
  NOTICE,
  noticeText.slice(0, noticeText.indexOf(PROV_OPEN)) + provenance + noticeText.slice(noticeText.indexOf(PROV_CLOSE) + PROV_CLOSE.length),
)

console.log(`\nSolar (${Object.keys(set.icons).length} icons, info.total ${set.info?.total ?? '?'}) — ${lic.title ?? 'CC BY 4.0'}`)
console.log(`  source ${sourcePath}`)
console.log(`  sha256 ${digest}  → written into public/icons/NOTICE.md`)
console.log(`\nWrote ${resolved.length * 2} files: public/icons/{rest,selected}/<slug>.svg\n`)
for (const r of resolved) console.log(`  ${r.slug.padEnd(22)} ${r.name}${r.style === LINEAR ? '   [LINEAR FALLBACK]' : ''}${r.excluded ? `   [${r.excluded} child(ren) excluded from the tint]` : ''}`)
console.log(
  fallbacks.length
    ? `\nLinear fallbacks (Line Duotone has no such glyph): ${fallbacks.map((f) => `${f.slug} → ${f.icon}`).join(', ')}`
    : '\nLinear fallbacks: none — every tile resolved in Line Duotone.',
)
console.log(`\nSlugs covered: ${resolved.length} (15 taxonomy categories + free + all).`)
console.log('Registry keys NOT covered: the ~81 subcategory glyphs in category-icons.tsx, which stay on lucide.')
console.log('\nWire the tint with (the forced-colors guard is required — see the header):')
console.log('  @media not (forced-colors: active) {')
console.log(`    .${BODY_CLASS} { fill: var(--color-brand-100); stroke: var(--color-brand-100); }`)
console.log('  }\n')
