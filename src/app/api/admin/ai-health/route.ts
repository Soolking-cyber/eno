import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/admin'
import { getGemini, geminiDiag, GEMINI_MODEL } from '@/lib/gemini'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Admin-only AI health/diagnostics. Answers "which Gemini config are we actually
// using in prod?" without exposing any secret (only project id + service-account
// email + resolved location/model + which ENV SOURCE won). Add ?probe=1 to also fire
// a live 1-token generateContent call so you can see, from prod, whether the model
// resolves (a 404 here = the model isn't served in the resolved region).
//   curl https://eno.vn/api/admin/ai-health          (with an admin session cookie)
//   curl https://eno.vn/api/admin/ai-health?probe=1
export async function GET(req: NextRequest) {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const diag = geminiDiag()
  const params = new URL(req.url).searchParams
  if (params.get('probe') !== '1') return NextResponse.json(diag)

  const ai = getGemini()
  if (!ai) return NextResponse.json({ ...diag, probe: { ok: false, error: 'client_null — no project/credentials resolved' } })

  // Optional ?model= override: probe ANY model against the LIVE prod config (project +
  // region + creds) WITHOUT committing a model change — so we can confirm e.g.
  // gemini-3.5-flash resolves on this project's global endpoint before flipping to it.
  const probeModel = params.get('model')?.trim() || GEMINI_MODEL
  const t0 = Date.now()
  try {
    const r = await ai.models.generateContent({
      model: probeModel,
      contents: 'Reply with the single word OK.',
      config: { maxOutputTokens: 12, thinkingConfig: { thinkingBudget: 0 } },
    })
    return NextResponse.json({ ...diag, probe: { ok: true, ms: Date.now() - t0, model: probeModel, text: (r.text || '').trim().slice(0, 40) } })
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    const httpCode = (msg.match(/"code":\s*(\d+)/) || [])[1] || null
    // Admin-only, so surfacing the upstream error (incl. a 404 "model not found in
    // region") is the whole point — it's the fastest way to diagnose config drift.
    return NextResponse.json({ ...diag, probe: { ok: false, ms: Date.now() - t0, model: probeModel, httpCode, error: msg.slice(0, 240) } })
  }
}
