import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { Type } from '@google/genai'
import { getGemini, GEMINI_MODEL } from '@/lib/gemini'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { TAXONOMY } from '@/lib/taxonomy'
import { containsPhoneNumber } from '@/lib/phone'
import { categoryHasBrand } from '@/lib/brand'

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
  if (!(file instanceof File)) return NextResponse.json({ error: 'no_file' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'empty_file' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'too_big' }, { status: 400 })
  // Title follows the app's chosen language.
  const lang = String(form.get('lang') || 'en') === 'vi' ? 'vi' : 'en'
  const titleLang = lang === 'vi' ? 'Vietnamese' : 'English'

  // Downscale to keep the vision call fast + cheap (512px is plenty to classify).
  // sharp decodes JPG/PNG/WebP/HEIC; on failure we log the real reason + bytes/type
  // so we can tell a HEIC/codec issue from a corrupt upload.
  let b64: string
  try {
    const buf = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    b64 = buf.toString('base64')
  } catch (e) {
    console.error('[ai/classify] decode failed', { type: file.type, size: file.size, msg: (e as Error)?.message })
    return NextResponse.json({ error: 'decode_failed', type: file.type }, { status: 400 })
  }

  const prompt = `You classify product photos for eno.vn, a marketplace for expats in Vietnam.
Focus on the SINGLE main item being sold — the one product in the foreground. IGNORE the background, the surface/table, hands, packaging clutter and any other props. Everything you output describes ONLY that product, never the scene.

First decide "productClear": true if there is one clear, identifiable product that fills enough of the frame to classify confidently; false if the photo is blurry/dark, shows no clear product, is mostly background, or crams in several unrelated items. If productClear is false, leave the other fields empty.

When productClear is true, pick the single best category + subcategory from THIS taxonomy (use the exact slugs):
${TAXONOMY_TEXT}

Also pick: listingType (one of the category's listed types; default "sell"); condition ("new" or "used", or "" if not a physical item / can't tell); a concise, factual title in ${titleLang} (max 80 chars) naming ONLY the product itself — e.g. "iPhone 14 Pro 128GB", NOT "iPhone on a white table" or "phone with charger on desk"; no scene words, no price, no phone; "brand": ALWAYS identify the product's brand / manufacturer — read it from any visible logo, label or text, and infer it from the product's recognizable design when no logo is shown (e.g. Apple, Samsung, Huawei, Honda, Yamaha, Sony, Dell, Nike, IKEA). Use the well-known canonical English brand name (e.g. "Apple", not "apple iphone"). Return "" ONLY if the item is genuinely unbranded (handmade, generic) or you truly cannot tell. Prefer a confident guess over "". And "description": a SHORT spec sheet in ${titleLang} about the product ONLY — main specs you can identify (brand, model, size/capacity, colour, key features). 1–3 short lines or comma-separated, factual, NO scene description, NO marketing fluff, NO price, NO phone. If you can't identify specs, return "".
Return ONLY JSON.`

  let parsed: { productClear?: boolean; category?: string; subcategory?: string; listingType?: string; condition?: string; title?: string; brand?: string; description?: string } = {}
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }, { text: prompt }] }],
      config: {
        temperature: 0.2,
        // 2.5-flash is a THINKING model — leave thinking on and its tokens eat the
        // budget, truncating the JSON (MAX_TOKENS → partial "{" → parse error).
        // Disable thinking for this structured task; all tokens go to the answer.
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 768,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            productClear: { type: Type.BOOLEAN },
            category: { type: Type.STRING },
            subcategory: { type: Type.STRING },
            listingType: { type: Type.STRING },
            condition: { type: Type.STRING },
            title: { type: Type.STRING },
            brand: { type: Type.STRING },
            description: { type: Type.STRING },
          },
          // REQUIRED so the model always emits them (optional fields get dropped).
          required: ['productClear', 'category', 'brand'],
        },
      },
    })
    // Harden: strip any stray ``` fences, fall back to {} on an empty reply.
    let txt = (res.text || '').trim()
    if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    parsed = JSON.parse(txt || '{}')
  } catch (e) {
    console.error('[ai/classify]', e)
    return NextResponse.json({ error: 'ai_failed', detail: (e as Error)?.message?.slice(0, 300) }, { status: 502 })
  }

  // No single clear product → tell the user to retake a close, clear photo of the
  // item itself (not a scene). Distinct from a plain classify miss.
  if (parsed.productClear === false) {
    return NextResponse.json({ unclear: true, categorySlug: null, subcategorySlug: null, listingType: null, condition: null, title: null, brand: null, description: null })
  }

  // Validate against the taxonomy — never trust the model's slugs blindly.
  const cat = TAXONOMY.find((c) => c.slug === parsed.category)
  if (!cat) return NextResponse.json({ categorySlug: null, subcategorySlug: null, listingType: null, condition: null, title: null, brand: null, description: null })
  const sub = cat.subcategories.find((s) => s.slug === parsed.subcategory)
  const listingType = cat.types.includes(parsed.listingType as never) ? parsed.listingType : 'sell'
  const condition = parsed.condition === 'new' || parsed.condition === 'used' ? parsed.condition : null
  const title = (parsed.title || '').trim().slice(0, 140) || null
  // Raw brand string (only for brand-relevant categories) — the server canonicalizes
  // + typo-dedupes it on save; here we just surface the AI's read for the form.
  const brand = categoryHasBrand(cat.slug) ? ((parsed.brand || '').trim().slice(0, 40) || null) : null
  // Concise spec sheet (brand/model/key specs). Guard against a model that slips a
  // phone number in; cap length so it stays a short spec list, not an essay.
  let description = (parsed.description || '').trim().slice(0, 600) || null
  if (description && containsPhoneNumber(description)) description = null

  return NextResponse.json({
    categorySlug: cat.slug,
    subcategorySlug: sub?.slug ?? null,
    listingType,
    condition,
    title,
    brand,
    description,
  })
}
