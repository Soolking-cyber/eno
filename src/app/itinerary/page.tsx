import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarDays, Map as MapIcon, MessageSquare, Wallet } from 'lucide-react'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { Button } from '@/components/ui/button'

// The Trip service's public face. This route used to be a 6-line permanentRedirect to
// eno.forum's builder; the itinerary service moved to eno.vn (owner, 2026-07-25), so a
// redirect off-origin was sending away the very visitors it should be converting.
//
// Deliberately a sibling of /trust and /about: same ContentPage shell, same <Tr> strings, so
// the service reads as part of eno.vn rather than a landing page bolted on.
//
// ⚠️ NO booking and NO payment on this page, or anywhere in this service. eno advises and
// arranges; the traveller pays each supplier directly and the 10% is quoted in chat. eno's
// filed MoIT position is "no own sales, no payment processing" — a "Book now" here would break
// it. Both CTAs go to the PLANNER, never to a checkout.

export const metadata: Metadata = {
  title: 'Vietnam trip planner — free itineraries, and local help if you want it | eno.vn',
  description:
    'Build a day-by-day Vietnam itinerary in minutes, see every stop on a map, and — if you want it — have our team arrange the bookings for a 10% service fee. You pay each hotel and guide directly.',
  alternates: { canonical: '/itinerary' },
}

/**
 * The map pin, at list size.
 *
 * ⚠️ The geometry is DUPLICATED from src/components/itinerary/trip-map.tsx (PIN_PATH /
 * PIN_VIEWBOX / DAY_COLORS[0]) rather than imported, and it has to be: trip-map is a
 * `'use client'` module, so every one of its exports is a client REFERENCE — this page is a
 * server component and calling `dayColor()` here fails the build outright with "Attempted to
 * call dayColor() from the server". Importing it would also drag a Leaflet loader onto a public
 * marketing page for no benefit.
 *
 * trip-map.tsx remains the source of truth for the real pin. If its path changes, this
 * illustration should follow — it is a promise about what the product looks like.
 */
function Pin({ n }: { n: number }) {
  return (
    <svg viewBox="0 0 26 34" className="h-7 w-[1.35rem] shrink-0" aria-hidden="true" focusable="false">
      <path d="M13 0C5.82 0 0 5.82 0 13c0 9.1 13 21 13 21s13-11.9 13-21C26 5.82 20.18 0 13 0z" fill="#0a66c2" stroke="rgba(255,255,255,.9)" strokeWidth={2} /> {/* design-lint-allow: raw hex — mirrors the theme-independent map pin */}
      <text x="13" y="17.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#ffffff">{n}</text> {/* design-lint-allow: raw hex — pin numeral */}
    </svg>
  )
}

// ⚠️ Every string below is written as a LITERAL `<Tr text="…">`, never mapped out of an array.
// The i18n extractor (scripts/gen-ui-strings.mjs) harvests `<Tr text="literal">` by regex; a
// `<Tr text={variable}>` is invisible to it, and an unharvested string has no Vietnamese entry,
// so `Tr` silently falls back to English. On a page whose whole job is to sell the service to a
// Vietnamese-reading audience, that is the one failure that matters. Verified by grepping the
// generated catalogue for these exact sentences after regenerating.
//
// (ContentPage's own `title`, `eyebrow` and section `label` props go through
// `<Tr text={title}>` inside that component, so they are NOT harvestable — true of /trust and
// every other content page in the repo, not something introduced here.)

function Step({ n, title, body }: { n: number; title: React.ReactNode; body: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-bold text-body">
        {n}
      </span>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-sm leading-relaxed text-body">{body}</p>
      </div>
    </li>
  )
}

function AssistanceTile({ icon: Icon, title, body }: {
  icon: typeof MessageSquare
  title: React.ReactNode
  body: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <Icon className="h-5 w-5 text-brand" />
      <p className="mt-2 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-body">{body}</p>
    </div>
  )
}

/** One stop of the sample day. Place names are proper nouns — deliberately NOT translated. */
function SampleStop({ n, place, what, first = false }: {
  n: number
  place: string
  what: React.ReactNode
  first?: boolean
}) {
  return (
    <div className={first ? undefined : 'mt-3 border-t border-border/60 pt-3'}>
      <div className="flex items-start gap-2.5">
        <Pin n={n} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{place}</p>
          <p className="text-xs text-body">{what}</p>
        </div>
      </div>
    </div>
  )
}

export default function ItineraryLandingPage() {
  return (
    <ContentPage
      eyebrow="Trip planner"
      title="Plan a Vietnam trip, day by day"
      intro={
        <Tr text="Tell us where you're going, how long you have and roughly what you want to spend. You get a day-by-day itinerary with real places, times and rough costs — every stop plotted on a map, so you can see whether a day makes sense before you're standing in it." />
      }
      sections={[
        { id: 'how', label: 'How it works' },
        { id: 'map', label: 'Every stop on a map' },
        { id: 'assistance', label: 'Want us to arrange it?' },
      ]}
    >
      {/* ⚠️ THE ASK COMES FIRST. Before this, a phone showed the eyebrow, the H1, a six-line intro
          and three numbered steps before offering anything to click — a page that described the
          service instead of selling it. The detail below is for people who want it; nobody should
          have to scroll past an explanation to reach the thing being explained. */}
      <div className="mb-8 rounded-2xl border border-border/70 bg-card p-5">
        <Button asChild variant="cta" size="lg" className="w-full sm:w-auto">
          <Link href="/dashboard/trips/plan">
            <CalendarDays className="h-4 w-4" />
            <Tr text="Plan my trip — free" />
          </Link>
        </Button>
        <p className="mt-2.5 text-sm text-body">
          <Tr text="Free, and it takes about two minutes. No card, and nothing to pay unless you ask us to arrange the bookings." />
        </p>
      </div>

      <ContentSection id="how" title="How it works">
        <ol className="space-y-3">
          <Step
            n={1}
            title={<Tr text="Tell us the shape of the trip" />}
            body={<Tr text="Pick your cities, the number of days, a budget level and the things you actually care about — food, history, beaches, nightlife." />}
          />
          <Step
            n={2}
            title={<Tr text="Get a day-by-day plan" />}
            body={<Tr text="Morning, afternoon and evening for every day, with the place, a rough cost and a note on what needs booking ahead." />}
          />
          <Step
            n={3}
            title={<Tr text="Keep it, or change it" />}
            body={<Tr text="Saved trips live under My Trips. Export one to Word, or generate another and compare." />}
          />
        </ol>
      </ContentSection>

      <ContentSection id="map" title="Every stop on a map" wide>
        <p className="max-w-3xl text-sm leading-relaxed text-body">
          <Tr text="A list of place names does not tell you that two stops are an hour apart. Each day gets its own colour, each stop a numbered pin, and the day's route is drawn in the order you would travel it — so a day that zig-zags across the city is obvious in advance." />
        </p>
        {/* One day, shown the way the real thing shows it. Not a live map: Leaflet and its tiles
            have no business loading on a marketing page, and a fabricated map would promise
            precision this illustration is not claiming. */}
        <div className="mt-4 max-w-3xl rounded-2xl border border-border/70 bg-card p-4">
          <SampleStop first n={1} place="Bến Thành Market" what={<Tr text="Breakfast and a first walk" />} />
          <SampleStop n={2} place="War Remnants Museum" what={<Tr text="Early afternoon, before the heat" />} />
          <SampleStop n={3} place="Cô Liêng" what={<Tr text="Dinner on plastic stools" />} />
          <p className="mt-3 text-xs text-ink-4">
            <Tr text="One day of a Ho Chi Minh City itinerary — the same numbered pins appear on the map beside the list." />
          </p>
        </div>
      </ContentSection>

      <ContentSection id="assistance" title="Want us to arrange it?" wide>
        <p className="max-w-3xl text-sm leading-relaxed text-body">
          <Tr text="Planning is the easy half. If you would rather not spend an evening emailing guesthouses in a language you do not read, our team can arrange the whole itinerary for you and stay reachable in chat while you travel." />
        </p>

        <div className="mt-4 grid max-w-3xl gap-3 sm:grid-cols-3">
          <AssistanceTile
            icon={MessageSquare}
            title={<Tr text="It all happens in chat" />}
            body={<Tr text="You ask in a normal conversation. We come back with what is available, what it costs, and what we would change." />}
          />
          <AssistanceTile
            icon={Wallet}
            title={<Tr text="You pay suppliers directly" />}
            body={<Tr text="Every hotel, driver and guide charges you their own price. We never take payment for them, and there is no markup hidden in a package." />}
          />
          <AssistanceTile
            icon={MapIcon}
            title={<Tr text="Our fee is 10%" />}
            body={<Tr text="Quoted in the chat before anything is booked, on the total the suppliers charge. Prefer to book it yourself? The plan is still yours, free." />}
          />
        </div>

        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-body">
          <Tr text="Start with the plan — the assistance offer sits on every saved trip, and you are free to ignore it." />
        </p>
        <div className="pt-1">
          <Button asChild variant="secondary">
            <Link href="/dashboard/trips/plan"><Tr text="Build my itinerary" /></Link>
          </Button>
        </div>
      </ContentSection>
    </ContentPage>
  )
}
