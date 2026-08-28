import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ COLOUR IN THE BOTTOM BAR MEANS "YOU ARE HERE", AND THIS TEST IS THE ONLY THING ENFORCING IT.
 *
 * Owner, 2026-08-28, looking at a blue heart while standing on Explore: "only blue if button is
 * pressed not when has noticification or saved counter increases". The shape being banned —
 * `lit={on || count > 0}` — is not a slip. It was written deliberately, as a faithful port of the
 * lucide Heart that painted itself `fill-brand` whenever anything was saved, and it survived a
 * review round on that reasoning before the owner saw it on a real phone and said no. A comment
 * was its only guard, which is exactly what a reviewer flagged: the same well-intentioned change
 * will be made again by whoever next reads "the badge is easy to miss".
 *
 * ⚠️ THIS IS A SOURCE ASSERTION, WHICH IS THE UNUSUAL PART AND THE NECESSARY PART. The failure is
 * a prop expression, not a rendered outcome: rendering `mobile-nav` and asserting a filter would
 * need a route, an auth context, a favourites context and a fetch, and would still only cover the
 * states the test happened to set up. Reading the call sites catches every one of them at once.
 */
const SRC = 'src/components/marketplace/mobile-nav.tsx'

describe('bottom nav: lit means location', () => {
  const code = readFileSync(SRC, 'utf8')
  const calls = [...code.matchAll(/<NavArt\s+([^>]*?)\/>/gs)].map((m) => m[1].replace(/\s+/g, ' ').trim())

  it('finds all five tabs', () => {
    expect(calls, `no <NavArt> call sites in ${SRC} — did the bar move or get renamed?`).toHaveLength(5)
    for (const name of ['explore', 'saved', 'post', 'messages', 'account']) {
      expect(calls.some((c) => c.includes(`name="${name}"`)), `no tab renders name="${name}"`).toBe(true)
    }
  })

  it('never derives lit from a count, an unread total or anything but the active state', () => {
    for (const call of calls) {
      const lit = /lit=\{([^}]*)\}/.exec(call)?.[1]
      // Post is the one exception and it is bare `lit` with no expression — an ACTION, not a place.
      if (lit === undefined) {
        expect(call, 'a tab with no `lit` at all would be permanently grey').toContain('lit')
        expect(call, 'only the Post tab may be unconditionally lit').toContain('name="post"')
        continue
      }
      expect(
        lit,
        `<NavArt ${call}/> derives lit from something other than the active tab. Colour in this bar ` +
          `means "you are here" and nothing else — a saved count or an unread total lights tabs the ` +
          `visitor is not on, and the row stops showing location. The BADGE carries those. ` +
          `See nav-art.tsx.`,
      ).toBe('on')
    }
  })
})
