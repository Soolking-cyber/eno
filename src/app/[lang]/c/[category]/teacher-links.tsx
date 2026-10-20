import { Bilingual } from '@/components/marketplace/bilingual'
import type { TeacherLink } from './category-data'

/**
 * ⛔ /c/teachers LINKS EVERY LIVE TEACHER PROFILE IN ITS OWN HTML (SEO plan §3(a) item 12, 2026-10-19).
 *
 * The grid server-renders the first PAGE_SIZE (48) profiles as cards; the rest arrived only through "Show more", a
 * client fetch of /api/listings (which robots.txt disallows) behind a button — and crawlers do not click buttons
 * (Google's pagination guidance). So about 45 of the 93 live profiles (the plan's count) had no crawlable link: none of
 * the other paths reaches past the grid — the home shelf is eight of the grid's own, a profile page links no other
 * teacher, and a /c/teachers/<district> page is linked only once its district holds ten profiles — and what was left
 * was the listing sitemaps (and each teacher's storefront, which only pages.xml names). So the page now names every
 * profile its grid does not show, as a plain link under it.
 *
 * ⛔ NO NEW URL, AND THE ROUTE STAYS ISR EXACTLY AS IT WAS — the three designs, compared:
 *   · `?page=N` with a self-canonical: the page cannot read its query without turning EVERY /c/<category> page
 *     dynamic (one route file): each view a Postgres render, and the HTML edge Worker stores only an `s-maxage`
 *     answer (infra/cloudflare/eno-html-edge-cache.js originShareable). Without reading it, `/c/teachers?page=2` is
 *     page 1 again — the standalone server answers a cached path without running the proxy (measured 2026-10-17) —
 *     under page 1's canonical: a duplicate URL whose "page 2" links lead back to page 1.
 *   · `/c/teachers/page/2`: static and ISR would work (two segments can never meet a `[district]` slug), but each page
 *     is a new indexable URL wearing page 1's title and lede, and one more ISR entry every teacher writer would have to
 *     purge (revalidateTeacherPages, the moderation paths) or a hidden profile stays linked there for its window — and
 *     pages 1 and 2 regenerate apart, so a profile whose rank moves can fall between them.
 *   · THIS: the page's own render reads the profiles past its grid — one indexed read beside the window, once per ISR
 *     render, never per request — and links them. No new ISR entry: every writer that purges /c/teachers purges this
 *     list with it. No query string, no headers(), cookies() or searchParams on the render path.
 * ⚠️ ONLY /c/teachers: the page reads and renders it under `cat.slug === TEACHERS_CATEGORY_SLUG`, so every other
 * category renders the same markup — its RSC payload gains one `false` child slot (the unrendered `{isTeachers && …}`),
 * nothing else — with no extra read (teacher-links.test.tsx renders both).
 *
 * ⛔ NO NEW EXPOSURE. The rows are read with the grid's own `where` (category-data.ts loadTeacherLinks, handed the
 * page's `scopedWhere`: live, scoped, the teachers category) — the set its grid and Show-more already show — and each
 * link is the card's own target with the name the card prints, as stored: a masked or short name is listed exactly as
 * its card shows it, a hidden or held profile not at all. No photo, headline or tick: less than the card shows, never
 * more.
 * ⛔ AND A TAKEDOWN PURGES IT (2026-10-20). The list puts profiles the grid never showed into this page's 6h-ISR HTML,
 * where before they were only behind Show-more's /api/listings (an edge window of minutes). So every door that pulls a
 * teacher profile purges /c/teachers: the teacher's own (revalidateTeacherPages) and, since this list, the generic ones
 * too — moderation, the admin console's bulk tool, enforcement holds, the AI and image-provenance auto-holds, the
 * availability review's "sold", and an account erasure even when it cannot read the teacher row (teachers/revalidate.ts
 * lists them, and why the licence sweep needs none). A pulled profile leaves this list as it leaves the home page:
 * within the edge cache's window, not the page's six hours.
 *
 * ⚠️ PLAIN `<a>`, NOT next/link: up to TEACHER_LINKS_MAX rows, and a Link is a client component that hydrates — a plain
 * anchor in a server component costs the client nothing, and a tap is an ordinary navigation, as the footer's link
 * lists are. Nothing is prefetched.
 */

/**
 * How many profiles past the grid the list links at most. 240 = five grids' worth: it covers 288 live profiles (93 on
 * 2026-10-19; ~5 new a day), and it bounds what the list adds to the page. Measured 2026-10-19 (a name's row in the HTML
 * plus its copy in the RSC payload, at a real id's length): ~0.24 KB a name before compression — today's 45 are 10.4 KB
 * raw, 1.4 KB brotli; at the cap 55 KB raw, 5.6 KB brotli — and on a phone 22px of scroll a name (44px rows, two
 * columns): ~1,000px today, ~5,300px at the cap. ⛔ PAST IT, PROFILES GO UNLINKED AGAIN, AND THE PAGE SAYS SO IN THE
 * LOGS (`(index)/page.tsx` warns on every render that reaches it) — the day the list needs real pagination
 * (`/c/teachers/page/N`, above), not a bigger number.
 */
export const TEACHER_LINKS_MAX = 240

/**
 * The profiles the grid does not show, in the order given (the page's own), at most `max`: every row whose id is not
 * one of the grid's cards, each once. The grid is what the page RENDERED, never a rank position — its window deals
 * sellers round-robin (feed-window.ts), so "past position 48" and "not on the grid" can differ.
 */
export function teachersPastGrid(rows: readonly TeacherLink[], grid: readonly { id: string }[], max = TEACHER_LINKS_MAX): TeacherLink[] {
  const linked = new Set(grid.map((l) => l.id))
  const out: TeacherLink[] = []
  for (const row of rows) {
    if (out.length >= max) break
    if (linked.has(row.id)) continue
    linked.add(row.id)
    out.push({ id: row.id, title: row.title })
  }
  return out
}

/**
 * The list and, through `[&_a]:`, every name in it: two columns on a phone, three from sm, four from lg — each an
 * explicit `minmax(0, 1fr)` template, so a long name truncates inside its track instead of widening it (an implicit
 * track grows to a nowrap name's full width). One name per row, one truncating line (the whole name stays in the
 * HTML): a 44px row on a phone by real height — `py-3` around the 20px line, no row gap, no `tap-44` extender, so no
 * row's hit area overlaps its neighbour's (D-TAP, footer.tsx) — and 28px from sm, where a pointer is the norm.
 * `text-body` is the COLOUR utility (docs/design-language.md §1).
 * ⚠️ ON THE LIST, NOT ON EACH ROW: a class on every `<a>` is ~0.1 KB per name twice over (the HTML and its RSC
 * payload), up to TEACHER_LINKS_MAX names; here a row is its href and its name.
 */
const NAME_LIST = 'mt-4 grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-4 [&_a]:block [&_a]:truncate [&_a]:py-3 [&_a]:text-sm [&_a]:text-body [&_a]:hover:text-accent-foreground [&_a]:hover:underline sm:[&_a]:py-1'

/**
 * "More teachers" — under /c/teachers' grid, AFTER its guide rail ("Guides" on eno.vn: the P0 internal links a reader
 * who finished the grid meets first, not ~1,000px of names later) and before "Other categories", in the page's own
 * section shape (a hairline, an `h-section` heading — both neighbours are the same).
 * The heading is authored in both languages (<Bilingual>; no claim, nothing counsel's list in
 * src/test/teachers-counsel-words.ts holds back). The names are never translated, in any language — a person's name.
 * Renders nothing without a profile to list.
 */
export function MoreTeachers({ teachers }: { teachers: readonly TeacherLink[] }) {
  if (!teachers.length) return null
  return (
    <section data-teacher-links="" className="mt-12 border-t border-border pt-8">
      <h2 className="h-section text-foreground">
        <Bilingual en="More teachers" vi="Các giáo viên khác" />
      </h2>
      <ul className={NAME_LIST}>
        {teachers.map((t) => (
          <li key={t.id}>
            <a href={`/listings/${t.id}`}>{t.title}</a>
          </li>
        ))}
      </ul>
    </section>
  )
}
