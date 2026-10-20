/**
 * ⛔ A TEACHER PROFILE IN SEARCH ENGINES — THE QUALITY FLOOR AND THE TEACHER'S OWN SWITCH (SEO plan P1 items 14 and 15;
 * owner decisions 7 and 14, approved 2026-10-20: "yes to both"). ONE verdict, asked by every place that tells a search
 * engine about a teacher's profile:
 *   · the profile page's robots tag ((pdp)/page.tsx generateMetadata) and its JSON-LD (teacher-profile-view.tsx);
 *   · the sitemaps — submittedListingWhere (src/lib/sitemap.ts, through src/lib/teachers/search-index.ts): the listing
 *     children, the index's count, and pages.xml's storefront block (a seller's storefront is submitted for a listing
 *     of its own, which a profile this verdict leaves out no longer is);
 *   · a teacher-only storefront's robots tag (search-index.ts storefrontTeacherRobots).
 * The rules, in this order:
 *   1. ⛔ A MASKED NAME IS ALWAYS OUT — the "nn***" stand-in an account carries until it has a real name (utils.ts
 *      maskEmailHandle, publish-guard.ts publicSafeName), or any name with no letter in it: a page "about" it is no page
 *      about a person, whatever else it holds.
 *   2. ⛔ "HIDE MY PROFILE FROM SEARCH ENGINES" (TeacherProfile.hideFromSearch, the teacher's own switch) — OUT while it
 *      is on. Only search engines are asked to leave the page out: eno still shows it to everyone.
 *   3. THE FLOOR — IN once the About text has ABOUT_WORDS_FLOOR (30) words or more, OR the page plays an intro video.
 * ⛔ FROM THE FIELDS THE PAGE SHOWS, AND NOTHING ELSE: the name its h1 prints, the About text it prints (the stored bio —
 * the server HTML carries it as written; a reader's translation comes later, in the browser), and the video its player
 * plays (teacherPublicVideo — the page's own rule, moved here so the two cannot drift). A video kept private and sent on
 * request plays nowhere on the page, so it does not count; neither does the headline.
 * A listing without its profile row is a broken row (the publish core writes both in one transaction): OUT.
 * ⚠️ IMPORT-FREE ON PURPOSE: the PDP, the sitemap and the measurement of the live pages (plain Node) all load it.
 */

/** The About text's floor, in words (owner decision 7, 2026-10-20). */
export const ABOUT_WORDS_FLOOR = 30

const SEGMENTER = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('en', { granularity: 'word' })
  : null
/** The scripts written WITHOUT spaces between words — a run of them is counted by Unicode word boundaries instead. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u

/**
 * The words in the teacher's own text, counted the way a word processor counts them: each whitespace-separated run that
 * holds a letter or a digit is one word — "student-centred" one, "bachelor's" one, a dash or a bullet none, a Vietnamese
 * syllable one (as in any Vietnamese word count). ⚠️ A run in a script written without spaces (Chinese, Japanese, Thai…)
 * would be ONE word however long, so it counts its Unicode word-boundary words instead (Intl.Segmenter); a runtime
 * without Intl.Segmenter counts it as one. Measured on the 112 live profiles (2026-10-20): none has such a run, and
 * counting by word boundaries throughout would split hyphenated words and move one profile across the floor.
 */
export function wordCount(text: string | null | undefined): number {
  let n = 0
  for (const run of (text ?? '').split(/\s+/)) {
    if (!/[\p{L}\p{N}]/u.test(run)) continue
    if (SEGMENTER && UNSPACED.test(run)) {
      for (const seg of SEGMENTER.segment(run)) if (seg.isWordLike) n++
    } else n++
  }
  return n
}

/**
 * A name that says nothing about a person: the masked handle an account carries until it has a real name — "nn***"
 * (utils.ts maskEmailHandle; publish-guard.ts publicSafeName masks a name that IS contact info the same way) — or any
 * name with an asterisk or with no letter at all. No person's name has an asterisk in it.
 */
export function isMaskedName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim()
  return n.includes('*') || !/\p{L}/u.test(n)
}

/**
 * The intro video the public profile PLAYS. ⛔ PRIVACY WINS (src/lib/teachers/video.ts, the planner's both-homes rule) —
 * on the teacher's CHOICE alone: a teacher who keeps their video private is shown no public player even if a stale public
 * URL survives somewhere (only a deploy window can leave one), with or without a private video stored (gate review,
 * 2026-10-07). Otherwise the profile's own URL, else the listing's — `??`, exactly as the page has always read it.
 */
export function teacherPublicVideo(
  tp: { videoOnRequest?: boolean | null; videoUrl?: string | null } | null | undefined,
  listingVideo: string | null | undefined,
): string | null {
  if (tp?.videoOnRequest === true) return null
  return tp?.videoUrl ?? listingVideo ?? null
}

/** What the verdict reads — the page's own fields (see the header). */
export type TeacherSearchFacts = {
  /** the name the page's h1 prints */
  name: string
  /** the About text the page prints (TeacherProfile.bio) */
  bio: string | null | undefined
  /** the video the page plays (teacherPublicVideo) */
  publicVideo: string | null | undefined
  /** the teacher's "Hide my profile from search engines" */
  hideFromSearch: boolean | null | undefined
}

export type TeacherSearchReason = 'no-profile' | 'masked-name' | 'opted-out' | 'thin'
export type TeacherSearchVerdict = { indexable: true; reason: null } | { indexable: false; reason: TeacherSearchReason }

/** Is this teacher profile one search engines are asked to index? `null` = a listing with no profile row (out). */
export function teacherSearchVerdict(f: TeacherSearchFacts | null | undefined): TeacherSearchVerdict {
  if (!f) return { indexable: false, reason: 'no-profile' }
  if (isMaskedName(f.name)) return { indexable: false, reason: 'masked-name' }
  if (f.hideFromSearch === true) return { indexable: false, reason: 'opted-out' }
  if (f.publicVideo || wordCount(f.bio) >= ABOUT_WORDS_FLOOR) return { indexable: true, reason: null }
  return { indexable: false, reason: 'thin' }
}

/**
 * The facts of one profile as the page reads them: its TeacherProfile row (null for a broken row) and its listing. The
 * h1 prints `fullName`, falling back to the listing's title only when there is no profile — which is out anyway.
 */
export function teacherSearchFacts(
  tp: { fullName: string; bio: string | null; videoUrl: string | null; videoOnRequest: boolean; hideFromSearch: boolean } | null | undefined,
  listing: { video: string | null | undefined },
): TeacherSearchFacts | null {
  if (!tp) return null
  return { name: tp.fullName, bio: tp.bio, publicVideo: teacherPublicVideo(tp, listing.video), hideFromSearch: tp.hideFromSearch }
}

/** The robots tag for a profile the verdict leaves out: not indexed, its links still followed. Undefined = the default. */
export function teacherRobots(v: TeacherSearchVerdict): { index: false; follow: true } | undefined {
  return v.indexable ? undefined : { index: false, follow: true }
}
