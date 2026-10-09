import type { SerializedListingCard } from '@/lib/types'
import { TEACHER_LISTING_TYPE, TEACHERS_CATEGORY_SLUG } from '@/lib/teachers/constants'

/**
 * WHICH ROWS OF THE EXPLORER'S FEED BECOME MAP PINS (listings-explorer.tsx `mapListings`).
 *
 * ⛔ A TEACHER IS NEVER A MAP PIN (teacher onboarding redesign, owner, 2026-10-08). A teacher row carries no coordinates
 * — the publish core writes none: a person is not a place — so its pin could only be geo.ts's text fallback guessing
 * from Listing.city / district. Measured on the redesign's rows: a teacher abroad (city '') and 16 of the 27 "somewhere
 * else" provinces (Gia Lai, Cao Bằng, … and Phú Quốc's An Giang) fell through to central Saigon, and District 7's
 * curated name ("Quận 7 (Phú Mỹ Hưng)") to the city centre — each pin with a travel time and a Directions button to a
 * person's guessed home, and a "Free" price tag (a profile has no price). The teacher PDP draws no map for the same
 * reason. The grid and the list beside the map still show every teacher.
 * ⚠️ THE SAME ARRAY BACK WHEN NOTHING IS DROPPED: the map's marker effect keys on this array, and a fresh copy on every
 * render tore down and rebuilt every marker (the memo note on `mapListings`). So `some` first, `filter` only if needed.
 */
export function mapPinRows<T extends Pick<SerializedListingCard, 'listingType'>>(rows: T[]): T[] {
  return rows.some(isTeacherRow) ? rows.filter((l) => !isTeacherRow(l)) : rows
}

const isTeacherRow = (l: Pick<SerializedListingCard, 'listingType'>) => l.listingType === TEACHER_LISTING_TYPE

/**
 * ⛔ DOES THIS CATEGORY'S FEED HAVE A MAP AT ALL? Not teachers: every row on that feed is a teacher, and no teacher is a
 * pin (above), so its map always came up empty (gate review, 2026-10-09). THE ONE RULE every map entry reads — the
 * explorer (`mapOffered`: its view tab, `?view=map`, Back/Forward), the header's Map (on and off the explorer) and the
 * /c/<category>/<district> hub's Map link — so a new mapless category is one line here, not a hunt for call sites.
 */
export function categoryHasMap(category: string | null | undefined): boolean {
  return category !== TEACHERS_CATEGORY_SLUG
}
