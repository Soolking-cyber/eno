// The public teacher profile (2026-09-30) — what a teacher Listing renders instead of the product
// PDP. Server component: SEO wants the profile in the HTML. Reads only PUBLIC TeacherProfile fields;
// contact data lives in TeacherPrivate and is not selected here.
//
// ONBOARDING REDESIGN (owner, 2026-10-08): it reads the v2 answers — where the teacher lives, the ONE teach-area list,
// the English level, the experience band, the taught languages — through src/lib/teachers/profile-view.ts (one pure
// derivation, tested there). ⛔ The old columns (preferredCities, openToOnline, coverAreas, nativeSpeaker,
// yearsExperience, currentDistrict) are WRITTEN MIRRORS now and are never read back here as answers (plan review D1).
//
// SEARCH DISPLAY (SEO plan P1 items 14 and 15, owner 2026-10-20): the profile is offered to search engines only while
// its search verdict lets it in (src/lib/teachers/search-floor.ts — the quality floor, a masked name, the teacher's own
// "Hide my profile from search engines"): the JSON-LD below follows it, and the PDP's robots tag follows the same row
// (src/lib/teachers/page-row.ts, read once per request). A visible trail — site › Find a teacher › name — leads up to
// /c/teachers, with its BreadcrumbList; the ProfilePage carries the listing's creation day as dateCreated.
import { Fragment } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { SITE_NAME } from '@/lib/edition'
import { localizedHref } from '@/lib/lang-pinned'
import { categoryBrowsePath } from '@/lib/retired-categories'
import { categoryEntryLabel } from '@/lib/category-entry-label'
import { pdpBreadcrumbLd } from '@/lib/pdp-breadcrumb'
import { getTeacherPageRow } from '@/lib/teachers/page-row'
import { teacherPublicVideo, teacherSearchFacts, teacherSearchVerdict } from '@/lib/teachers/search-floor'
import { teacherTitleLine } from '@/lib/teachers/search-title'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { isListingImageUrl, isMockImageUrl } from '@/lib/listing-image'
import { Tr } from '@/context/language-context'
import { LocalizedText } from '@/components/marketplace/listing-content'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { TeacherContact, TeacherContactJump, TeacherCoverAsk } from '@/components/teachers/teacher-contact'
import { PdpActionBar } from '@/components/marketplace/pdp-action-bar'
import { TeacherAvailableFrom } from '@/components/teachers/teacher-available-from'
import { CATEGORY_BY_SLUG } from '@/lib/taxonomy'
import { TEACHERS_CATEGORY_SLUG } from '@/lib/teachers/constants'
import { TEACHER_OPTIONS } from '@/lib/teachers/profile'
import { EXPERIENCE_BAND_PHRASE } from '@/lib/teachers/card-proof'
import { countryName } from '@/lib/teachers/countries'
import { teacherProfileLd } from '@/lib/teachers/jsonld'
import { ANYWHERE, ONLINE, coverReachOf, placeLabel } from '@/lib/teachers/places'
import { availableStart, homeLocationName, livesInLine, publicSituation, teachAreaRows } from '@/lib/teachers/profile-view'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BadgeCheck, Check, Lock } from '@/components/ui/icons'
import { identityMarkShownOnCard } from '@/lib/teachers/identity-mark'
import { COVER_CONSENT_VERSION, COVER_DAYS, COVER_PARTS, COVER_PART_LABELS, coverAreaLabel, coverSlotLabel } from '@/lib/teachers/cover'
import { CoverDayShort } from '@/components/teachers/cover-day'
import { ExperienceMonth } from '@/components/teachers/experience-month'
import { storedLanguageLabel } from '@/components/teachers/language-list'
import { formatCalendarDay, vnIsoDay } from '@/lib/calendar-day'
import { ShareButton } from '@/components/marketplace/share-button'
import { TeacherBio } from '@/components/teachers/teacher-bio'
import { TeacherIntroVideo } from '@/components/teachers/teacher-intro-video'
import { cn } from '@/lib/utils'

type Opt = { value: string; label: string; labelVi?: string }
const labelOf = (opts: readonly Opt[], v: string) => opts.find((o) => o.value === v)?.label ?? v
/**
 * A taxonomy option's name — its own Vietnamese (`labelVi`), never `<Tr>`: `<Tr>` looks the English up as a UI string,
 * so most teacher options ("Phonics", "Private tutoring", "PhD") reached a Vietnamese reader machine-translated, and a
 * curated word could differ from the one the /c/teachers filter shows (2026-10-15). Same rule as a category name
 * (bilingual.tsx). A value the taxonomy does not know prints exactly as stored — never sent to translation as copy.
 */
function OptionLabel({ opts, value }: { opts: readonly Opt[]; value: string }) {
  const o = opts.find((x) => x.value === value)
  if (!o) return <>{value}</>
  return o.labelVi ? <Bilingual en={o.label} vi={o.labelVi} /> : <Tr text={o.label} />
}
const ldJson = (o: object) => JSON.stringify(o).replace(/</g, '\\u003c')
/** The title word for the 'stem' subject, the same in both languages (search-title.ts TITLE_SUBJECT) — see `subjectChips`. */
const STEM_WORD = ' (STEM)'

type Experience = { role: string; employer: string; city: string; from: string; to: string }
type Certificate = { type: string; hours: number | null; provider: string; year: number | null }

/** The English level as the header says it — asked only for English-medium subjects (profile.ts englishMedium). */
const ENGLISH_LEVEL: Record<string, { en: string; vi: string }> = {
  native: { en: 'Native English speaker', vi: 'Người bản ngữ tiếng Anh' },
  fluent: { en: 'Fluent English', vi: 'Tiếng Anh lưu loát' },
  working: { en: 'Working English', vi: 'Tiếng Anh dùng được trong công việc' },
}

/**
 * One fact. `text` goes through <Tr>; `node` is rendered as given — a taxonomy option (OptionLabel, its own
 * Vietnamese), a place name (⛔ never machine-translated, places.ts placeLabel), an authored pair, or the teacher's own
 * words (a taught language).
 */
type Chip = { key: string; text?: string; node?: React.ReactNode }

/**
 * The facts as one plain line — "Kids, Teens, Adults", "Online, Ho Chi Minh City" (UI climb batch 82, 2026-11-13; blind
 * A/B Opus 7.02 → 7.41): ages, job types and places were each a column of pills that a phone stacked one or two to a line.
 * "Can travel to" too (owner-approved 2026-11-14, cook r04 teachers: it was a pill list). Each item renders exactly as its
 * chip did (a place name never machine-translated, a taxonomy option in its own Vietnamese).
 * ⛔ EXCEPT SUBJECTS, WHICH ARE CHIPS AGAIN (owner-approved 2026-11-15, build 7 — cook r07 teachers; it reverses cook r04's
 * "SUBJECTS TOO … every value on this page reads as words", which itself reversed batch 82's "Subjects keep their chips"):
 * `Chips`, below. Every other row stays words.
 */
function Plain({ items }: { items: Chip[] }) {
  // `data-fact` marks each item, so a test reads the items the way it reads a chip list's <li>s.
  return <>{items.map((x, i) => <Fragment key={x.key}>{i > 0 && ', '}<span data-fact="">{x.node ?? <Tr text={x.text} />}</span></Fragment>)}</>
}

/**
 * The subjects as wrapped chips (owner-approved 2026-11-15, build 7 — cook r07 teachers): the SAME items, each its own chip —
 * the field's tint, 32px tall, the 8px corner, 14/20 ink, 8px apart, a real list (no commas to hide). Static: a chip here is
 * a fact, not a control, so it is no button and no link.
 */
function Chips({ items }: { items: Chip[] }) {
  return (
    <ul className="flex flex-wrap gap-2 pt-1">
      {items.map((x) => (
        <li key={x.key} data-fact="" className="inline-flex min-h-8 items-center rounded-lg bg-tint px-3 text-sm text-foreground">
          {x.node ?? <Tr text={x.text} />}
        </li>
      ))}
    </ul>
  )
}

/**
 * A fact row: the label (14, muted) | the value (16, ink), baseline-aligned, 12px above and below its hairline (owner-approved
 * 2026-11-14, cook r04 teachers: it was 14/14 on 8px). On a phone the label column is 7rem (batch 82 made it 7.5rem: at 10rem
 * the values had 186px of a 390px screen); a long Vietnamese label ("Sẵn sàng chuyển đến") wraps to two lines on its baseline.
 */
function Row({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-x-3 py-3 text-base sm:grid-cols-[10rem_1fr]', className)}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  )
}

/** A section's heading: the shell's h2 role (22/28 bold ink, owner-approved 2026-11-14), 12px above its content. */
const SECTION_H2 = 'mb-3 text-t-h2 text-foreground'

export async function TeacherProfileView({ listing, hostUrl, live, lang }: {
  listing: { id: string; title: string; images: string[]; video: string | null; createdAt: Date | string; updatedAt: Date | string }
  /** The site's origin (NEXT_PUBLIC_APP_URL) — the canonical URL and the trail's links are built on it. */
  hostUrl: string
  /** The listing is live (published and active): only then is the profile shared or described to search engines at all. */
  live: boolean
  /** The server-rendered language (en | vi) — country and place names are named in it. */
  lang: string
}) {
  const canonicalUrl = `${hostUrl}/listings/${listing.id}`
  // ONE ROW, shared with the PDP's generateMetadata (cache()d — src/lib/teachers/page-row.ts says what it holds).
  const tpRow = await getTeacherPageRow(listing.id)
  // ⛔ Only THAT a private intro video exists leaves this query (2026-10-07) — its storage path is never rendered, put in
  // the JSON-LD or handed to a client component, so it is split off here, before `tp` is used anywhere. The mark's
  // inputs and the card cache go the same way: whether a teacher HID the mark is theirs, never the page's — and so does
  // "Hide my profile from search engines", which only the search verdict below reads (from `tpRow`).
  const {
    private: tpPrivate, profileId: _profileId, identityMarkOn: _markOn, identityMarkWithdrawnAt: _markHiddenAt, listing: _markCard,
    hideFromSearch: _hideFromSearch, ...tpPublic
  } = tpRow ?? { private: null, profileId: null, identityMarkOn: false, identityMarkWithdrawnAt: null, listing: null, hideFromSearch: false }
  const tp = tpRow ? (tpPublic as Omit<NonNullable<typeof tpRow>, 'private' | 'profileId' | 'identityMarkOn' | 'identityMarkWithdrawnAt' | 'listing' | 'hideFromSearch'>) : null
  /**
   * ⛔ THE SEARCH VERDICT (owner decisions 7 and 14, 2026-10-20 — src/lib/teachers/search-floor.ts), from the very row
   * this page prints: the name in the h1, the About text below, the video the player plays. The PDP's robots tag asks it
   * of the same cache()d row, so the JSON-LD and the tag cannot disagree. Out → no structured data at all.
   */
  const search = teacherSearchVerdict(teacherSearchFacts(tpRow, listing))
  const describe = live && search.indexable
  /**
   * "IDENTITY VERIFIED" — THE PROFILE LINE (owner, 2026-10-15; AUTOMATIC since 2026-10-16): shown while the teacher's
   * identity check is LIVE and the name above is within the ID's, unless they hid it (src/lib/teachers/identity-mark.ts
   * — the one predicate every surface asks). Only the boolean leaves.
   * ⛔ GATED ON THE CARD CACHE this query already loaded (identityMarkShownOnCard): zero identity reads unless the
   * listing's cache holds today's value — the card and the line can never disagree in the line's favour — and then judged
   * LIVE, so a lapse or a revocation since the cache was written never shows. ⚠️ FAILS CLOSED: a cache wrongly empty (a
   * sync that failed) or a read that throws hides the line.
   * ⛔ THE ONE CLOCK READ ON THIS ISR PAGE — correct only because every input that moves it purges the page: a hide or a
   * show-again (saveTeacherIdentityMark), every save — the first Publish and a rename (saveTeacherProfile) — approval and
   * revocation (identity-effects), and the clock itself — a document lapses at 00:00 ICT and the card pass at 00:05 ICT
   * re-derives the cache and purges every identity holder who has not hidden it (/api/cron/identity-marks; the 09:05
   * reconcile again). ⛔ Nothing of it goes into the JSON-LD.
   */
  const identityShown = tpRow
    ? await identityMarkShownOnCard({
      profileId: tpRow.profileId, fullName: tpRow.fullName,
      identityMarkOn: tpRow.identityMarkOn, identityMarkWithdrawnAt: tpRow.identityMarkWithdrawnAt,
    }, tpRow.listing?.identityMarkNotice ?? null, new Date()).catch(() => false)
    : false
  // ⛔ PRIVACY WINS (video.ts, the planner's both-homes rule) — on the teacher's CHOICE alone: a teacher who keeps their video
  // private is shown no public player even if a stale public URL survives somewhere (only a deploy window can leave one),
  // with or without a private video stored (gate review, 2026-10-07). The on-request line needs one stored.
  // The public player's rule is search-floor.ts teacherPublicVideo — the search verdict counts exactly this video.
  const keptPrivate = tp?.videoOnRequest === true
  const videoOnRequest = keptPrivate && !!tpPrivate?.videoPath
  const publicVideo = teacherPublicVideo(tp, listing.video)
  const cat = CATEGORY_BY_SLUG[TEACHERS_CATEGORY_SLUG]
  // A listing without its profile is a broken row (the publish core writes both in one transaction);
  // render the bare minimum rather than a 500.
  const name = tp?.fullName ?? listing.title
  const photo = tp?.photoUrl ?? listing.images[0] ?? null
  const situation = publicSituation(tp ?? {})
  // "Lives in …" / "Not in Vietnam yet" — ⛔ never an empty city, never the old Hồ Chí Minh fallback (profile-view.ts).
  const home = livesInLine(situation, lang)
  const places = teachAreaRows(situation)
  const englishLevel = tp?.englishLevel ? ENGLISH_LEVEL[tp.englishLevel] : undefined
  // The experience band as a phrase — ONE table with the teacher card's proof line (card-proof.ts, batch 80).
  const band = tp?.experienceBand ? EXPERIENCE_BAND_PHRASE[tp.experienceBand] : undefined
  const teachLanguages = tp?.teachLanguages ?? []
  const experience = (Array.isArray(tp?.experience) ? tp.experience : []) as Experience[]
  const certificates = (Array.isArray(tp?.certificates) ? tp.certificates : []) as Certificate[]
  const degreeOpts = cat?.facets.find((f) => f.key === 'degree')?.options ?? []
  const degreeLabel = tp?.degreeLevel ? labelOf(degreeOpts, tp.degreeLevel) : null
  /** The qualifications section is drawn (it carries "Ask to see documents before hiring"; the identity line defers to it). */
  const qualsShown = !!tp && (!!degreeLabel || certificates.length > 0)
  // A place — its own name, never machine-translated; Online and "Anywhere in Vietnam" are words, authored in both.
  const placeChip = (k: string): Chip => ({
    key: k,
    node: k === ONLINE ? <Bilingual en="Online" vi="Trực tuyến" />
      : k === ANYWHERE ? <Bilingual en="Anywhere in Vietnam" vi="Bất kỳ đâu tại Việt Nam" />
      : placeLabel(k, lang),
  })
  // "Other language" reads as the languages taught once they are named: a listed language in the reader's language
  // (storedLanguageLabel — "Tiếng Pháp", not "French"), and an old free-text value as it was typed.
  // The "Maths & science" chip also says "STEM", for screen readers and crawlers only: the word the <title> and the h1 use for it
  // (search-title.ts TITLE_SUBJECT — "STEM & English teacher"), which the page's text otherwise never said (Seobility crawl 10,
  // 2026-11-26: an h1 word missing from the body on nine profiles). The chip's label is unchanged — not a taxonomy rename.
  const subjectChips: Chip[] = (tp?.subjects ?? []).flatMap((s): Chip[] => (s === 'other-language' && teachLanguages.length
    ? teachLanguages.map((l) => ({ key: `language:${l}`, node: storedLanguageLabel(l, lang) }))
    : [{ key: s, node: <><OptionLabel opts={TEACHER_OPTIONS.subject} value={s} />{s === 'stem' && <span className="sr-only">{STEM_WORD}</span>}</> }]))
  // Online is a PLACE since 2026-10-08 ("Can teach in"): an old row's 'online' job type is not printed as a job.
  const jobTypes = (tp?.jobTypes ?? []).filter((j) => TEACHER_OPTIONS.jobType.some((o) => o.value === j))
  // The start DAY ('YYYY-MM-DD'): the page names its month; an old row's day (any day, before 2026-10-08) still decides
  // when it reads "Now" — never before it (profile-view.ts availableStart).
  const startDay = availableStart(tp?.availableFrom)
  // Cover lessons (2026-10-07): shown only while switched on and complete — the same rule as the search tokens
  // (profile.ts coverIsPublic; a stored coverOpen is only ever written with its separate consent).
  // ⛔ AND ONLY UNDER TODAY'S NOTICE: a consent given to an older COVER_CONSENT_VERSION does not cover what the new
  // notice says, so the section disappears until the teacher switches it on again under the new one (gate review).
  // ⛔ WHERE THEY TRAVEL IS DERIVED (2026-10-08): the teach areas near home that are cover areas (places.ts
  // coverReachOf) — the very list the coverArea tokens carry — never the stored coverAreas mirror.
  const coverSlots = tp?.coverSlots ?? [] // `?? []`: a NULL array written outside the app must not crash the page
  const coverAreas = coverReachOf(situation)
  const cover = tp && tp.coverOpen && tp.coverConsentVersion === COVER_CONSENT_VERSION && coverSlots.length > 0 && coverAreas.length > 0 && tp.coverRateVnd != null
    ? { slots: new Set(coverSlots), areas: coverAreas, rate: tp.coverRateVnd, confirmedAt: tp.coverConfirmedAt }
    : null
  // ⛔ knowsLanguage: the teacher's languages by name — English first when they teach in it (an English level is
  // asked only then), then the languages they speak and the ones they teach, each once.
  const knows = [...(tp?.englishLevel ? ['English'] : []), ...(tp?.languages ?? []), ...teachLanguages]
    .filter((l, i, all) => all.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === i)
  const ld = tp && teacherProfileLd({
    url: canonicalUrl, fullName: tp.fullName, headline: tp.headline, photoUrl: photo, nationality: countryName(tp.nationality, 'en'),
    languages: knows, homeLocation: homeLocationName(situation), degreeLevel: tp.degreeLevel, degreeMajor: tp.degreeMajor,
    degreeInstitution: tp.degreeInstitution, certificates: certificates.map((c) => ({ type: c.type, provider: c.provider })),
    createdAt: listing.createdAt, updatedAt: tp.updatedAt,
  })
  /**
   * THE TRAIL — site › Find a teacher › name (SEO plan P1 item 14): the visible crumbs and their BreadcrumbList, from one
   * model (pdpBreadcrumbLd, the product page's — NAV-10). The middle crumb is the category's ENTRY label ("Find a
   * teacher" / "Tìm giáo viên", category-entry-label.ts — a link INTO /c/teachers wears it), named in the page's language
   * like the product trail. The root is SITE_NAME: this page renders on eno.forum too. The last crumb is the h1's name —
   * nothing the page does not already print.
   */
  const entry = categoryEntryLabel({ slug: TEACHERS_CATEGORY_SLUG, name: cat?.name ?? 'Teachers', nameVi: cat?.nameVi })
  const pageLang = lang === 'vi' ? 'vi' : 'en'
  const breadcrumbLd = pdpBreadcrumbLd({
    hostUrl, siteName: SITE_NAME, lang: pageLang,
    category: { slug: TEACHERS_CATEGORY_SLUG, name: entry.name, nameVi: entry.nameVi },
    subcategory: null, title: name, canonicalUrl,
  })
  // The line under the headline: nationality · English level · experience · where they live — each only once answered.
  const facts: { key: string; node: React.ReactNode }[] = tp ? [
    ...(tp.nationality ? [{ key: 'nationality', node: countryName(tp.nationality, lang) }] : []),
    ...(englishLevel ? [{ key: 'english', node: <Bilingual en={englishLevel.en} vi={englishLevel.vi} /> }] : []),
    ...(band ? [{ key: 'experience', node: <Bilingual en={band.en} vi={band.vi} /> }] : []),
    ...(home?.kind === 'place' ? [{ key: 'home', node: <Bilingual en="Lives in {place}" vi="Sống tại {place}" values={{ place: home.place }} /> }] : []),
    // Abroad: the same words the card shows (Listing.location — projection.ts NOT_IN_VIETNAM), never a city.
    ...(home?.kind === 'abroad' ? [{ key: 'home', node: home.online ? <Bilingual en="Not in Vietnam yet · Online" vi="Chưa ở Việt Nam · Trực tuyến" /> : <Bilingual en="Not in Vietnam yet" vi="Chưa ở Việt Nam" /> }] : []),
  ] : []

  /**
   * THE IDENTITY SENTENCE, BUILT ONCE (owner, 2026-10-15; ONE sentence since batch 65, 2026-11-11 — both blind judges named
   * the three of it, five lines of grey on a phone's first screen): what was checked (the ID and a selfie, and that the name
   * above matches it) and what was not (nationality, qualifications, work permits) — never the tier, the document, its number
   * or its expiry. "Ask to see documents before hiring" is the qualifications section's own line further down this page, so
   * it is said once — and here only when that section is not drawn.
   * ⛔ THE LABEL AND THE SENTENCE PART (owner-approved 2026-11-14, cook r04 teachers — it reverses "full width under the
   * header, never beside the h1", owner 2026-10-15): "Identity verified" is a tick UNDER THE NAME, in the name's column, at
   * every width (a 72px portrait below 360px keeps that column ~156px, and the label may wrap — the ruling's worry was a
   * 128px column); the sentence opens the counsel panel (TeacherContact `counsel`) — at every width since 2026-11-26 (owner:
   * "One copy, contact panel"; it was also drawn under the header from lg, CSS showing one, and Seobility counted the pair).
   */
  const identitySentence = identityShown
    ? (qualsShown
        ? <Bilingual
            en="eno checked this teacher’s ID and a selfie, and the name above matches it; nationality, qualifications and work permits are as the teacher states."
            vi="eno đã kiểm tra giấy tờ tùy thân và ảnh chân dung của giáo viên, tên ở trên khớp với giấy tờ đó; quốc tịch, bằng cấp và giấy phép lao động do giáo viên tự khai."
          />
        : <Bilingual
            en="eno checked this teacher’s ID and a selfie, and the name above matches it; nationality, qualifications and work permits are as the teacher states, so ask to see documents before hiring."
            vi="eno đã kiểm tra giấy tờ tùy thân và ảnh chân dung của giáo viên, tên ở trên khớp với giấy tờ đó; quốc tịch, bằng cấp và giấy phép lao động do giáo viên tự khai, hãy đề nghị xem giấy tờ trước khi tuyển dụng."
          />)
    : null
  const rate = cover ? formatMoneyFull(cover.rate, '₫', moneyLocale(lang)) : null

  return (
    // data-rum: the page-speed totals tell a teacher profile from any other listing page (src/lib/rum/shared.ts).
    <div className="flex min-h-page flex-col" data-rum="teacher">
      {/* ⛔ Structured data only for a profile search engines are asked to index (the search verdict, above). */}
      {describe && ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(ld) }} />}
      {describe && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(breadcrumbLd) }} />}
      <Header />
      {/* `pb-6` below lg: the shell's 24px from the last section to the footer's hairline (owner-approved 2026-11-14); lg keeps 48. */}
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-6 lg:pb-12">
        {/* The way up (the /c page's trail, ui/breadcrumb — hidden in the native app by its data-crumb-trail). The leaf
            repeats the h1 just below, so a phone shows only the way up: one line, no wrap — at the meta role (13), 12 above
            the header. */}
        <Breadcrumb className="mb-4 max-sm:mb-3">
          <BreadcrumbList className="max-sm:text-t-meta">
            <BreadcrumbItem>
              {/* `relative tap-44`: a 44px touch target around the short crumb, no layout change (home-06). */}
              <BreadcrumbLink render={<Link href={localizedHref('/', pageLang)} prefetch={false} />} className="relative tap-44 hover:text-accent-foreground">{SITE_NAME}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-line-strong">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={localizedHref(categoryBrowsePath(TEACHERS_CATEGORY_SLUG), pageLang)} prefetch={false} />} className="relative tap-44 hover:text-accent-foreground">
                <Bilingual en={entry.name} vi={entry.nameVi || entry.name} />
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden text-line-strong sm:block">/</BreadcrumbSeparator>
            <BreadcrumbItem className="hidden min-w-0 sm:inline-flex">
              <BreadcrumbPage className="truncate font-medium">{name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_24rem] lg:gap-x-10">
          <div className="space-y-8">
            {/* ⛔ THE HEADER IS ONE GRID (owner-approved 2026-11-14, cook r04 teachers — it reverses 2026-11-05's "A PHONE'S HEADER
                IS TWO BANDS … a 96px photo beside everything left the words a 240px column"; the reason still holds). Below lg: a
                96px portrait | the name (the page's one display line, balanced) over its "Identity verified" tick | the share
                glyph on a 44px target — the portrait beside ONLY the name and the tick. Then, at the full width: the teacher's
                headline, the facts, and the rate with "Contact teacher" on one row (the pinned bar's own layout). 320–359px: a
                72px portrait and the h2 step, so the name column keeps ~156px. From lg the photo spans the column's height
                beside name, tick and details, as it always did; the h1 stays 24px there, now bold.
                DOM ORDER = READING ORDER: photo, h1, tick, share, details. 24px down to the video below lg (`max-lg:mb-6` beats
                the column's zero-specificity space-y). */}
            <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 max-lg:mb-6 lg:grid-rows-[auto_auto_1fr] lg:gap-x-4">
              {/* ⚠️ THROUGH THE OPTIMIZER, PRELOADED AT HIGH PRIORITY (speed plan item 7, 2026-10-16). The raw <img> sent
                  the uploaded original — 71 KB for a 96px circle on the measured profile, ~2 KB as AVIF — at the
                  default image priority. `priority` is the preload and `fetchPriority`
                  is what makes it high (listing-gallery.tsx's note). A URL the optimizer does not serve (anything
                  but a canonical listing-bucket image) is passed through as before. The JSON-LD, the share card
                  and TeacherContact keep the original URL (`photo`). */}
              {photo
                ? <Image src={photo} alt={name} aria-hidden width={96} height={96} quality={60} priority fetchPriority="high" unoptimized={!isListingImageUrl(photo) || isMockImageUrl(photo)} className="col-start-1 row-span-2 row-start-1 size-24 shrink-0 self-center rounded-full object-cover ring-1 ring-border max-[359px]:size-18 lg:row-span-3 lg:self-start" />
                : <span className="col-start-1 row-span-2 row-start-1 size-24 shrink-0 self-center rounded-full bg-muted ring-1 ring-border max-[359px]:size-18 lg:row-span-3 lg:self-start" />}
              {/* ⛔ THE NAME IS THE FIGURE ROLE BELOW lg (owner-approved 2026-11-15, build 7 — cook r07 teachers; it reverses, on this
                  page, the shell's "--t-display 28/34, ONE per page"): `text-t-figure` 32px bold −0.03em on a 36px line (two
                  balanced lines stay 72px beside the 96px portrait), still the page's one display object. 320–359px keeps the h2
                  step (22/28); from lg the 24px name, as before. */}
              <h1 className={cn(
                'col-start-2 row-start-1 min-w-0 text-t-figure max-lg:leading-9 text-balance text-foreground [overflow-wrap:anywhere] max-[359px]:text-t-h2 max-[359px]:leading-7 lg:self-start lg:text-2xl lg:font-bold lg:tracking-normal',
                identityShown ? 'self-end' : 'row-span-2 self-center lg:row-span-1',
              )}>
                {name}
                {/* What the <title> says after the name, for crawlers and screen readers, not on screen (Seobility, 2026-11-23: a
                    name alone is under the 20 characters an h1 should have). The page states the same subjects and city below.
                    English only: the Vietnamese line can carry an untranslated subject ("Phonics"), and the vi body holds none. */}
                {pageLang === 'en' && <span className="sr-only">{' — '}{teacherTitleLine(tp ?? {}, pageLang)}</span>}
              </h1>
              {/* "IDENTITY VERIFIED" (owner, 2026-10-15; AUTOMATIC since 2026-10-16) — a fact about the person, under the name:
                  the card's own BadgeCheck in the success green, the label in ink, no pill. It may wrap; never nowrap. */}
              {identityShown && (
                <p data-identity-tick="" className="col-start-2 row-start-2 mt-1.5 flex min-w-0 items-start gap-1.5 text-sm font-bold text-foreground">
                  <BadgeCheck aria-hidden className="mt-px size-4.5 shrink-0 text-success" />
                  <Bilingual en="Identity verified" vi="Đã xác minh danh tính" />
                </p>
              )}
              {/* SHARE (owner, 2026-10-11: "make it easy to share on facebook and zalo or whatsapp") — the page's own
                  link; Facebook and Zalo build the card from its Open Graph tags (the photo, name and headline — never a
                  price, the PDP's generateMetadata). Only a profile schools can see is worth sharing — one left out of
                  search engines (the search verdict) is still on eno, so it is still shared. Below sm the glyph alone, 22px in
                  ink, centred on a 44px target in the header's third column; from sm its label, as before. */}
              {live && (
                <ShareButton
                  url={canonicalUrl}
                  title={tp?.headline ? `${name} — ${tp.headline}` : name}
                  subject="teacher-profile"
                  className="col-start-3 row-span-2 row-start-1 shrink-0 self-center max-sm:size-11 max-sm:justify-center max-sm:p-0 max-sm:text-foreground max-sm:[&_svg]:size-5.5 lg:row-span-1 lg:self-start"
                />
              )}
              <div className="col-span-3 row-start-3 mt-4 min-w-0 [overflow-wrap:anywhere] lg:col-span-1 lg:col-start-2 lg:mt-1">
                {/* The teacher's own words, translated for the reader like a listing description is (LocalizedText). */}
                {tp && <p className="text-pretty text-foreground"><LocalizedText text={tp.headline} /></p>}
                {facts.length > 0 && (
                  <p className="mt-2 text-pretty text-sm text-muted-foreground">
                    {facts.map((f, i) => <Fragment key={f.key}>{i > 0 && ' · '}{f.node}</Fragment>)}
                  </p>
                )}
                {/* THE RATE AND THE ONE ACTION ON ONE ROW (owner-approved 2026-11-14, cook r04 teachers) — the pinned bar's own
                    layout, so the bar is this row pinned once it scrolls away. Phones and tablets only: on lg the contact block
                    is the sticky right column. "Contact teacher" (rentals-12) scrolls to that block and runs its action. It takes
                    the rest of the row, and drops to its own full-width line where the two cannot share one (Vietnamese at 320). */}
                {/* The rate a step up (owner-approved 2026-11-15, build 7 — cook r07 teachers): the figure 24/28 bold ink, "/ hour"
                    a 15 muted label (the card-title role, regular). */}
                <div className="mt-4 flex flex-wrap items-center gap-3 lg:hidden">
                  {rate && <p className="text-2xl leading-7 font-bold tracking-tight tabular-nums text-price">{rate} <span className="text-t-card font-normal tracking-normal text-muted-foreground"><Bilingual en="/ hour" vi="/ giờ" /></span></p>}
                  {/* `data-pdp-action-block`: the element the pinned bar measures and reads the button through (pdp-action-bar.tsx:
                      a node the page keeps, never the button itself). At lg the row is display:none, so the bar finds no
                      control to mirror there. */}
                  <div data-pdp-action-block="" className="grow sm:grow-0">
                    <TeacherContactJump listingId={listing.id} className="w-full sm:w-auto" />
                  </div>
                </div>
                {/* The same action, pinned once that button has scrolled away and until the full contact block is on screen
                    (owner, 2026-11-10: item 1 of the decision scorecard; pdp-action-bar.tsx). It presses the button above. */}
                <PdpActionBar
                  block="[data-pdp-action-block]"
                  control='[data-pdp-primary="teacher"]'
                  // = '#' + TEACHER_CONTACT_ID (teacher-contact.tsx). Written out: that file is a client module, and a server
                  // component cannot read a client module's constant. teacher-profile-view.pinned-bar.test.ts keeps the two equal.
                  hideWhile="#teacher-contact"
                  price={rate ? <p className="text-lg font-bold leading-6 text-price">{rate} <span className="text-base font-normal text-muted-foreground"><Bilingual en="/ hour" vi="/ giờ" /></span></p> : undefined}
                />
              </div>
            </header>

            {/* The identity sentence is the contact block's `counsel` at every width since 2026-11-26 (owner: "One copy, contact
                panel" — two server copies were Seobility's duplicate paragraph); it is no longer drawn under the header. */}

            {/* ⛔ THE VIDEO FIRST, AT EVERY WIDTH (owner-approved 2026-11-14, cook r04 teachers — it reverses batch 69's "TEACHING
                FACTS FIRST … before the video", 2026-11-11): a person before their facts, as Preply opens, straight under the
                rate row. One DOM order: no CSS `order`, no second <video>. The heading stays for screen readers only; the frame
                wears the 16px media corner.
                ⛔ A POSTER WITH A REAL PLAY BUTTON (owner-approved 2026-11-15, build 7 — cook r07 teachers; it reverses cook r04's
                "the player says what it is" through its native control bar): until the first tap the frame shows the white play
                disc and the video's length on a white plate; the tap turns the controls on and plays the same <video>. Never
                autoplay (teacher-intro-video.tsx). */}
            {publicVideo && (
              <section aria-labelledby="t-video">
                <h2 id="t-video" className="sr-only"><Bilingual en="Intro video" vi="Video giới thiệu" /></h2>
                <TeacherIntroVideo src={publicVideo} />
              </section>
            )}
            {/* Kept private, sent on request (2026-10-07): whoever messages the teacher asks in the chat — any account since
                2026-10-13, not only a school — and the teacher sends it there. */}
            {videoOnRequest && (
              <section aria-labelledby="t-video">
                <h2 id="t-video" className={SECTION_H2}><Bilingual en="Intro video" vi="Video giới thiệu" /></h2>
                <p className="flex items-center gap-2 text-sm text-body">
                  <Lock className="size-4 shrink-0 text-muted-foreground" />
                  <Bilingual en="Sent on request — message this teacher and ask for it in the chat." vi="Gửi theo yêu cầu — hãy nhắn tin cho giáo viên và đề nghị xem trong cuộc trò chuyện." />
                </p>
              </section>
            )}

            {/* TEACHING: subjects, ages, where and languages — what a school or a parent decides fit on (UI climb batch 69), right
                after the video. Label | value rows on hairlines; the subjects, the long value, take the full width under their
                label on a phone. */}
            {tp && (
              <section aria-labelledby="t-teaching">
                <h2 id="t-teaching" className={SECTION_H2}><Bilingual en="Teaching" vi="Giảng dạy" /></h2>
                <dl className="divide-y divide-border">
                  {/* Row labels say what the /c/teachers filter calls the same facet (taxonomy labelVi). */}
                  {/* Subjects as chips (build 7, `Chips`); the full width under their label on a phone. */}
                  <Row label={<Bilingual en="Subjects" vi="Môn dạy" />} className="pt-1 max-sm:grid-cols-1 max-sm:gap-y-1"><Chips items={subjectChips} /></Row>
                  <Row label={<Bilingual en="Teaches" vi="Dạy lứa tuổi" />}><Plain items={tp.ageGroups.map((s) => ({ key: s, node: <OptionLabel opts={TEACHER_OPTIONS.ageGroup} value={s} /> }))} /></Row>
                  {jobTypes.length > 0 && <Row label={<Bilingual en="Looking for" vi="Tìm việc" />}><Plain items={jobTypes.map((s) => ({ key: s, node: <OptionLabel opts={TEACHER_OPTIONS.jobType} value={s} /> }))} /></Row>}
                  {/* THE ONE TEACH-AREA LIST (2026-10-08), split by the home area: where they can teach from home (and
                      Online), and where they would move. A school's "Can teach in" filter matches the whole list. */}
                  {places.canTeachIn.length > 0 && <Row label={<Bilingual en="Can teach in" vi="Có thể dạy tại" />}><Plain items={places.canTeachIn.map(placeChip)} /></Row>}
                  {places.wouldMoveTo.length > 0 && <Row label={<Bilingual en="Would move to" vi="Sẵn sàng chuyển đến" />}><Plain items={places.wouldMoveTo.map(placeChip)} /></Row>}
                  {/* "Available: From November 2026", or "Now" once the start has come — decided after mount, on the
                      reader's clock (TeacherAvailableFrom): no clock in this ISR-cached HTML. */}
                  {startDay && <Row label={<Bilingual en="Available" vi="Có thể bắt đầu" />}><TeacherAvailableFrom from={startDay} /></Row>}
                  {tp.expectedSalaryM != null && tp.expectedSalaryM > 0 && <Row label={<Bilingual en="Expected salary" vi="Mức lương mong muốn" />}>{formatMoneyFull(tp.expectedSalaryM * 1_000_000, '₫', moneyLocale(lang))} / <Bilingual en="month" vi="tháng" /></Row>}
                  {tp.languages.length > 0 && <Row label={<Bilingual en="Languages" vi="Ngôn ngữ" />}>{tp.languages.map((l) => storedLanguageLabel(l, lang)).join(', ')}</Row>}
                </dl>
              </section>
            )}

            {/* COVER LESSONS — after Teaching (2026-11-05: a person before a timetable), because a school arriving from the cover
                filter came for exactly this; the rate is already at the button above. ⛔ The rate is display only, never JSON-LD
                (a person is not an Offer — jsonld.ts). Dates are a plain calendar day (formatCalendarDay): this page is
                ISR-cached, so nothing here may read the clock. */}
            {cover && (
              <section aria-labelledby="t-cover">
                <h2 id="t-cover" className={SECTION_H2}><Bilingual en="Available for cover lessons" vi="Nhận dạy thay" /></h2>
                {/* ⛔ THE USUAL WEEK AS A COMPACT GRID (UI climb batch 88, 2026-11-13 — round 13 "every fact once"; owner, 2026-11-13:
                    "reduce lines … super clean"): three rows (morning, afternoon, evening) by seven days, flat on the page ("lines
                    between elements … almost no boxes", owner 07-24). Still a real table: every cell keeps a screen-reader label —
                    the open slot's own words, "Not available" for the rest — and the hours stay under each part of the day.
                    ⛔ A FREE SLOT IS THE SUCCESS GREEN'S WASH WITH ITS CHECK, NOT A FILLED BRAND SQUARE (owner-approved 2026-11-14, cook
                    r04 teachers — it reverses batch 88's filled squares): the check says "free" without a legend, and nothing in
                    the week is heavier than the name or the button; a closed slot is the field's well. 32px slots in 44px rows,
                    4px apart. The wrapper takes the border-spacing's pull, outside ui/table's own overflow container. */}
                <div className="-mx-1 -mt-1.5">
                  <Table className="table-fixed border-separate border-spacing-x-1 border-spacing-y-1.5">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-auto w-20 px-0"><span className="sr-only"><Bilingual en="Part of the day" vi="Buổi" /></span></TableHead>
                        {COVER_DAYS.map((d) => (
                          <TableHead key={d} className="h-auto px-0 pb-0.5 text-center text-t-meta font-normal text-muted-foreground"><CoverDayShort day={d} /></TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {COVER_PARTS.map((p) => (
                        <TableRow key={p} className="border-0 hover:bg-transparent">
                          <TableHead scope="row" className="h-auto px-0 text-left align-middle text-sm font-normal text-body">
                            <Bilingual en={COVER_PART_LABELS[p].en} vi={COVER_PART_LABELS[p].vi} />
                            <span className="block text-t-meta text-muted-foreground">{COVER_PART_LABELS[p].hours}</span>
                          </TableHead>
                          {COVER_DAYS.map((d) => {
                            const slot = `${d}-${p}`
                            const open = cover.slots.has(slot)
                            return (
                              <TableCell key={d} className="h-11 p-0 align-middle">
                                <span aria-hidden data-cover-slot={open ? 'open' : ''} className={cn('flex h-8 items-center justify-center rounded-lg', open ? 'bg-success/10 text-success' : 'bg-tint')}>
                                  {open && <Check aria-hidden className="size-4" />}
                                </span>
                                <span className="sr-only">
                                  {open
                                    ? <Bilingual en={coverSlotLabel(slot, 'en')} vi={coverSlotLabel(slot, 'vi')} />
                                    : <Bilingual en="Not available" vi="Không nhận" />}
                                </span>
                              </TableCell>
                            )
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {/* "Can travel to" as a label | value row on hairlines, like Teaching's (owner-approved 2026-11-14; it was a pill list).
                    Place names in the page's language, never machine-translated (PlaceName's rule). */}
                <dl className="mt-3 border-y border-border">
                  <Row label={<Bilingual en="Can travel to" vi="Có thể đến dạy tại" />}><Plain items={cover.areas.map((a) => ({ key: a, node: coverAreaLabel(a, lang) }))} /></Row>
                </dl>
                {/* One short note (batch 88): the week is the teacher's usual one, and when they confirmed it. */}
                <p className="mt-3 text-t-meta text-muted-foreground">
                  <Bilingual en="Usual week" vi="Lịch thường lệ" />
                  {cover.confirmedAt && <>{' · '}<Bilingual en="confirmed {date}" vi="xác nhận ngày {date}" values={{ date: formatCalendarDay(cover.confirmedAt.toISOString(), lang) }} datesIso={{ date: vnIsoDay(cover.confirmedAt) }} /></>}
                </p>
                {/* The cover ask under the week it asks about, below lg (teacher-contact.tsx TeacherCoverAsk: the contact block's
                    own action, a remote; from lg the block's cta is the ask). A block-level 44px box, 8px under the note, so
                    its height is its own and never a line box's. */}
                <TeacherCoverAsk listingId={listing.id} className="mt-2 flex min-h-11 w-fit lg:hidden" />
              </section>
            )}

            {tp?.bio && (
              <section aria-labelledby="t-about">
                <h2 id="t-about" className={SECTION_H2}><Bilingual en="About" vi="Giới thiệu" /></h2>
                <TeacherBio><LocalizedText text={tp.bio} /></TeacherBio>
              </section>
            )}

            {experience.length > 0 && (
              <section aria-labelledby="t-exp">
                {/* ⛔ Not <Tr>: the UI-string "Experience" is "Trải nghiệm" (an experience you go on); this is work history. */}
                <h2 id="t-exp" className={SECTION_H2}><Bilingual en="Experience" vi="Kinh nghiệm" /></h2>
                <ol className="space-y-3">
                  {experience.map((x, i) => (
                    <li key={i}>
                      {/* A row title (the shell's h3 role, 17/24 bold ink), its place and months in the small muted step. */}
                      <p className="text-t-h3 text-foreground">{x.role} · {x.employer}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{x.city}{x.city && (x.from || x.to) ? ' · ' : null}{x.from ? <ExperienceMonth v={x.from} /> : null}{x.from && x.to ? ' – ' : null}{x.to ? <ExperienceMonth v={x.to} /> : null}{x.from && !x.to ? <> – <Bilingual en="present" vi="nay" /></> : null}</p>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {qualsShown && (
              <section aria-labelledby="t-quals">
                <h2 id="t-quals" className={SECTION_H2}><Bilingual en="Qualifications" vi="Bằng cấp và chứng chỉ" /></h2>
                <ul className="space-y-2 text-base text-body">
                  {degreeLabel && tp.degreeLevel && (
                    <li><OptionLabel opts={degreeOpts} value={tp.degreeLevel} />{tp.degreeMajor ? `, ${tp.degreeMajor}` : ''}{tp.degreeInstitution ? ` — ${tp.degreeInstitution}` : ''}{tp.degreeYear ? ` (${tp.degreeYear})` : ''}</li>
                  )}
                  {certificates.filter((c) => c.type).map((c, i) => (
                    <li key={i}>
                      <OptionLabel opts={TEACHER_OPTIONS.cert} value={c.type} />
                      {c.hours ? ` · ${c.hours}h` : ''}{c.provider ? ` · ${c.provider}` : ''}{c.year ? ` (${c.year})` : ''}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-t-meta text-muted-foreground"><Bilingual en="Self-stated · ask to see documents" vi="Do giáo viên tự khai · hãy đề nghị xem giấy tờ" /></p>
              </section>
            )}
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            {/* The rate sits with the action: here on desktop, beside the Contact button in the header below lg. */}
            {rate && <p className="mb-3 hidden text-2xl font-bold tracking-tight text-price lg:block">{rate} <span className="text-base font-semibold"><Bilingual en="/ hour" vi="/ giờ" /></span></p>}
            {/* Below lg the block is the counsel panel at the end of the page, opened by the identity sentence (`counsel`). */}
            <TeacherContact listingId={listing.id} name={name} image={photo} cover={!!cover} counsel={identitySentence} />
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  )
}
