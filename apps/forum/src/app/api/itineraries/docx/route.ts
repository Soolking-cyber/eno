import { NextResponse } from 'next/server'
import { isLanguage, type Language } from '@/lib/languages'
import { createItineraryDocx } from '@/lib/itinerary-docx'
import type { GeneratedItineraryResponse } from '@/components/itinerary/itinerary-data'

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
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (contentLength > 2_000_000) {
      return NextResponse.json({ error: 'Itinerary is too large' }, { status: 413 })
    }

    const body = await request.json() as DocxRequest
    if (!validPayload(body)) {
      return NextResponse.json({ error: 'Invalid itinerary' }, { status: 400 })
    }
    const translations = Object.fromEntries(
      Object.entries(body.translations || {})
        .filter(([source, translated]) => source.length <= 2_000 && typeof translated === 'string' && translated.length <= 4_000)
        .slice(0, 500),
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
