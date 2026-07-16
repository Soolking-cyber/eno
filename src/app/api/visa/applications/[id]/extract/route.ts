import { Type } from '@google/genai'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { GEMINI_MODEL, getGemini } from '@/lib/gemini'
import { rateLimit } from '@/lib/ratelimit'
import { getVisaUser } from '@/lib/visa/auth'
import { decryptVisaPayload, encryptVisaPayload } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent } from '@/lib/visa/records'
import { visaPayloadSchema } from '@/lib/visa/schema'
import { VISA_BUCKET } from '@/lib/visa/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const METHODS = 'POST, OPTIONS'
export function OPTIONS(request: Request) { return forumPreflight(request, METHODS) }

const extractionSchema = {
  type: Type.OBJECT,
  properties: {
    surname: { type: Type.STRING }, givenNames: { type: Type.STRING }, dateOfBirth: { type: Type.STRING },
    sex: { type: Type.STRING, enum: ['', 'male', 'female'] }, nationality: { type: Type.STRING },
    passportNumber: { type: Type.STRING }, passportIssuingAuthority: { type: Type.STRING },
    passportIssueDate: { type: Type.STRING }, passportExpiryDate: { type: Type.STRING },
    placeOfBirth: { type: Type.STRING }, confidence: { type: Type.NUMBER }, warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['surname', 'givenNames', 'dateOfBirth', 'sex', 'nationality', 'passportNumber', 'passportIssuingAuthority', 'passportIssueDate', 'passportExpiryDate', 'placeOfBirth', 'confidence', 'warnings'],
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, METHODS)
  const user = await getVisaUser(request)
  if (!user) return forumJson(request, { error: 'auth_required' }, { status: 401 }, METHODS)
  const limit = await rateLimit('visa-passport-extract', user.id, 6, '24 h', { strict: true })
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, METHODS)
  const { id } = await params
  const db = getVisaDb()
  const [{ data: application }, { data: passport }] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', id).eq('user_id', user.id).maybeSingle(),
    db.from('visa_documents').select('storage_path').eq('application_id', id).eq('kind', 'passport').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (!application) return forumJson(request, { error: 'not_found' }, { status: 404 }, METHODS)
  if (!['draft', 'needs_changes'].includes(application.status)) return forumJson(request, { error: 'application_locked' }, { status: 409 }, METHODS)
  const payload = decryptVisaPayload(application.encrypted_payload)
  if (!payload.aiDocumentProcessingConsent) return forumJson(request, { error: 'ai_processing_consent_required' }, { status: 409 }, METHODS)
  if (!passport) return forumJson(request, { error: 'passport_image_required' }, { status: 409 }, METHODS)
  const ai = getGemini()
  if (!ai) return forumJson(request, { error: 'ai_unavailable' }, { status: 503 }, METHODS)
  const { data: blob, error: downloadError } = await db.storage.from(VISA_BUCKET).download(passport.storage_path)
  if (downloadError || !blob) return forumJson(request, { error: 'passport_download_failed' }, { status: 500 }, METHODS)

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [
        { text: 'Read this passport biodata page. Transcribe only clearly visible values. Use YYYY-MM-DD for full dates. Return an empty string for anything uncertain or absent. Never infer nationality, names, sex, dates, or numbers from context. Warnings must be short field names needing human review. This output is a draft suggestion and will be checked by the passport holder.' },
        { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(await blob.arrayBuffer()).toString('base64') } },
      ] }],
      config: { temperature: 0, responseMimeType: 'application/json', responseSchema: extractionSchema },
    })
    const extracted = JSON.parse(response.text || '{}') as Record<string, unknown>
    const datePattern = /^\d{4}-\d{2}-\d{2}$/
    const suggestions: Record<string, string> = {}
    for (const key of ['surname', 'givenNames', 'nationality', 'passportNumber', 'passportIssuingAuthority', 'placeOfBirth'] as const) {
      if (typeof extracted[key] === 'string' && extracted[key].trim()) suggestions[key] = extracted[key].trim()
    }
    for (const key of ['dateOfBirth', 'passportIssueDate', 'passportExpiryDate'] as const) {
      if (typeof extracted[key] === 'string' && datePattern.test(extracted[key])) suggestions[key] = extracted[key]
    }
    if (extracted.sex === 'male' || extracted.sex === 'female') suggestions.sex = extracted.sex
    const merged = visaPayloadSchema.parse({ ...payload })
    for (const [key, value] of Object.entries(suggestions)) {
      if (!merged[key as keyof typeof merged]) Object.assign(merged, { [key]: value })
    }
    const now = new Date().toISOString()
    const { error } = await db.from('visa_applications').update({ encrypted_payload: encryptVisaPayload(merged), checklist: ['ai_extraction_needs_review'], updated_at: now, last_applicant_action_at: now }).eq('id', id).eq('user_id', user.id)
    if (error) throw error
    await recordVisaEvent(id, 'system', 'passport_draft_extracted', undefined, { fieldsSuggested: Object.keys(suggestions).length })
    return forumJson(request, { payload: merged, suggestions: Object.keys(suggestions), confidence: typeof extracted.confidence === 'number' ? extracted.confidence : null, warnings: Array.isArray(extracted.warnings) ? extracted.warnings.filter((item): item is string => typeof item === 'string').slice(0, 12) : [] }, undefined, METHODS)
  } catch {
    return forumJson(request, { error: 'passport_extraction_failed' }, { status: 502 }, METHODS)
  }
}
