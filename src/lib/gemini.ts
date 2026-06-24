import 'server-only'
import { GoogleGenAI } from '@google/genai'

// Gemini on VERTEX AI (so the "GenAI App Builder" credit is drawn). Configured via:
//   GOOGLE_VERTEX_PROJECT      — the GCP project id linked to the credit's billing
//   GOOGLE_VERTEX_LOCATION     — e.g. "us-central1" (default) or "global"
//   GOOGLE_VERTEX_CREDENTIALS  — the service-account JSON key, as a single-line string
// Lazy singleton; returns null when unconfigured so the AI routes degrade gracefully.

export const GEMINI_MODEL = 'gemini-2.0-flash' // fast + cheap + multimodal — ideal for classify/rephrase

let client: GoogleGenAI | null | undefined

export function getGemini(): GoogleGenAI | null {
  if (client !== undefined) return client
  const project = process.env.GOOGLE_VERTEX_PROJECT
  const location = process.env.GOOGLE_VERTEX_LOCATION || 'us-central1'
  const rawCreds = process.env.GOOGLE_VERTEX_CREDENTIALS
  if (!project || !rawCreds) { client = null; return null }
  try {
    const credentials = JSON.parse(rawCreds) as { client_email: string; private_key: string }
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
