import 'server-only'
import { GoogleGenAI } from '@google/genai'

// Gemini on VERTEX AI. Configured via:
//   GOOGLE_VERTEX_PROJECT      — the GCP project id linked to billing
//   GEMINI_LOCATION            — optional override; default "global" (see below)
//   GOOGLE_VERTEX_CREDENTIALS  — the service-account JSON key, as a single-line string
// Lazy singleton; returns null when unconfigured so the AI routes degrade gracefully.

// ALL AI paths run gemini-2.5-flash: image classify, description polish, concierge,
// brands, admin review. REVERTED from gemini-3.5-flash (2026-07-06): 3.5-flash is
// served from the GLOBAL endpoint ONLY and 404s on us-central1 — so the post-wizard
// autofill/polish broke ("AI unavailable") wherever the Gemini endpoint resolved to a
// region. 2.5-flash is verified to work on BOTH global AND regional endpoints
// (us-central1 + asia-southeast1), so it's immune to whatever GEMINI_LOCATION is set
// to in prod. It's also faster on this workload (~1.7–3s vs 3.5's ~2–4.5s). If you
// want to move back to a 3.x model, pin GEMINI_LOCATION=global in Vercel first.
export const GEMINI_MODEL = 'gemini-2.5-flash'
// Lighter/faster variant for high-stakes retries (admin review) — also region-robust.
export const GEMINI_MODEL_FALLBACK = 'gemini-2.5-flash-lite'

let client: GoogleGenAI | null | undefined

export function getGemini(): GoogleGenAI | null {
  if (client !== undefined) return client
  // Gemini bills REAL money — the $1000 GenAI credit covers Vertex AI SEARCH, NOT the
  // Gemini API — so it can run on its OWN project/billing, separate from Vertex Search.
  // Prefer GEMINI_* env (e.g. the eno-translate project on the $300 free trial); fall
  // back to the shared GOOGLE_VERTEX_* (eno-vn) when unset. vertex-search.ts keeps using
  // GOOGLE_VERTEX_* (where the data store lives), so the two stay decoupled.
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
