// Canonical Help Center taxonomy — the ONE source of truth for the help topics,
// shared by the /help UI, the /help/[id] thread page, and scripts/sync-help-center.ts
// (which upserts these as real ForumCommunity rows).
//
// WHY topics are communities: the owner's Help Center is Reddit-style — every answer is
// a real ForumPost that can be upvoted, commented on, bookmarked and reported. All of
// those tables key on ForumPost.id, so help content has to be posts, and posts must live
// in a community. Making the help topics communities means the whole existing forum
// stack (voting, comments, moderation, the eno.forum web face) works on help content for
// free, instead of a parallel content system that can only be read.
//
// ⚠️ Adding a topic here is NOT enough on its own. A community must also exist as a DB
// row (run `npx tsx scripts/sync-help-center.ts`) AND be listed in
// apps/forum/src/components/forum/forum-data.ts — the forum gates rendering on that
// hardcoded array, so a community missing from it is invisible on eno.forum.
//
// No `import 'server-only'`: the /help client components read this too.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ THIS FILE IS ALSO THE EDITION BOUNDARY FOR HELP CONTENT, AND THAT IS NOT A
// SIDE JOB — IT IS THE ONLY PLACE THE BOUNDARY CAN LIVE.
//
// The leak that forced it, measured in PRODUCTION on 2026-08-01:
// `https://eno.vn/sitemap.xml` contained
// `<loc>https://eno.vn/help/help-vietnam-evisa-entry-basics</loc>` and that URL
// returned 200 on the licensed sàn TMĐT. The licensed marketplace was asking
// Google to index an e-visa help article, and serving it.
//
// ⚠️ NEITHER OF THIS REPO'S TWO USUAL MECHANISMS COULD FIX IT, so do not reach
// for them here:
//   · `pageExtensions` + the `.svc.` infix removes a ROUTE from the marketplace
//     build. `/help/[id]` is a single shared route that must keep serving the
//     marketplace's own answers, so it cannot be excluded.
//   · `turbopack.resolveAlias` removes a MODULE'S VOCABULARY from the artifact.
//     The article is a `ForumPost` ROW in a shared database. Its title and body
//     are not in any module, so there is nothing to alias away.
// The only thing in the repo that can decide the article's fate is the TOPIC it
// lives in — `ForumPost.communitySlug`, which is exactly what the three help
// reads already filter on. So the declaration goes on the topic, below.
//
// ⚠️ AND IT IS A TOPIC DECLARATION, NEVER A KEYWORD DENYLIST. The obvious "fix"
// is to drop any post whose title matches /visa|e-visa|nhập cảnh/. That is a
// denylist over USER-AUTHORED content — members ask questions in these topics —
// so it is unmaintainable by construction and it fails SILENTLY on the next
// article somebody writes. A topic is declared once, by us, in this file.
//
// ⚠️ NO SERVICES VOCABULARY MAY EVER BE WRITTEN INTO THE VALUES BELOW. A
// MARKETPLACE build compiles this module — it has to, because it is what tells
// eno.vn which topics to withhold — so an alias is not available and a gate
// would not remove the strings. `src/lib/expat-guides.ts` solves the identical
// problem the identical way and says so in its header; the rule there is the
// rule here. Slug, name, description: none of them may name the service.
// `src/lib/help-center-edition.test.ts` fails the build if one does.
// ─────────────────────────────────────────────────────────────────────────────

import { EDITION, type Edition } from '@/lib/edition'

export type HelpTopic = {
  /** ForumCommunity.slug */
  slug: string
  name: string
  nameVi: string
  description: string
  descriptionVi: string
  /** lucide-react icon name; mirrored into ForumCommunity.icon */
  icon: string
  /**
   * Which editions may surface this topic — its chip on /help, its answers, its
   * `/help/<id>` article URLs, and those URLs' sitemap entries.
   *
   * ⚠️ REQUIRED, WITH NO DEFAULT, AND THAT IS THE POINT OF THE FIELD. A default
   * would have to be one of two wrong things: default-visible re-opens the leak
   * the moment someone adds a travel/services topic and forgets, and
   * default-hidden makes an ordinary new marketplace topic silently invisible on
   * eno.vn. Making it mandatory means `tsc` refuses to compile a topic whose
   * edition nobody decided — and `next.config.ts` sets `ignoreBuildErrors:
   * false`, so that is a red build, not a warning.
   */
  editions: readonly Edition[]
}

/** Both editions serve this topic. */
const BOTH: readonly Edition[] = ['marketplace', 'services']
/**
 * eno.forum only.
 *
 * ⚠️ THE NAME CARRIES THE MEANING BECAUSE THE VALUE MAY NOT. See the header: this
 * module is compiled into the licensed marketplace, so the constant cannot be
 * called anything that names the service.
 */
const SERVICES_ONLY: readonly Edition[] = ['services']

/**
 * EVERY help topic, both editions — the seed/sync view of the taxonomy.
 *
 * ⚠️ USE `HELP_TOPICS` BELOW UNLESS YOU ARE WRITING TO THE DATABASE. The two
 * deployments share ONE database, so `scripts/sync-help-center.ts` must upsert
 * all of these regardless of which edition's env happens to be loaded when it
 * runs; every READ path wants the edition-scoped list instead.
 */
export const ALL_HELP_TOPICS: readonly HelpTopic[] = [
  {
    slug: 'help-getting-started',
    name: 'Getting started',
    nameVi: 'Bắt đầu',
    description: 'What eno.vn is and how to find your way around.',
    descriptionVi: 'eno.vn là gì và cách sử dụng cơ bản.',
    icon: 'rocket',
    editions: BOTH,
  },
  {
    slug: 'help-buying',
    name: 'Buying & offers',
    nameVi: 'Mua hàng & trả giá',
    description: 'Messaging sellers, making offers, saving listings.',
    descriptionVi: 'Nhắn tin cho người bán, trả giá, lưu tin đăng.',
    icon: 'shopping-bag',
    editions: BOTH,
  },
  {
    slug: 'help-selling',
    name: 'Selling & listings',
    nameVi: 'Bán hàng & tin đăng',
    description: 'Posting, pricing, photos and managing what you sell.',
    descriptionVi: 'Đăng tin, định giá, hình ảnh và quản lý tin đăng.',
    icon: 'tag',
    editions: BOTH,
  },
  {
    slug: 'help-trust-safety',
    name: 'Trust & safety',
    nameVi: 'Uy tín & an toàn',
    description: 'Trust scores, safe meet-ups, scams and reporting.',
    descriptionVi: 'Điểm uy tín, gặp mặt an toàn, lừa đảo và báo cáo.',
    icon: 'shield-check',
    editions: BOTH,
  },
  {
    slug: 'help-account',
    name: 'Account & app',
    nameVi: 'Tài khoản & ứng dụng',
    description: 'Signing in, notifications, language and settings.',
    descriptionVi: 'Đăng nhập, thông báo, ngôn ngữ và cài đặt.',
    icon: 'user-round-cog',
    editions: BOTH,
  },
  {
    slug: 'vietnam-travel',
    name: 'Vietnam travel',
    nameVi: 'Du lịch Việt Nam',
    description: 'Arriving, getting around, eating well and staying safe.',
    descriptionVi: 'Nhập cảnh, đi lại, ăn uống và giữ an toàn.',
    icon: 'plane',
    /**
     * ⚠️ THIS WAS SERVICES_ONLY FOR ABOUT AN HOUR, AND THE CORRECTION IS THE INTERESTING PART.
     *
     * The topic-level gate is right — a post-id or keyword denylist over content people write
     * fails silently the first time somebody publishes an article it does not know about. But
     * pointing it at THIS topic withheld ten articles to hide one. The other nine (airport
     * transfers, ride-hailing, ATMs, SIM cards, weather, street food, etiquette, tourist scams,
     * the 48-hour checklist) are ordinary content a licensed marketplace may publish, and they
     * are precisely the "I am moving to Vietnam" material that brings expats to a marketplace
     * for expats. Measured before the correction: 166 of the topic's 215 views were on those
     * nine, all indexed, all 404ing on eno.vn.
     *
     * So the gate did not change — the TAXONOMY did. The single entry-permit article moved to
     * `vietnam-visa` below, one row, and this topic went back to serving both editions. Moving
     * one post beats moving nine, and "Vietnam travel" is a topic a licensed marketplace should
     * obviously be allowed to have.
     *
     * ⚠️ INFORMATIONAL VISA CONTENT BELONGS HERE AND IS ALLOWED ON eno.vn — owner, 2026-08-01:
     * "in eno.vn we can give truthful visa information that is correct fact checked that
     * genuinely helps tourists no issue there". The licensing constraint bites on PROVIDING and
     * ADVERTISING a service eno.vn is not licensed for; explaining how a government process works
     * is neither. So `help-vietnam-evisa-entry-basics` stays in this topic and stays visible on
     * both editions — no data move was needed, only this line.
     *
     * ⚠️ THE LINE TO HOLD IS INFORM vs SELL, and it is about CONTENT, not topic. An article here
     * may explain the official process, the real government fee and the official portal. It may
     * NOT pitch eno's paid visa service, link to its checkout, or read as an advert for it — that
     * is the Advertising Law exposure (Law 75/2025: you must hold documents proving lawful
     * provision of what you promote). Service-help of that kind goes in `vietnam-visa` below.
     */
    editions: BOTH,
  },
  {
    slug: 'eno-service-help',
    name: 'Service help',
    nameVi: 'Trợ giúp dịch vụ',
    description: 'How our paid services work: what they cover, timings, fees and refunds.',
    descriptionVi: 'Cách các dịch vụ trả phí hoạt động: phạm vi, thời gian, phí và hoàn tiền.',
    icon: 'stamp',
    /**
     * ⚠️ THE SERVICES-ONLY TOPIC, AND THE DISTINCTION IT ENCODES IS THE WHOLE POINT.
     *
     * This is not information ABOUT a government process — that is allowed on eno.vn and lives in
     * `vietnam-travel` above. This is help about the PAID SERVICE ITSELF: how an assisted
     * application works, what the fee buys, processing times, refunds, who the licensed provider
     * is. Describing that on eno.vn is advertising a service eno.vn is not licensed to provide,
     * and Law 75/2025 requires the publisher to hold documents proving lawful provision of what
     * it promotes.
     *
     * ⚠️ THE NAME AND DESCRIPTION ARE DELIBERATELY GENERIC, AND A TEST ENFORCES IT. The first
     * draft called this "Our visa service" and `help-center-edition.test.ts` failed it inside a
     * minute: every value in this file compiles into the MARKETPLACE bundle, so naming a
     * services-only topic after the service it withholds ships the vocabulary it exists to
     * withhold. The same trap `src/lib/expat-guides.ts` documents. Keep the values neutral —
     * the topic's meaning belongs in this comment, not in a string that gets bundled.
     *
     * ⚠️ EMPTY TODAY, ON PURPOSE. It carries no articles; it exists so service-help has an
     * obviously correct home the moment somebody writes it, instead of being filed into a travel
     * topic where it would quietly reach the licensed domain. It also keeps the gate exercised —
     * the test asserts a services-only topic exists so the check cannot become vacuous.
     *
     * ⚠️ DO NOT MOVE `help-vietnam-evisa-entry-basics` HERE. It is fact-checked information about
     * a government process, it earned 49 views, and the owner ruled it fine for eno.vn
     * (2026-08-01).
     */
    editions: SERVICES_ONLY,
  },
]

/**
 * The help topics THIS EDITION serves. ⚠️ THE UNQUALIFIED NAME IS THE SAFE ONE, ON
 * PURPOSE — the unscoped list is the one spelled `ALL_`. Every read path in the app
 * (`loadHelpCenter`, `loadHelpThread`, the sitemap, the topic chips) already reached
 * for `HELP_TOPICS`/`HELP_TOPIC_SLUGS`, so scoping THESE means the guard cannot be
 * forgotten at a call site — including a call site that does not exist yet. A future
 * reader who wants "all of them" has to type a name that says so.
 */
export const HELP_TOPICS: readonly HelpTopic[] = ALL_HELP_TOPICS.filter((topic) =>
  topic.editions.includes(EDITION),
)

/**
 * The `communitySlug` allowlist for every help read.
 *
 * ⚠️ THIS ONE CONSTANT IS BOTH HALVES OF THE FIX, and the coupling is the property
 * worth protecting. `loadHelpThread` filters on it, so a withheld article returns null
 * and `/help/[id]` calls `notFound()` — a genuine 404, not a redirect or an empty
 * shell. `src/app/sitemap.xml/route.ts` filters the SAME constant, so the sitemap can
 * never advertise a URL the route refuses to serve. A sitemap-only filter would have
 * been cosmetic: the page would still have resolved for anyone with the link, and
 * Google had already crawled it.
 */
export const HELP_TOPIC_SLUGS: string[] = HELP_TOPICS.map((topic) => topic.slug)

/** Every slug, unscoped — for the sync script that writes to the shared database. */
export const ALL_HELP_TOPIC_SLUGS: string[] = ALL_HELP_TOPICS.map((topic) => topic.slug)

/**
 * The slugs THIS edition must refuse — the complement of {@link HELP_TOPIC_SLUGS}. Empty on the
 * services edition, which withholds nothing.
 *
 * ⚠️ IT EXISTS FOR THE ROUTES THAT SERVE A POST BY ID WITHOUT GOING THROUGH THE HELP CENTRE, and
 * they are the reason a page-level 404 was not enough. `/help/[id]` refuses a withheld article, but
 * `GET /api/forum/posts/[id]` reads the SAME table by id, is compiled into the marketplace build,
 * and had no community filter at all — so eno.vn answered with the article as JSON while its own
 * page said 404. A denylist rather than the existing allowlist because those routes legitimately
 * serve non-help communities too; they must withhold help topics this edition does not carry,
 * without accidentally becoming help-only.
 *
 * A function, not a const, so a caller cannot capture it before EDITION resolves in a test.
 */
export function withheldHelpTopicSlugs(): string[] {
  return ALL_HELP_TOPICS.filter((topic) => !topic.editions.includes(EDITION)).map((t) => t.slug)
}

const BY_SLUG = new Map(HELP_TOPICS.map((topic) => [topic.slug, topic]))

/**
 * ⚠️ EDITION-SCOPED, LIKE EVERYTHING ELSE BELOW `HELP_TOPICS`. On eno.vn a
 * services-only topic is not a help topic at all, so this returns null for it — which
 * is what the thread page's topic chip and any future "is this ours" check need.
 */
export function helpTopic(slug: string): HelpTopic | null {
  return BY_SLUG.get(slug) ?? null
}

/** Is this community one of the Help Center topics? Used to keep help threads out of
 *  the general community feed and vice versa. */
export function isHelpTopic(slug: string): boolean {
  return BY_SLUG.has(slug)
}
