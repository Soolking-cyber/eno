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

  const prompt = `You help shoppers SEARCH a marketplace (eno.vn, for expats in Vietnam) by photo.
Look only at the SINGLE main item in the foreground — ignore the background, hands, surface, packaging and clutter.
Return JSON:
- "query": a short ENGLISH search query a shopper would type to find this item — the product TYPE, plus the brand/model ONLY if a logo or name is clearly legible on the item (e.g. "Honda Wave motorbike", "wooden dining table", "iPhone 14 Pro", "office chair", "road bike"). 2–5 words, no scene words ("on a table"), no price. If you genuinely cannot tell what the item is, return "".
- "category": the single best-matching category slug from this list, or "" if unsure: ${TAXONOMY_TEXT}
- "brand": the canonical brand name ONLY if clearly legible on the item, else "".
Return ONLY JSON.`

  let parsed: { query?: string; category?: string; brand?: string } = {}
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }, { text: prompt }] }],
      config: {
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 256,
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
