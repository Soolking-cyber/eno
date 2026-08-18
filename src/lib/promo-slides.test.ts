import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROMO_SLIDES } from './promo-slides'

/**
 * THE HOME BANNER'S ONE PAID SHAPE — the guarantee that a bought slide names who bought it.
 *
 * A slide carrying `art` is different in kind from every other slide here: the artwork replaces
 * eno's own bilingual copy with a third party's message, in the one position above the fold that
 * every visitor sees. So it has to be attributable. The TYPE already carries most of that weight —
 * `partner` lives INSIDE the `art` object, so you cannot add artwork without naming the advertiser
 * (see the note in promo-slides.ts) — and this file covers only what a type cannot express.
 *
 * ⚠️ AND A LINT COULD NOT HAVE DONE THIS JOB. scripts/design-lint.mjs walks `.tsx` only; the data
 * being guarded is a `.ts` module, so it is invisible to the one gate that looks like the obvious
 * home for a rule like this. That is why the check is a test.
 *
 * ⚠️ THESE ASSERTIONS PASS VACUOUSLY WHEN NO SLIDE CARRIES `art`, AND THAT IS CORRECT HERE — unlike
 * expat-guides.test.ts, which guards a registry that must never be empty. No baked artwork means no
 * bought slide and therefore nothing to disclose; a "there must be at least one" guard would turn
 * the legitimate removal of a partner banner into a red suite.
 */
describe('promo slides — partner attribution', () => {
  const withArt = PROMO_SLIDES.filter((s) => s.art)

  it('every slide carrying baked artwork names a non-empty partner', () => {
    for (const slide of withArt) {
      const partner = slide.art?.partner
      // typeof, not just truthiness: this is what catches the field being widened to optional or
      // dropped through an `as` cast later — the exact ways a type guarantee stops guaranteeing.
      expect(
        typeof partner,
        `${slide.key}: art.partner must be a string — a bought banner has to say whose it is`,
      ).toBe('string')
      expect(
        partner?.trim(),
        `${slide.key}: art.partner is blank — the panel would render a bare "Advertisement ·" chip with nobody attached to it`,
      ).not.toBe('')
    }
  })

  /**
   * ⚠️ LOAD-BEARING, NOT TIDINESS — promo-banner.tsx RELIES ON THIS ONE. The panel renders the image
   * instead of any DOM copy, so `alt` is the entire message a screen reader receives, and the link's
   * aria-label is built as "<Advertisement> — <alt>". The partner's name is deliberately NOT
   * prepended there, because `alt` already opens with their lockup and prepending it made the label
   * read "Advertisement · VietKite — VietKite — …" (measured; a screen reader said the name twice).
   * Dropping the name from the label is only safe while the name is guaranteed to be IN the alt.
   * This is that guarantee. Delete it and the disclosure silently stops naming anyone.
   *
   * Case-insensitive on purpose: the artwork's own lockup casing is the partner's to choose, and
   * this check is about attribution, not typography.
   */
  it('the alt text of an art slide names the partner in both languages', () => {
    for (const slide of withArt) {
      const { partner, alt = '', altVi = '' } = slide.art ?? {}
      // ⛔ `partner: null` MEANS "THIS IS ENO'S OWN", AND SUCH A SLIDE HAS NOBODY TO ATTRIBUTE.
      // The assertion below exists so a PAID slide can never lose its attribution; applying it to
      // an own-brand banner would demand eno name itself as its own advertiser, which is the false
      // disclosure the null case was added to avoid. Skipped, not weakened — every slide that DOES
      // name a partner is still checked in both languages.
      if (partner === null || partner === undefined) continue
      const needle = partner.trim().toLowerCase()
      expect(
        alt.toLowerCase(),
        `${slide.key}: the English alt does not mention "${partner}" — alt is the only message a screen reader gets from baked artwork`,
      ).toContain(needle)
      expect(
        altVi.toLowerCase(),
        `${slide.key}: the Vietnamese alt does not mention "${partner}"`,
      ).toContain(needle)
    }
  })

  /**
   * Not attribution, but it belongs with it: the two cuts are switched by a `<source media>` in
   * promo-banner.tsx, so a slide that supplies one and not the other silently serves the wrong
   * aspect to half the visitors — the failure the two-file split exists to prevent.
   *
   * ⚠️ IT RESOLVES THE PATHS ON DISK RATHER THAN COMPARING TWO STRINGS. A reviewer pointed out that
   * asserting `mobile !== desktop` proves only that somebody typed two different things, which is
   * the cheap half of the check — a typo'd path passes it and then 404s. This slide IS the home
   * page's LCP element, so a missing file is a hole above the fold on the first paint every visitor
   * gets, and `surface` is not underneath an art slide to catch it (the art branch replaces the
   * gradient entirely). Paths are public/ URLs, so the file is `public` + the leading-slash path.
   */
  it('an art slide supplies BOTH cuts and both files exist in public/', () => {
    for (const slide of withArt) {
      const { mobile = '', desktop = '' } = slide.art ?? {}
      expect(
        mobile,
        `${slide.key}: the mobile and desktop cuts are the same file — one of the two aspect ratios will be cropped through the artwork`,
      ).not.toBe(desktop)
      for (const [cut, href] of [['mobile', mobile], ['desktop', desktop]] as const) {
        expect(href, `${slide.key}: the ${cut} cut is missing from the slide`).toBeTruthy()
        expect(
          existsSync(join('public', href)),
          `${slide.key}: the ${cut} cut "${href}" does not exist in public/ — the banner is the home page's LCP element, so this 404s above the fold`,
        ).toBe(true)
      }
    }
  })
})
