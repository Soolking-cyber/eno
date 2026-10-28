'use client'

// ⛔ CORE GLYPHS ONLY — User and ArrowRight here, ChevronRight inside <Shelf>. This row is in the home page's SSR HTML,
// and one deferred glyph would bind the ~188 KB glyphs-rest.svg to '/' (scripts/critical-icons.mjs). Not the plate's
// UserRound, not GraduationCap. src/lib/critical-glyphs.guard.test.ts reads this file's imports.
import { ArrowRight, User } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { CATEGORY_ENTRY_LABELS } from '@/lib/category-entry-label'
import { localizedHref } from '@/lib/lang-pinned'
import { teacherJoinUrl, teacherSurfaceHref } from '@/lib/teachers/host'
import { keepTeacherJoinInApp } from '@/components/teachers/teacher-join-click'
import { TEACH_HUB_PATH } from '@/lib/teach-guides/hub-path'
import { IS_SERVICES } from '@/lib/edition'
import type { SerializedListingCard } from '@/lib/types'
import { ListingCard } from './listing-card'
import { MIN_RAIL_ITEMS, RAIL_CARD_W, Shelf } from './shelf'

/** The door's link: the action colour, a 44px hit area (tap-44's ::before needs the `relative`), the arrow after. */
const DOOR_LINK = 'relative tap-44 inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline'

/**
 * THE HOME PAGE'S "FIND A TEACHER" SHELF (owner, 2026-10-13: "make teacher profiles more visible on the home page"): the
 * up-to-eight teacher cards the server seeded (src/lib/core/teacher-shelf.ts — /c/teachers' own default order, minus the
 * owner's demo), "See all" to /c/teachers, and one line of text for teachers themselves.
 *
 * ⛔ FIRST UNDER THE CATEGORIES, ABOVE THE FEED (owner, 2026-10-28: "no product with link shows there mostly the partner
 * teachers etc the ones that dont take us out of the app"). It was a full-width row inside the feed grid after the
 * twelfth card ("below page one, never above the feed", 2026-10-13); the owner's new ask reverses that. The explorer owns
 * WHERE and WHEN (listings-explorer.tsx, `showTeacherShelf`: the undirected home in the default order only — never a
 * search, a filter, an area, a sort, the map or video view, or a storefront) and the mask that keeps it off every other
 * cold URL's first paint (globals.css).
 * ⛔ THE CANON'S OWN PARTS: <Shelf> and <ListingCard>, unchanged — a flat section over one hairline, no eyebrow, no fill.
 * ⚠️ THE FIRST CARD CARRIES THE PAGE'S ONE LCP HINT (`priority` + `lcp`): above the feed, its photo is the largest image
 * on the first screen at every width (a rail card is exactly one feed column — shelf.tsx RAIL_CARD_W), so the preload
 * moved here from feed card 0, which keeps `priority` alone. The other cards stay lazy. No `onLocate`.
 * ⚠️ ON A MASKED COLD URL (a search, category or sort deep link) THE PRELOAD STILL FETCHES THIS PHOTO while the shelf is
 * `display: none` (globals.css): the ISR HTML is one document for every query string and cannot know the URL. It is the
 * same one wasted image the masked seed's card 0 carried before the move — that card was hidden and replaced too.
 * ⚠️ ONE HAIRLINE, BELOW IT, between the shelf and the filter strip that opens the feed; above it the categories need
 * none.
 * ⚠️ THE DOOR FOLLOWS THE CATEGORY PLATE'S (category-rail.tsx, the teachers / jobs door): a teacher with a profile gets
 * theirs, one with a saved draft gets it back on THIS host (the session is here, not on the teacher host), everyone else
 * the sign-up form on its own host — in the iOS / Android app on this host instead (keepTeacherJoinInApp). The server
 * render and the hydration render both draw the last of those (useDashboard's server snapshot holds no dashboard), so the
 * swap happens after hydration, a page below the fold.
 * ⛔ ON eno.forum EVERY LINK HERE BUT THE CARDS GOES TO eno.vn DIRECTLY (teacherSurfaceHref / teacherJoinUrl): the forum 308s
 * the teacher pages there (owner decision 6, 2026-10-20; src/lib/teachers/surface.ts). A card still opens /listings/<id>,
 * whose PDP sends a teacher's profile on to eno.vn ((pdp)/layout.tsx) — one hop, and <ListingCard> stays untouched.
 * ⚠️ NO NEW COPY: the title is the category's entry label ("Find a teacher" — category-entry-label.ts), the door lines are
 * the plate's and /c/jobs' own. No counts, and no "free" (POSTING_IS_FREE governs that word).
 * ⚠️ ONE EXCEPTION, THE OWNER'S (teacher visibility plan, approved 2026-10-18): a second line to the teacher library's hub,
 * the same words as /c/jobs' and /c/teachers' (teaching-links.tsx `TeachGuideLink`). The home page earned 121 of eno.vn's
 * 280 Google clicks over three months and linked nothing in the library (src/lib/teach-guides/site-links.ts). A plain
 * <a> like the doors, `hrefLang` because the guides are English-only; the path comes from the import-free hub-path module,
 * never the registry — the registry imports every guide's content, and this row is client code.
 */
export function TeacherShelf({
  listings,
  onOpen,
  teacherProfile,
  teacherDraft,
}: {
  listings: SerializedListingCard[]
  /** The explorer's card tap — its back-nav snapshot, then the push (stable, so the memoised cards stay memoised). */
  onOpen: (listing: SerializedListingCard) => void
  /** The viewer already has a teacher profile → the door opens it. */
  teacherProfile: boolean
  /** The viewer has an unfinished one → the door continues it. */
  teacherDraft: boolean
}) {
  const { lang, tr } = useLanguage()
  // The rails' sparse floor (shelf.tsx): two cards and a void read as a dead shop. /c/teachers still lists everyone.
  if (listings.length < MIN_RAIL_ITEMS) return null
  const title = CATEGORY_ENTRY_LABELS.teachers
  return (
    <div data-teacher-shelf="" className="min-w-0 border-b border-border pt-2 pb-4">
      <Shelf icon={User} title={tr(title.name, title.nameVi)} seeAllHref={teacherSurfaceHref(localizedHref('/c/teachers', lang))}>
        {listings.map((l, i) => (
          <div key={l.id} className={RAIL_CARD_W}>
            <ListingCard listing={l} onOpen={onOpen} priority={i === 0} lcp={i === 0} />
          </div>
        ))}
      </Shelf>
      <p className="mt-4 max-w-prose text-sm text-body">
        {teacherProfile ? (
          <a href={teacherSurfaceHref(localizedHref('/teachers/edit', lang))} data-cross-link="home-teacher-edit" className={DOOR_LINK}>
            {tr('Your teacher profile', 'Hồ sơ giáo viên của bạn')} <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
          </a>
        ) : teacherDraft ? (
          <a href={teacherSurfaceHref(localizedHref('/teachers/join', lang))} data-cross-link="home-teacher-continue" className={DOOR_LINK}>
            {tr('Continue your teacher profile', 'Tiếp tục hồ sơ giáo viên')} <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
          </a>
        ) : (
          <>
            {tr('Want schools to find you?', 'Muốn trường học tìm đến bạn?')}{' '}
            <a
              href={teacherJoinUrl()}
              data-cross-link="home-teacher-join"
              onClick={(e) => keepTeacherJoinInApp(e, lang)}
              className={DOOR_LINK}
            >
              {tr('Create a teacher profile', 'Tạo hồ sơ giáo viên')} <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
            </a>
          </>
        )}
      </p>
      {/* Marketplace only: eno.forum 308s the library to eno.vn, so there this would be a redirect. */}
      {!IS_SERVICES && (
        <p className="mt-1 max-w-prose text-sm text-body">
          {tr('New to teaching in Vietnam?', 'Mới dạy học ở Việt Nam?')}{' '}
          <a href={TEACH_HUB_PATH} hrefLang="en" data-cross-link="home-teach-guide" className={DOOR_LINK}>
            {tr('Start with the guide', 'Đọc cẩm nang (tiếng Anh)')} <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
          </a>
        </p>
      )}
    </div>
  )
}
