import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { Type } from '@google/genai'
import { getGemini, GEMINI_MODEL } from '@/lib/gemini'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { TAXONOMY } from '@/lib/taxonomy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 12 * 1024 * 1024
const CAT_SLUGS = TAXONOMY.map((c) => c.slug)
const TAXONOMY_TEXT = TAXONOMY.map((c) => `${c.slug} (${c.name})`).join(', ')

// Visual search: turn a TAKEN / UPLOADED / PASTED photo into a text search query
// (+ best-guess category/brand) by reading the main subject with Gemini Vision,
// then the caller runs the normal keyword search. Reuses the existing Vertex/Gemini
// setup (no embedding store to build/host) — the cheapest accurate path at scale:
// one downscaled 512px Flash call per search, rate-limited by account or IP.
export async function POST(req: NextRequest) {
  const ai = getGemini()
  if (!ai) return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })

  // Search is open to everyone, so allow anonymous — but bound cost/abuse by
  // rate-limiting on the profile when signed in, else the client IP.
  const profileId = await getCurrentProfileId()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
  const limit = await rateLimit('ai-visual-search', profileId || ip, 30, '1 h')
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'no_file' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'empty_file' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_big' }, { status: 400 })

  // Downscale aggressively — 512px is plenty to recognize the subject and keeps the
  // vision call fast + cheap.
  let b64: string
  try {
    const buf = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    b64 = buf.toString('base64')
  } catch {
    return NextResponse.json({ error: 'decode_failed' }, { status: 400 })
  }

  const prompt = `You turn a shopper's photo into a marketplace SEARCH for eno.vn.
Look ONLY at the single main item in the foreground; ignore background, hands, surface, packaging and clutter.

Write "query": the FEWEST English words that you are CERTAIN describe the item, so the search returns plenty of matches (the search requires every word to match, so each extra word narrows it — when in doubt, use fewer).
- Start from the plain product noun on its own: "pen", "chair", "motorbike", "sofa", "watch", "laptop".
- Add ONE attribute (colour OR material) only if it is obvious and defining: "blue pen", "wooden chair", "leather sofa".
- Add the brand, then the model, ONLY when a logo / name / model text is clearly legible or the design is unmistakable: "Honda Wave", "iPhone 14 Pro", "Samsung TV", "Toyota Vios".
- Be certain. If you are unsure of an attribute, brand or model, LEAVE IT OUT — a shorter, broader query is always better than a wrong or too-narrow one. Never guess a brand from a generic shape.
- No scene words, no condition, no price, no quotes. Usually 1–3 words; never more than 4.
- If you cannot confidently name the item at all, return "".

Also return "category": the single best-matching slug from this list, or "" if unsure: ${TAXONOMY_TEXT}
And "brand": the canonical brand name ONLY if clearly legible on the item, else "".
Return ONLY JSON.`

  let parsed: { query?: string; category?: string; brand?: string } = {}
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }, { text: prompt }] }],
      config: {
        // Low temperature → deterministic, certain wording (no creative over-specifying).
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 128,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            query: { type: Type.STRING },
            category: { type: Type.STRING },
            brand: { type: Type.STRING },
          },
          required: ['query'],
        },
      },
    })
    let txt = (res.text || '').trim()
    if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    parsed = JSON.parse(txt || '{}')
  } catch (e) {
    console.error('[ai/visual-search]', e)
    return NextResponse.json({ error: 'ai_failed' }, { status: 502 })
  }

  const query = (parsed.query || '').trim().slice(0, 80)
  if (!query) return NextResponse.json({ query: '', category: null, brand: null, unclear: true })
  const category = CAT_SLUGS.includes(String(parsed.category)) ? parsed.category : null
  const brand = (parsed.brand || '').trim().slice(0, 40) || null

  return NextResponse.json({ query, category, brand })
}
