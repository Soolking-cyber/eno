import { TEACH_CONTENT } from './content.generated'

/**
 * THE TEACH-IN-VIETNAM LIBRARY — one registry for the hub, the route, the sitemap and "Keep reading".
 *
 * ⛔ NO VISA, ITINERARY OR PAYPAL VOCABULARY IN ANY VALUE, AND NO PERMISSION-TO-STAY VOCABULARY EITHER.
 * Every guide here is compiled into BOTH editions (eno.forum 308s the routes to eno.vn — next.config.ts), so
 * every string in this file and in src/content/teach-in-vietnam/*.json lands in the licensed marketplace's bundle (CLAUDE.md, the edition
 * split; src/lib/expat-guides.ts states the same rule for its registry). "Work permit" is a labour
 * document and is allowed — /jobs-vietnam-expats already says it. teach-guides.test.ts enforces the
 * vocabulary over this file and the content; the entry/stay side of moving here is deliberately out of
 * scope for eno.vn, and the guides say so plainly instead of hinting at it.
 *
 * ⚠️ RELEASED IN WAVES, BY DATE. `published` is the day a guide goes live: before it, the route 404s,
 * the hub and "Keep reading" leave it out, the sitemap does not submit it and in-text links to it render
 * as plain text. The whole library ships in one deploy and appears a wave at a time — a young domain
 * publishing ~40 guides in one day reads as scaled production, and waves let Search Console show what
 * each wave earned before the next. `isLive` is the one gate; never compare dates anywhere else.
 * The date is read at REQUEST time, so a wave needs no deploy: the guide pages and the hub re-render
 * hourly (ISR), the sitemap and llms.txt daily.
 * ⚠️ A URL asked for BEFORE its release day caches that 404 for up to an hour (ISR caches a notFound()),
 * so the first request after the hour turns serves the stale 404 once and regenerates. Harmless for a
 * page nobody has been sent to yet — and nothing sends anyone: no link, sitemap entry or IndexNow ping
 * names an unreleased guide.
 *
 * ⚠️ `updated` IS A READER-VISIBLE EDIT (new facts, rewritten prose), never a refactor — same contract as
 * expat-guides.ts. It drives `dateModified` and the sitemap `<lastmod>`.
 */

export type TeachCluster = 'decide' | 'qualify' | 'jobs' | 'papers' | 'money' | 'arrive' | 'live' | 'classroom' | 'grow'

export type TeachGuideEntry = {
  slug: string
  cluster: TeachCluster
  /** Link text on the hub and in "Keep reading". */
  label: string
  /** One line: what the guide answers. */
  blurb: string
  /** YYYY-MM-DD — the release date (see the wave note above). */
  published: string
  updated?: string
  /**
   * YYYY-MM-DD — the day a PERSON on the eno.vn team fact-checked this guide, titles and description
   * included. ⛔ NO DATE, NO RELEASE, whatever `published` says (`isReleased`). Google's guidance on
   * AI-assisted content (developers.google.com/search/docs/fundamentals/using-gen-ai-content, updated
   * 2026-10-01): "It is critical to manually factcheck and review all AI-generated content … before
   * publishing", metadata and structured data included. These guides are drafted with AI from a verified
   * fact base and checked by agents; the human check is the gate, and every guide says it was reviewed —
   * so a guide nobody reviewed must not be live to say so.
   */
  reviewed?: string
  /**
   * WHAT WAS REVIEWED: the content digest (digest.ts) of the guide the person approved. content.ts refuses to
   * build a reviewed guide whose content has changed since — an edit after review needs a new review.
   */
  reviewedDigest?: string
  /** A live listing rail after the last section: teaching jobs, or homes to rent. */
  rail?: 'jobs' | 'homes'
  /** A cornerstone is featured at the top of its hub section. */
  cornerstone?: boolean
}

export const TEACH_BASE = '/teach-in-vietnam'

export const TEACH_CLUSTERS: readonly { id: TeachCluster; title: string; lede: string }[] = [
  { id: 'decide', title: 'Decide', lede: 'Whether teaching in Vietnam suits you, and where.' },
  { id: 'qualify', title: 'Qualify', lede: 'The degree, certificate and checks employers and the work permit need.' },
  { id: 'jobs', title: 'Get hired', lede: 'The kinds of jobs, where they are advertised, interviews and contracts.' },
  { id: 'papers', title: 'Work permit and documents', lede: 'The labour paperwork, step by step.' },
  { id: 'money', title: 'Pay, tax and money', lede: 'What teachers earn, what is deducted, and how to bank and send money home.' },
  { id: 'arrive', title: 'Arrive', lede: 'The first weeks in Ho Chi Minh City: housing, phone, transport, health.' },
  { id: 'live', title: 'Live in Saigon', lede: 'Neighbourhoods, costs, safety and everyday life.' },
  { id: 'classroom', title: 'Teach well', lede: 'Vietnamese classrooms, learners and the exams they prepare for.' },
  { id: 'grow', title: 'Grow and move on', lede: 'Career steps from teacher to trainer or manager, and leaving well.' },
] as const

/**
 * The library. Order inside a cluster is the hub's reading order.
 * ⚠️ The block between the markers is written by ~/eno-teach-guides/integrate.py from the editorial topic map
 * (briefs/topics.json) and the owner's approvals (briefs/reviews.json: date + digest, recorded with approve.py).
 * A hand edit inside it is lost at the next integrate — record a review with approve.py, never by hand here.
 */
export const TEACH_GUIDES: readonly TeachGuideEntry[] = [
  // <generated-guides>
  { slug: "teaching-english-in-ho-chi-minh-city", cluster: "decide", label: "Teaching English in Ho Chi Minh City", blurb: "The Saigon teaching market in one page: the jobs, the pay, the paperwork, where teachers live and how to start.", published: "2026-10-12", reviewed: "2026-10-11", reviewedDigest: "98dd069053affbbb", rail: "jobs", cornerstone: true },
  { slug: "how-to-become-an-english-teacher-in-vietnam", cluster: "decide", label: "How to become an English teacher in Vietnam: step by step", blurb: "A realistic timeline from home to your first payday — documents, certificate, job search, work permit and arrival.", published: "2026-10-12", reviewed: "2026-10-11", reviewedDigest: "921d08da6842685b", cornerstone: true },
  { slug: "requirements-to-teach-english-in-vietnam", cluster: "decide", label: "Requirements to teach English in Vietnam (2026)", blurb: "The degree, certificate, clean record and health check you need — plus the honest answer for non-native speakers, no-degree and over-50 teachers.", published: "2026-10-12", reviewed: "2026-10-11", reviewedDigest: "0538ef451422b890", cornerstone: true },
  { slug: "is-teaching-english-in-vietnam-worth-it", cluster: "decide", label: "Is teaching English in Vietnam worth it?", blurb: "An honest look at the money, the lifestyle and the trade-offs, and how Vietnam compares with Thailand, Korea, China and Japan.", published: "2026-11-09" },
  { slug: "hanoi-vs-ho-chi-minh-city-for-teachers", cluster: "decide", label: "Hanoi vs Ho Chi Minh City (and Da Nang) for teachers", blurb: "Job volume, pay, climate, cost of living and lifestyle compared, so you pick the city that fits.", published: "2026-11-23" },
  { slug: "getting-your-degree-authenticated-for-vietnam", cluster: "qualify", label: "Getting your degree and documents authenticated for Vietnam", blurb: "Apostille or consular legalisation, certified translation and notarisation in Ho Chi Minh City: what each document needs and how long it takes.", published: "2026-10-12", reviewed: "2026-10-11", reviewedDigest: "399ccf24bf562734", cornerstone: true },
  { slug: "tefl-tesol-and-celta-for-vietnam", cluster: "qualify", label: "TEFL, TESOL or CELTA for teaching in Vietnam?", blurb: "Which certificate employers and the rules accept, online versus in-class, where to take a CELTA in Vietnam and what each costs.", published: "2026-10-26" },
  { slug: "criminal-record-check-for-a-vietnam-work-permit", cluster: "qualify", label: "Criminal record check for a Vietnam work permit", blurb: "How to get the right police check from the US, UK, Canada, Australia, Ireland, New Zealand, South Africa or the Philippines — or from Vietnam itself.", published: "2026-10-26" },
  { slug: "language-centre-jobs-in-ho-chi-minh-city", cluster: "jobs", label: "Working at a language centre in Ho Chi Minh City", blurb: "How chain and independent English centres hire, schedule and pay — and how to check a centre before you sign.", published: "2026-10-12", reviewed: "2026-10-11", reviewedDigest: "9bd4a4900b38739f", rail: "jobs", cornerstone: true },
  { slug: "finding-a-teaching-job-in-vietnam", cluster: "jobs", label: "Finding a teaching job in Vietnam", blurb: "Where jobs are advertised, when schools hire, applying from abroad or on the ground, and how to avoid paying anyone to get hired.", published: "2026-10-12", reviewed: "2026-10-11", reviewedDigest: "c9ab6532fadf87bd", rail: "jobs", cornerstone: true },
  { slug: "english-teaching-contracts-in-vietnam", cluster: "jobs", label: "English teaching contracts in Vietnam: what to check", blurb: "The clauses that matter — hours, pay, probation, holidays, notice, penalties — and what Vietnamese labour law says about them.", published: "2026-10-12", reviewed: "2026-10-11", reviewedDigest: "024e2c2455d7b185", cornerstone: true },
  { slug: "types-of-english-teaching-jobs-in-vietnam", cluster: "jobs", label: "Types of English teaching jobs in Vietnam", blurb: "Language centres, public schools, kindergartens, bilingual and international schools, universities and companies compared: hours, pay, students and requirements.", published: "2026-10-26", rail: "jobs" },
  { slug: "teaching-job-scams-in-vietnam", cluster: "jobs", label: "Teaching job scams in Vietnam and how to spot them", blurb: "The common scams and bad-employer patterns, how to check a school before you sign, and what to do if you are not paid.", published: "2026-10-26" },
  { slug: "cover-lessons-and-substitute-teaching-in-ho-chi-minh-city", cluster: "jobs", label: "Cover lessons and substitute teaching in Ho Chi Minh City", blurb: "How cover work happens in Saigon, what it pays, what you need to do it legally and how schools find cover teachers.", published: "2026-10-26", rail: "jobs" },
  { slug: "international-school-jobs-in-vietnam", cluster: "jobs", label: "International school jobs in Vietnam", blurb: "What international and bilingual schools require, what they pay and include, and how their hiring cycle works.", published: "2026-11-09", rail: "jobs" },
  { slug: "english-teacher-cv-and-demo-lesson-in-vietnam", cluster: "jobs", label: "English teacher CV, interview and demo lesson in Vietnam", blurb: "What schools in Vietnam expect on a CV, how interviews run and how to plan a demo lesson that gets the offer.", published: "2026-11-09" },
  { slug: "private-tutoring-and-online-teaching-in-vietnam", cluster: "jobs", label: "Private tutoring and online teaching in Vietnam", blurb: "Rates, finding students and the legal side of tutoring and online work while living in Vietnam.", published: "2026-11-09" },
  { slug: "teaching-ielts-in-vietnam", cluster: "jobs", label: "Teaching IELTS in Vietnam", blurb: "Why IELTS teachers are in demand, what centres pay and expect, and what Vietnamese candidates need most.", published: "2026-11-23", rail: "jobs" },
  { slug: "discrimination-and-hiring-bias-in-teaching-jobs-in-vietnam", cluster: "jobs", label: "Hiring bias in teaching jobs in Vietnam", blurb: "How nationality, accent, race and age affect hiring in Vietnam, what the law says, and practical ways through it.", published: "2026-11-23" },
  { slug: "vietnam-work-permit-for-english-teachers", cluster: "papers", label: "Vietnam work permit for English teachers (2026)", blurb: "The current rules, the documents, the health check, the timeline, the cost and who pays — and what happens if you change jobs.", published: "2026-10-12", reviewed: "2026-10-11", reviewedDigest: "637fefec6d7a0789", cornerstone: true },
  { slug: "english-teacher-salary-in-vietnam", cluster: "money", label: "English teacher salary in Vietnam (2026)", blurb: "What teachers really earn by employer type and city, hourly rates in Ho Chi Minh City, and what is left after tax and insurance.", published: "2026-10-12", reviewed: "2026-10-11", reviewedDigest: "f967c0d1936183dd", rail: "jobs", cornerstone: true },
  { slug: "cost-of-living-in-ho-chi-minh-city-for-teachers", cluster: "money", label: "Cost of living in Ho Chi Minh City for a teacher (2026)", blurb: "Rent by district from thousands of live listings, bills, food and transport, two real monthly budgets, and what to bring for month one.", published: "2026-10-12", reviewed: "2026-10-11", reviewedDigest: "e98ecc9b0680bb6c", rail: "homes", cornerstone: true },
  { slug: "personal-income-tax-for-teachers-in-vietnam", cluster: "money", label: "Personal income tax for foreign teachers in Vietnam", blurb: "Tax residency, the rates and deductions in force in 2026, withholding on hourly and second jobs, and settling up when you leave.", published: "2026-10-26" },
  { slug: "banking-and-sending-money-home-from-vietnam", cluster: "money", label: "Banking and sending money home from Vietnam", blurb: "Opening a bank account as a foreign teacher, e-wallets, and the documents banks ask for to transfer your salary abroad.", published: "2026-10-26" },
  { slug: "social-and-health-insurance-for-foreign-teachers-in-vietnam", cluster: "money", label: "Social and health insurance for foreign teachers in Vietnam", blurb: "Who must contribute, how much comes off your pay, what you get, and claiming the lump sum when you leave.", published: "2026-11-09" },
  { slug: "your-first-weeks-in-ho-chi-minh-city", cluster: "arrive", label: "Your first weeks in Ho Chi Minh City: a checklist", blurb: "What to sort out in your first days and weeks in Saigon: phone, money, housing, getting around, health and your paperwork.", published: "2026-10-26" },
  { slug: "healthcare-and-health-insurance-in-ho-chi-minh-city", cluster: "arrive", label: "Healthcare and health insurance in Ho Chi Minh City", blurb: "International and local hospitals, what a visit costs, the insurance your job includes and what to add, and dengue and air-quality basics.", published: "2026-10-26" },
  { slug: "getting-around-ho-chi-minh-city", cluster: "arrive", label: "Getting around Ho Chi Minh City", blurb: "Ride-hailing, the metro, buses and motorbikes compared on cost, time and safety for a teacher's daily commute.", published: "2026-11-09" },
  { slug: "motorbike-licence-in-vietnam-for-foreigners", cluster: "arrive", label: "Motorbike licence in Vietnam for foreigners", blurb: "Whether your licence or international permit is valid, how to get a Vietnamese licence, the 2025 fines and staying insured.", published: "2026-11-09" },
  { slug: "where-to-live-in-ho-chi-minh-city-as-a-teacher", cluster: "live", label: "Where to live in Ho Chi Minh City as a teacher", blurb: "The neighbourhoods teachers choose and why, what they cost from live rent data, commutes, flooding and the new ward names.", published: "2026-10-12", reviewed: "2026-10-11", reviewedDigest: "de5b24ca9e20c259", rail: "homes", cornerstone: true },
  { slug: "the-teaching-year-in-vietnam", cluster: "live", label: "The teaching year in Vietnam: terms, Tet and the rainy season", blurb: "When schools teach and hire, what Tet and public holidays mean for your pay and plans, and how the rainy season changes your commute.", published: "2026-11-09" },
  { slug: "is-ho-chi-minh-city-safe", cluster: "live", label: "Is Ho Chi Minh City safe?", blurb: "The real risks for foreigners — phone snatching, scams, traffic and health — and the habits that avoid them.", published: "2026-11-23" },
  { slug: "moving-to-vietnam-with-family-as-a-teacher", cluster: "live", label: "Moving to Vietnam with a family as a teacher", blurb: "Housing, schools and childcare costs, work for a partner and the budget a family needs in Ho Chi Minh City.", published: "2026-11-23" },
  { slug: "learning-vietnamese-and-finding-your-people-in-saigon", cluster: "live", label: "Learning Vietnamese and finding your people in Saigon", blurb: "Where to study Vietnamese, the phrases that help in a classroom and how teachers build a life and friends in the city.", published: "2026-11-23" },
  { slug: "vietnamese-classroom-culture-for-english-teachers", cluster: "classroom", label: "Vietnamese classroom culture for English teachers", blurb: "How students, teaching assistants, parents and managers expect a foreign teacher to behave — and what works with large classes.", published: "2026-10-26" },
  { slug: "teaching-young-learners-in-vietnam", cluster: "classroom", label: "Teaching young learners and kindergarten in Vietnam", blurb: "What works with Vietnamese children, phonics and games, the Cambridge Starters to Flyers exams and keeping parents happy.", published: "2026-11-09" },
  { slug: "pronunciation-problems-of-vietnamese-learners", cluster: "classroom", label: "Pronunciation problems of Vietnamese learners of English", blurb: "The sounds Vietnamese learners find hardest — final consonants, clusters, -s and -ed endings, th, stress — and classroom fixes for each.", published: "2026-11-09" },
  { slug: "english-teacher-workload-and-schedules-in-vietnam", cluster: "classroom", label: "English teacher workload and schedules in Vietnam", blurb: "Real weekly timetables, split shifts and weekends, unpaid preparation and how teachers avoid burning out.", published: "2026-11-23" },
  { slug: "safeguarding-and-professional-conduct-for-teachers-in-vietnam", cluster: "classroom", label: "Safeguarding and professional conduct for teachers in Vietnam", blurb: "Protecting children and yourself: photos, social media, contact with students and parents, and what Vietnamese law expects.", published: "2026-11-23" },
  { slug: "english-teacher-career-path-in-vietnam", cluster: "grow", label: "Career paths for English teachers in Vietnam", blurb: "From classroom teacher to senior teacher, trainer, examiner or academic manager — the qualifications and pay steps along the way.", published: "2026-11-23" },
  { slug: "leaving-vietnam-checklist-for-teachers", cluster: "grow", label: "Leaving Vietnam: a checklist for teachers", blurb: "Notice and final pay, tax settlement, the social insurance lump sum, money transfers, selling your things and references.", published: "2026-11-23" },
  // </generated-guides>
] as const

/** Today's date in Vietnam (UTC+7, no DST) as YYYY-MM-DD: a wave opens at 00:00 there, 17:00 UTC the day before. */
export function vnToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10)
}

/**
 * Has this guide's release day come? Reviewed by a person AND both dates reached (Vietnam calendar days).
 * ⚠️ String comparison is only valid for well-formed YYYY-MM-DD dates — teach-guides.test.ts checks every
 * registry date is one, so a typo cannot release a guide early.
 */
export function isReleased(e: { published: string; reviewed?: string }, now: Date = new Date()): boolean {
  if (!e.reviewed) return false
  const today = vnToday(now)
  return e.published <= today && e.reviewed <= today
}

/** The day a guide actually went live: the later of its wave date and its review — its `datePublished`. */
export function releaseDate(e: { published: string; reviewed?: string }): string {
  return e.reviewed && e.reviewed > e.published ? e.reviewed : e.published
}

/**
 * THE GATE: released AND its content is in the build. A registry entry whose JSON is missing must not
 * reach the hub, the sitemap or a link while its own URL 404s (teach-guides.test.ts also requires the
 * two to match one to one; this keeps a slip from leaking at runtime).
 */
export function isLive(e: { slug: string; published: string; reviewed?: string }, now: Date = new Date()): boolean {
  return isReleased(e, now) && Object.prototype.hasOwnProperty.call(TEACH_CONTENT, e.slug)
}

export const teachPath = (slug: string) => `${TEACH_BASE}/${slug}`

export function releasedGuides(now: Date = new Date()): TeachGuideEntry[] {
  return TEACH_GUIDES.filter((e) => isLive(e, now))
}

export function guideEntry(slug: string): TeachGuideEntry | undefined {
  return TEACH_GUIDES.find((e) => e.slug === slug)
}

/** Live-ness of an in-site href: a teach guide must be released; every other site path is live. */
export function isLiveTeachHref(href: string, now: Date = new Date()): boolean {
  const path = href.split(/[?#]/)[0]
  if (!path.startsWith(`${TEACH_BASE}/`)) return true
  const e = guideEntry(path.slice(TEACH_BASE.length + 1))
  return !!e && isLive(e, now)
}

/**
 * Sitemap `<lastmod>` and JSON-LD dates for a guide. `published` is the RELEASE date (`releaseDate`): a
 * guide reviewed after its wave date went live on the review day, and saying otherwise backdates it.
 */
export function teachGuideDates(slug: string): { published: string; updated?: string } {
  const e = guideEntry(slug)
  if (!e) throw new Error(`teach-guides: no registry entry for "${slug}"`)
  const published = releaseDate(e)
  return { published, ...(e.updated && e.updated > published ? { updated: e.updated } : {}) }
}

/** The hub's "Start here", by the reader's situation. A slug that is not live yet is skipped there. */
export const TEACH_START_PATHS: readonly { title: string; slugs: readonly string[] }[] = [
  { title: 'Still deciding', slugs: ['teaching-english-in-ho-chi-minh-city', 'is-teaching-english-in-vietnam-worth-it', 'requirements-to-teach-english-in-vietnam'] },
  { title: 'Getting ready at home', slugs: ['how-to-become-an-english-teacher-in-vietnam', 'getting-your-degree-authenticated-for-vietnam', 'criminal-record-check-for-a-vietnam-work-permit'] },
  { title: 'Looking for a job', slugs: ['finding-a-teaching-job-in-vietnam', 'language-centre-jobs-in-ho-chi-minh-city', 'english-teaching-contracts-in-vietnam'] },
  { title: 'Moving to Saigon', slugs: ['where-to-live-in-ho-chi-minh-city-as-a-teacher', 'cost-of-living-in-ho-chi-minh-city-for-teachers', 'vietnam-work-permit-for-english-teachers'] },
]

/**
 * The eno.vn pages (other than the guides themselves) a guide may link — EXACT paths. The editorial
 * validator (~/eno-teach-guides/validate.mjs SITE_PATHS) holds the same list; teach-guides.test.ts checks
 * every internal link is a registry guide or one of these, and that each of these exists on disk.
 */
export const TEACH_SITE_PATHS: readonly string[] = [
  '/', '/schools', '/jobs-vietnam-expats', '/hcmc-rent-index', '/c/rentals', '/c/jobs', '/c/teachers', '/help',
  '/renting-an-apartment-vietnam-foreigner', '/rental-deposit-vietnam', '/furnishing-a-home-in-vietnam',
  '/secondhand-furniture-ho-chi-minh-city', '/selling-up-before-you-leave-vietnam', '/esim-vietnam-guide',
  '/motorbike-rental-ho-chi-minh-city', '/teach-in-vietnam', '/about', '/contact', '/safety',
]
