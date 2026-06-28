import 'server-only'
import { GoogleGenAI } from '@google/genai'

// Gemini on VERTEX AI (so the "GenAI App Builder" credit is drawn). Configured via:
//   GOOGLE_VERTEX_PROJECT      — the GCP project id linked to the credit's billing
//   GOOGLE_VERTEX_LOCATION     — e.g. "us-central1" (default) or "global"
//   GOOGLE_VERTEX_CREDENTIALS  — the service-account JSON key, as a single-line string
// Lazy singleton; returns null when unconfigured so the AI routes degrade gracefully.

export const GEMINI_MODEL = 'gemini-2.5-flash' // fast + cheap + multimodal; verified available on this Vertex project (2.0-flash 404s here)

let client: GoogleGenAI | null | undefined

export function getGemini(): GoogleGenAI | null {
  if (client !== undefined) return client
  // Gemini bills REAL money — the $1000 GenAI credit covers Vertex AI SEARCH, NOT the
  // Gemini API — so it can run on its OWN project/billing, separate from Vertex Search.
  // Prefer GEMINI_* env (e.g. the eno-translate project on the $300 free trial); fall
  // back to the shared GOOGLE_VERTEX_* (eno-vn) when unset. vertex-search.ts keeps using
  // GOOGLE_VERTEX_* (where the data store lives), so the two stay decoupled.
  const project = process.env.GEMINI_PROJECT || process.env.GOOGLE_VERTEX_PROJECT
  const location = process.env.GEMINI_LOCATION || process.env.GOOGLE_VERTEX_LOCATION || 'us-central1'
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
