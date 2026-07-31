import { NextResponse } from 'next/server'
import { isLanguage, type Language } from '@/lib/languages'
import { createItineraryDocx } from '@/lib/itinerary-docx'
import type { GeneratedItineraryResponse } from '@/lib/itinerary-data'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

type DocxRequest = {
  result?: GeneratedItineraryResponse
  travelers?: number
  lang?: Language
  translations?: Record<string, string>
}

function validPayload(body: DocxRequest): body is Required<Pick<DocxRequest, 'result' | 'travelers' | 'lang'>> & DocxRequest {
  return Boolean(
    body.result?.plan
      && typeof body.result.plan.title === 'string'
      && body.result.plan.title.length <= 180
      && Array.isArray(body.result.plan.days)
      && body.result.plan.days.length >= 1
      && body.result.plan.days.length <= 30
      && Number.isInteger(body.travelers)
      && body.travelers! >= 1
      && body.travelers! <= 100
      && isLanguage(body.lang),
  )
}

export async function POST(request: Request) {
  try {
    // Auth + per-user cap: docx generation is CPU/memory heavy; an open endpoint is a
    // volumetric DoS. (No Gemini spend here — this is pure document assembly.)
    const userId = await getCurrentProfileId()
    if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
    const limit = await rateLimit('itinerary-docx', userId, 30, '1 h', { strict: true })
    if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

    // Bounded read: Content-Length is omittable (chunked) so it can't be the only
    // guard — cap the actual bytes before JSON.parse to keep a huge body from OOMing.
    const raw = await request.text()
    if (raw.length > 2_000_000) return NextResponse.json({ error: 'Itinerary is too large' }, { status: 413 })
    let body: DocxRequest
    try { body = JSON.parse(raw) as DocxRequest } catch { return NextResponse.json({ error: 'Invalid itinerary' }, { status: 400 }) }
    if (!validPayload(body)) {
      return NextResponse.json({ error: 'Invalid itinerary' }, { status: 400 })
    }
    // Cap the KEY COUNT before Object.entries materialises the whole map — a
    // millions-of-keys object would block the event loop just being enumerated.
    const rawTranslations = body.translations && typeof body.translations === 'object' ? body.translations : {}
    const translations = Object.fromEntries(
      Object.keys(rawTranslations)
        .slice(0, 500)
        .map((k) => [k, rawTranslations[k]] as const)
        .filter(([source, translated]) => source.length <= 2_000 && typeof translated === 'string' && translated.length <= 4_000),
    )
    const { blob, filename } = await createItineraryDocx(body.result, body.travelers, body.lang, translations)
    return new Response(blob, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    })
  } catch (error) {
    console.error('[api/itineraries/docx]', (error as Error)?.message?.slice(0, 300))
    return NextResponse.json({ error: 'Word file could not be created' }, { status: 400 })
  }
}
