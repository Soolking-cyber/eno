import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { isLanguage, type Language } from '@/lib/languages'
import { createSavedItineraryDocx, type SavedItineraryDocxInput } from '@/lib/itinerary-docx'
import { CITY_MAP, type CityId } from '@/lib/itinerary-data'
import { rateLimit } from '@/lib/ratelimit'

// Word export for a SAVED dashboard itinerary. Unlike POST /api/itineraries/docx (which
// renders the full live research response the client still holds in memory), this reads a
// persisted itinerary and builds a clean day-by-day document from the reduced projection we
// store (day plans + stay shortlist + budget). Owner-scoped via the cookie session; no
// snapshot column required, so it works for every saved row.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getCurrentProfileId()
    if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
    // Same per-user cap as the live docx route — document assembly is CPU/memory heavy.
    const limit = await rateLimit('itinerary-docx', userId, 30, '1 h', { strict: true })
    if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

    const { id } = await params
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
}
