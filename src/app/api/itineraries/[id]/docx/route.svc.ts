import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
import { isLanguage, type Language } from '@/lib/languages'
import { createSavedItineraryDocx, type SavedItineraryDocxInput } from '@/lib/itinerary-docx'
import { CITY_MAP, type CityId } from '@/lib/itinerary-data'

// Word export for a SAVED dashboard itinerary. Unlike POST /api/itineraries/docx (which
// renders the full live research response the client still holds in memory), this reads a
// persisted itinerary and builds a clean day-by-day document from the reduced projection we
// store (day plans + stay shortlist + budget). Owner-scoped via the cookie session; no
// snapshot column required, so it works for every saved row.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// ⚠️ WS6 MIGRATION. `auth: 'userId'` is the getCurrentProfileId() this route already called (401
// `auth_required`, no Profile row), and the limiter moves up verbatim — same bucket as the live
// docx route, same 30/1h keyed on the caller, `strict: true` kept so a limiter outage still fails
// CLOSED on a CPU-heavy path. Both used to sit INSIDE the try/catch; neither can throw
// (getCurrentProfileId swallows, rateLimit catches its own backend errors), so moving them above it
// changes no branch — worth checking, because that catch answers 400 rather than 500.
//
// ⚠️ NO `body:` SCHEMA, AND THAT IS THE CONTRACT. `request.json().catch(() => ({}))` means a
// MISSING or malformed body is a success that falls back to `lang: 'en'` — the client posts none
// when the traveller exports in English. A schema would turn that into a 400.
//
// ⚠️ THE 404 IS STILL A `return`, NOT AN ApiError. It sits inside the try, and the catch below
// converts anything thrown into 400 "Word file could not be created" — an ApiError there would be
// swallowed and answered 400 instead of 404.
export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'itinerary-docx', limit: 30, window: '1 h', strict: true } },
  async ({ req: request, params, userId }) => {
    try {
      const { id } = params
      const body = (await request.json().catch(() => ({}))) as { lang?: Language }
      const lang: Language = isLanguage(body.lang) ? body.lang : 'en'

      const itinerary = await db.itinerary.findFirst({
        where: { id, profileId: userId, status: { not: 'archived' } },
        include: {
          dayPlans: { orderBy: { dayNumber: 'asc' } },
          stays: { orderBy: { position: 'asc' } },
        },
      })
      if (!itinerary) return NextResponse.json({ error: 'not_found' }, { status: 404 })

      const city = CITY_MAP.get(itinerary.destinationId as CityId)
      const destinationLabel = city
        ? (lang === 'vi' ? city.nameVi : city.name)
        : itinerary.destinationId.replace(/[-_]/g, ' ')
      const interests = ((v): string[] => (Array.isArray(v) ? (v as string[]) : []))((() => {
        try { return JSON.parse(itinerary.interests) } catch { return [] }
      })())

      const input: SavedItineraryDocxInput = {
        title: itinerary.title,
        destinationLabel,
        days: itinerary.days,
        estimatedBudget: itinerary.estimatedBudget,
        interests,
        updatedAt: itinerary.updatedAt.toISOString(),
        dayPlans: itinerary.dayPlans.map((d) => ({
          dayNumber: d.dayNumber,
          area: d.area, areaVi: d.areaVi,
          title: d.title, titleVi: d.titleVi,
          morning: d.morning, morningVi: d.morningVi,
          afternoon: d.afternoon, afternoonVi: d.afternoonVi,
          evening: d.evening, eveningVi: d.eveningVi,
        })),
        stays: itinerary.stays.map((s) => ({
          name: s.name, nameVi: s.nameVi,
          area: s.area, areaVi: s.areaVi,
          note: s.note, noteVi: s.noteVi,
          estimatedNightly: s.estimatedNightly,
        })),
      }

      const { blob, filename } = await createSavedItineraryDocx(input, lang)
      return new Response(blob, {
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      })
    } catch (error) {
      console.error('[api/itineraries/[id]/docx]', (error as Error)?.message?.slice(0, 300))
      return NextResponse.json({ error: 'Word file could not be created' }, { status: 400 })
    }
  },
)
