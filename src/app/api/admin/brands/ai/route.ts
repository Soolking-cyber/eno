import { NextRequest, NextResponse } from 'next/server'
import { Type } from '@google/genai'
import { getAdmin } from '@/lib/admin'
import { getGemini, GEMINI_MODEL } from '@/lib/gemini'
import { normalizeBrand } from '@/lib/brand-normalize'
import { iconForBrand, iconPathForSlug } from '@/lib/brand-icons'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Admin AI assist for brand curation. Given a (possibly messy/niche) brand name,
// the model returns the CANONICAL brand name + a best-guess simple-icons slug + a
// one-line note. We then VALIDATE the logo against the real simple-icons set
// (never trust the model to invent SVG paths), so the admin only ever sees a real
// monotone mark to approve — or none (keep the monogram / paste a custom path).
export async function POST(req: NextRequest) {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ai = getGemini()
  if (!ai) return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })

  let body: { name?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const input = String(body.name || '').trim().slice(0, 80)
  if (!input) return NextResponse.json({ error: 'missing_name' }, { status: 400 })

  const prompt = `You help curate a brand catalogue. For the brand name "${input}", return:
- "canonical": the brand's correct, canonical English display name (fix casing/typos, drop product/model words). E.g. "appl iphone" → "Apple", "huawi" → "Huawei", "bugaboo strollers" → "Bugaboo".
- "slug": IF this is a well-known brand likely present in the simple-icons icon set, its simple-icons slug (lowercase, letters/digits only, e.g. "apple", "samsung", "nike", "ikea", "mercedes"); otherwise "". Do not guess for obscure/local brands.
- "note": a short (≤12 word) description of what the brand makes.
Return ONLY JSON.`

  let parsed: { canonical?: string; slug?: string; note?: string } = {}
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: { canonical: { type: Type.STRING }, slug: { type: Type.STRING }, note: { type: Type.STRING } },
          required: ['canonical', 'slug'],
        },
      },
    })
    let txt = (res.text || '').trim()
    if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    parsed = JSON.parse(txt || '{}')
  } catch (e) {
    console.error('[admin/brands/ai]', e)
    return NextResponse.json({ error: 'ai_failed' }, { status: 502 })
  }

  const name = (parsed.canonical || '').trim().slice(0, 60) || input
  // Validate the logo against the REAL simple-icons set: try the model's slug, then
  // a match on the canonical name. Only a slug that actually resolves to a path wins.
  const slugGuess = (parsed.slug || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  let iconSlug: string | null = null
  let iconPath: string | null = null
  if (slugGuess && iconPathForSlug(slugGuess)) {
    iconSlug = slugGuess
    iconPath = iconPathForSlug(slugGuess)
  } else {
    const match = iconForBrand(normalizeBrand(name))
    if (match) { iconSlug = match.slug; iconPath = iconPathForSlug(match.slug) }
  }

  return NextResponse.json({ name, iconSlug, iconPath, note: (parsed.note || '').trim().slice(0, 120) || null })
}
