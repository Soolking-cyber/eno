'use client'

import { ArrowUpRight } from '@/components/ui/icons'
import { useId } from 'react'
import { Row, Rows } from '@/components/ui/rows'
import { useLanguage } from '@/context/language-context'
import { CROSS_SITE_REL, MARKETPLACE_HOME, MARKETPLACE_LINKS } from '@/lib/cross-site-links'
import { handleExternalClick } from '@/lib/native-browser'
import { AFFILIATION } from '@/lib/site-legal'
import { cn } from '@/lib/utils'

/**
 * "ALREADY IN VIETNAM?" — the eno.vn introduction, shown on eno.forum only.
 *
 * A visa applicant is, almost by definition, about to arrive in Vietnam and about to need somewhere
 * to live and something to ride. Saying so once, at the bottom of the page they came to read, is
 * useful. Saying it in a banner on every surface is an ad unit, and this component is written to
 * make the first easy and the second obviously wrong — see the placement note below.
 *
 * ⚠️ IT DISCLOSES THE RELATIONSHIP IN THE SAME BREATH AS THE PITCH. `AFFILIATION.short*` from
 * src/lib/site-legal.ts renders directly under the links, because a recommendation between two
 * sites in one brand family is only honest if the reader is told they are in one brand family. The
 * line may NOT be reworded here to something warmer, and it may NOT be dropped when the layout gets
 * tight: it is the reason this is promotion rather than an undisclosed cross-sell. (It also may not
 * say the sites are UNRELATED — that constant carries the full reasoning.)
 *
 * ⚠️ PLACEMENT IS PART OF THE DESIGN, NOT A DETAIL OF IT — AND THE RULE IS A SHAPE, NOT A COUNT.
 * It belongs at the END of a long-form, services-only page whose reader is planning a move to
 * Vietnam: /vietnam-evisa, /services-for-expats-vietnam and /moving-to-vietnam today (grep for
 * `CrossSitePromo` and `crossSitePromo` for the live list — a number written here would be wrong
 * within a week). It does NOT belong in the header, the home feed, a chat thread, a listing page,
 * or anything that renders on more than a handful of routes. Two things break at once if it
 * spreads: a reader starts seeing an ad unit rather than a recommendation, and the links stop being
 * editorial — boilerplate repeated site-wide is precisely the pattern a crawler discounts, so
 * over-using this surface is the one way to make it worth less rather than more.
 *
 * ⚠️ ALIASED AWAY ON A MARKETPLACE BUILD (next.config.ts → cross-site-promo.stub.tsx). On eno.vn
 * this is a page advertising eno.vn to a reader who is on eno.vn. The empty-list guard below
 * already makes it render nothing there via the lib stub — the alias is what additionally keeps the
 * copy out of the artifact, which a guard cannot do.
 *
 * ⚠️ ITS STRINGS ARE HARVESTED INTO THE SERVICES TRANSLATION CATALOGUE, and that took a deliberate
 * edit: scripts/gen-ui-strings.mjs classifies a `tr()` literal by the PATH of the file it was found
 * in, and this file sits in src/components/marketplace/ with everything shared. Without an entry in
 * that script's SERVICES_SOURCES, these sentences would land in `ui-strings.ts` — the catalogue
 * eno.vn ships to every browser to pre-warm translations — and the alias above would not save us,
 * because the leak would be through a generated file this module never imports.
 */
export function CrossSitePromo({ className }: { className?: string }) {
  const { tr } = useLanguage()
  // ⚠️ useId, not a literal. The component is reusable and the placement rule says one per page —
  // but "one per page" is a convention, and a duplicated literal id would silently point the
  // second section's aria-labelledby at the first one's heading. Hooks run before the early
  // return below, which is why this sits above it.
  const titleId = useId()

  // The home link leads the list, then the three most useful destinations for somebody who has just
  // arrived. Three, not four: the fourth (moving sales) is the least likely thing a new arrival
  // needs on day one and is still one click away in the footer column. The order lives in the lib.
  const home = MARKETPLACE_HOME
  const links = home ? [home, ...MARKETPLACE_LINKS.slice(0, 3)] : []

  // The marketplace-edition stub resolves both of these to nothing. Belt and braces beside the
  // alias: a future build that forgets the alias must still render nothing rather than a block of
  // self-links with an empty href.
  if (links.length === 0) return null

  return (
    <section
      aria-labelledby={titleId}
      className={cn('mt-14 max-w-3xl border-t border-border pt-8', className)}
    >
      <p className="eyebrow mb-2 text-accent-foreground">{tr('Also from eno', 'Cũng từ eno')}</p>
      <h2 id={titleId} className="h-section text-foreground">
        {tr(
          'Already in Vietnam? Find housing, jobs and motorbikes on eno.vn',
          'Bạn đã ở Việt Nam? Tìm nhà ở, việc làm và xe máy trên eno.vn',
        )}
      </h2>
      <p className="mt-3 text-base leading-relaxed text-body">
        {tr(
          'eno.vn is our marketplace for the international community in Vietnam, listed by the people who own the things. Free to browse, free to post.',
          'eno.vn là chợ của chúng tôi dành cho cộng đồng quốc tế tại Việt Nam, do chính chủ đăng tin. Xem tin và đăng tin đều miễn phí.',
        )}
      </p>

      {/* Lines, not boxes (docs/design-language.md §3b) — a ruled list on the page canvas rather
          than a card floated on top of it, so this reads as part of the page instead of as an
          inserted advertisement. The <ul>/<li> semantics come from the primitive. */}
      <Rows className="mt-5">
        {links.map((l) => (
          <Row key={l.key}>
            {/* ⚠️ DOFOLLOW. `rel` is CROSS_SITE_REL — `noopener` and nothing else. Adding nofollow
                or sponsored here forfeits the only reason this surface exists; the constant carries
                the full argument.

                handleExternalClick is attached for the same reason the footer attaches it to every
                anchor: it is a no-op unless the native shell is running AND the target is genuinely
                third-party. eno.vn is in the shell's allowNavigation list, so today this changes
                nothing — it is here so that a future destination on some other host cannot silently
                become a hard exit out of the app. */}
            <a
              href={l.href}
              rel={CROSS_SITE_REL}
              onClick={handleExternalClick}
              className="group flex items-start gap-3 text-sm"
            >
              <span className="flex-1">
                <span className="block font-semibold text-foreground group-hover:text-accent-foreground">
                  {tr(l.labelEn, l.labelVi)}
                </span>
                <span className="mt-0.5 block leading-relaxed text-body">{tr(l.blurbEn, l.blurbVi)}</span>
              </span>
              <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-4 group-hover:text-accent-foreground" aria-hidden />
            </a>
          </Row>
        ))}
      </Rows>

      {/* The disclosure. Deliberately quiet but never hidden — see the header note. */}
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {tr(AFFILIATION.shortEn, AFFILIATION.shortVi)}
      </p>
    </section>
  )
}
