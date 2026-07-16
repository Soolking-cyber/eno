import 'server-only'
import { GoogleGenAI } from '@google/genai'

// Vertex AI API-key mode is preferred when GEMINI_VERTEX_API_KEY is present. It
// uses Cloud billing without requiring a service-account credential in Vercel.
// The Gemini Developer API remains available through GEMINI_API_KEY, followed by
// the service-account fallback used by existing deployments configured via:
//   GOOGLE_VERTEX_PROJECT      — the GCP project id linked to billing
//   GEMINI_LOCATION            — optional override; default "global" (see below)
//   GOOGLE_VERTEX_CREDENTIALS  — the service-account JSON key, as a single-line string
// Lazy singleton; returns null when unconfigured so the AI routes degrade gracefully.

// Keep the stable, region-robust model first for every live request. The eno-translate
// project's 3.5 preview pool can return RESOURCE_EXHAUSTED while 2.5 remains healthy;
// making 2.5 primary prevents itinerary and visa traffic from touching that exhausted
// pool during normal operation. 3.5 remains an immediate secondary attempt where a
// route explicitly uses GEMINI_MODEL_FALLBACK. The global endpoint supports both.
export const GEMINI_MODEL = 'gemini-2.5-flash'
export const GEMINI_MODEL_FALLBACK = 'gemini-3.5-flash'

let client: GoogleGenAI | null | undefined

export function getGemini(): GoogleGenAI | null {
  if (client !== undefined) return client
  // Gemini bills REAL money — the $1000 GenAI credit covers Vertex AI SEARCH, NOT the
  // Gemini API — so it can run on its OWN project/billing, separate from Vertex Search.
  // Prefer GEMINI_* env (e.g. the eno-translate project on the $300 free trial); fall
  // back to the shared GOOGLE_VERTEX_* (eno-vn) when unset. vertex-search.ts keeps using
  // GOOGLE_VERTEX_* (where the data store lives), so the two stay decoupled.
  const vertexApiKey = process.env.GEMINI_VERTEX_API_KEY?.trim()
  if (vertexApiKey) {
    client = new GoogleGenAI({ vertexai: true, apiKey: vertexApiKey })
    return client
  }
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (apiKey) {
    client = new GoogleGenAI({ apiKey })
    return client
  }
  const project = process.env.GEMINI_PROJECT || process.env.GOOGLE_VERTEX_PROJECT
  const location = process.env.GEMINI_LOCATION || 'global'
  const rawCreds = process.env.GEMINI_CREDENTIALS || process.env.GOOGLE_VERTEX_CREDENTIALS
  if (!project || !rawCreds) { client = null; return null }
  try {
    // Accept the SA key as raw JSON OR base64-encoded JSON. base64 is paste-safe
    // (no quotes/newlines to mangle in the Vercel dashboard) — preferred.
    const json = rawCreds.trim().startsWith('{') ? rawCreds : Buffer.from(rawCreds.trim(), 'base64').toString('utf8')
    const credentials = JSON.parse(json) as { client_email: string; private_key: string }
    client = new GoogleGenAI({
      vertexai: true,
      project,
      location,
      // Inline credentials (no key file on serverless). google-auth-library reads
      // client_email + private_key from here.
      googleAuthOptions: { credentials, projectId: project },
    })
  } catch (e) {
    console.error('[gemini] bad GOOGLE_VERTEX_CREDENTIALS', e)
    client = null
  }
  return client
}

export const aiEnabled = () => getGemini() !== null

/** Non-secret summary of the RESOLVED Gemini config — WHICH env source is actually in
 *  effect (GEMINI_* preferred, GOOGLE_VERTEX_* fallback), the project/location the
 *  client will hit, and whether it initialised. Powers GET /api/admin/ai-health so you
 *  can see the live config without reading Vercel secrets. Exposes only ids/the service-
 *  account email (identifiers, not keys) — never the private key or credential blob. */
export function geminiDiag() {
  const vertexApiKey = process.env.GEMINI_VERTEX_API_KEY?.trim()
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  const gProj = process.env.GEMINI_PROJECT, vProj = process.env.GOOGLE_VERTEX_PROJECT
  const gLoc = process.env.GEMINI_LOCATION
  const gCred = process.env.GEMINI_CREDENTIALS, vCred = process.env.GOOGLE_VERTEX_CREDENTIALS
  const rawCreds = gCred || vCred || ''
  let credServiceAccount: string | null = null
  try {
    if (rawCreds) {
      const json = rawCreds.trim().startsWith('{') ? rawCreds : Buffer.from(rawCreds.trim(), 'base64').toString('utf8')
      credServiceAccount = (JSON.parse(json) as { client_email?: string }).client_email ?? null
    }
  } catch { credServiceAccount = 'PARSE_ERROR' }
  return {
    model: GEMINI_MODEL,
    fallbackModel: GEMINI_MODEL_FALLBACK,
    authSource: vertexApiKey ? 'GEMINI_VERTEX_API_KEY' : apiKey ? 'GEMINI_API_KEY' : gProj?.trim() || vProj?.trim() ? 'VERTEX_AI' : 'none',
    // `.trim() || fallback` so a present-but-EMPTY var falls through exactly like getGemini().
    project: (gProj?.trim() || vProj?.trim()) || null,
    projectSource: gProj?.trim() ? 'GEMINI_PROJECT' : vProj?.trim() ? 'GOOGLE_VERTEX_PROJECT' : 'none',
    location: gLoc?.trim() || 'global',
    locationSource: gLoc?.trim() ? 'GEMINI_LOCATION' : 'default(global)',
    credSource: gCred?.trim() ? 'GEMINI_CREDENTIALS' : vCred?.trim() ? 'GOOGLE_VERTEX_CREDENTIALS' : 'none',
    credServiceAccount,
    aiAssistFlag: process.env.NEXT_PUBLIC_AI_ASSIST || null,
    clientReady: getGemini() !== null,
  }
}
