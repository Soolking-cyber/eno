import 'server-only'
import { db } from '@/lib/db'
import { scopedListingWhere, teachersCategoryId } from '@/lib/edition-scope'
import { inAppOnly } from '@/lib/in-app-listing'
import { LISTING_CARD_SELECT, serializeListingCard } from '@/lib/serialize'
import { LANGS } from '@/lib/i18n/langs'
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
 * ⛔ A PERSON'S NAME IS NEVER MACHINE-TRANSLATED — IN ANY OF THE ELEVEN LANGUAGES (seller-info.tsx: "a name translated is
 * a different name"; the profile page shows it as typed, teacher-profile-view.tsx). A teacher row's title IS the name
 * (projection.ts) with no authored twin, so the card's useLocalized (listing-content.tsx localizedPlan) translated it in
 * the nine MT languages — from the nightly warm-translations cache, which localizeListingTitles embedded into this 6h
 * page (zh-Hans / ko / ja / ru), else by a paid /api/translate call on view (km / ms / th / fr / hi) — and in English too
 * for a name with a Vietnamese letter, Hangul or Cyrillic (useMachineEn: "Nguyễn Thị Hoa" reads as Vietnamese text). So
 * every language is PINNED to the name, in the embed each one reads first: `titleVi` for /vi, `titleI18n` for the ten
 * others, `en` included — no translation is embedded and no client request is made (review, 2026-10-13).
 * localizeListingTitles is not called (it could only add translations to overwrite), and a stored titleVi is overwritten
 * too: no teacher code writes one (projection.ts), so it could only be a bulk title translation.
 * Since 2026-10-16 the card itself pins every teacher's name as well (listing-card.tsx and compact-listing-row.tsx read
 * a teacher card's `title` as stored and ask useLocalized for nothing), so /c/teachers, Show-more, the explorer and the
 * storefronts print the name as typed too — the "Identity verified" tick sits beside it. The embed here stays, the
 * same pin from the server's side.
 * Cost: one findMany of at most TAKE + 2 rows on the [verified, status, categoryId, sellerId] index; ten more copies of
 * each name in the page's RSC payload (eight cards ≈ 2 KB, less the cached translations it no longer carries).
 */
export async function homeTeacherShelf(): Promise<SerializedListingCard[]> {
  // Memoised per process (edition-scope.ts); null = no teachers category, so no teacher listing can exist.
  const teachersId = await teachersCategoryId()
  if (!teachersId) return []
  // ⛔ ONLY LISTINGS DEALT ON eno, like every home surface (owner, 2026-10-28 — in-app-listing.ts). A teacher profile carries
  // no partner link today; the narrowing makes "the home page shows only listings contacted through the platform" true by
  // construction rather than by that fact (codex, commit gate).
  const where = inAppOnly(await scopedListingWhere(
    { categoryId: teachersId, verified: true, status: 'active' as const, id: { notIn: [...HOME_HIDDEN_TEACHER_LISTING_IDS] } },
    { teachers: true },
  ))
  const rows = await db.listing.findMany({
    where,
    orderBy: [{ rankScore: 'desc' }, { id: 'desc' }],
    // Two spare rows, so a profile whose photo is missing does not leave the shelf a card short.
    take: HOME_TEACHER_SHELF_TAKE + 2,
    select: LISTING_CARD_SELECT,
  })
  return rows
    .map(serializeListingCard)
    // A card without its photo is a grey box with a name under it — on the home page, not worth the slot.
    .filter((c) => typeof c.images[0] === 'string' && c.images[0] !== '')
    .slice(0, HOME_TEACHER_SHELF_TAKE)
    .map((c) => ({ ...c, titleVi: c.title, titleI18n: nameInEveryLanguage(c.title) }))
}

/** The name as typed, as the embedded title of every language but Vietnamese (whose slot is `titleVi`) — see above. */
function nameInEveryLanguage(name: string): Record<string, string> {
  return Object.fromEntries(LANGS.filter((l) => l !== 'vi').map((l) => [l, name]))
}
