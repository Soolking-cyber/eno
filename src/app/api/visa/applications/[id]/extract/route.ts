import { Type } from '@google/genai'
import { z } from 'zod'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { GEMINI_MODEL, getGemini } from '@/lib/gemini'
import { rateLimit } from '@/lib/ratelimit'
import { getVisaUser } from '@/lib/visa/auth'
import { decryptVisaPayload, encryptVisaPayload } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
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
        sex: { type: Type.STRING, enum: ['', 'male', 'female'] }, nationality: { type: Type.STRING },
        identityNumber: { type: Type.STRING }, passportNumber: { type: Type.STRING },
        passportType: { type: Type.STRING, enum: ['', 'ordinary', 'official', 'diplomatic', 'other'] },
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

const passportIssues: Record<string, string> = {
  correctPassportBiodataPage: 'not_passport_biodata_page', singleDataPage: 'use_one_passport_data_page',
  clearImage: 'passport_image_blurry', noSignificantGlare: 'passport_image_has_glare',
  fullPageVisible: 'passport_page_cropped', allCornersVisible: 'passport_corners_missing',
  printedTextReadable: 'passport_text_unreadable', mrzReadable: 'passport_mrz_unreadable',
}

const portraitIssues: Record<string, string> = {
  correctPortraitPhoto: 'not_compliant_portrait', singlePerson: 'portrait_must_show_one_person', clearImage: 'portrait_image_blurry',
  straightFace: 'face_must_look_straight', noHat: 'remove_hat', noGlasses: 'remove_glasses', formalClothes: 'wear_formal_clothes',
  whiteBackground: 'use_plain_white_background', faceCentered: 'center_face_in_photo',
  headAndShouldersVisible: 'show_head_and_shoulders', evenLighting: 'portrait_lighting_uneven',
}

function failedChecks(value: unknown, issueMap: Record<string, string>) {
  if (!value || typeof value !== 'object') return Object.values(issueMap)
  const checks = value as Record<string, unknown>
  return Object.entries(issueMap).flatMap(([key, issue]) => checks[key] === true ? [] : [issue])
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, METHODS)
  const user = await getVisaUser(request)
  if (!user) return forumJson(request, { error: 'auth_required' }, { status: 401 }, METHODS)
  const limit = await rateLimit('visa-image-analysis', user.id, 16, '24 h', { strict: true })
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, METHODS)
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
  const ai = getGemini()
  if (!ai) {
    await db.from('visa_documents').update({ validation_status: 'unavailable' }).eq('id', document.id)
    return forumJson(request, { error: 'ai_unavailable' }, { status: 503 }, METHODS)
  }
  const { data: blob, error: downloadError } = await db.storage.from(VISA_BUCKET).download(document.storage_path)
  if (downloadError || !blob) return forumJson(request, { error: 'image_download_failed' }, { status: 500 }, METHODS)
  const existingReport = document.validation_report && typeof document.validation_report === 'object' ? document.validation_report as Record<string, unknown> : {}

  try {
    const passport = parsed.data.kind === 'passport'
    const prompt = passport
      ? 'Act as a strict quality checker and transcription assistant for the official Viet Nam e-Visa form. Confirm this is exactly one complete passport biodata page, clear and readable, with the entire physical page and all four corners visible and no glare obscuring data. Transcribe every relevant printed field and both 44-character ICAO TD3 MRZ lines exactly. Use English text, YYYY-MM-DD dates, and empty strings when absent or uncertain. Passport type means ordinary, official, diplomatic, or other. Never infer or invent a value. Quality booleans must be false whenever the criterion is uncertain.'
      : 'Act as a strict quality checker for the official Viet Nam e-Visa portrait. Check that it is one clear 4x6-style head-and-shoulders portrait of one person, facing straight forward, with no hat, no glasses, formal/neat clothing, a plain white background, centered face, and even lighting. Do not claim the photo is recent because that cannot be verified. Quality booleans must be false whenever the criterion is uncertain.'
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [
        { text: prompt },
        { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(await blob.arrayBuffer()).toString('base64') } },
      ] }],
      config: { temperature: 0, responseMimeType: 'application/json', responseSchema: passport ? passportSchema : portraitSchema },
    })
    const analyzed = JSON.parse(response.text || '{}') as Record<string, unknown>
    const issueMap = passport ? passportIssues : portraitIssues
    const issues = failedChecks(analyzed.checks, issueMap)
    const validationStatus = issues.length ? 'failed' : 'passed'
    const validationReport = {
      ...existingReport,
      version: VISA_IMAGE_RULES_VERSION,
      status: validationStatus,
      issues,
      semanticChecks: analyzed.checks || {},
      confidence: typeof analyzed.confidence === 'number' ? Math.max(0, Math.min(1, analyzed.confidence)) : null,
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
      if (!mrz.valid && !issues.includes('passport_mrz_check_failed')) issues.push('passport_mrz_check_failed')
      payload.aiDocumentProcessingConsent = true
      const merged = visaPayloadSchema.parse({ ...payload, ...suggestions })
      Object.assign(payload, merged)
      validationReport.issues = issues
      validationReport.status = issues.length ? 'failed' : 'passed'
      Object.assign(validationReport, { mrzChecks })
    }

    const finalStatus = validationReport.status as 'passed' | 'failed'
    const now = new Date().toISOString()
    const documentUpdate = await db.from('visa_documents').update({ validation_status: finalStatus, validation_report: validationReport }).eq('id', document.id)
    if (documentUpdate.error) throw documentUpdate.error
    if (passport) {
      const previousChecklist = Array.isArray(application.checklist) ? application.checklist : []
      const imageIssueCodes = new Set([...Object.values(passportIssues), 'passport_mrz_check_failed', 'passport_image_not_verified'])
      const checklist = [...new Set([...previousChecklist.filter((item: string) => !imageIssueCodes.has(item)), 'ai_extraction_needs_review', ...issues])]
      const applicationUpdate = await db.from('visa_applications').update({ encrypted_payload: encryptVisaPayload(payload), checklist, updated_at: now, last_applicant_action_at: now }).eq('id', id).eq('user_id', user.id)
      if (applicationUpdate.error) throw applicationUpdate.error
    }
    await recordVisaEvent(id, 'system', passport ? 'passport_analyzed_and_extracted' : 'portrait_analyzed', undefined, { documentId: document.id, status: finalStatus, issues, fieldsSuggested: Object.keys(suggestions).length })
    return forumJson(request, {
      document: { id: document.id, validationStatus: finalStatus, validationReport },
      payload: passport ? payload : undefined,
      suggestions: Object.keys(suggestions), issues,
    }, undefined, METHODS)
  } catch {
    const validationReport = { ...existingReport, version: VISA_IMAGE_RULES_VERSION, status: 'unavailable', issues: ['automatic_image_check_failed'], analyzedAt: new Date().toISOString() }
    await db.from('visa_documents').update({ validation_status: 'unavailable', validation_report: validationReport }).eq('id', document.id)
    return forumJson(request, { error: 'image_analysis_failed' }, { status: 502 }, METHODS)
  }
}
