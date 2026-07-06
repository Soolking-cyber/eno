import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { Type } from '@google/genai'
import { getGemini, GEMINI_MODEL } from '@/lib/gemini'
import { aiGuard } from '@/lib/ai-guard'
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

  const gate = await aiGuard('classify', 40) // post-wizard authoring — sellers classify many photos
  if (!gate.ok) return gate.res

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
    const buf = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 50_000_000 })
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

Then fill:
- "listingType": one of the category's listed types; default "sell".
- "condition": "new" or "used", or "" if not a physical item / can't tell.
- "brandConfident": be STRICT. true ONLY when you can identify the exact brand with ~95%+ certainty — from a clearly legible logo, brand name or model text ON the product, OR a truly unmistakable iconic design. If the brand is not clearly legible and you would be guessing, set false. NEVER infer a premium or luxury brand (e.g. TAG Heuer, Rolex, Omega, Apple) from a generic shape — many smartwatches, watches and gadgets look alike. When unsure, false.
- "brand": the canonical English brand name (e.g. "Apple", "Huawei", "Honda", "Samsung") ONLY when brandConfident is true; otherwise "".
- "model": the specific model/line WITHOUT the brand word (e.g. brand "Apple" → model "iPhone 14 Pro"; brand "Honda" → model "Wave Alpha"; brand "Kia" → model "Sorento"). Only when you can read or clearly recognize it; otherwise "". Never guess a model.
- "title" in ${titleLang} (max 80 chars): name the product accurately. Include the brand/model ONLY when brandConfident is true; when NOT confident, use a correct GENERIC descriptor instead of a guessed brand — e.g. "Round smartwatch, steel bracelet" (NOT "TAG Heuer Smartwatch"). Name the product itself, no scene words ("on a table"), no price, no phone.
- "description" in ${titleLang}: 2–4 short lines describing ONLY what is actually visible — what the item is, then a few concrete specs you can really see (type, colour, material, visible size/features, condition cues). Do NOT invent model numbers, capacities, brands or features you cannot see. If brandConfident is false, do NOT name a brand. No scene description, no marketing fluff, no price, no phone.
Then infer these visible attributes ONLY when you can actually see/judge them (else ""):
- "color": the product's dominant colour as ONE simple English word — black, white, grey, silver, red, blue, green, beige or gold.
- "transmission" (vehicles only): "automatic" or "manual" — only if genuinely clear (e.g. a scooter is automatic, a sport bike with a visible clutch/gear lever is manual). Else "".
- "fuel" (vehicles only): "petrol", "electric" or "diesel" — only if clear (e.g. an obvious EV / charging port → electric). Else "".
- "material" (furniture only): "wood", "fabric" or "metal" — the main visible material. Else "".
Return ONLY JSON.`

  let parsed: { productClear?: boolean; category?: string; subcategory?: string; listingType?: string; condition?: string; title?: string; brand?: string; brandConfident?: boolean; model?: string; description?: string; color?: string; transmission?: string; fuel?: string; material?: string } = {}
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
            brandConfident: { type: Type.BOOLEAN },
            brand: { type: Type.STRING },
            model: { type: Type.STRING },
            description: { type: Type.STRING },
            color: { type: Type.STRING },
            transmission: { type: Type.STRING },
            fuel: { type: Type.STRING },
            material: { type: Type.STRING },
          },
          // REQUIRED so the model always emits them (optional fields get dropped).
          required: ['productClear', 'category', 'brandConfident', 'brand'],
        },
      },
    })
    // Harden: strip any stray ``` fences, fall back to {} on an empty reply.
    let txt = (res.text || '').trim()
    if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    parsed = JSON.parse(txt || '{}')
  } catch (e) {
    console.error('[ai/classify]', e)
    // Never echo raw upstream error text to the client (provider internals). Log it instead.
    console.error('[ai/classify]', (e as Error)?.message?.slice(0, 300))
    return NextResponse.json({ error: 'ai_failed' }, { status: 502 })
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
  // Brand only when the model is genuinely confident (~95%+) — never a guess. The
  // model was confidently mislabelling look-alikes (a Huawei watch → "TAG Heuer").
  // For a brand category where it's NOT confident, surface `brandUncertain` so the
  // wizard asks for a clearer photo of the logo rather than filling a wrong brand.
  const isBrandCat = categoryHasBrand(cat.slug)
  const brandConfident = parsed.brandConfident === true
  const brand = isBrandCat && brandConfident ? ((parsed.brand || '').trim().slice(0, 40) || null) : null
  const brandUncertain = isBrandCat && !brandConfident
  // Specific model — only meaningful alongside a confident brand.
  const model = brand ? ((parsed.model || '').trim().slice(0, 60) || null) : null
  // Grounded short description (what's visible). Guard against a model that slips a
  // phone number in; cap length so it stays concise, not an essay.
  let description = (parsed.description || '').trim().slice(0, 600) || null
  if (description && containsPhoneNumber(description)) description = null

  // Visible attributes (color/transmission/fuel/material) → validate each against
  // the chosen category's facet OPTIONS so we only ever return a real taxonomy
  // value (the wizard pre-selects these chips; the user confirms). A free word like
  // "silver" maps to the "grey" option via its label ("Grey / Silver").
  const matchOption = (f: (typeof cat.facets)[number], raw?: string): string | null => {
    const v = String(raw || '').trim().toLowerCase()
    if (!v) return null
    for (const o of f.options) {
      if (o.value.toLowerCase() === v) return o.value
      const words = `${o.label} ${o.labelVi}`.toLowerCase().split(/[\s/]+/).filter(Boolean)
      if (words.includes(v)) return o.value
    }
    return null
  }
  const attributes: Record<string, string> = {}
  for (const key of ['color', 'transmission', 'fuel', 'material'] as const) {
    const f = cat.facets.find((ff) => ff.key === key)
    const m = f ? matchOption(f, parsed[key]) : null
    if (m) attributes[key] = m
  }

  return NextResponse.json({
    categorySlug: cat.slug,
    subcategorySlug: sub?.slug ?? null,
    listingType,
    condition,
    title,
    brand,
    brandUncertain,
    model,
    description,
    attributes,
  })
}
