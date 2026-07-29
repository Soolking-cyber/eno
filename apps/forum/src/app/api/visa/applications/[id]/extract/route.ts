import { ThinkingLevel, Type } from '@google/genai'
import { z } from 'zod'
import { aiErrorStatus, withAiRetry } from '@/lib/ai-retry'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { GEMINI_VISA_FALLBACK_MODEL, GEMINI_VISA_MODEL, getGemini } from '@/lib/gemini'
import { rateLimit } from '@/lib/ratelimit'
import { getVisaUser } from '@/lib/visa/auth'
import { decryptVisaPayload, encryptVisaPayload } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { evaluatePassportImageQuality, evaluatePortraitImageQuality, PASSPORT_IMAGE_CODES } from '@/lib/visa/image-quality'
import { parsePassportMrz } from '@/lib/visa/mrz'
import { recordVisaEvent } from '@/lib/visa/records'
import { visaPayloadSchema } from '@/lib/visa/schema'
import { VISA_BUCKET, VISA_IMAGE_RULES_VERSION } from '@/lib/visa/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const METHODS = 'POST, OPTIONS'
const requestSchema = z.object({ kind: z.enum(['portrait', 'passport']).default('passport'), documentId: z.string().uuid().optional() })

export function OPTIONS(request: Request) { return forumPreflight(request, METHODS) }

const passportSchema = {
  type: Type.OBJECT,
  properties: {
    checks: {
      type: Type.OBJECT,
      properties: {
        correctPassportBiodataPage: { type: Type.BOOLEAN }, singleDataPage: { type: Type.BOOLEAN },
        clearImage: { type: Type.BOOLEAN }, noSignificantGlare: { type: Type.BOOLEAN },
        fullPageVisible: { type: Type.BOOLEAN }, allCornersVisible: { type: Type.BOOLEAN },
        printedTextReadable: { type: Type.BOOLEAN }, mrzReadable: { type: Type.BOOLEAN },
      },
      required: ['correctPassportBiodataPage', 'singleDataPage', 'clearImage', 'noSignificantGlare', 'fullPageVisible', 'allCornersVisible', 'printedTextReadable', 'mrzReadable'],
    },
    fields: {
      type: Type.OBJECT,
      properties: {
        surname: { type: Type.STRING }, givenNames: { type: Type.STRING }, dateOfBirth: { type: Type.STRING },
        sex: { type: Type.STRING, enum: ['unknown', 'male', 'female'] }, nationality: { type: Type.STRING },
        identityNumber: { type: Type.STRING }, passportNumber: { type: Type.STRING },
        passportType: { type: Type.STRING, enum: ['unknown', 'ordinary', 'official', 'diplomatic', 'other'] },
        passportIssuingAuthority: { type: Type.STRING }, passportIssueDate: { type: Type.STRING },
        passportExpiryDate: { type: Type.STRING }, placeOfBirth: { type: Type.STRING },
      },
      required: ['surname', 'givenNames', 'dateOfBirth', 'sex', 'nationality', 'identityNumber', 'passportNumber', 'passportType', 'passportIssuingAuthority', 'passportIssueDate', 'passportExpiryDate', 'placeOfBirth'],
    },
    mrzLine1: { type: Type.STRING }, mrzLine2: { type: Type.STRING },
    confidence: { type: Type.NUMBER }, observations: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['checks', 'fields', 'mrzLine1', 'mrzLine2', 'confidence', 'observations'],
}

const portraitSchema = {
  type: Type.OBJECT,
  properties: {
    checks: {
      type: Type.OBJECT,
      properties: {
        correctPortraitPhoto: { type: Type.BOOLEAN }, singlePerson: { type: Type.BOOLEAN }, clearImage: { type: Type.BOOLEAN },
        straightFace: { type: Type.BOOLEAN }, noHat: { type: Type.BOOLEAN }, noGlasses: { type: Type.BOOLEAN },
        formalClothes: { type: Type.BOOLEAN }, whiteBackground: { type: Type.BOOLEAN },
        faceCentered: { type: Type.BOOLEAN }, headAndShouldersVisible: { type: Type.BOOLEAN }, evenLighting: { type: Type.BOOLEAN },
      },
      required: ['correctPortraitPhoto', 'singlePerson', 'clearImage', 'straightFace', 'noHat', 'noGlasses', 'formalClothes', 'whiteBackground', 'faceCentered', 'headAndShouldersVisible', 'evenLighting'],
    },
    confidence: { type: Type.NUMBER }, observations: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['checks', 'confidence', 'observations'],
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

async function analyzeImage(
  ai: NonNullable<ReturnType<typeof getGemini>>,
  contents: Parameters<typeof ai.models.generateContent>[0]['contents'],
  responseSchema: typeof passportSchema | typeof portraitSchema,
) {
  const attempts = [
    { model: GEMINI_VISA_MODEL, delay: 0 },
    { model: GEMINI_VISA_FALLBACK_MODEL, delay: 0 },
  ]
  return withAiRetry(attempts, async (attempt, index) => {
      const response = await ai.models.generateContent({
        model: attempt.model,
        contents,
        config: {
          temperature: 0,
          maxOutputTokens: responseSchema === passportSchema ? 2_048 : 1_024,
          responseMimeType: 'application/json',
          responseSchema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          httpOptions: { timeout: 12_000, retryOptions: { attempts: 1 } },
        },
      })
      const analyzed = JSON.parse(response.text || '{}') as Record<string, unknown>
      if (!analyzed.checks || typeof analyzed.checks !== 'object') throw new SyntaxError('image_analysis_missing_checks')
      return { analyzed, model: attempt.model, attempts: index + 1 }
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, METHODS)
  const user = await getVisaUser(request)
  if (!user) return forumJson(request, { error: 'auth_required' }, { status: 401 }, METHODS)
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({ kind: 'passport' })))
  if (!parsed.success) return forumJson(request, { error: 'invalid_analysis_request' }, { status: 400 }, METHODS)
  const { id } = await params
  const db = getVisaDb()
  let documentQuery = db.from('visa_documents').select('id,storage_path,kind,validation_report').eq('application_id', id).eq('kind', parsed.data.kind)
  if (parsed.data.documentId) documentQuery = documentQuery.eq('id', parsed.data.documentId)
  const [{ data: application }, { data: document }] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', id).eq('user_id', user.id).maybeSingle(),
    documentQuery.order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (!application) return forumJson(request, { error: 'not_found' }, { status: 404 }, METHODS)
  if (!['draft', 'needs_changes'].includes(application.status)) return forumJson(request, { error: 'application_locked' }, { status: 409 }, METHODS)
  if (!document) return forumJson(request, { error: `${parsed.data.kind}_image_required` }, { status: 409 }, METHODS)
  const existingReport = document.validation_report && typeof document.validation_report === 'object' ? document.validation_report as Record<string, unknown> : {}
  const [hourlyLimit, dailyLimit] = await Promise.all([
    rateLimit('visa-image-analysis-v2-hour', user.id, 10, '1 h', { strict: true }),
    rateLimit('visa-image-analysis-v2-day', user.id, 30, '24 h', { strict: true }),
  ])
  if (!hourlyLimit.success || !dailyLimit.success) {
    const validationReport = {
      ...existingReport,
      version: VISA_IMAGE_RULES_VERSION,
      status: 'unavailable',
      issues: ['automatic_image_check_rate_limited'],
      analyzedAt: new Date().toISOString(),
    }
    await db.from('visa_documents').update({ validation_status: 'unavailable', validation_report: validationReport }).eq('id', document.id).neq('validation_status', 'passed')
    const response = forumJson(request, { error: 'image_analysis_rate_limited' }, { status: 429 }, METHODS)
    response.headers.set('Retry-After', '300')
    return response
  }
  const ai = getGemini()
  if (!ai) {
    await db.from('visa_documents').update({ validation_status: 'unavailable' }).eq('id', document.id).neq('validation_status', 'passed')
    return forumJson(request, { error: 'ai_unavailable' }, { status: 503 }, METHODS)
  }
  const { data: blob, error: downloadError } = await db.storage.from(VISA_BUCKET).download(document.storage_path)
  if (downloadError || !blob) return forumJson(request, { error: 'image_download_failed' }, { status: 500 }, METHODS)

  try {
    const passport = parsed.data.kind === 'passport'
    const prompt = passport
      ? 'Act as a strict quality checker and transcription assistant for the official Viet Nam e-Visa form. Confirm this is exactly one complete passport biodata page, clear and readable, with the entire physical page and all four corners visible and no glare obscuring data. Transcribe every relevant printed field and both 44-character ICAO TD3 MRZ lines exactly. Use English text and YYYY-MM-DD dates. Use unknown for uncertain sex or passport type and empty strings for other absent or uncertain fields. Passport type means ordinary, official, diplomatic, or other. Never infer or invent a value. Quality booleans must be false whenever the criterion is uncertain.'
      : 'Act as a strict quality checker for the official Viet Nam e-Visa portrait. Check that it is one clear 4x6-style head-and-shoulders portrait of one person, facing straight forward, with no hat, no glasses, formal/neat clothing, a plain white background, centered face, and even lighting. Do not claim the photo is recent because that cannot be verified. Quality booleans must be false whenever the criterion is uncertain.'
    const analysis = await analyzeImage(ai, [{ role: 'user', parts: [
        { text: prompt },
        { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(await blob.arrayBuffer()).toString('base64') } },
      ] }], passport ? passportSchema : portraitSchema)
    const analyzed = analysis.analyzed
    const quality = passport ? evaluatePassportImageQuality(analyzed.checks) : evaluatePortraitImageQuality(analyzed.checks)
    const { issues, warnings } = quality
    const validationStatus = quality.status
    const validationReport = {
      ...existingReport,
      version: VISA_IMAGE_RULES_VERSION,
      status: validationStatus,
      issues,
      warnings,
      semanticChecks: analyzed.checks || {},
      confidence: typeof analyzed.confidence === 'number' ? Math.max(0, Math.min(1, analyzed.confidence)) : null,
      analysisModel: analysis.model,
      analysisAttempts: analysis.attempts,
      analyzedAt: new Date().toISOString(),
    }

    const payload = decryptVisaPayload(application.encrypted_payload)
    const suggestions: Record<string, string> = {}
    let mrzChecks: Record<string, boolean> | undefined
    if (passport) {
      const fields = analyzed.fields && typeof analyzed.fields === 'object' ? analyzed.fields as Record<string, unknown> : {}
      for (const key of ['surname', 'givenNames', 'nationality', 'identityNumber', 'passportNumber', 'passportIssuingAuthority', 'placeOfBirth'] as const) {
        const value = textValue(fields[key])
        if (value) suggestions[key] = value
      }
      for (const key of ['dateOfBirth', 'passportIssueDate', 'passportExpiryDate'] as const) {
        const value = textValue(fields[key])
        if (isIsoDate(value)) suggestions[key] = value
      }
      if (fields.sex === 'male' || fields.sex === 'female') suggestions.sex = fields.sex
      if (['ordinary', 'official', 'diplomatic', 'other'].includes(String(fields.passportType))) suggestions.passportType = String(fields.passportType)

      const mrz = parsePassportMrz(textValue(analyzed.mrzLine1), textValue(analyzed.mrzLine2))
      mrzChecks = mrz.checks
      for (const [key, value] of Object.entries(mrz.fields)) {
        if (key !== 'nationalityCode' && value) suggestions[key] = value
      }
      const checkedQuality = evaluatePassportImageQuality(analyzed.checks, mrz.valid)
      warnings.splice(0, warnings.length, ...checkedQuality.warnings)
      payload.aiDocumentProcessingConsent = true
      const merged = visaPayloadSchema.parse({ ...payload, ...suggestions })
      Object.assign(payload, merged)
      validationReport.issues = issues
      validationReport.status = checkedQuality.status
      Object.assign(validationReport, { mrzChecks })
    }

    const finalStatus = validationReport.status as 'passed' | 'failed'
    const now = new Date().toISOString()
    // ⚠️ A DOCUMENT THAT ALREADY PASSED IS NEVER DOWNGRADED — this copy was missing the guard.
    // The other three writes in this file already carry `.neq('validation_status','passed')`; this
    // success path did not, and both apps write the SAME visa_documents rows. So a re-analysis
    // through the forum could revoke a portrait eno.vn had already passed, throwing the applicant
    // back to Documents with no way to understand why. The stored bytes cannot change between runs
    // (uploads are `upsert: false` and every upload inserts a new row), so a different verdict on a
    // second run is model noise, not new information.
    const documentUpdate = await db.from('visa_documents').update({ validation_status: finalStatus, validation_report: validationReport }).eq('id', document.id).neq('validation_status', 'passed')
    if (documentUpdate.error) throw documentUpdate.error
    if (passport) {
      const previousChecklist = Array.isArray(application.checklist) ? application.checklist : []
      const imageIssueCodes = new Set(PASSPORT_IMAGE_CODES)
      const checklist = [...new Set([...previousChecklist.filter((item: string) => !imageIssueCodes.has(item)), 'ai_extraction_needs_review', ...issues])]
      // CAS on updated_at + 0-row = 409 (audit P2 #10; the root route had the guard,
      // this copy had NEITHER — a concurrent applicant save was silently clobbered by
      // the merge, or the merge silently vanished while a success event was recorded).
      const applicationUpdate = await db.from('visa_applications').update({ encrypted_payload: encryptVisaPayload(payload), checklist, updated_at: now, last_applicant_action_at: now }).eq('id', id).eq('user_id', user.id).eq('updated_at', application.updated_at).select('id').maybeSingle()
      if (applicationUpdate.error) throw applicationUpdate.error
      if (!applicationUpdate.data) return forumJson(request, { error: 'application_changed_retry' }, { status: 409 }, METHODS)
    }
    await recordVisaEvent(id, 'system', passport ? 'passport_analyzed_and_extracted' : 'portrait_analyzed', undefined, { documentId: document.id, status: finalStatus, issues, fieldsSuggested: Object.keys(suggestions).length, model: analysis.model, attempts: analysis.attempts })
    return forumJson(request, {
      document: { id: document.id, validationStatus: finalStatus, validationReport },
      payload: passport ? payload : undefined,
      suggestions: Object.keys(suggestions), issues, warnings,
    }, undefined, METHODS)
  } catch (error) {
    const failure = error as { name?: string; status?: number; code?: number | string }
    const status = aiErrorStatus(error)
    const capacityBusy = status === 429
    console.error('[visa-image-analysis] failed', { kind: parsed.data.kind, name: failure.name || 'Error', status, message: error instanceof Error ? error.message.slice(0, 300) : null })
    const issue = capacityBusy ? 'automatic_image_check_busy' : 'automatic_image_check_failed'
    const validationReport = { ...existingReport, version: VISA_IMAGE_RULES_VERSION, status: 'unavailable', issues: [issue], analyzedAt: new Date().toISOString() }
    await db.from('visa_documents').update({ validation_status: 'unavailable', validation_report: validationReport }).eq('id', document.id).neq('validation_status', 'passed')
    const response = forumJson(request, { error: capacityBusy ? 'image_analysis_busy' : 'image_analysis_failed' }, { status: capacityBusy ? 429 : 502 }, METHODS)
    if (capacityBusy) response.headers.set('Retry-After', '60')
    return response
  }
}
