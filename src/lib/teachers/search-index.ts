import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import { teacherSearchFacts, teacherSearchVerdict } from '@/lib/teachers/search-floor'

/**
 * THE SEARCH VERDICT (src/lib/teachers/search-floor.ts) WHERE A PAGE OTHER THAN THE PROFILE SPEAKS FOR IT — the sitemaps
 * and a teacher's storefront (owner decisions 7 and 14, 2026-10-20). The profile page itself asks the verdict of the row
 * it renders ((pdp)/page.tsx, teacher-profile-view.tsx); these ask it of the same columns, read here.
 */

/** What the verdict reads of a profile — the page's own fields: the name, the About text, the video, the switch. */
const SEARCH_SELECT = {
  fullName: true, bio: true, videoUrl: true, videoOnRequest: true, hideFromSearch: true,
} as const satisfies Prisma.TeacherProfileSelect

type SearchRow = { id: string; video: string | null; teacherProfile: { fullName: string; bio: string; videoUrl: string | null; videoOnRequest: boolean; hideFromSearch: boolean } | null }
const searchable = (r: SearchRow) => teacherSearchVerdict(teacherSearchFacts(r.teacherProfile, r)).indexable

/**
 * The live teacher listings search engines may be told about: every published, active `listingType: 'teacher'` row whose
 * profile passes the verdict — keyed on listingType because that is what makes the PDP render a profile (and so judge
 * it) at all. A row with no profile is out (a broken row; the page says the same).
 * ⚠️ ONE READ OF EVERY LIVE TEACHER (112 on 2026-10-20 — a bio each, a few hundred KB at 1,000), paid by each sitemap
 * build (daily ISR) and the IndexNow run; the ids go back as one `IN` list, well inside Postgres's bind limit at any size
 * the teacher category will reach.
 */
export async function searchableTeacherListingIds(): Promise<string[]> {
  const rows = await db.listing.findMany({
    where: await scopedListingWhere({ listingType: TEACHER_LISTING_TYPE, verified: true, status: 'active' }, { teachers: true }),
    select: { id: true, video: true, teacherProfile: { select: SEARCH_SELECT } },
    orderBy: { id: 'asc' },
  })
  return rows.filter(searchable).map((r) => r.id)
}

/**
 * The sitemaps' teacher rule, as ONE more AND element of submittedListingWhere (src/lib/sitemap.ts): a row that is not a
 * teacher profile passes untouched; a teacher profile only while the verdict lets it in. ⛔ AN ALLOW-LIST, so it fails
 * CLOSED: a profile that went live after the id read above, or one whose row cannot be judged, stays out until the next
 * build rather than slipping in under the floor. One predicate for the index's count and every child's page, so the two
 * cannot disagree (sitemap.xml/route.ts) — and through it pages.xml's storefront block: a seller's storefront is
 * submitted only for a listing of its own, which a teacher profile left out here no longer is.
 * ⚠️ `{ not: … }` is SQL `<>`, which never matches NULL — safe here because Listing.listingType is NOT NULL
 * (`String @default("sell")`, prisma/schema.prisma; Prisma's types refuse `listingType: null` for it), so every row that is
 * not a teacher profile passes. Both review rounds raised it as a possible sitemap wipe; the schema answers it.
 */
export async function teacherSitemapScope(): Promise<Prisma.ListingWhereInput> {
  return { OR: [{ listingType: { not: TEACHER_LISTING_TYPE } }, { id: { in: await searchableTeacherListingIds() } }] }
}

/**
 * ⛔ A TEACHER-ONLY STOREFRONT SPEAKS FOR ITS PROFILE (2026-10-20) — `noindex, follow` when the shop has NOTHING else
 * (`products` 0) and NO teacher profile it shows passes the verdict (under the floor, a masked name, or "Hide my profile
 * from search engines" on). Such a page — titled with the person's name, showing the one profile's card — IS that
 * profile under another URL. Measured on the live sitemap that day: all 111 `/sellers/<id>` storefronts it submitted were
 * of this kind, and 30 of them carried a profile the verdict leaves out.
 * ⚠️ A SHOP WITH STOCK KEEPS ITS TAG, whatever its teacher card says (review round 2, codex — reversing round 1's rule):
 * the page is about its stock, and a teacher's switch must not take a seller's whole shop out of search. Its card stays
 * on that page as it stays in the teacher lists, which stay indexable too — the switch's helper line says so ("its card
 * still shows on eno's other pages"). No teacher profile at all: unchanged.
 * `products` is the storefront's own count of live listings (loadSeller's scoped `_count.listings`, which never counts a
 * teacher row). pages.xml leaves out exactly the storefronts this answers noindex for: such a seller has no submitted
 * listing (submittedListingWhere). One indexed read (sellerId), and only for a shop with nothing else.
 */
export async function storefrontTeacherRobots(sellerId: string, products: number): Promise<{ index: false; follow: true } | undefined> {
  if (products > 0) return undefined
  // The same rows the storefront's teacher section shows (seller-storefront.tsx loadStorefrontTeachers), uncapped.
  const rows: SearchRow[] = await db.listing.findMany({
    where: await scopedListingWhere({ sellerId, listingType: TEACHER_LISTING_TYPE, verified: true, status: 'active' }, { teachers: true }),
    select: { id: true, video: true, teacherProfile: { select: SEARCH_SELECT } },
  })
  if (!rows.length) return undefined
  return rows.some(searchable) ? undefined : { index: false, follow: true }
}
