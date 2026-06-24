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

  const prompt = `You are writing a professional product listing description for eno.vn, a marketplace for expats in Vietnam.
Rewrite the seller's text below into clear, persuasive, easy-to-skim copy — WITHOUT inventing or changing any facts. Never add specs, prices, model numbers, brands, or claims that are not in the original; if a detail isn't given, leave it out.

Structure the result like this:
1. Open with a short benefit-led hook (1–2 sentences): what makes the item worth buying and who it suits — lead with benefits, not just features.
2. Then a few scannable bullet points (each starting with "- ") for the key features / specs that ARE in the seller's text.
3. End with the practical info if present (condition, what's included, dimensions, reason for selling).

Rules: keep paragraphs short and the language simple, so a buyer grasps the value in seconds. Use the item's natural keywords so it's easy to find in search, but never keyword-stuff. Aim for a complete but tight description — depth without padding (roughly 80–200 words is ideal; never pad to hit a length). Write in ${outLang}. Never include a phone number or contact details. Return ONLY the rewritten description — no preamble, no heading like "Description:".

Seller's text:
"""${text}"""`

  let out = ''
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      // Disable thinking (2.5-flash) so its tokens don't eat the budget and truncate
      // the rewrite; this is a simple rephrase, no reasoning needed.
      config: { temperature: 0.4, maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 } },
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
