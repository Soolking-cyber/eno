import { getGemini, geminiDiag, GEMINI_MODEL } from '@/lib/gemini'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Admin-only AI health/diagnostics. Answers "which Gemini config are we actually
// using in prod?" without exposing any secret (only project id + service-account
// email + resolved location/model + which ENV SOURCE won). Add ?probe=1 to also fire
// a live 1-token generateContent call so you can see, from prod, whether the model
// resolves (a 404 here = the model isn't served in the resolved region).
//   curl https://eno.vn/api/admin/ai-health          (with an admin session cookie)
//   curl https://eno.vn/api/admin/ai-health?probe=1
//
// ⚠️ WS6 MIGRATION — THE AUTH PREAMBLE ONLY. `auth: 'admin'` is the same getAdmin() this route
// called, and route() answers a non-admin with `{"error":"Forbidden"}` 403 — the same capital-F
// string, the same status, the 16-site spelling this endpoint already used. No rate limit existed
// and none is added; a GET has no body, so `body:` would be meaningless.
//
// ⚠️ `'admin'` RESOLVES NO PROFILE. An earlier draft of this header said it follows getAdmin()
// with getCurrentProfile() and called the extra Profile read an accepted cost. It did, and the
// cost turned out not to be acceptable anywhere: no admin handler reads ctx.profile or
// ctx.userId, the call made read-only admin GETs perform a presence-heartbeat WRITE, and on a
// first-ever call it runs ensureProfile()'s irreversible guest-Seller auto-claim. It was removed
// from the wrapper in this same commit; getAdmin() is Supabase-auth only and touches no DB.
// That matters MORE here than anywhere: this endpoint is what you curl during an outage, and with
// the Profile read in place it answered 500 whenever Postgres was down — losing the one property
// that made it worth having. Caught by an adversarial review of the migration, not by a test.
//
// Branches, all byte-identical: guest or non-admin → 403 `{"error":"Forbidden"}` · no ?probe=1 →
// 200 diag · unconfigured client → 200 `{…diag, probe:{ok:false,error:"client_null …"}}` · probe
// succeeds → 200 with `probe.ok:true` · probe throws → 200 with `probe.ok:false` and the upstream
// message (the try/catch below is unchanged, so an upstream 404 is still a 200 here, deliberately).
//
// NOTE, rather than a claim of total safety: nothing outside that try/catch can reject —
// geminiDiag() swallows its own parse error and getGemini() catches client init — so there is no
// unwrapped DB or network call for route() to newly convert. If some unforeseen throw did escape,
// it would now be `{"error":"internal_error"}` 500 instead of Next's default 500 page.
export const GET = route({ auth: 'admin' }, async ({ req }) => {
  const diag = geminiDiag()
  const params = new URL(req.url).searchParams
  if (params.get('probe') !== '1') return diag

  const ai = getGemini()
  if (!ai) return { ...diag, probe: { ok: false, error: 'client_null — no project/credentials resolved' } }

  // Optional ?model= override: probe ANY model against the LIVE prod config (project +
  // region + creds) WITHOUT committing a model change — so we can confirm e.g.
  // a new flash model resolves on this project's global endpoint before flipping to it.
  const probeModel = params.get('model')?.trim() || GEMINI_MODEL
  const t0 = Date.now()
  try {
    const r = await ai.models.generateContent({
      model: probeModel,
      contents: 'Reply with the single word OK.',
      config: { maxOutputTokens: 12, thinkingConfig: { thinkingBudget: 0 } },
    })
    return { ...diag, probe: { ok: true, ms: Date.now() - t0, model: probeModel, text: (r.text || '').trim().slice(0, 40) } }
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    const httpCode = (msg.match(/"code":\s*(\d+)/) || [])[1] || null
    // Admin-only, so surfacing the upstream error (incl. a 404 "model not found in
    // region") is the whole point — it's the fastest way to diagnose config drift.
    return { ...diag, probe: { ok: false, ms: Date.now() - t0, model: probeModel, httpCode, error: msg.slice(0, 240) } }
  }
})
