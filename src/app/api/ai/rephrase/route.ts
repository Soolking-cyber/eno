import { NextRequest, NextResponse } from 'next/server'
import { getGemini, GEMINI_MODEL } from '@/lib/gemini'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { containsPhoneNumber } from '@/lib/phone'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_IN = 5000

// AI "Polish": rewrite the seller's rough description into clean, professional
// listing copy WITHOUT inventing facts, in the app's chosen language. Auth-gated +
// rate-limited. The model is told never to add a phone number; we also re-check.
export async function POST(req: NextRequest) {
  const ai = getGemini()
  if (!ai) return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })

  const profileId = await getCurrentProfileId()
  if (!profileId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const limit = await rateLimit('ai-rephrase', profileId, 60, '1 h')
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { text?: string; lang?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const text = String(body.text || '').trim().slice(0, MAX_IN)
  if (text.length < 3) return NextResponse.json({ error: 'too_short' }, { status: 400 })
  const lang = body.lang === 'vi' ? 'vi' : 'en'
  const outLang = lang === 'vi' ? 'Vietnamese' : 'English'

  const prompt = `You are improving a product listing description for eno.vn, a marketplace for expats in Vietnam.
Rewrite the seller's text below to be clear, professional, and trustworthy WITHOUT inventing or changing any facts (do not add specs, prices, or claims not in the original). Keep it concise. Write the result in ${outLang}. Never include a phone number or contact details. Return ONLY the rewritten description, no preamble.

Seller's text:
"""${text}"""`

  let out = ''
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: { temperature: 0.4, maxOutputTokens: 1200 },
    })
    out = (res.text || '').trim()
  } catch (e) {
    console.error('[ai/rephrase]', e)
    return NextResponse.json({ error: 'ai_failed' }, { status: 502 })
  }

  if (!out) return NextResponse.json({ error: 'ai_failed' }, { status: 502 })
  // Safety net: if the model slipped in a phone number, fall back to the original.
  if (containsPhoneNumber(out)) return NextResponse.json({ text }, { status: 200 })
  return NextResponse.json({ text: out.slice(0, MAX_IN) })
}
