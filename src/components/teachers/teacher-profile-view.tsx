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
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { isListingImageUrl, isMockImageUrl } from '@/lib/listing-image'
import { Tr } from '@/context/language-context'
import { LocalizedText } from '@/components/marketplace/listing-content'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { TeacherContact, TeacherContactJump } from '@/components/teachers/teacher-contact'
import { TeacherAvailableFrom } from '@/components/teachers/teacher-available-from'
import { CATEGORY_BY_SLUG } from '@/lib/taxonomy'
import { TEACHERS_CATEGORY_SLUG } from '@/lib/teachers/constants'
import { TEACHER_OPTIONS } from '@/lib/teachers/profile'
import { countryName } from '@/lib/teachers/countries'
import { teacherProfileLd } from '@/lib/teachers/jsonld'
import { ANYWHERE, ONLINE, coverReachOf, placeLabel } from '@/lib/teachers/places'
import { availableStart, homeLocationName, livesInLine, publicSituation, teachAreaRows } from '@/lib/teachers/profile-view'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { BadgeCheck, Check, Lock } from '@/components/ui/icons'
import { identityMarkShownOnCard } from '@/lib/teachers/identity-mark'
import { COVER_CONSENT_VERSION, COVER_DAYS, COVER_PARTS, COVER_PART_LABELS, coverAreaLabel, coverSlotLabel } from '@/lib/teachers/cover'
import { CoverDayShort } from '@/components/teachers/cover-day'
import { ExperienceMonth } from '@/components/teachers/experience-month'
import { storedLanguageLabel } from '@/components/teachers/language-list'
import { formatCalendarDay, vnIsoDay } from '@/lib/calendar-day'
import { ShareButton } from '@/components/marketplace/share-button'

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

type Experience = { role: string; employer: string; city: string; from: string; to: string }
type Certificate = { type: string; hours: number | null; provider: string; year: number | null }

/** The English level as the header says it — asked only for English-medium subjects (profile.ts englishMedium). */
const ENGLISH_LEVEL: Record<string, { en: string; vi: string }> = {
  native: { en: 'Native English speaker', vi: 'Người bản ngữ tiếng Anh' },
  fluent: { en: 'Fluent English', vi: 'Tiếng Anh lưu loát' },
  working: { en: 'Working English', vi: 'Tiếng Anh dùng được trong công việc' },
}
/** "How long have you been teaching?" — the experience facet's five bands, as a phrase. */
const EXPERIENCE_BAND: Record<string, { en: string; vi: string }> = {
  'under-1-year': { en: 'Under 1 year teaching', vi: 'Dạy dưới 1 năm' },
  '1-3-years': { en: '1–3 years teaching', vi: 'Dạy 1–3 năm' },
  '3-5-years': { en: '3–5 years teaching', vi: 'Dạy 3–5 năm' },
  '5-10-years': { en: '5–10 years teaching', vi: 'Dạy 5–10 năm' },
  'over-10-years': { en: '10+ years teaching', vi: 'Dạy 10 năm trở lên' },
}

/**
 * One chip. `text` goes through <Tr>; `node` is rendered as given — a taxonomy option (OptionLabel, its own
 * Vietnamese), a place name (⛔ never machine-translated, places.ts placeLabel), an authored pair, or the teacher's own
 * words (a taught language).
 */
type Chip = { key: string; text?: string; node?: React.ReactNode }
function Chips({ items }: { items: Chip[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((x) => <li key={x.key} className="rounded-full bg-tint px-3 py-1 text-sm text-body">{x.node ?? <Tr text={x.text} />}</li>)}
    </ul>
  )
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  )
}

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
  const band = tp?.experienceBand ? EXPERIENCE_BAND[tp.experienceBand] : undefined
  const teachLanguages = tp?.teachLanguages ?? []
  const experience = (Array.isArray(tp?.experience) ? tp.experience : []) as Experience[]
  const certificates = (Array.isArray(tp?.certificates) ? tp.certificates : []) as Certificate[]
  const degreeOpts = cat?.facets.find((f) => f.key === 'degree')?.options ?? []
  const degreeLabel = tp?.degreeLevel ? labelOf(degreeOpts, tp.degreeLevel) : null
  // A place — its own name, never machine-translated; Online and "Anywhere in Vietnam" are words, authored in both.
  const placeChip = (k: string): Chip => ({
    key: k,
    node: k === ONLINE ? <Bilingual en="Online" vi="Trực tuyến" />
      : k === ANYWHERE ? <Bilingual en="Anywhere in Vietnam" vi="Bất kỳ đâu tại Việt Nam" />
      : placeLabel(k, lang),
  })
  // "Other language" reads as the languages taught once they are named: a listed language in the reader's language
  // (storedLanguageLabel — "Tiếng Pháp", not "French"), and an old free-text value as it was typed.
  const subjectChips: Chip[] = (tp?.subjects ?? []).flatMap((s): Chip[] => (s === 'other-language' && teachLanguages.length
    ? teachLanguages.map((l) => ({ key: `language:${l}`, node: storedLanguageLabel(l, lang) }))
    : [{ key: s, node: <OptionLabel opts={TEACHER_OPTIONS.subject} value={s} /> }]))
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

  return (
    // data-rum: the page-speed totals tell a teacher profile from any other listing page (src/lib/rum/shared.ts).
    <div className="flex min-h-page flex-col" data-rum="teacher">
      {/* ⛔ Structured data only for a profile search engines are asked to index (the search verdict, above). */}
      {describe && ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(ld) }} />}
      {describe && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(breadcrumbLd) }} />}
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-5xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        {/* The way up (the /c page's trail, ui/breadcrumb — hidden in the native app by its data-crumb-trail). The leaf
            repeats the h1 just below, so a phone shows only the way up: one line, no wrap. */}
        <Breadcrumb className="mb-4">
          <BreadcrumbList>
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
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-8">
            <header className="flex items-start gap-4">
              {/* ⚠️ THROUGH THE OPTIMIZER, PRELOADED AT HIGH PRIORITY (speed plan item 7, 2026-10-16). The raw <img> sent
                  the uploaded original — 71 KB for a 96px circle on the measured profile, ~2 KB as AVIF — at the
                  default image priority. `priority` is the preload and `fetchPriority`
                  is what makes it high (listing-gallery.tsx's note). A URL the optimizer does not serve (anything
                  but a canonical listing-bucket image) is passed through as before. The JSON-LD, the share card
                  and TeacherContact keep the original URL (`photo`). */}
              {photo
                ? <Image src={photo} alt="" width={96} height={96} quality={60} priority fetchPriority="high" unoptimized={!isListingImageUrl(photo) || isMockImageUrl(photo)} className="size-24 shrink-0 rounded-full object-cover" />
                : <span className="size-24 shrink-0 rounded-full bg-muted" />}
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <h1 className="text-2xl font-semibold text-foreground">{name}</h1>
                {/* The teacher's own words, translated for the reader like a listing description is (LocalizedText). */}
                {tp && <p className="mt-1 text-body"><LocalizedText text={tp.headline} /></p>}
                {facts.length > 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {facts.map((f, i) => <Fragment key={f.key}>{i > 0 && ' · '}{f.node}</Fragment>)}
                  </p>
                )}
                {/* "Message" in the first screen (rentals-12): scrolls to the contact block below and runs
                    its action. Phones and tablets only — on lg the block is the sticky right column. */}
                <TeacherContactJump listingId={listing.id} className="mt-3 lg:hidden" />
              </div>
              {/* SHARE (owner, 2026-10-11: "make it easy to share on facebook and zalo or whatsapp") — the page's own
                  link; Facebook and Zalo build the card from its Open Graph tags (the photo, name and headline — never a
                  price, the PDP's generateMetadata). Only a profile schools can see is worth sharing — one left out of
                  search engines (the search verdict) is still on eno, so it is still shared. */}
              {live && (
                <ShareButton
                  url={canonicalUrl}
                  title={tp?.headline ? `${name} — ${tp.headline}` : name}
                  subject="teacher-profile"
                  className="ml-auto shrink-0"
                />
              )}
            </header>

            {/* "IDENTITY VERIFIED" (owner, 2026-10-15) — full width under the header, never beside the h1 (at 320px the
                name column is ~128px). The label and ONE sentence on exactly what was checked and what was not; never the
                tier, the document, its number or its expiry. BadgeCheck: the card's own glyph — one claim, one glyph. */}
            {identityShown && (
              <div data-identity-line="" className="flex flex-col gap-2 rounded-2xl bg-tint p-4 sm:flex-row sm:items-start sm:gap-3">
                <Badge variant="success" size="md" className="self-start">
                  <BadgeCheck aria-hidden className="h-3.5 w-3.5" />
                  <Bilingual en="Identity verified" vi="Đã xác minh danh tính" />
                </Badge>
                <p className="text-sm text-body">
                  <Bilingual
                    en="eno’s team checked this teacher’s ID document and a selfie, and the name above matches that ID. Nationality, qualifications and work permits are as the teacher states. Ask to see documents before hiring."
                    vi="Đội ngũ eno đã kiểm tra giấy tờ tùy thân và ảnh chân dung của giáo viên này; tên ở trên khớp với giấy tờ đó. Quốc tịch, bằng cấp và giấy phép lao động do giáo viên tự khai — hãy đề nghị xem giấy tờ trước khi tuyển dụng."
                  />
                </p>
              </div>
            )}

            {/* COVER LESSONS — first after the name, because a school arriving from the cover filter came for exactly
                this. ⛔ The rate is display only, never JSON-LD (a person is not an Offer — jsonld.ts). Dates are a plain
                calendar day (formatCalendarDay): this page is ISR-cached, so nothing here may read the clock. */}
            {cover && (
              <section aria-labelledby="t-cover" className="space-y-3 rounded-2xl bg-tint p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="t-cover" className="text-lg font-semibold text-foreground"><Bilingual en="Available for cover lessons" vi="Nhận dạy thay" /></h2>
                  <p className="font-semibold text-foreground">{formatMoneyFull(cover.rate, '₫', moneyLocale(lang))} <Bilingual en="/ hour" vi="/ giờ" /></p>
                </div>
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      {/* Narrower below 360px, and the part labels a size down there: "Afternoon" is one word and cannot wrap,
                          and at 320px it overran its column into "Evening" (preview check, 2026-10-07). */}
                      <TableHead className="w-12 min-[360px]:w-16"><span className="sr-only"><Bilingual en="Day of the week" vi="Ngày trong tuần" /></span></TableHead>
                      {COVER_PARTS.map((p) => (
                        <TableHead key={p} className="whitespace-normal px-1 text-center">
                          <span className="text-xs min-[360px]:text-sm"><Bilingual en={COVER_PART_LABELS[p].en} vi={COVER_PART_LABELS[p].vi} /></span>
                          <span className="block text-xs font-normal text-muted-foreground">{COVER_PART_LABELS[p].hours}</span>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {COVER_DAYS.map((d) => (
                      <TableRow key={d} className="hover:bg-transparent">
                        <TableHead scope="row" className="font-semibold"><CoverDayShort day={d} /></TableHead>
                        {COVER_PARTS.map((p) => {
                          const slot = `${d}-${p}`
                          return (
                            <TableCell key={p} className="text-center">
                              {cover.slots.has(slot)
                                ? <><Check aria-hidden className="mx-auto size-4 text-brand" /><span className="sr-only"><Bilingual en={coverSlotLabel(slot, 'en')} vi={coverSlotLabel(slot, 'vi')} /></span></>
                                : <span aria-hidden className="text-muted-foreground">·</span>}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground"><Bilingual en="Can travel to" vi="Có thể đến dạy tại" /></p>
                  {/* Place names in the page's language, never machine-translated (PlaceName's rule). */}
                  <ul className="flex flex-wrap gap-2">
                    {cover.areas.map((a) => <li key={a} className="rounded-full bg-background px-3 py-1 text-sm text-body">{coverAreaLabel(a, lang)}</li>)}
                  </ul>
                </div>
                <p className="text-xs text-muted-foreground">
                  <Bilingual en="This is the teacher's usual week. Message them to agree a date, time and place." vi="Đây là lịch thường lệ của giáo viên. Hãy nhắn tin để thống nhất ngày, giờ và địa điểm." />
                  {cover.confirmedAt && <>{' '}<Bilingual en="Confirmed on {date}." vi="Đã xác nhận ngày {date}." values={{ date: formatCalendarDay(cover.confirmedAt.toISOString(), lang) }} datesIso={{ date: vnIsoDay(cover.confirmedAt) }} /></>}
                </p>
              </section>
            )}

            {publicVideo && (
              <section aria-labelledby="t-video">
                <h2 id="t-video" className="mb-3 text-lg font-semibold text-foreground"><Bilingual en="Intro video" vi="Video giới thiệu" /></h2>
                <video src={publicVideo} controls preload="metadata" playsInline className="aspect-video w-full rounded-2xl bg-black" />
              </section>
            )}
            {/* Kept private, sent on request (2026-10-07): whoever messages the teacher asks in the chat — any account since
                2026-10-13, not only a school — and the teacher sends it there. */}
            {videoOnRequest && (
              <section aria-labelledby="t-video">
                <h2 id="t-video" className="mb-2 text-lg font-semibold text-foreground"><Bilingual en="Intro video" vi="Video giới thiệu" /></h2>
                <p className="flex items-center gap-2 text-sm text-body">
                  <Lock className="size-4 shrink-0 text-muted-foreground" />
                  <Bilingual en="Sent on request — message this teacher and ask for it in the chat." vi="Gửi theo yêu cầu — hãy nhắn tin cho giáo viên và đề nghị xem trong cuộc trò chuyện." />
                </p>
              </section>
            )}

            {tp?.bio && (
              <section aria-labelledby="t-about">
                <h2 id="t-about" className="mb-2 text-lg font-semibold text-foreground"><Bilingual en="About" vi="Giới thiệu" /></h2>
                <p className="max-w-prose whitespace-pre-line text-body"><LocalizedText text={tp.bio} /></p>
              </section>
            )}

            {tp && (
              <section aria-labelledby="t-teaching" className="space-y-4">
                <h2 id="t-teaching" className="text-lg font-semibold text-foreground"><Bilingual en="Teaching" vi="Giảng dạy" /></h2>
                <dl className="divide-y divide-border">
                  {/* Row labels say what the /c/teachers filter calls the same facet (taxonomy labelVi). */}
                  <Row label={<Bilingual en="Subjects" vi="Môn dạy" />}><Chips items={subjectChips} /></Row>
                  <Row label={<Bilingual en="Teaches" vi="Dạy lứa tuổi" />}><Chips items={tp.ageGroups.map((s) => ({ key: s, node: <OptionLabel opts={TEACHER_OPTIONS.ageGroup} value={s} /> }))} /></Row>
                  {jobTypes.length > 0 && <Row label={<Bilingual en="Looking for" vi="Tìm việc" />}><Chips items={jobTypes.map((s) => ({ key: s, node: <OptionLabel opts={TEACHER_OPTIONS.jobType} value={s} /> }))} /></Row>}
                  {/* THE ONE TEACH-AREA LIST (2026-10-08), split by the home area: where they can teach from home (and
                      Online), and where they would move. A school's "Can teach in" filter matches the whole list. */}
                  {places.canTeachIn.length > 0 && <Row label={<Bilingual en="Can teach in" vi="Có thể dạy tại" />}><Chips items={places.canTeachIn.map(placeChip)} /></Row>}
                  {places.wouldMoveTo.length > 0 && <Row label={<Bilingual en="Would move to" vi="Sẵn sàng chuyển đến" />}><Chips items={places.wouldMoveTo.map(placeChip)} /></Row>}
                  {/* "Available: From November 2026", or "Now" once the start has come — decided after mount, on the
                      reader's clock (TeacherAvailableFrom): no clock in this ISR-cached HTML. */}
                  {startDay && <Row label={<Bilingual en="Available" vi="Có thể bắt đầu" />}><TeacherAvailableFrom from={startDay} /></Row>}
                  {tp.expectedSalaryM != null && tp.expectedSalaryM > 0 && <Row label={<Bilingual en="Expected salary" vi="Mức lương mong muốn" />}>{formatMoneyFull(tp.expectedSalaryM * 1_000_000, '₫', moneyLocale(lang))} / <Bilingual en="month" vi="tháng" /></Row>}
                  {tp.languages.length > 0 && <Row label={<Bilingual en="Languages" vi="Ngôn ngữ" />}>{tp.languages.map((l) => storedLanguageLabel(l, lang)).join(', ')}</Row>}
                </dl>
              </section>
            )}

            {experience.length > 0 && (
              <section aria-labelledby="t-exp">
                {/* ⛔ Not <Tr>: the UI-string "Experience" is "Trải nghiệm" (an experience you go on); this is work history. */}
                <h2 id="t-exp" className="mb-3 text-lg font-semibold text-foreground"><Bilingual en="Experience" vi="Kinh nghiệm" /></h2>
                <ol className="space-y-3">
                  {experience.map((x, i) => (
                    <li key={i}>
                      <p className="font-medium text-foreground">{x.role} · {x.employer}</p>
                      <p className="text-sm text-muted-foreground">{x.city}{x.city && (x.from || x.to) ? ' · ' : null}{x.from ? <ExperienceMonth v={x.from} /> : null}{x.from && x.to ? ' – ' : null}{x.to ? <ExperienceMonth v={x.to} /> : null}{x.from && !x.to ? <> – <Bilingual en="present" vi="nay" /></> : null}</p>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {tp && (degreeLabel || certificates.length > 0) && (
              <section aria-labelledby="t-quals">
                <h2 id="t-quals" className="mb-3 text-lg font-semibold text-foreground"><Bilingual en="Qualifications" vi="Bằng cấp và chứng chỉ" /></h2>
                <ul className="space-y-2 text-sm text-body">
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
                <p className="mt-2 text-xs text-muted-foreground"><Bilingual en="Qualifications are as stated by the teacher. Ask to see documents before hiring." vi="Bằng cấp và chứng chỉ do giáo viên tự khai. Hãy đề nghị xem giấy tờ trước khi tuyển dụng." /></p>
              </section>
            )}
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <TeacherContact listingId={listing.id} name={name} image={photo} cover={!!cover} />
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  )
}
