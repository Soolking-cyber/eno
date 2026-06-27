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

  const prompt = `You identify the main item in a shopper's photo so they can SEARCH for it on eno.vn (a marketplace for expats in Vietnam). People often upload a photo precisely to find out a product's BRAND and MODEL — so identify them whenever you can.

Look only at the single main item in the foreground (ignore background, hands, surface, clutter).

Return "query": the best short search phrase for that item.
- USE YOUR PRODUCT KNOWLEDGE to name the BRAND and MODEL when you recognize the design — you do NOT need a visible logo. This is expected for motorbikes/cars, phones, laptops, cameras, watches and well-known consumer products (e.g. "Triumph Rocket 3", "Honda Wave Alpha", "iPhone 14 Pro", "Toyota Vios", "Sony A7"). You may add the product type when it helps ("Triumph Rocket 3 motorbike").
- If you recognize the brand but not the exact model, give brand + type ("Triumph motorbike"). If you recognize neither, use the plain product type plus one obvious defining attribute ("black motorbike", "blue pen", "wooden chair").
- Be accurate, not reckless: only name a brand/model you genuinely recognize. Don't invent a model number, and don't guess a premium brand from a generic look-alike. But DO make a real effort to identify recognizable products — falling back to a bare "black motorbike" when the bike is clearly identifiable is a failure.
- 1–5 words, no scene words, no condition, no price, no quotes. If you truly cannot tell what the item is, return "".

Also return "category": the single best-matching slug from this list, or "": ${TAXONOMY_TEXT}
And "brand": the canonical brand name when you recognize it (from a logo OR a distinctive design), else "".
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
