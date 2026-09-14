import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ COLOUR IN THE BOTTOM BAR MEANS "YOU ARE HERE", AND THIS TEST IS THE ONLY THING ENFORCING IT.
 *
 * Owner, 2026-08-28, looking at a blue heart while standing on Explore: "only blue if button is
 * pressed not when has noticification or saved counter increases". The banned shape was written
 * deliberately twice: first as the glyph Heart's `count > 0 && 'fill-brand text-brand'` (and the
 * bubble's unread fill), then ported to the 3D art as `lit={on || count > 0}`. The owner said no on a
 * real phone. A comment was its only guard, which is exactly what a reviewer flagged.
 *
 * ⚠️ THE BAR IS BACK ON SOLAR v2 GLYPHS (owner, 2026-09-14: "on mobile bottom navbar icons move back to
 * solar v2 version"), and the glyphs are exactly where the old fills lived — so the rule is now asserted
 * against the glyph call sites: location is TabBody's wash and the link's aria-current (Solar Bold), and no
 * glyph may take a fill or colour from a count. (The file keeps its name so its history stays with it; the
 * 3D `NavArt` it once guarded is no longer rendered by the bar.)
 *
 * ⚠️ THIS IS A SOURCE ASSERTION, WHICH IS THE UNUSUAL PART AND THE NECESSARY PART. The failure is a class
 * expression, not a rendered outcome: rendering `mobile-nav` would need a route, an auth context, a
 * favourites context and a fetch, and would still only cover the states the test set up.
 */
const SRC = 'src/components/marketplace/mobile-nav.tsx'

describe('bottom nav: lit means location', () => {
  const code = readFileSync(SRC, 'utf8')
  const glyphs = [...code.matchAll(/<(Heart|MessageSquare|User|Plus)\s+([^>]*?)\/>/g)].map((m) => ({ name: m[1], props: m[2].replace(/\s+/g, ' ').trim() }))
  const compass = [...code.matchAll(/<CategoryGlyphArt\s+([^>]*?)\/>/g)].map((m) => m[1].replace(/\s+/g, ' ').trim())

  it('finds all five tabs as Solar glyphs, and no 3D art', () => {
    expect(compass.filter((c) => c.includes('Icon={Compass}')), 'Explore renders the Compass duotone').toHaveLength(1)
    for (const name of ['Heart', 'MessageSquare', 'User', 'Plus']) {
      expect(glyphs.filter((g) => g.name === name), `exactly one <${name}> in ${SRC}`).toHaveLength(1)
    }
    expect(code, 'the bar went back to Solar v2 glyphs; a <NavArt> here means the 3D art crept back').not.toMatch(/<NavArt\b/)
  })

  it('never lights a glyph from a count, an unread total or anything but the active state', () => {
    for (const { name, props } of glyphs) {
      if (name === 'Plus') continue // Post is an ACTION, not a place: its coin is always brand, by design
      expect(
        props,
        `<${name} ${props}/> carries a fill or colour. Colour in this bar means "you are here" and nothing ` +
          `else — a saved count or an unread total lights tabs the visitor is not on. The BADGE carries those.`,
      ).not.toMatch(/fill-|text-brand|count|unread/)
    }
    expect(compass[0], 'Explore takes its selected state from TabBody, never from a count').toMatch(/selected=\{on\}/)
  })
})
