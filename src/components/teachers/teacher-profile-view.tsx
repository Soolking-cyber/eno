// The public teacher profile (2026-09-30) — what a teacher Listing renders instead of the product
// PDP. Server component: SEO wants the profile in the HTML. Reads only PUBLIC TeacherProfile fields;
// contact data lives in TeacherPrivate and is not selected here.
//
// ONBOARDING REDESIGN (owner, 2026-10-08): it reads the v2 answers — where the teacher lives, the ONE teach-area list,
// the English level, the experience band, the taught languages — through src/lib/teachers/profile-view.ts (one pure
// derivation, tested there). ⛔ The old columns (preferredCities, openToOnline, coverAreas, nativeSpeaker,
// yearsExperience, currentDistrict) are WRITTEN MIRRORS now and are never read back here as answers (plan review D1).
import { Fragment } from 'react'
import { db } from '@/lib/db'
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
import { Check, Lock } from '@/components/ui/icons'
import { COVER_CONSENT_VERSION, COVER_DAYS, COVER_PARTS, COVER_PART_LABELS, coverAreaLabel, coverSlotLabel } from '@/lib/teachers/cover'
import { CoverDayShort } from '@/components/teachers/cover-day'
import { formatCalendarDay } from '@/lib/calendar-day'

type Opt = { value: string; label: string }
const labelOf = (opts: readonly Opt[], v: string) => opts.find((o) => o.value === v)?.label ?? v
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
  'over-10-years': { en: '10+ years teaching', vi: 'Dạy hơn 10 năm' },
}

/**
 * One chip. `text` is taxonomy copy and goes through <Tr>; `node` is rendered as given — a place name (⛔ never
 * machine-translated, places.ts placeLabel), an authored pair, or the teacher's own words (a taught language).
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

export async function TeacherProfileView({ listing, canonicalUrl, indexable, lang }: {
  listing: { id: string; title: string; images: string[]; video: string | null; updatedAt: Date | string }
  canonicalUrl: string
  indexable: boolean
  /** The server-rendered language (en | vi) — country and place names are named in it. */
  lang: string
}) {
  const tpRow = await db.teacherProfile.findUnique({
    where: { listingId: listing.id },
    select: {
      fullName: true, headline: true, bio: true, photoUrl: true, videoUrl: true, nationality: true,
      languages: true, availableFrom: true, jobTypes: true, ageGroups: true, subjects: true, experience: true,
      degreeLevel: true, degreeMajor: true, degreeInstitution: true, degreeYear: true, certificates: true, expectedSalaryM: true, updatedAt: true,
      // The v2 situation (2026-10-08) — where they live and the one teach-area list; the cover reach is derived from them.
      livesIn: true, currentCity: true, currentDistrictKey: true, currentProvince: true, teachAreas: true,
      teachLanguages: true, englishLevel: true, experienceBand: true,
      coverOpen: true, coverSlots: true, coverRateVnd: true, coverConfirmedAt: true, coverConsentVersion: true,
      videoOnRequest: true, private: { select: { videoPath: true } },
    },
  })
  // ⛔ Only THAT a private intro video exists leaves this query (2026-10-07) — its storage path is never rendered, put in
  // the JSON-LD or handed to a client component, so it is split off here, before `tp` is used anywhere.
  const { private: tpPrivate, ...tpPublic } = tpRow ?? { private: null }
  const tp = tpRow ? (tpPublic as Omit<NonNullable<typeof tpRow>, 'private'>) : null
  // ⛔ PRIVACY WINS (video.ts, the planner's both-homes rule) — on the teacher's CHOICE alone: a teacher who keeps their video
  // private is shown no public player even if a stale public URL survives somewhere (only a deploy window can leave one),
  // with or without a private video stored (gate review, 2026-10-07). The on-request line needs one stored.
  const keptPrivate = tp?.videoOnRequest === true
  const videoOnRequest = keptPrivate && !!tpPrivate?.videoPath
  const publicVideo = keptPrivate ? null : (tp?.videoUrl ?? listing.video)
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
  const degreeLabel = tp?.degreeLevel ? labelOf(cat?.facets.find((f) => f.key === 'degree')?.options ?? [], tp.degreeLevel) : null
  // A place — its own name, never machine-translated; Online and "Anywhere in Vietnam" are words, authored in both.
  const placeChip = (k: string): Chip => ({
    key: k,
    node: k === ONLINE ? <Bilingual en="Online" vi="Trực tuyến" />
      : k === ANYWHERE ? <Bilingual en="Anywhere in Vietnam" vi="Bất kỳ đâu tại Việt Nam" />
      : placeLabel(k, lang),
  })
  // "Other language" reads as the languages taught (the teacher's own words, as typed) once they are named.
  const subjectChips: Chip[] = (tp?.subjects ?? []).flatMap((s): Chip[] => (s === 'other-language' && teachLanguages.length
    ? teachLanguages.map((l) => ({ key: `language:${l}`, node: l }))
    : [{ key: s, text: labelOf(TEACHER_OPTIONS.subject, s) }]))
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
    degreeInstitution: tp.degreeInstitution, certificates: certificates.map((c) => ({ type: c.type, provider: c.provider })), updatedAt: tp.updatedAt,
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
    <div className="flex min-h-page flex-col">
      {indexable && ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(ld) }} />}
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-5xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-8">
            <header className="flex items-start gap-4">
              {photo
                ? <img src={photo} alt="" width={96} height={96} className="size-24 shrink-0 rounded-full object-cover" />
                : <span className="size-24 shrink-0 rounded-full bg-muted" />}
              <div className="min-w-0">
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
            </header>

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
                  {cover.confirmedAt && <>{' '}<Bilingual en="Confirmed on {date}." vi="Xác nhận ngày {date}." values={{ date: formatCalendarDay(cover.confirmedAt.toISOString(), lang) }} datesIso={{ date: cover.confirmedAt.toISOString().slice(0, 10) }} /></>}
                </p>
              </section>
            )}

            {publicVideo && (
              <section aria-labelledby="t-video">
                <h2 id="t-video" className="mb-3 text-lg font-semibold text-foreground"><Tr text="Intro video" /></h2>
                <video src={publicVideo} controls preload="metadata" playsInline className="aspect-video w-full rounded-2xl bg-black" />
              </section>
            )}
            {/* Kept private, sent on request (2026-10-07): a school asks in the chat, and the teacher sends it there. */}
            {videoOnRequest && (
              <section aria-labelledby="t-video">
                <h2 id="t-video" className="mb-2 text-lg font-semibold text-foreground"><Tr text="Intro video" /></h2>
                <p className="flex items-center gap-2 text-sm text-body">
                  <Lock className="size-4 shrink-0 text-muted-foreground" />
                  <Bilingual en="Sent on request — schools can message this teacher and ask for it in the chat." vi="Gửi khi được đề nghị — trường có thể nhắn tin cho giáo viên và đề nghị xem trong cuộc trò chuyện." />
                </p>
              </section>
            )}

            {tp?.bio && (
              <section aria-labelledby="t-about">
                <h2 id="t-about" className="mb-2 text-lg font-semibold text-foreground"><Tr text="About" /></h2>
                <p className="max-w-prose whitespace-pre-line text-body"><LocalizedText text={tp.bio} /></p>
              </section>
            )}

            {tp && (
              <section aria-labelledby="t-teaching" className="space-y-4">
                <h2 id="t-teaching" className="text-lg font-semibold text-foreground"><Tr text="Teaching" /></h2>
                <dl className="divide-y divide-border">
                  <Row label={<Tr text="Subjects" />}><Chips items={subjectChips} /></Row>
                  <Row label={<Tr text="Teaches" />}><Chips items={tp.ageGroups.map((s) => ({ key: s, text: labelOf(TEACHER_OPTIONS.ageGroup, s) }))} /></Row>
                  {jobTypes.length > 0 && <Row label={<Tr text="Looking for" />}><Chips items={jobTypes.map((s) => ({ key: s, text: labelOf(TEACHER_OPTIONS.jobType, s) }))} /></Row>}
                  {/* THE ONE TEACH-AREA LIST (2026-10-08), split by the home area: where they can teach from home (and
                      Online), and where they would move. A school's "Can teach in" filter matches the whole list. */}
                  {places.canTeachIn.length > 0 && <Row label={<Bilingual en="Can teach in" vi="Có thể dạy tại" />}><Chips items={places.canTeachIn.map(placeChip)} /></Row>}
                  {places.wouldMoveTo.length > 0 && <Row label={<Bilingual en="Would move to" vi="Sẵn sàng chuyển đến" />}><Chips items={places.wouldMoveTo.map(placeChip)} /></Row>}
                  {/* "Available: From November 2026", or "Now" once the start has come — decided after mount, on the
                      reader's clock (TeacherAvailableFrom): no clock in this ISR-cached HTML. */}
                  {startDay && <Row label={<Bilingual en="Available" vi="Có thể bắt đầu" />}><TeacherAvailableFrom from={startDay} /></Row>}
                  {tp.expectedSalaryM != null && tp.expectedSalaryM > 0 && <Row label={<Tr text="Expected salary" />}>{formatMoneyFull(tp.expectedSalaryM * 1_000_000, '₫', moneyLocale(lang))} / <Tr text="month" /></Row>}
                  {tp.languages.length > 0 && <Row label={<Tr text="Languages" />}>{tp.languages.join(', ')}</Row>}
                </dl>
              </section>
            )}

            {experience.length > 0 && (
              <section aria-labelledby="t-exp">
                <h2 id="t-exp" className="mb-3 text-lg font-semibold text-foreground"><Tr text="Experience" /></h2>
                <ol className="space-y-3">
                  {experience.map((x, i) => (
                    <li key={i}>
                      <p className="font-medium text-foreground">{x.role} · {x.employer}</p>
                      <p className="text-sm text-muted-foreground">{[x.city, [x.from, x.to || null].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}{x.from && !x.to ? <> – <Tr text="present" /></> : null}</p>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {tp && (degreeLabel || certificates.length > 0) && (
              <section aria-labelledby="t-quals">
                <h2 id="t-quals" className="mb-3 text-lg font-semibold text-foreground"><Tr text="Qualifications" /></h2>
                <ul className="space-y-2 text-sm text-body">
                  {degreeLabel && (
                    <li><Tr text={degreeLabel} />{tp.degreeMajor ? `, ${tp.degreeMajor}` : ''}{tp.degreeInstitution ? ` — ${tp.degreeInstitution}` : ''}{tp.degreeYear ? ` (${tp.degreeYear})` : ''}</li>
                  )}
                  {certificates.filter((c) => c.type).map((c, i) => (
                    <li key={i}>
                      <Tr text={labelOf(TEACHER_OPTIONS.cert, c.type)} />
                      {c.hours ? ` · ${c.hours}h` : ''}{c.provider ? ` · ${c.provider}` : ''}{c.year ? ` (${c.year})` : ''}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground"><Tr text="Qualifications are as stated by the teacher. Ask to see documents before hiring." /></p>
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
