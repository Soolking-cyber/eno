import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MASCOT_NAMES } from './mascot'

/**
 * THE CHECK THAT KEEPS THE NINE MASCOTS THE SAME SIZE.
 *
 * `Mascot` paints these as a CSS mask with `mask-size: contain` inside a square box, so the
 * VIEWBOX decides how large eno renders — not the drawing inside it. Nine files sharing one 512
 * canvas means the shield is identical on every empty state; nine files each cropped to their
 * own content means it is not, and nothing about the drawing looks wrong in isolation.
 *
 * That is not hypothetical. The design project ships this same artwork with a per-file viewBox
 * (497.50 on `success`, 564.89 on `key`), which renders the shield 13.55% larger on one empty
 * state than another — eno quietly changing size as you move around the app. A screenshot of any
 * single page looks fine, so this is the only place that catches it.
 *
 * ⚠️ WHAT THIS SUITE DOES **NOT** DO, STATED PLAINLY BECAUSE AN OVERSOLD GUARD IS WORSE THAN NONE.
 * It reads bytes with regexes; it does not lay out SVG. `getBBox` needs a real engine and vitest
 * runs in node here, so:
 *   · RELATIVE path deltas are not summed. `M400 410 h144` clips at 544 with every literal
 *     under 512 and passes. Only `<rect>`/`<circle>`, whose extent is one addition, are summed.
 *   · A TRACED group's geometry is not bounded at all — its coordinates are four-digit potrace
 *     numbers in a pre-transform space, where 512 means nothing.
 *   · Ancestor transforms are not composed.
 * What it does enforce is the shape of the regression actually seen: a widened viewBox, and prop
 * coordinates lifted from a set drawn on a bigger canvas. Render the file before you trust it.
 */
const DIR = fileURLToPath(new URL('../../../public/mascots', import.meta.url))
const read = (name: string) => readFileSync(join(DIR, `${name}.svg`), 'utf8')

/** Any paint other than `none`. */
const STROKE_PAINT = /stroke="(?!none)[^"]+"/

/**
 * The stroked prop groups on `key` and `profile`, i.e. `<g fill="none" stroke="…">`.
 * The traced groups are excluded on purpose — see the header.
 */
const strokedGroups = (svg: string) =>
  [...svg.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)].filter(([, attrs]) => STROKE_PAINT.test(attrs))

/**
 * How many stroked prop groups each file is expected to carry.
 *
 * ⚠️ WITHOUT THIS, EVERY PROP ASSERTION BELOW PASSES VACUOUSLY ON THE MOST LIKELY REGRESSION.
 * `mascot-draw.mjs` lives in another repository and still emits the potrace props as
 * `<g fill="#000000" stroke="none" transform="…">`. `stroke="none"` is not a paint, so
 * `strokedGroups()` would return `[]`, and "every stroked group declares its width", "…is
 * untransformed" and "…stays on the canvas" would all be green over artwork that had silently
 * reverted. Counting is what makes the other three mean anything.
 */
const PROP_GROUPS: Record<string, number> = {
  wave: 0, saved: 0, help: 0, key: 1, search: 0, profile: 1, chat: 0, success: 0, cookie: 0,
}

/**
 * Read one numeric attribute.
 *
 * ⚠️ TWO WAYS THIS SILENTLY READ THE WRONG NUMBER, BOTH FOUND BY REVIEW:
 *   · without the leading `(?:^|\s)` it matched a longer attribute ENDING in the name — `x`
 *     inside `rx`, `width` inside `stroke-width`;
 *   · quoted with `'` instead of `"` it matched nothing and fell back to a default of 0, which
 *     sails through every bounds check below. A miss now THROWS instead of defaulting, because a
 *     bounds test that quietly measures zero is worse than no bounds test.
 */
const attr = (el: string, name: string): number => {
  const m = el.match(new RegExp(`(?:^|\\s)${name}=("|')(-?[\\d.]+)\\1`))
  if (!m) throw new Error(`expected a numeric ${name}= on ${el}`)
  return Number(m[2])
}

describe('the mascot family shares one canvas', () => {
  it('has exactly one file per name, and no orphans', () => {
    const onDisk = readdirSync(DIR)
      .filter((f) => f.endsWith('.svg'))
      .map((f) => f.replace(/\.svg$/, ''))
      .sort()
    expect(onDisk).toEqual([...MASCOT_NAMES].sort())
  })

  it.each(MASCOT_NAMES)('%s is on the shared 0 0 512 512 canvas', (name) => {
    const svg = read(name)
    expect(svg).toContain('viewBox="0 0 512 512"')
    expect(svg).toMatch(/width="512"\s+height="512"/)
  })

  it.each(MASCOT_NAMES)('%s declares no opacity', (name) => {
    // A mask reads ALPHA only, so `opacity` is not a styling choice here — it silently fades part
    // of the glyph and no amount of `text-*` on the span can bring it back. Both quote styles,
    // and inside a `style=`, because the input is hand-maintained.
    const svg = read(name)
    expect(svg).not.toMatch(/\bopacity\s*=/)
    expect(svg).not.toMatch(/style=("|')[^"']*opacity/)
  })

  it.each(MASCOT_NAMES)('%s keeps stroke paint on the group, where it can be checked', (name) => {
    // Every assertion below reads the GROUP's attributes. A stroke moved onto a child would slip
    // past all of them, so the group form is required rather than assumed — that keeps the checks
    // sound by construction instead of by luck.
    for (const el of read(name).match(/<(?:path|circle|rect|ellipse|line|polyline|polygon)\b[^>]*>/g) ?? []) {
      expect(el, `${name}: a drawing element carries its own stroke paint`).not.toMatch(STROKE_PAINT)
    }
  })

  it.each(MASCOT_NAMES)('%s nests no groups, which would blind the group scan', (name) => {
    // `strokedGroups` pairs `<g …>` with the next `</g>`. On `<g><g stroke…>…</g></g>` that pairs
    // the OUTER attrs with the INNER body and consumes the inner open tag, so a stroked group can
    // disappear from the scan entirely and every prop assertion passes vacuously.
    for (const [, , body] of [...read(name).matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)]) {
      expect(body, `${name}: nested <g>`).not.toMatch(/<g\b/)
    }
  })

  it.each(MASCOT_NAMES)('%s still carries the prop groups the checks below assume', (name) => {
    expect(strokedGroups(read(name)), `${name}: prop group count changed — see PROP_GROUPS`).toHaveLength(
      PROP_GROUPS[name]
    )
  })

  it.each(MASCOT_NAMES)('%s: every stroked prop group declares its width, and paints it', (name) => {
    for (const [, attrs] of strokedGroups(read(name))) {
      // Without the attribute the SVG default is 1 — a hairline at any real size — and a test that
      // only asserts on widths it FINDS passes vacuously on exactly that regression.
      const w = attrs.match(/(?:^|\s)stroke-width="([\d.]+)"/)
      expect(w, `${name}: a stroked group has no stroke-width`).not.toBeNull()
      expect(Number(w![1])).toBeGreaterThanOrEqual(8) // the rig's outer line weight

      // ...and the declared width is the PAINTED width only while nothing scales it. The two
      // traced prop groups these replaced carried `scale(0.49)`/`scale(0.56)` chains, under which
      // a literal 8 paints at 3.9 and this floor would be theatre. (Only the group's own
      // transform is visible here; the no-nesting rule above is what makes that sufficient.)
      expect(attrs, `${name}: a stroked group is transformed`).not.toMatch(/(?:^|\s)transform=/)
    }
  })

  it.each(MASCOT_NAMES)('%s: stroked prop geometry stays on the canvas', (name) => {
    // The viewBox check catches a WIDENED canvas. This catches the likelier shape of the same
    // regression: pasting the design project's props (x 429..624 on key, 421..560 on profile)
    // into a 512 file, where the right third is silently clipped by the viewport while every
    // other assertion still passes. Verified to FAIL on both of those files.
    for (const [, attrs, body] of strokedGroups(read(name))) {
      const half = Number(attrs.match(/(?:^|\s)stroke-width="([\d.]+)"/)?.[1] ?? 0) / 2

      // ⚠️ A CHILD transform defeats every coordinate check that follows: `<rect x="10"
      // transform="translate(900,900)">` reads as on-canvas and renders 900 units away. The
      // group-level no-transform rule says nothing about children, so say it here.
      for (const el of body.match(/<[a-z]+\b[^>]*>/g) ?? []) {
        expect(el, `${name}: a prop child is transformed`).not.toMatch(/(?:^|\s)transform=/)
      }

      // A coarse bound first — see the header for what it cannot see. Bounded on BOTH sides:
      // `Math.abs` alone let `M-40 410 h144` through, which is clipped at the left edge. Today
      // every number in these two groups is non-negative, so if a future prop genuinely needs a
      // negative relative delta, relax this deliberately rather than by accident.
      for (const n of body.match(/-?\d+(?:\.\d+)?/g) ?? []) {
        expect(Number(n), `${n} in ${name} is off the 512 canvas`).toBeGreaterThanOrEqual(0)
        expect(Number(n), `${n} in ${name} is off the 512 canvas`).toBeLessThanOrEqual(512)
      }

      // ⚠️ AND THE SUM-EXTENT SHAPES, because the bound above cannot see them: the design's
      // `profile` card is `x="426" width="130"` — not one number over 512, right edge at 556.
      // The half-stroke is included; ink, not centre lines, is what gets clipped.
      const within = (lo: number, hi: number, what: string) => {
        expect(lo - half, `${name}: ${what} runs off the top/left`).toBeGreaterThanOrEqual(0)
        expect(hi + half, `${name}: ${what} runs off the bottom/right`).toBeLessThanOrEqual(512)
      }
      for (const el of body.match(/<rect\b[^>]*>/g) ?? []) {
        within(attr(el, 'x'), attr(el, 'x') + attr(el, 'width'), 'a rect')
        within(attr(el, 'y'), attr(el, 'y') + attr(el, 'height'), 'a rect')
      }
      for (const el of body.match(/<circle\b[^>]*>/g) ?? []) {
        within(attr(el, 'cx') - attr(el, 'r'), attr(el, 'cx') + attr(el, 'r'), 'a circle')
        within(attr(el, 'cy') - attr(el, 'r'), attr(el, 'cy') + attr(el, 'r'), 'a circle')
      }
    }
  })
})
