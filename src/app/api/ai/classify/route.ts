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

// Compact taxonomy the model picks from (slugs are the contract; names give context).
const TAXONOMY_TEXT = TAXONOMY.map((c) =>
  `- ${c.slug} (${c.name}) [types: ${c.types.join(', ')}] subcategories: ${c.subcategories.map((s) => `${s.slug}(${s.name})`).join(', ') || 'none'}`,
).join('\n')

// AI autofill: classify a product PHOTO into the listing taxonomy + suggest a title.
// Output is validated against the taxonomy server-side, so a bad model response can
// never put an invalid category/slug on a listing. Auth-gated + rate-limited.
export async function POST(req: NextRequest) {
  const ai = getGemini()
  if (!ai) return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })

  const profileId = await getCurrentProfileId()
  if (!profileId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const limit = await rateLimit('ai-classify', profileId, 40, '1 h')
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'bad_image' }, { status: 400 })
  }
  // Title follows the app's chosen language.
  const lang = String(form.get('lang') || 'en') === 'vi' ? 'vi' : 'en'
  const titleLang = lang === 'vi' ? 'Vietnamese' : 'English'

  // Downscale to keep the vision call fast + cheap (512px is plenty to classify).
  let b64: string
  try {
    const buf = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    b64 = buf.toString('base64')
  } catch { return NextResponse.json({ error: 'bad_image' }, { status: 400 }) }

  const prompt = `You classify product photos for eno.vn, a marketplace for expats in Vietnam.
Pick the single best category + subcategory from THIS taxonomy (use the exact slugs):
${TAXONOMY_TEXT}

Also pick: listingType (one of the category's listed types; default "sell"); condition ("new" or "used", or "" if not a physical item / can't tell); and a concise, factual title in ${titleLang} (max 80 chars, no price, no phone).
Return ONLY JSON.`

  let parsed: { category?: string; subcategory?: string; listingType?: string; condition?: string; title?: string } = {}
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }, { text: prompt }] }],
      config: {
        temperature: 0.2,
        maxOutputTokens: 300,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            subcategory: { type: Type.STRING },
            listingType: { type: Type.STRING },
            condition: { type: Type.STRING },
            title: { type: Type.STRING },
          },
          required: ['category'],
        },
      },
    })
    parsed = JSON.parse(res.text || '{}')
  } catch (e) {
    console.error('[ai/classify]', e)
    return NextResponse.json({ error: 'ai_failed' }, { status: 502 })
  }

  // Validate against the taxonomy — never trust the model's slugs blindly.
  const cat = TAXONOMY.find((c) => c.slug === parsed.category)
  if (!cat) return NextResponse.json({ categorySlug: null, subcategorySlug: null, listingType: null, condition: null, title: null })
  const sub = cat.subcategories.find((s) => s.slug === parsed.subcategory)
  const listingType = cat.types.includes(parsed.listingType as never) ? parsed.listingType : 'sell'
  const condition = parsed.condition === 'new' || parsed.condition === 'used' ? parsed.condition : null
  const title = (parsed.title || '').trim().slice(0, 140) || null

  return NextResponse.json({
    categorySlug: cat.slug,
    subcategorySlug: sub?.slug ?? null,
    listingType,
    condition,
    title,
  })
}
