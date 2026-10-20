import { cache } from 'react'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'

/**
 * THE PUBLIC TEACHER PROFILE'S ONE ROW (2026-09-30; shared since 2026-10-20) — the TeacherProfile row behind a teacher
 * listing, as the profile page renders it (src/components/teachers/teacher-profile-view.tsx) AND as its metadata reads it
 * ((pdp)/page.tsx generateMetadata: the robots tag from the search verdict, src/lib/teachers/search-floor.ts, and the
 * <title> line, search-title.ts). ⚠️ `cache()`-WRAPPED, so a request reads it ONCE for both — the get-listing.ts pattern —
 * and the tag and the page are judged on the very same row: the verdict cannot say "thin" over a page that prints 40
 * words, or the reverse.
 * Only PUBLIC fields leave the view: contact data lives in TeacherPrivate and only THAT a private video exists is read
 * (its path is split off in the view before anything else uses the row), and the "Identity verified" inputs and the
 * card cache are read for ONE boolean (the view says how). ⛔ Nothing here is ever handed to a client component whole.
 */
export const TEACHER_PAGE_SELECT = {
  fullName: true, headline: true, bio: true, photoUrl: true, videoUrl: true, nationality: true,
  languages: true, availableFrom: true, jobTypes: true, ageGroups: true, subjects: true, experience: true,
  degreeLevel: true, degreeMajor: true, degreeInstitution: true, degreeYear: true, certificates: true, expectedSalaryM: true, updatedAt: true,
  // The v2 situation (2026-10-08) — where they live and the one teach-area list; the cover reach is derived from them.
  livesIn: true, currentCity: true, currentDistrictKey: true, currentProvince: true, teachAreas: true,
  teachLanguages: true, englishLevel: true, experienceBand: true,
  coverOpen: true, coverSlots: true, coverRateVnd: true, coverConfirmedAt: true, coverConsentVersion: true,
  videoOnRequest: true, private: { select: { videoPath: true } },
  // "Hide my profile from search engines" (owner decision 14, 2026-10-20) — read for the search verdict only.
  hideFromSearch: true,
  // "Identity verified" (owner, 2026-10-15): read for ONE boolean (identityMarkShownOnCard), never rendered — the mark's
  // inputs and the listing's card cache (Listing.identityMarkNotice, through the row's own listing relation, in this same
  // read: no query of its own) are split off with `private`, so the view's `tp` never carries them.
  profileId: true, identityMarkOn: true, identityMarkWithdrawnAt: true, listing: { select: { identityMarkNotice: true } },
} as const satisfies Prisma.TeacherProfileSelect

/** The profile row behind teacher listing `listingId`, or null for a broken row (a listing without its profile). */
export const getTeacherPageRow = cache(async (listingId: string) =>
  db.teacherProfile.findUnique({ where: { listingId }, select: TEACHER_PAGE_SELECT }))

export type TeacherPageRow = NonNullable<Awaited<ReturnType<typeof getTeacherPageRow>>>
