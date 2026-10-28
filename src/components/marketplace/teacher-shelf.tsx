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
 * THE HOME PAGE'S "FIND A TEACHER" SHELF (owner, 2026-10-13: "make teacher profiles more visible on the home page" —
 * picked: a shelf after the feed's first twelve listings). One full-width row INSIDE the feed grid, right after the
 * twelfth card: the up-to-eight teacher cards the server seeded (src/lib/core/teacher-shelf.ts — /c/teachers' own
 * default order, minus the owner's demo), "See all" to /c/teachers, and one line of text for teachers themselves.
 *
 * ⛔ BELOW PAGE ONE, NEVER ABOVE THE FEED. Nothing measured on the first screen moves: the first card's top, card 0's
 * single LCP preload, "no full-width media above the grid" and the first twelve grid children all being listing cards
 * (globals.css) all hold. The explorer owns WHERE (listings-explorer.tsx, `showTeacherShelf`: the undirected home only —
 * never a search, a filter, an area, the map or video view, or a storefront).
 * ⛔ THE CANON'S OWN PARTS: <Shelf> and <ListingCard>, unchanged — a flat section under one hairline, no eyebrow, no fill.
 * The cards take no `priority`/`lcp` (lazy photos; the page's one preload stays card 0's) and no `onLocate`.
 * ⚠️ ONE HAIRLINE BETWEEN BLOCKS. Its own on top; below, only when rows follow it (`not-last:`) — as the grid's last child
 * the feed footer's own top line ("Browse everything") is the next one. The guest capture row that follows it drops its
 * top line instead (globals.css, beside the feed-grid rules), so two parallel lines never sit a grid gap apart.
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
    <div data-teacher-shelf="" className="col-span-full min-w-0 border-t border-border pt-6 pb-4 not-last:border-b">
      <Shelf icon={User} title={tr(title.name, title.nameVi)} seeAllHref={teacherSurfaceHref(localizedHref('/c/teachers', lang))}>
        {listings.map((l) => (
          <div key={l.id} data-sid={l.sellerId} className={RAIL_CARD_W}>
            <ListingCard listing={l} onOpen={onOpen} />
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
