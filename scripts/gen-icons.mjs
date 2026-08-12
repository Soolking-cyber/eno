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
import { LUCIDE_TO_SOLAR } from './lucide-solar-map.mjs'

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

  // ── the shield family, for trust ──────────────────────────────────────────────────────────
  // Owner, 2026-08-12: "trust badge use solar pack minimalistic shield no custom icons across
  // the app ... for different types of shiel with tick or other shields seach from solar icon
  // pack already exists". Solar carries thirteen shields; these are the ones trust surfaces
  // need. `trust-shield` is the SCORE badge — the numeral is drawn over it, which is why it is
  // the plain minimalistic silhouette and not one that already has a mark in its centre.
  { name: 'trust-shield', icon: 'shield-minimalistic',
    why: 'The score badge. Deliberately EMPTY inside: trust-score.tsx draws the number at the ' +
         'optical centre, and any shield carrying its own tick/star/user would collide with it.' },
  { name: 'shield-verified', icon: 'shield-check', why: 'A verified/approved shield — the tick variant.' },
  { name: 'shield-warning', icon: 'shield-warning', why: 'A flagged or at-risk shield.' },
  { name: 'shield-star', icon: 'shield-star', why: 'A distinguished / top-tier shield.' },
  { name: 'shield-user', icon: 'shield-user', why: 'Identity-verified — a person inside the shield.' },
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
  // ⚠️ Bold DRAWS SOME GLYPHS WITH PRIMITIVES, NOT ONLY PATHS — `bold/user` carries a <circle>,
  // which the first draft rejected outright. The allow-list covers the shape elements SVG has;
  // anything outside it is still refused.
  const ELEMENTS = ['svg', 'path', 'g', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon']
  const ATTRS = ['xmlns', 'width', 'height', 'viewBox', 'fill', 'fill-rule', 'clip-rule', 'd', 'aria-hidden',
    'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform']
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
  return quantise(out).replace(/^<svg /, '<svg aria-hidden="true" ') + '\n'
}

/**
 * ROUND EVERY COORDINATE TO TWO DECIMALS. This is the single biggest speed lever the icon set has,
 * and it is free: Solar ships coordinates like `12.4142` and `6.58579`, and on a 24-unit viewBox
 * the second decimal is 1/100th of a unit — 0.01px at the 24px these render at, 0.04px at 4× zoom.
 * Sub-pixel at any size this app draws, on any display.
 *
 * ⚠️ MEASURED, BECAUSE "GZIP WILL HANDLE IT" IS THE OBVIOUS OBJECTION AND IT IS WRONG. Shorter
 * numbers are less ENTROPY, not just more repetition, so the win survives compression almost
 * intact — on src/components/ui/icons.tsx: raw 928,400 → 724,477 (−22.0%), gzip 275,248 → 202,549
 * (−26.4%), brotli 175,971 → 130,188 (−26.0%).
 *
 * It matters because that module is ~90% path data by weight and it lands in a chunk EVERY route
 * loads: measured on the built app, /signin pulls the same 244kB of icon geometry to draw nine
 * icons that the home page pulls to draw forty-seven.
 *
 * ⚠️ IT RUNS ON THE WAY OUT OF `normalise`, WHICH IS THE ONE FUNNEL. Components, the standalone
 * .svg files and the icon-paths table are all built from this return value, so rounding here
 * cannot leave the three disagreeing — and the sanitiser above has already validated the markup,
 * so this only ever sees an allow-listed shape.
 */
function quantise(svg) {
  /**
   * ⚠️ TWO GUARDS, BECAUSE THE ROUNDING IS ONLY SAFE FOR THE SHAPE THIS DEPENDENCY SHIPS TODAY,
   * AND BOTH FAILURES WOULD BE SILENT. A reviewer (codex) raised both against an earlier draft
   * whose comment asserted they could not happen; measuring said one of the two assertions was
   * simply wrong, so neither is left as a claim now — they are assertions the build makes.
   *
   *   · RELATIVE COMMANDS (lowercase m/l/c/…). Rounding each coordinate independently is bounded
   *     only because every command here is ABSOLUTE: measured, 886 of 886 paths, zero relative
   *     commands. In a relative path the errors ACCUMULATE along the segment chain, so a long
   *     path could drift far past a pixel with nothing to show for it but a slightly wrong glyph.
   *   · SCIENTIFIC NOTATION. The number regex matches the mantissa of `1.234e-5` and would leave
   *     `1.23e-5` behind — a real rewrite, not the no-op the earlier comment claimed. There is
   *     none inside path data today (checked), which is exactly why it would go unnoticed.
   *
   * Both are `fail()`, not silent skips: a generator that quietly declines to optimise is how you
   * end up unable to explain why one glyph is heavier than its neighbours.
   */
  const geometry = [...svg.matchAll(/\s(?:d|cx|cy|rx|ry|r|x|y|x1|y1|x2|y2|width|height|points)="([^"]*)"/g)].map((m) => m[1])
  for (const g of geometry) {
    if (/\d[eE][-+]?\d/.test(g)) fail(`scientific notation in geometry (${g.slice(0, 40)}…) — quantise() would rewrite the mantissa`)
    if (/[mlhvcsqtaz]/.test(g)) fail(`relative path command in geometry (${g.slice(0, 40)}…) — rounding accumulates error along a relative chain`)
  }

  // ⚠️ ONLY INSIDE GEOMETRY ATTRIBUTES. A blanket pass over the markup would also rewrite the
  // viewBox and, worse, anything numeric that is an identifier rather than a measurement.
  // `parseFloat(toFixed())` is what drops a trailing zero, so 0.50 comes out "0.5" and not "0.50".
  const round = (v) => v.replace(/-?\d*\.\d+/g, (m) => String(parseFloat(Number(m).toFixed(2))))
  return svg
    .replace(/\sd="([^"]*)"/g, (_m, d) => ` d="${round(d)}"`)
    .replace(/\s(cx|cy|rx|ry|r|x|y|x1|y1|x2|y2|width|height|points)="([^"]*)"/g, (_m, a, v) => ` ${a}="${round(v)}"`)
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

// ── the module the app actually renders ──────────────────────────────────────────────────────

/**
 * ⚠️ THE SVG FILES ARE NOT WHAT THE APP MOUNTS — THIS MODULE IS.
 *
 * `category-art.ts` has always said the artwork must be fetch-and-INLINED rather than `<img
 * src>`-ed, because an `<img>` isolates the file from the page's colour and `currentColor` stops
 * working: no hover, no selected, no dark mode. But "inline it" via 114 separate URLs is 114
 * requests on the chrome above the fold, which is worse than the lucide glyphs it replaces.
 *
 * So the same generator pass that writes the files also writes their path data here, from the
 * SAME normalised bytes — there is no second transcription to drift. A tile renders one inline
 * `<svg>` with no network at all, and `icon-paths.test.ts` re-parses the SVGs and asserts the
 * module still agrees with them path for path.
 */
const asPaths = (body) => {
  // ⚠️ FAIL ON A SHAPE THIS CANNOT REPRESENT, RATHER THAN DROPPING IT SILENTLY. This module
  // carries only `d` strings, but Solar's Bold weight draws some glyphs with <circle>/<rect>
  // (`bold/user` is one). Today all 57 category + UI glyphs are path-only — measured — so
  // nothing is lost; the moment a mapping change pulls in a primitive, a tile would render with
  // a piece missing and every "path for path" assertion would still pass. Three reviewers raised
  // this independently, which is why it is a build failure and not a comment.
  const shapes = [...body.matchAll(/<([a-z]+)\b/g)].map((m) => m[1]).filter((e) => e !== 'g' && e !== 'svg')
  const unsupported = [...new Set(shapes)].filter((e) => e !== 'path')
  if (unsupported.length) fail(`icon-paths.ts cannot carry <${unsupported.join('>, <')}> — extend the module contract or pick a path-only glyph`)
  if (/\stransform=/.test(body)) fail('icon-paths.ts cannot carry a transform — it would displace the geometry')
  return [...body.matchAll(/<path\b([^>]*?)\/?>/g)].map(([, a]) => {
    const d = a.match(/\sd="([^"]*)"/)?.[1]
    if (!d) fail('a <path> with no d= survived normalisation')
    return { d, evenOdd: /fill-rule="evenodd"/.test(a) }
  })
}

const CATEGORY_SLUGS = new Set(CATEGORIES.map((r) => r.slug))
const art = { category: {}, ui: {} }
for (const p of plan) {
  const bucket = CATEGORY_SLUGS.has(p.name) && !p.dir.includes('/ui/') ? 'category' : 'ui'
  ;(art[bucket][p.name] ??= {})[p.state] = asPaths(p.body)
}

const lit = (rows) =>
  Object.entries(rows)
    .map(
      ([name, states]) =>
        `  ${JSON.stringify(name)}: {\n` +
        ['rest', 'selected']
          .map(
            (s) =>
              `    ${s}: [${states[s]
                .map((q) => `{ d: ${JSON.stringify(q.d)}${q.evenOdd ? ', evenOdd: true' : ''} }`)
                .join(', ')}],`
          )
          .join('\n') +
        `\n  },`
    )
    .join('\n')

writeFileSync(
  join(ROOT, 'src/generated/icon-paths.ts'),
  `// GENERATED by scripts/gen-icons.mjs — do not edit. Run \`npm run icons\`.
//
// Path data for the official Solar v2 artwork, emitted from the same pass that writes
// public/icons/**. Inlined rather than fetched so \`currentColor\` drives the ink: a tile's own
// hover / selected / dark-mode colour reaches the glyph, which an <img> or a CSS mask cannot do.
//
// \`evenOdd\` carries Solar's \`fill-rule="evenodd"\`, which is load-bearing: without it every
// counter (the hole in a keyhole, the gap in a padlock) fills solid and the glyph becomes a blob.

/** One filled subpath. \`evenOdd\` means it needs \`fillRule="evenodd"\` to keep its holes. */
export type IconPath = { readonly d: string; readonly evenOdd?: boolean }

/** \`rest\` = Solar Outline, \`selected\` = Solar Bold. Both are separately drawn glyphs. */
export type IconArt = { readonly rest: readonly IconPath[]; readonly selected: readonly IconPath[] }

/** The 17 category tiles, keyed by taxonomy slug. */
export const CATEGORY_ART: Readonly<Record<string, IconArt>> = {
${lit(art.category)}
}

/** The 40 UI glyphs, keyed by the app-facing name in \`src/lib/ui-icons.ts\`. */
export const UI_ART: Readonly<Record<string, IconArt>> = {
${lit(art.ui)}
}
`
)

// ── the lucide drop-in shim ──────────────────────────────────────────────────────────────────

/**
 * ⚠️ 155 FILES IMPORT lucide-react. THIS IS WHAT LETS THEM ALL SWAP IN ONE LINE EACH.
 *
 * `src/components/ui/icons.tsx` exports one component per lucide name the app uses, drawn with
 * Solar geometry. A call site keeps writing `<Search className="h-4 w-4" />` and changes only its
 * import path. The alternative — rewriting 235 distinct icon names across 155 files by hand — is
 * a diff nobody can review and a migration that half-lands.
 *
 * ⚠️ ONE EXPORTED CONST PER ICON, EACH CARRYING ITS OWN PATH DATA, SO THE BUNDLER CAN DROP THE
 * REST. A single `Record<name, paths>` object would pull all 235 glyphs into every route that
 * imports any one of them. Separate top-level consts with no side effects are tree-shakeable, so
 * a route that imports `<Search/>` ships one path string.
 *
 * ⚠️ EVERY ICON SHIPS BOTH WEIGHTS AND CSS PICKS ONE — Outline at rest, Bold while pressed.
 * Owner, 2026-08-12: *"all across the app with new icons the button pressed state is bold and
 * unpressed outline version"*, which is the same grammar the category tiles already use.
 *
 * ⚠️ IT IS CSS RATHER THAN A PROP, AND THAT IS THE ONLY REASON IT COULD LAND AT ALL. Threading an
 * `active` prop would mean editing every one of ~800 icon call sites and knowing, at each, which
 * boolean means "pressed" — a migration nobody finishes. Two <g> layers and one rule in
 * globals.css cover every button, link, tab and toggle in the app without touching a call site,
 * and a component that has no pressed state simply never matches the selector.
 *
 * ⚠️ THE COST IS HONEST: two path sets per icon instead of one. Each icon is still its own
 * tree-shakeable const, so a route pays only for the icons it renders.
 *
 * ⚠️ THE PROPS CONTRACT IS LUCIDE'S, INCLUDING THE PARTS THAT DO NOTHING HERE. `strokeWidth` and
 * `absoluteStrokeWidth` are accepted and IGNORED: Solar's Outline weight is a filled outline, not
 * a stroke, so there is nothing to widen. Dropping them from the type instead would break ~30
 * call sites that pass `strokeWidth={STROKE_UI}` and force this migration to touch their bodies.
 */
const shimRows = Object.entries(LUCIDE_TO_SOLAR).sort(([a], [b]) => a.localeCompare(b))
/**
 * The inner markup of one weight, with SVG attribute names rewritten to their JSX spellings.
 * ⚠️ NOT `asPaths` — that only sees <path>, and Bold uses <circle> and <rect> in places. Emitting
 * the sanitised markup verbatim keeps every shape; the allow-list above is what makes that safe.
 */
const JSX_ATTR = { 'fill-rule': 'fillRule', 'clip-rule': 'clipRule', 'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin' }
const layer = (solar, style) => {
  const svg = normalise(readFileSync(join(SRC, style, `${solar}.svg`), 'utf8'), { name: solar, style })
  let inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  for (const [a, j] of Object.entries(JSX_ATTR)) inner = inner.split(a + '=').join(j + '=')
  return inner
}

const shimBody = shimRows
  .map(([lucide, solar]) => {
    for (const style of ['outline', 'bold']) {
      if (!available[style].has(solar)) fail(`lucide ${lucide} -> solar "${solar}" is not in the ${style} style`)
    }
    return (
      `/** Solar \`${solar}\` — Outline at rest, Bold while pressed. */\n` +
      `export const ${lucide} = (p: IconProps) => <Glyph {...p}>` +
      `<g className="i-rest">${layer(solar, 'outline')}</g>` +
      `<g className="i-on">${layer(solar, 'bold')}</g>` +
      `</Glyph>`
    )
  })
  .join('\n')

writeFileSync(
  join(ROOT, 'src/components/ui/icons.tsx'),
  `// GENERATED by scripts/gen-icons.mjs — do not edit. Run \`npm run icons\`.
//
// A drop-in replacement for the lucide-react imports this app used to make, drawn with official
// Solar v2 (Outline). Call sites are unchanged except for the import path; the name -> glyph
// mapping, and every judgement call behind it, lives in scripts/lucide-solar-map.mjs.
import type { SVGProps } from 'react'

/**
 * lucide's prop shape. \`size\`, \`strokeWidth\` and \`absoluteStrokeWidth\` are accepted for source
 * compatibility; the first sets the box, the other two are INERT because Solar's Outline weight is
 * a filled outline with no stroke to widen. They are kept so a call site passing
 * \`strokeWidth={STROKE_UI}\` still compiles.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & {
  size?: number | string
  strokeWidth?: number | string
  absoluteStrokeWidth?: boolean
}

/** The type lucide exports for "a component that renders an icon", used where icons are passed around. */
export type LucideIcon = (props: IconProps) => React.ReactElement

function Glyph({ size = 24, strokeWidth: _sw, absoluteStrokeWidth: _asw, children, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

${shimBody}
`
)

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
