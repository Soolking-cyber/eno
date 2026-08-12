#!/usr/bin/env node
/**
 * ICON GENERATOR — official Solar v2 in, two weights per name out.
 *
 * Run from the project root:  `npm run icons`
 * Output:                     public/icons/rest/<slug>.svg        (category tiles, Outline)
 *                             public/icons/selected/<slug>.svg    (category tiles, Bold)
 *                             public/icons/ui/rest/<name>.svg     (UI glyphs, Outline)
 *                             public/icons/ui/selected/<name>.svg (UI glyphs, Bold)
 *
 * ── WHY THIS REPLACED gen-category-icons.mjs ─────────────────────────────────────────────────
 * The previous generator built the SELECTED state by hand: it took the Line Duotone glyph,
 * stripped the opacity that encodes the second tone, then drew the same paths twice — a tint
 * "body" layer under an ink layer — and painted the body with `--brand-100` from a stylesheet.
 * That machinery existed only because a line glyph has no filled form to switch to.
 *
 * It never shipped. Filling an OPEN path implicitly closes it, so paths that only read as an edge
 * turned into solid wedges: `food-drink`'s toque took a white trapezoid through its crown and
 * `property`'s side wings tinted a diagonal sliver. Both are the "half-filled glyph" that
 * docs/icon-language.md forbids outright, so the tint rule was never added to globals.css and the
 * selected artwork sat inert behind a ⛔ comment. `fillExclude` was the mitigation — a per-glyph
 * list of children to keep out of the tint, each pinned to a geometry prefix so a Solar reorder
 * would fail the build rather than tint the wrong path.
 *
 * ⚠️ ALL OF THAT IS DELETED, AND NOTHING REPLACES IT, BECAUSE SOLAR ALREADY DRAWS BOTH WEIGHTS.
 * Owner, 2026-08-12: *"with solar iconpack you can use bold and outline versions from official
 * source no need coloring individually"*. Bold is not a filled version of the line — it is a
 * separately drawn glyph — so there is no open path to close, no wedge, no exclusion list, no
 * tint layer and no CSS hook. The outline-idle / filled-active grammar the owner mandated on
 * 2026-08-07 now comes from the source instead of being reconstructed here.
 *
 * ── WHY NO RECOLOURING STEP ──────────────────────────────────────────────────────────────────
 * Measured across all 114 files this generator reads (57 names x 2 weights): every drawing
 * element is a `<path>` (one to seven of them, not one) on a `0 0 24 24` viewBox, painted
 * `fill="currentColor"`, with zero baked hex values, zero `opacity` carriers and zero stroke
 * paint. So the ink follows the element's own colour exactly like the lucide glyph it replaces,
 * and this script rewrites no colour at all.
 * It strips Solar's own `class="solar solar-<name>-<style>"` (ours should not carry it) and the
 * root `stroke-width`, which is inert on a shape that has no stroke.
 *
 * ── SOURCE ───────────────────────────────────────────────────────────────────────────────────
 * `@solar-icons/static`, a devDependency — the framework-agnostic distribution documented at
 * https://solar-icons.vercel.app/docs/v2/packages/static. 1,246 icons in six styles; we read two.
 * Icons are CC BY 4.0, the packaging MIT; public/icons/NOTICE.md carries the attribution.
 *
 * ⚠️ A WRONG GLYPH IS A PRODUCT BUG, NOT A STYLE NIT — a shopper who cannot find Vehicles does
 * not file a ticket, they leave. So the maps below are literal tables rather than a fuzzy name
 * search at build time: a search that silently resolves `travel` to a paper aeroplane is worse
 * than no artwork. `why` is not decoration either — rows marked ⚠️ are the ones where Solar has
 * no 1:1 equivalent, and those are exactly the rows a reviewer should argue with.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'node_modules/@solar-icons/static/dist/icons')
const OUT = join(ROOT, 'public/icons')

const fail = (msg) => {
  console.error('\n✗ ' + msg + '\n')
  process.exit(1)
}

/**
 * CATEGORY TILES — the 15 taxonomy categories in TAXONOMY order, then the two tiles that are not
 * categories. The mapping and its rationales carry over unchanged from gen-category-icons.mjs;
 * only the STYLE this generator reads has changed, so a row argued over once stays settled.
 */
const CATEGORIES = [
  { slug: 'vehicles', icon: 'scooter', lucide: 'CarFront',
    why: '⚠️ SOLAR HAS NO CAR — the nearest are bus, garage, wheel-angle and traffic. `scooter` is ' +
         'a motorbike, which is not a compromise: "xe máy" is the single most posted item in ' +
         'Vietnam and category-icons.tsx already carries bespoke motorbike artwork.' },
  { slug: 'rentals', icon: 'key', lucide: 'KeyRound', why: 'Same idea as lucide KeyRound — a key.' },
  { slug: 'property', icon: 'buildings-2', lucide: 'Building2',
    why: 'Same idea as lucide Building2. Chosen over `home`/`home-angle`, whose pentagon reads as ' +
         'a generic "home" button rather than as property. ⚠️ Its side wings were the reason the ' +
         'old tint layer produced a diagonal sliver; Bold draws them solid, so the row is clean now.' },
  { slug: 'moving-sale', icon: 'box', lucide: 'PackageOpen',
    why: 'A packing box. Solar has no OPEN box; `box` and `box-minimalistic` are the closed and ' +
         'wireframe cubes. (The old note preferred `box` because it kept its lid seam once the ' +
         'duotone opacity was stripped — that reason is gone with the duotone, but the glyph stands.)' },
  { slug: 'furniture-appliances', icon: 'sofa', lucide: 'Sofa', why: 'Same idea as lucide Sofa.' },
  { slug: 'electronics', icon: 'smartphone', lucide: 'Smartphone',
    why: 'Same idea as lucide Smartphone. `devices` was the alternative and is two unlabelled ' +
         'rounded rectangles — it reads as a diagram, not as a phone.' },
  { slug: 'fashion-beauty', icon: 't-shirt', lucide: 'Shirt', why: 'Same idea as lucide Shirt.' },
  { slug: 'baby-kids', icon: 'balloon', lucide: 'Baby',
    why: '⚠️ THE ONE REAL GAP, STILL UNRESOLVED. Solar contains no baby, stroller, pram, cot, ' +
         'pacifier, teddy or toy. The category is "Mẹ & Bé" and `balloon` is the most child-coded ' +
         'mark the set has. This row is the one to overrule: it wants a bespoke first-party glyph ' +
         '(the MotorbikeIcon precedent) or lucide Baby kept for this tile alone.' },
  { slug: 'hobbies-sports', icon: 'dumbbell', lucide: 'Dumbbell', why: 'Same idea as lucide Dumbbell.' },
  { slug: 'pets', icon: 'paw', lucide: 'PawPrint', why: 'Same idea as lucide PawPrint.' },
  { slug: 'jobs', icon: 'case', lucide: 'Briefcase',
    why: 'A briefcase. Solar names it `case`; `suitcase` is the travel one and is deliberately NOT ' +
         'used here (see tickets-travel).' },
  { slug: 'services', icon: 'settings', lucide: 'Wrench',
    why: '⚠️ SOLAR HAS NO WRENCH, spanner, screwdriver or toolbox. A cog is the conventional ' +
         'stand-in and the only inclusive option — `broom`, `paint-roller`, `sledgehammer` and ' +
         '`whisk` each name ONE trade in a category spanning cleaning, repair, tutoring and ' +
         'beauty. ⚠️ A cog also means "settings" in UI language, so this tile must never sit next ' +
         'to an account-settings control.' },
  { slug: 'community-events', icon: 'users-group-two-rounded', lucide: 'UsersRound',
    why: 'Two heads with shoulders. ⚠️ Its flanking figures are bare arcs, which is why the old ' +
         'tint layer turned them into crescents; Bold draws whole figures, so the defect is gone.' },
  { slug: 'tickets-travel', icon: 'ticket', lucide: 'Plane',
    why: '⚠️ EVERY SOLAR "PLANE" IS A PAPER PLANE — `plane`, `plane-2` and `plane-3` are the ' +
         'send/telegram dart, not an airliner, so a 1:1 swap for lucide Plane would put a "send ' +
         'message" mark on the travel tile. `ticket` is unmistakable and is the first word of the ' +
         'slug. `suitcase-lines` was dropped: at 44px it is the same rounded rectangle with a ' +
         'handle as `case` on the Jobs tile beside it.' },
  { slug: 'food-drink', icon: 'chef-hat-minimalistic', lucide: 'UtensilsCrossed',
    why: 'Solar has no crossed cutlery. A chef\'s hat covers both halves of "Ẩm thực" better than ' +
         '`plate` or `cup-hot`, each of which names one. ⚠️ The `-minimalistic` cut was chosen ' +
         'because plain `chef-hat` drew its band as a hollow stripe that the tint layer left ' +
         'half-filled. That constraint died with the tint layer, so plain `chef-hat` is now a ' +
         'live option — a deliberate art-direction call, not a silent swap.' },
  { slug: 'free', icon: 'gift', lucide: 'Gift',
    why: 'The `free` INTENT SHORTCUT (INTENT_SHORTCUTS, length 1) — same idea as lucide Gift. ' +
         'There is no `wanted` tile in the app; the spec that asked for one described something ' +
         'that does not exist.' },
  { slug: 'all', icon: 'layers', lucide: 'Layers',
    why: 'The browse rail\'s leading tile (data-cat="all"), which renders lucide Layers today. ' +
         'Kept 1:1 so the swap changes the artwork source and nothing else.' },
]

/**
 * UI GLYPHS — the app's chrome. Names on the left are ours and are what a call site asks for;
 * they stay stable if the Solar mapping is ever re-argued.
 *
 * ⚠️ Rows marked ⚠️ are where Solar has no exact equivalent and the owner's "pick the closest
 * looking one" applies. They are the rows to argue with.
 */
const UI = [
  { name: 'account', icon: 'user-circle' },
  { name: 'attach', icon: 'paperclip-rounded',
    why: '⚠️ NOT plain `paperclip`, AND NOT `paperclip-2` — those two are among the 55 Solar ' +
         'glyphs (measured) whose Outline and Bold are the SAME DRAWING, so a selected attach ' +
         'button would show no change at all. The IDENTICAL-PAIR check below fails the build on ' +
         'that now; this row is the one it caught.' },
  { name: 'back', icon: 'alt-arrow-left', why: 'The `alt-` cut is the chevron; bare `arrow-left` is a shafted arrow.' },
  { name: 'bell', icon: 'bell' },
  { name: 'calendar', icon: 'calendar' },
  { name: 'camera', icon: 'camera' },
  { name: 'chevron-down', icon: 'alt-arrow-down' },
  { name: 'close', icon: 'close-circle', why: '⚠️ Solar has no bare X — every close mark is enclosed. `close-square` is the alternative.' },
  { name: 'copy', icon: 'copy' },
  { name: 'edit', icon: 'pen-new-square' },
  { name: 'error', icon: 'danger-triangle', why: 'Reserved for faults. docs/icon-language.md: no mascot on a fault.' },
  { name: 'explore', icon: 'compass' },
  { name: 'filters', icon: 'filter' },
  { name: 'forward', icon: 'alt-arrow-right' },
  { name: 'gallery', icon: 'gallery' },
  { name: 'grid', icon: 'widget', why: 'A 2x2 grid — the view-mode toggle.' },
  { name: 'info', icon: 'info-circle' },
  { name: 'language', icon: 'global', why: '⚠️ `translation` is the alternative; a globe is the app\'s existing language mark.' },
  { name: 'map-pin', icon: 'map-point' },
  { name: 'menu', icon: 'hamburger-menu' },
  { name: 'messages', icon: 'chat-round-dots' },
  { name: 'more', icon: 'menu-dots' },
  { name: 'offer', icon: 'tag-price', why: '⚠️ Offers are price-led here, so a price tag beats `hand-money`.' },
  { name: 'phone', icon: 'phone' },
  { name: 'play', icon: 'play' },
  { name: 'post', icon: 'add-square', why: 'The compose/post action.' },
  { name: 'rating', icon: 'star' },
  { name: 'retry', icon: 'refresh' },
  { name: 'save-search', icon: 'bookmark', why: '⚠️ Solar has no saved-search glyph. Shares a family with `saved` on purpose — the two are the same idea at different scopes.' },
  { name: 'saved', icon: 'heart', why: 'Saved listings are hearts in this app, not bookmarks.' },
  { name: 'search', icon: 'magnifier' },
  { name: 'send', icon: 'plane', why: 'Solar\'s paper-plane dart. `send-square` is an enclosed arrow and reads as an upload.' },
  { name: 'share', icon: 'share' },
  { name: 'sort', icon: 'sort-vertical' },
  { name: 'success', icon: 'check-circle' },
  { name: 'theme-dark', icon: 'moon' },
  { name: 'theme-light', icon: 'sun' },
  { name: 'time', icon: 'clock-circle' },
  { name: 'verified', icon: 'verified-check' },
  { name: 'views', icon: 'eye' },
]

/** `rest` = the idle weight. `selected` = the active weight. */
const STYLE = { rest: 'outline', selected: 'bold' }

// ── read ─────────────────────────────────────────────────────────────────────────────────────

if (!existsSync(SRC)) {
  fail(
    `@solar-icons/static is not installed.\n\n  npm i -D @solar-icons/static\n\n` +
      `Expected the icon files at ${SRC}`
  )
}

const available = Object.fromEntries(
  Object.values(STYLE).map((style) => [
    style,
    new Set(
      readdirSync(join(SRC, style))
        .filter((f) => f.endsWith('.svg'))
        .map((f) => f.replace(/\.svg$/, ''))
    ),
  ])
)

// ── normalise ────────────────────────────────────────────────────────────────────────────────

/**
 * Solar ships e.g.
 *   <svg … viewBox="0 0 24 24" fill="none" stroke-width="1.5" class="solar solar-home-bold"><path … fill="currentColor"/></svg>
 * We keep the geometry and the `currentColor` verbatim and drop two things that are ours to own:
 * the vendor class, and a root `stroke-width` that paints nothing on a fill-only glyph.
 */
function normalise(svg, { name, style }) {
  const out = svg
    .replace(/\s+class="[^"]*"/g, '')
    .replace(/\s+stroke-width="[^"]*"/g, '')
    .replace(/>\s+</g, '><')
    .trim()

  // Refuse anything that would need recolouring — the whole point is that nothing does.
  if (/#[0-9a-fA-F]{3,8}\b/.test(out)) fail(`${style}/${name}: a baked hex colour survived normalisation`)
  if (/\bopacity=/.test(out)) fail(`${style}/${name}: an opacity carrier survived normalisation`)
  if (/stroke="(?!none)[^"]+"/.test(out)) fail(`${style}/${name}: unexpected stroke paint`)
  for (const f of out.match(/fill="([^"]*)"/g) ?? []) {
    if (!['fill="currentColor"', 'fill="none"'].includes(f)) fail(`${style}/${name}: unexpected ${f}`)
  }
  if (!out.includes('viewBox="0 0 24 24"')) fail(`${style}/${name}: not on the 24 grid`)

  /**
   * ⚠️ SANITISE, BECAUSE THESE ARE MEANT TO BE INLINED AND THAT MAKES THEM MARKUP, NOT AN IMAGE.
   * `category-art.ts` says the artwork must be fetch-and-inlined so `currentColor` works, which
   * means a `<script>`, an `onload=`, a `<use href>` or a `url()` arriving from the dependency
   * would run with the PAGE's authority — not sandboxed the way an `<img>` would be. The set is
   * reputable and today's 114 files are clean, but "trusted upstream" is a supply-chain
   * assumption, not a property of the bytes, and a dependency bump is exactly when it changes.
   *
   * ⚠️ IT SUBTRACTS WHAT IS ALLOWED AND FAILS ON THE REMAINDER, RATHER THAN MATCHING ATTRIBUTES.
   * The first draft scanned for `/\s([a-zA-Z][\w:-]*)=/` and allow-listed the names it found —
   * which two reviewers walked straight through, because that pattern does not describe SVG:
   * `<path d="…" onload = "alert(1)">` has whitespace before the `=`, and `<path/onload=…>` has
   * no whitespace before the NAME. Both matched no rule and were therefore "allowed". Removing
   * the known-good spans and demanding nothing is left has no such gap: whatever syntax an
   * attacker uses, the bytes are still there afterwards.
   */
  const ELEMENTS = ['svg', 'path', 'g']
  const ATTRS = ['xmlns', 'width', 'height', 'viewBox', 'fill', 'fill-rule', 'clip-rule', 'd', 'aria-hidden']
  for (const tag of out.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    const el = tag.match(/^<([a-zA-Z][\w:-]*)/)?.[1] ?? ''
    if (!ELEMENTS.includes(el)) fail(`${style}/${name}: unexpected element <${el}>`)
    let rest = tag.slice(1 + el.length, -1)
    for (const a of ATTRS) rest = rest.replace(new RegExp(`\\s*${a}\\s*=\\s*"[^"]*"`, 'g'), '')
    rest = rest.replace(/[\s/]/g, '')
    if (rest) fail(`${style}/${name}: unexpected markup in <${el} …>: ${JSON.stringify(rest)}`)
  }
  if (/url\s*\(/i.test(out)) fail(`${style}/${name}: contains a url() reference`)

  /**
   * ⚠️ `aria-hidden="true"` IS PUT BACK, AND ITS ABSENCE WAS A REAL REGRESSION. Every file the
   * previous generator wrote carried it; the first draft of this one dropped it and the
   * allow-list above would then have REFUSED to let it return. These are decorative — the tile's
   * own text names the category — so inlined without it a screen reader gains one unlabelled
   * graphic per tile: seventeen on the home grid alone, forty more once the UI set is wired.
   * Caught by all three reviewers independently, which is the strongest signal this loop gives.
   */
  return out.replace(/^<svg /, '<svg aria-hidden="true" ') + '\n'
}

// ── write ────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ RESOLVE AND VALIDATE EVERYTHING BEFORE DELETING ANYTHING. An earlier draft wiped each
 * directory and then wrote into it row by row, so a single missing source name — or a disk error,
 * or a ^C — left `public/icons/rest/` empty or half-populated, which is a live site with missing
 * artwork rather than a failed build. Building the whole set in memory first means the only way to
 * reach the write phase is with all 114 files valid.
 */
const plan = []
const build = (rows, key, dirFor) => {
  for (const [state, style] of Object.entries(STYLE)) {
    const dir = dirFor(state)
    for (const row of rows) {
      if (!available[style].has(row.icon)) {
        fail(
          `${row[key]} -> solar "${row.icon}" does not exist in the ${style} style.\n` +
            `  Pick another name from node_modules/@solar-icons/static/dist/icons/${style}/`
        )
      }
      const svg = readFileSync(join(SRC, style, `${row.icon}.svg`), 'utf8')
      plan.push({ dir, file: `${row[key]}.svg`, name: row[key], state, body: normalise(svg, { name: row.icon, style }) })
    }
  }
}

build(CATEGORIES, 'slug', (state) => join(OUT, state))
build(UI, 'name', (state) => join(OUT, 'ui', state))

/**
 * ⚠️ THE TWO WEIGHTS MUST ACTUALLY DIFFER, AND FOR 55 SOLAR GLYPHS THEY DO NOT.
 *
 * Measured across the whole set: 55 of 1,246 names — every `link*`, `list*`, `undo*`, `repeat*`,
 * `paperclip`, `paperclip-2`, `forward`, `reply`, `maximize` — are drawn IDENTICALLY in Outline
 * and Bold. They are line-only marks with no interior to fill, so Bold has nothing to thicken.
 * Solar's own files differ by the `class="solar-<name>-<style>"` attribute alone, which this
 * generator strips, so the collision is invisible upstream and total downstream.
 *
 * A row that lands on one of them produces a control whose selected state looks exactly like its
 * resting state — the tap appears to do nothing. `attach` was mapped to `paperclip` and did
 * exactly that. Nothing else catches this: both files exist, both parse, both are valid.
 */
const byName = new Map()
for (const p of plan) {
  const key = `${p.dir.replace(/\/(rest|selected)$/, '')}::${p.name}`
  const seen = byName.get(key) ?? {}
  seen[p.state] = p.body
  byName.set(key, seen)
}
const collisions = [...byName.entries()].filter(([, v]) => v.rest && v.selected && v.rest === v.selected)
if (collisions.length) {
  fail(
    `these names render IDENTICALLY at rest and selected, so the active state is invisible:\n` +
      collisions.map(([k]) => `    ${k.split('::')[1]}`).join('\n') +
      `\n\n  Solar draws ~55 line-only glyphs the same in Outline and Bold. Map these to a name\n` +
      `  whose Bold actually differs (e.g. paperclip -> paperclip-rounded).`
  )
}

/**
 * ⚠️ WRITE FIRST, PRUNE AFTER — AND EACH FILE ATOMICALLY. The obvious order (empty the
 * directories, then fill them) has a window in which `public/icons/` is empty or half-populated,
 * and an interruption there does not fail a build: it ships a site with missing artwork, from
 * committed files that were fine a moment ago. So every file lands via a temp write + `rename`,
 * which is atomic within a filesystem, and orphans from a renamed row are removed only once all
 * 114 are on disk. The worst interruption can now do is leave a stale file beside a fresh one.
 */
for (const dir of new Set(plan.map((p) => p.dir))) mkdirSync(dir, { recursive: true })
for (const p of plan) {
  const dest = join(p.dir, p.file)
  const tmp = `${dest}.tmp`
  writeFileSync(tmp, p.body)
  renameSync(tmp, dest)
}
const keep = new Map()
for (const p of plan) keep.set(p.dir, (keep.get(p.dir) ?? new Set()).add(p.file))
keep.set(OUT, keep.get(OUT) ?? new Set())
for (const [dir, files] of keep) {
  for (const f of readdirSync(dir)) {
    // `.tmp` is ours and must never survive — everything under public/ is site-root-addressable.
    if (f.endsWith('.tmp') || (f.endsWith('.svg') && !files.has(f))) rmSync(join(dir, f))
  }
}
const written = plan.length

// ── attribution ──────────────────────────────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules/@solar-icons/static/package.json'), 'utf8'))

/**
 * ⚠️ THE LICENCE OBLIGATION IS PART OF THE ARTEFACT. Solar is CC BY 4.0: we may ship it
 * commercially and modify it, in exchange for crediting the creator, linking the licence, and
 * saying that we changed it. A NOTICE that loses any of those three makes the SVGs beside it
 * unlicensed, so `category-art.test.ts` asserts on this text rather than trusting a habit.
 *
 * The digest is over the exact source bytes this run read — the only thing tying the files here
 * to the release they claim to come from.
 */
const digest = createHash('sha256')
for (const style of Object.values(STYLE)) {
  for (const icon of [...CATEGORIES.map((r) => r.icon), ...UI.map((r) => r.icon)].sort()) {
    digest.update(readFileSync(join(SRC, style, `${icon}.svg`)))
  }
}

// Atomic for the same reason as the SVGs: CC BY 4.0 obliges the attribution to travel WITH
// the artwork, so a truncated NOTICE beside 114 fresh icons is a licensing problem rather
// than a cosmetic one. ⚠️ This removes the TORN-WRITE case only: the SVGs are written first, so
// an interruption between the two phases still leaves fresh icons beside the previous notice.
// That window is one process tick and self-heals on the next run; a torn file does not.
const noticePath = join(OUT, 'NOTICE.md')
writeFileSync(
  noticePath + '.tmp',
  `# Icon attribution

The SVGs under \`public/icons/\` are GENERATED — do not hand-edit them, run \`npm run icons\`.

## Credit

**[Solar Icons](https://solar-icons.vercel.app/)** by **480 Design**, licensed
**CC BY 4.0** — https://creativecommons.org/licenses/by/4.0/
Obtained through the \`@solar-icons/static\` package (version ${pkg.version}), whose packaging
code is MIT. The icon artwork itself is CC BY 4.0 and that is the licence these files carry.

## Changes made

These files are **modified** copies of the originals. \`scripts/gen-icons.mjs\` renames each
glyph to an app-facing name, removes Solar's own \`class="solar solar-<name>-<style>"\` and the
inert root \`stroke-width\`, and collapses whitespace between elements. No geometry and no colour
is altered — every path keeps its original \`d\` and its \`fill="currentColor"\`.

## What is used

Two of Solar's six styles, carrying the app's idle/active grammar:

| directory | Solar style | used for |
|---|---|---|
| \`rest/\` | Outline | a category tile at rest |
| \`selected/\` | Bold | a category tile selected |
| \`ui/rest/\` | Outline | a UI control at rest |
| \`ui/selected/\` | Bold | a UI control active |

Every file paints with \`currentColor\` and carries no baked colour, so the ink follows the
element's own colour in both themes. \`scripts/gen-icons.mjs\` holds the name mapping and the
reasoning behind each choice.

<!-- provenance:begin -->
    source   @solar-icons/static@${pkg.version}
    styles   ${Object.values(STYLE).join(', ')}
    glyphs   ${CATEGORIES.length} category tiles + ${UI.length} UI glyphs
    sha256   ${digest.digest('hex')}
<!-- provenance:end -->
`
)
renameSync(noticePath + '.tmp', noticePath)

console.log(`✓ wrote ${written} SVGs (${CATEGORIES.length} category tiles + ${UI.length} UI glyphs, x2 weights)`)
console.log(`  ${OUT}/{rest,selected}/            category tiles`)
console.log(`  ${OUT}/ui/{rest,selected}/         UI glyphs`)
