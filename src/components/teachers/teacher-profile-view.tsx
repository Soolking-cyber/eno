// The public teacher profile (2026-09-30) — what a teacher Listing renders instead of the product
// PDP. Server component: SEO wants the profile in the HTML. Reads only PUBLIC TeacherProfile fields;
// contact data lives in TeacherPrivate and is not selected here.
import { db } from '@/lib/db'
import { Tr } from '@/context/language-context'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { TeacherContact } from '@/components/teachers/teacher-contact'
import { CATEGORY_BY_SLUG } from '@/lib/taxonomy'
import { TEACHERS_CATEGORY_SLUG } from '@/lib/teachers/constants'
import { TEACHER_OPTIONS } from '@/lib/teachers/profile'
import { countryName } from '@/lib/teachers/countries'
import { teacherProfileLd } from '@/lib/teachers/jsonld'
import { formatMoneyFull } from '@/lib/vnd'

type Opt = { value: string; label: string }
const labelOf = (opts: readonly Opt[], v: string) => opts.find((o) => o.value === v)?.label ?? v
const ldJson = (o: object) => JSON.stringify(o).replace(/</g, '\\u003c')

type Experience = { role: string; employer: string; city: string; from: string; to: string }
type Certificate = { type: string; hours: number | null; provider: string; year: number | null }

function Chips({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((x) => <li key={x} className="rounded-full bg-tint px-3 py-1 text-sm text-body"><Tr text={x} /></li>)}
    </ul>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground"><Tr text={label} /></dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  )
}

export async function TeacherProfileView({ listing, canonicalUrl, indexable }: {
  listing: { id: string; title: string; images: string[]; video: string | null; updatedAt: Date | string }
  canonicalUrl: string
  indexable: boolean
}) {
  const tp = await db.teacherProfile.findUnique({
    where: { listingId: listing.id },
    select: {
      fullName: true, headline: true, bio: true, photoUrl: true, videoUrl: true, nationality: true, nativeSpeaker: true,
      languages: true, currentCity: true, currentDistrict: true, preferredCities: true, openToOnline: true, availableFrom: true,
      jobTypes: true, ageGroups: true, subjects: true, yearsExperience: true, experience: true, degreeLevel: true,
      degreeMajor: true, degreeInstitution: true, degreeYear: true, certificates: true, expectedSalaryM: true, updatedAt: true,
    },
  })
  const cat = CATEGORY_BY_SLUG[TEACHERS_CATEGORY_SLUG]
  // A listing without its profile is a broken row (the publish core writes both in one transaction);
  // render the bare minimum rather than a 500.
  const name = tp?.fullName ?? listing.title
  const photo = tp?.photoUrl ?? listing.images[0] ?? null
  const cityLabel = tp ? labelOf(TEACHER_OPTIONS.workIn, tp.currentCity) : ''
  const experience = (Array.isArray(tp?.experience) ? tp.experience : []) as Experience[]
  const certificates = (Array.isArray(tp?.certificates) ? tp.certificates : []) as Certificate[]
  const workIn = tp ? [...tp.preferredCities.map((c) => labelOf(TEACHER_OPTIONS.workIn, c)), ...(tp.openToOnline && !tp.preferredCities.includes('online') ? ['Online'] : [])] : []
  const degreeLabel = tp?.degreeLevel ? labelOf(cat?.facets.find((f) => f.key === 'degree')?.options ?? [], tp.degreeLevel) : null
  const ld = tp && teacherProfileLd({
    url: canonicalUrl, fullName: tp.fullName, headline: tp.headline, photoUrl: photo, nationality: countryName(tp.nationality, 'en'),
    languages: tp.languages, cityLabel, degreeLevel: tp.degreeLevel, degreeMajor: tp.degreeMajor, degreeInstitution: tp.degreeInstitution,
    certificates: certificates.map((c) => ({ type: c.type, provider: c.provider })), updatedAt: tp.updatedAt,
  })

  return (
    <div className="flex min-h-screen flex-col">
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
                {tp && <p className="mt-1 text-body">{tp.headline}</p>}
                {tp && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {countryName(tp.nationality, 'en')}
                    {tp.nativeSpeaker && <> · <Tr text="Native English speaker" /></>}
                    {' · '}{tp.yearsExperience} <Tr text="years teaching" />
                    {' · '}{tp.currentDistrict ? `${tp.currentDistrict}, ` : ''}<Tr text={cityLabel} />
                  </p>
                )}
              </div>
            </header>

            {(tp?.videoUrl ?? listing.video) && (
              <section aria-labelledby="t-video">
                <h2 id="t-video" className="mb-3 text-lg font-semibold text-foreground"><Tr text="Intro video" /></h2>
                <video src={(tp?.videoUrl ?? listing.video)!} controls preload="metadata" playsInline className="aspect-video w-full rounded-2xl bg-black" />
              </section>
            )}

            {tp?.bio && (
              <section aria-labelledby="t-about">
                <h2 id="t-about" className="mb-2 text-lg font-semibold text-foreground"><Tr text="About" /></h2>
                <p className="max-w-prose whitespace-pre-line text-body">{tp.bio}</p>
              </section>
            )}

            {tp && (
              <section aria-labelledby="t-teaching" className="space-y-4">
                <h2 id="t-teaching" className="text-lg font-semibold text-foreground"><Tr text="Teaching" /></h2>
                <dl className="divide-y divide-border">
                  <Row label="Subjects"><Chips items={tp.subjects.map((s) => labelOf(TEACHER_OPTIONS.subject, s))} /></Row>
                  <Row label="Teaches"><Chips items={tp.ageGroups.map((s) => labelOf(TEACHER_OPTIONS.ageGroup, s))} /></Row>
                  <Row label="Looking for"><Chips items={tp.jobTypes.map((s) => labelOf(TEACHER_OPTIONS.jobType, s))} /></Row>
                  {workIn.length > 0 && <Row label="Wants to work in"><Chips items={workIn} /></Row>}
                  {tp.availableFrom && <Row label="Available from">{tp.availableFrom.toISOString().slice(0, 10)}</Row>}
                  {tp.expectedSalaryM != null && tp.expectedSalaryM > 0 && <Row label="Expected salary">{formatMoneyFull(tp.expectedSalaryM * 1_000_000, '₫')} / <Tr text="month" /></Row>}
                  {tp.languages.length > 0 && <Row label="Languages">{tp.languages.join(', ')}</Row>}
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
            <TeacherContact listingId={listing.id} name={name} image={photo} />
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  )
}
