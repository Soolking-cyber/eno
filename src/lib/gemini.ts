import 'server-only'
import { GoogleGenAI } from '@google/genai'

// Gemini API-key mode is preferred when GEMINI_API_KEY is present. Vertex AI
// remains a server-side fallback for existing deployments configured via:
//   GOOGLE_VERTEX_PROJECT      — the GCP project id linked to billing
//   GEMINI_LOCATION            — optional override; default "global" (see below)
//   GOOGLE_VERTEX_CREDENTIALS  — the service-account JSON key, as a single-line string
//   GEMINI_ADC / GOOGLE_VERTEX_ADC = "1" — use Application Default Credentials INSTEAD of a key
//                                (required in speedy-victory-500106-h8, which forbids SA keys)
// Lazy singleton; returns null when unconfigured so the AI routes degrade gracefully.

// ⚠️ THE MODEL IDS LIVE IN A PURE MODULE (gemini-model.ts) AND ARE RE-EXPORTED HERE. This file is
// `server-only`, so a maintenance script cannot import it — and a script that hardcodes its own
// copy of the model string is the thing that goes stale when the app moves version. Every existing
// `from '@/lib/gemini'` import is unchanged; the history of WHY the global endpoint is mandatory
// lives beside the constants.
export { GEMINI_MODEL, GEMINI_MODEL_FALLBACK } from './gemini-model'
// …and imported for this file's own use (a re-export does not bring a name into scope).
import { GEMINI_MODEL, GEMINI_MODEL_FALLBACK } from './gemini-model'

let client: GoogleGenAI | null | undefined

/**
 * Whether to authenticate via Application Default Credentials instead of a key.
 *
 * ⚠️ `K_SERVICE` IS THE LOAD-BEARING HALF, AND IT CLOSES A HOLE BOTH EXTERNAL REVIEWERS FOUND
 * INDEPENDENTLY (codex + Gemini 3.1 Pro, 2026-08-02). The env flag alone is NOT enough: production
 * secrets carry `GOOGLE_VERTEX_ADC=1` next to the production project id, and pulling prod env into
 * a local `.env` is routine here (`set -a; . ./.env`). A developer who syncs the env WITHOUT the
 * key would then hit the ADC branch, where ADC resolves to their PERSONAL gcloud identity while
 * `project` still points at production — silently authenticating and billing against prod.
 *
 * `K_SERVICE` is set only by the Cloud Run runtime, so ADC can only engage where the metadata
 * server exists. It is the same Cloud Run test cache-handler.cjs already uses (line 186). Off
 * Cloud Run with no key, getGemini() returns null and the AI routes degrade gracefully, which is
 * the correct behaviour for a laptop.
 *
 * ⚠️ `GEMINI_ADC="0"` IS A DELIBERATE HARD OFF-SWITCH, not a bug. `"0"` is a truthy string, so `||`
 * stops there and GOOGLE_VERTEX_ADC is never consulted — which is exactly what you want from a
 * per-service override, and is why it is spelled out rather than left to be rediscovered.
 */
function adcEnabled(): boolean {
  return (process.env.GEMINI_ADC || process.env.GOOGLE_VERTEX_ADC) === '1' && !!process.env.K_SERVICE
}

export function getGemini(): GoogleGenAI | null {
  if (client !== undefined) return client
  // Gemini bills REAL money — the $1000 GenAI credit covers Vertex AI SEARCH, NOT the
  // Gemini API — so it can run on its OWN project/billing, separate from Vertex Search.
  // Prefer GEMINI_* env (e.g. the eno-translate project on the $300 free trial); fall
  // back to the shared GOOGLE_VERTEX_* (eno-vn) when unset. vertex-search.ts keeps using
  // GOOGLE_VERTEX_* (where the data store lives), so the two stay decoupled.
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (apiKey) {
    client = new GoogleGenAI({ apiKey })
    return client
  }
  const project = process.env.GEMINI_PROJECT || process.env.GOOGLE_VERTEX_PROJECT
  const location = process.env.GEMINI_LOCATION || 'global'
  // ⚠️ `.trim()` ON EACH SIDE, MATCHING geminiDiag() EXACTLY. Without it a whitespace-only
  // GEMINI_CREDENTIALS is truthy here (so it wins over a perfectly good GOOGLE_VERTEX_CREDENTIALS,
  // then throws in JSON.parse and caches client=null forever) while geminiDiag() trims and reports
  // "ADC" or "none" — so /api/admin/ai-health would describe a working config at the exact moment
  // AI is dead. Both reviewers found this drift; the two functions must read the env identically.
  const rawCreds = process.env.GEMINI_CREDENTIALS?.trim() || process.env.GOOGLE_VERTEX_CREDENTIALS?.trim()
  // ⚠️ ADC IS THE ONLY OPTION IN THE PROJECT GEMINI IS MOVING TO, so this is a requirement
  // rather than a convenience. speedy-victory-500106-h8 enforces the org policy
  // `constraints/iam.disableServiceAccountKeyCreation` — `gcloud iam service-accounts keys create`
  // fails there with FAILED_PRECONDITION, so there is no GEMINI_CREDENTIALS to paste. Cloud Run's
  // own runtime identity (eno-run@speedy-victory-500106-h8, granted roles/aiplatform.user)
  // authenticates from the metadata server instead: no key in Secret Manager, nothing to rotate.
  //
  // Same GEMINI_* -> GOOGLE_VERTEX_* fallback as every other var here, so setting
  // GOOGLE_VERTEX_ADC=1 once covers Search and Gemini together.
  //
  // ⚠️ rawCreds STILL WINS when present, and that ordering is what made this safe to ship before
  // the env changed: with GEMINI_CREDENTIALS set, this file behaves exactly as it did, so the code
  // could deploy and be verified BEFORE the credential was removed rather than in the same step.
  //
  // ⚠️ DO NOT collapse this to `if (!rawCreds) use ADC` — see adcEnabled() for why the env flag
  // alone is not sufficient and why it is additionally pinned to the Cloud Run runtime.
  const useAdc = adcEnabled()
  if (!project || (!rawCreds && !useAdc)) { client = null; return null }
  try {
    if (rawCreds) {
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
    } else {
      // No `credentials`: google-auth-library walks the ADC chain, which on Cloud Run is the
      // metadata server. projectId is still passed explicitly — ADC infers the project the
      // CREDENTIAL belongs to, which is not necessarily the one billing these calls.
      client = new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions: { projectId: project } })
    }
  } catch (e) {
    console.error('[gemini] client init failed', e)
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
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  const gProj = process.env.GEMINI_PROJECT, vProj = process.env.GOOGLE_VERTEX_PROJECT
  const gLoc = process.env.GEMINI_LOCATION
  const gCred = process.env.GEMINI_CREDENTIALS, vCred = process.env.GOOGLE_VERTEX_CREDENTIALS
  // Trimmed, exactly as getGemini() now reads it — a diagnostic that resolves the credential
  // differently from the code it diagnoses is worse than no diagnostic.
  const rawCreds = gCred?.trim() || vCred?.trim() || ''
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
    authSource: apiKey ? 'GEMINI_API_KEY' : gProj?.trim() || vProj?.trim() ? 'VERTEX_AI' : 'none',
    // `.trim() || fallback` so a present-but-EMPTY var falls through exactly like getGemini().
    project: (gProj?.trim() || vProj?.trim()) || null,
    projectSource: gProj?.trim() ? 'GEMINI_PROJECT' : vProj?.trim() ? 'GOOGLE_VERTEX_PROJECT' : 'none',
    location: gLoc?.trim() || 'global',
    locationSource: gLoc?.trim() ? 'GEMINI_LOCATION' : 'default(global)',
    // 'ADC' is reported only when NO key is present AND adcEnabled() actually holds — the same
    // predicate getGemini() branches on, K_SERVICE included. A key beside GOOGLE_VERTEX_ADC=1
    // still means the KEY authenticates, and ai-health must say so or it becomes a lie at exactly
    // the moment someone is debugging a credential problem.
    credSource: gCred?.trim()
      ? 'GEMINI_CREDENTIALS'
      : vCred?.trim()
        ? 'GOOGLE_VERTEX_CREDENTIALS'
        : adcEnabled()
          ? 'ADC'
          : 'none',
    credServiceAccount,
    aiAssistFlag: process.env.NEXT_PUBLIC_AI_ASSIST || null,
    clientReady: getGemini() !== null,
  }
}
