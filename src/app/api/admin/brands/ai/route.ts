import { Type } from '@google/genai'
import { getGemini, GEMINI_MODEL } from '@/lib/gemini'
import { normalizeBrand } from '@/lib/brand-normalize'
import { iconForBrand, iconPathForSlug } from '@/lib/brand-icons'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Admin AI assist for brand curation. Given a (possibly messy/niche) brand name,
// the model returns the CANONICAL brand name + a best-guess simple-icons slug + a
// one-line note. We then VALIDATE the logo against the real simple-icons set
// (never trust the model to invent SVG paths), so the admin only ever sees a real
// monotone mark to approve — or none (keep the monogram / paste a custom path).
//
// ⚠️ WS6 MIGRATION — THE AUTH PREAMBLE ONLY. `auth: 'admin'` is the same getAdmin() and emits the
// same `{"error":"Forbidden"}` 403, capital F.
//
// ⚠️ `'admin'` RESOLVES NO PROFILE. An earlier draft of this header said it follows getAdmin()
// with getCurrentProfile() and called the extra Profile read an accepted cost. It did, and the
// cost turned out not to be acceptable anywhere: no admin handler reads ctx.profile or
// ctx.userId, the call made read-only admin GETs perform a presence-heartbeat WRITE, and on a
// first-ever call it runs ensureProfile()'s irreversible guest-Seller auto-claim. It was removed
// from the wrapper in this same commit; getAdmin() is Supabase-auth only and touches no DB.
// This route's handler touches no DB either, so with the read removed it once again answers from
// Gemini alone rather than 500ing when Postgres is unreachable.
//
// ⚠️ NO `body:` SCHEMA — SAME TWO REASONS AS /api/admin/ai-review.
//   1. ORDER: route() parses the body BEFORE the handler, which would move it ahead of the
//      `ai_unavailable` 503 — malformed JSON with Gemini unconfigured would flip 503 → 400.
//   2. COERCION + TWO CODES: `String(body.name || '')` accepts a number or null and stringifies it
//      where zod would 400, and an absent name (`missing_name`) is a different code from
//      unparseable JSON (`bad_request`) — one `invalidBodyCode` cannot be both.
// No rate limit existed on this Gemini call and none is added; adding one would invent a 429.
//
// Branches: non-admin → 403 `{"error":"Forbidden"}` · Gemini unconfigured → 503 `ai_unavailable` ·
// malformed JSON → 400 `bad_request` · empty/absent name → 400 `missing_name` · model call or JSON
// parse throws → 502 `ai_failed` (the try/catch below is unchanged and still logs) · success → 200
// `{name,iconSlug,iconPath,note}`.
//
// Byte-identical on every branch: the model call is the only thing that can reject and it is
// already caught. Nothing here touches the DB.
export const POST = route({ auth: 'admin' }, async ({ req }) => {
  const ai = getGemini()
  if (!ai) throw new ApiError('ai_unavailable', 503)

  let body: { name?: string }
  try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
  const input = String(body.name || '').trim().slice(0, 80)
  if (!input) throw new ApiError('missing_name', 400)

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
    throw new ApiError('ai_failed', 502)
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

  return { name, iconSlug, iconPath, note: (parsed.note || '').trim().slice(0, 120) || null }
})
