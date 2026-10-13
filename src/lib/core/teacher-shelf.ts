import 'server-only'
import { db } from '@/lib/db'
import { scopedListingWhere, teachersCategoryId } from '@/lib/edition-scope'
import { LISTING_CARD_SELECT, serializeListingCard } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { HOME_HIDDEN_TEACHER_LISTING_IDS, HOME_TEACHER_SHELF_TAKE } from '@/lib/teachers/constants'
import type { SerializedListingCard } from '@/lib/types'

/**
 * THE HOME PAGE'S "FIND A TEACHER" SHELF (owner, 2026-10-13 — "make teacher profiles more visible on the home page"; the
 * option picked was a shelf after the feed's first twelve listings): the first HOME_TEACHER_SHELF_TAKE cards of
 * /c/teachers' DEFAULT ORDER, minus the owner's demo profile. Seeded into the 6h-ISR home HTML by (home)/page.tsx and
 * drawn by teacher-shelf.tsx.
 *
 * ⛔ THE ORDER IS /c/teachers' DISCLOSED ONE, NOT A NEW RANKING RULE. Same predicate (verified, active, the teachers
 * category) and the same `rankScore desc, id desc` as that page's preview ((index)/page.tsx). Its seller round-robin
 * changes nothing for teachers — one profile per account, so one teacher card per seller — so the shelf is the first
 * cards of its own "See all", and /legal/ranking has no new parameter to disclose.
 * ⛔ THE OPT-IN IS PINNED TO ONE CATEGORY. `{ teachers: true }` lifts scopedListingWhere's default teacher exclusion, so
 * the `categoryId` beside it is what keeps every other listing out; the desk / allow-list scope still applies.
 * ⚠️ ONLY CARD FIELDS LEAVE THE SERVER: LISTING_CARD_SELECT + serializeListingCard — no description or bio, nothing of
 * TeacherPrivate, and no ownerId on the wire.
 * ⚠️ A PERSON'S NAME IS NEVER MACHINE-TRANSLATED ON /vi. A teacher row has no titleVi (projection.ts writes the name as
 * the title only), so the card's useLocalized would send the name through the translator on a Vietnamese page; the
 * profile page shows the name as typed (teacher-profile-view.tsx), and so does this card. The nine MT languages keep
 * whatever is already cached for the title, exactly as on /c/teachers (localizeListingTitles reads pre-warmed rows only
 * and never pays for a translation).
 * Cost: one findMany of at most TAKE + 2 rows on the [verified, status, categoryId, sellerId] index.
 */
export async function homeTeacherShelf(): Promise<SerializedListingCard[]> {
  // Memoised per process (edition-scope.ts); null = no teachers category, so no teacher listing can exist.
  const teachersId = await teachersCategoryId()
  if (!teachersId) return []
  const where = await scopedListingWhere(
    { categoryId: teachersId, verified: true, status: 'active' as const, id: { notIn: [...HOME_HIDDEN_TEACHER_LISTING_IDS] } },
    { teachers: true },
  )
  const rows = await db.listing.findMany({
    where,
    orderBy: [{ rankScore: 'desc' }, { id: 'desc' }],
    // Two spare rows, so a profile whose photo is missing does not leave the shelf a card short.
    take: HOME_TEACHER_SHELF_TAKE + 2,
    select: LISTING_CARD_SELECT,
  })
  const cards = rows
    .map(serializeListingCard)
    // A card without its photo is a grey box with a name under it — on the home page, not worth the slot.
    .filter((c) => typeof c.images[0] === 'string' && c.images[0] !== '')
    .slice(0, HOME_TEACHER_SHELF_TAKE)
    .map((c) => ({ ...c, titleVi: c.titleVi ?? c.title }))
  return localizeListingTitles(cards)
}
