import { ThinkingLevel, Type } from '@google/genai'
import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { AI_GLOBAL_DAILY_LIMIT } from '@/lib/ai-guard'
import { aiErrorStatus, withAiRetry } from '@/lib/ai-retry'
import { GEMINI_MODEL, GEMINI_MODEL_FALLBACK, getGemini } from '@/lib/gemini'
import { rateLimit } from '@/lib/ratelimit'
import { decryptVisaPayload, encryptVisaPayload, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { evaluatePassportImageQuality, evaluatePortraitImageQuality, PASSPORT_IMAGE_CODES } from '@/lib/visa/image-quality'
import { parsePassportMrz } from '@/lib/visa/mrz'
import { recordVisaEvent } from '@/lib/visa/records'
import { nextDocumentStatus } from '@/lib/visa/document-status'
import { visaPayloadSchema } from '@/lib/visa/schema'
import { VISA_BUCKET, VISA_IMAGE_RULES_VERSION } from '@/lib/visa/storage'

// In-hub port of apps/forum/src/app/api/visa/applications/[id]/extract/route.ts —
// passport/portrait quality check + passport field extraction. Adapted to eno.vn's OWN
// AI stack: getGemini() (Vertex on eno-vn, GLOBAL endpoint only — src/lib/gemini.ts)
// with GEMINI_MODEL → GEMINI_MODEL_FALLBACK attempts through withAiRetry.
//
// BREAKERS (never bypassed): the forum's per-user hour/day limits are kept VERBATIM
// (same limiter names, so quotas hold across both surfaces on a shared Redis), and on
// top the route charges eno.vn's shared `ai-global` daily budget breaker — the same
// bucket the other direct-Gemini routes (classify/rephrase/visual-search) drain, so
// visa extraction can never push total Gemini spend past the ceiling (src/lib/ai-guard.ts).
// All three are strict (fail CLOSED without Redis). Passport extraction rewrites the
// encrypted payload, so the route is env-gated on visaCryptoReady().
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const requestSchema = z.object({ kind: z.enum(['portrait', 'passport']).default('passport'), documentId: z.string().uuid().optional() })
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    { model: GEMINI_MODEL, delay: 0 },
    { model: GEMINI_MODEL_FALLBACK, delay: 0 },
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
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({ kind: 'passport' })))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_analysis_request' }, { status: 400 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const db = getVisaDb()
  // validation_status is selected for the no-downgrade rule at the write below — without it we
  // cannot tell whether this document has already been certified.
  let documentQuery = db.from('visa_documents').select('id,storage_path,kind,validation_report,validation_status').eq('application_id', id).eq('kind', parsed.data.kind)
  if (parsed.data.documentId) documentQuery = documentQuery.eq('id', parsed.data.documentId)
  const [{ data: application }, { data: document }] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', id).eq('user_id', userId).maybeSingle(),
    documentQuery.order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (!application) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!['draft', 'needs_changes'].includes(application.status)) return NextResponse.json({ error: 'application_locked' }, { status: 409 })
  if (!document) return NextResponse.json({ error: `${parsed.data.kind}_image_required` }, { status: 409 })
  const existingReport = document.validation_report && typeof document.validation_report === 'object' ? document.validation_report as Record<string, unknown> : {}
  // User limits FIRST. A single Promise.all also consumed the SHARED ai-global token
  // for a caller already over their OWN quota — a spammer past their hourly could
  // still drain the platform-wide daily budget and black out AI for everyone. So the
  // global (same bucket as classify/rephrase/visual-search) is consumed only once the
  // per-user gates pass.
  const [hourlyLimit, dailyLimit] = await Promise.all([
    rateLimit('visa-image-analysis-v2-hour', userId, 10, '1 h', { strict: true }),
    rateLimit('visa-image-analysis-v2-day', userId, 30, '24 h', { strict: true }),
  ])
  const globalLimit = hourlyLimit.success && dailyLimit.success
    ? await rateLimit('ai-global', 'global', AI_GLOBAL_DAILY_LIMIT, '1 d', { strict: true })
    : { success: false }
  if (!hourlyLimit.success || !dailyLimit.success || !globalLimit.success) {
    const validationReport = {
      ...existingReport,
      version: VISA_IMAGE_RULES_VERSION,
      status: 'unavailable',
      issues: ['automatic_image_check_rate_limited'],
      analyzedAt: new Date().toISOString(),
    }
    await db.from('visa_documents').update({ validation_status: 'unavailable', validation_report: validationReport }).eq('id', document.id).neq('validation_status', 'passed')
    const response = NextResponse.json({ error: 'image_analysis_rate_limited' }, { status: 429 })
    response.headers.set('Retry-After', '300')
    return response
  }
  const ai = getGemini()
  if (!ai) {
    await db.from('visa_documents').update({ validation_status: 'unavailable' }).eq('id', document.id).neq('validation_status', 'passed')
    return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })
  }
  const { data: blob, error: downloadError } = await db.storage.from(VISA_BUCKET).download(document.storage_path)
  if (downloadError || !blob) return NextResponse.json({ error: 'image_download_failed' }, { status: 500 })

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

    const analysedStatus = validationReport.status as 'passed' | 'failed'

    // ⚠️ A DOCUMENT THAT ALREADY PASSED IS NEVER DOWNGRADED. Both failure paths below already
    // guard their writes with `.neq('validation_status','passed')`; this success path did not,
    // and that asymmetry was a live bug rather than a style inconsistency.
    //
    // How it bites: the document query takes the NEWEST row of this kind, so calling /extract
    // again without a documentId re-analyses the SAME row. The stored bytes cannot have changed
    // (storage.ts uploads with `upsert: false`, and every upload inserts a new row), so a
    // different verdict on the second run is MODEL NOISE, not new information — this is a
    // temperature-0 flash model, but the 2026-07-28 production data shows it returning different
    // issue sets for the same subject minutes apart. A stray retry, a double-tap or a flaky
    // network re-issuing the POST could therefore revoke a passed portrait, and because
    // `portrait_image_not_verified` is owned by DM step 1, the applicant would be thrown from
    // wherever they had reached back to Documents, with no way to understand why.
    //
    // ⚠️ IT IS ONE VALUE, USED THREE TIMES. Guarding only the UPDATE would leave the response and
    // the audit event asserting a status the database does not hold, so the client would render a
    // failure the server disagrees with. The event still records what the analysis actually said
    // (`analysedStatus`), so a suppressed downgrade is visible to the desk rather than erased.
    //
    // The rule lives in lib/visa/document-status.ts with its tests — deliberately NOT in
    // image-quality.ts, which is a sync-pair with the forum copy.
    const finalStatus = nextDocumentStatus(document.validation_status, analysedStatus)
    const downgradeSuppressed = finalStatus !== analysedStatus
    const now = new Date().toISOString()

    // ⚠️ WHEN A DOWNGRADE IS SUPPRESSED, THE REPORT IS LEFT ALONE TOO — column and report must
    // never disagree. Writing the new report while forcing the column to 'passed' would store a
    // FAILING report under a PASSED status, and both surfaces read the report: the admin case
    // page renders `validation_report.issues`, and the applicant's card renders them as red
    // bullets — which would appear underneath a green "Verified" badge. The passing report that
    // certified this document stands; the disagreement is recorded on the event instead.
    const documentUpdate = downgradeSuppressed
      ? await db.from('visa_documents').update({ validation_status: finalStatus }).eq('id', document.id)
      : await db.from('visa_documents').update({ validation_status: finalStatus, validation_report: validationReport }).eq('id', document.id)
    if (documentUpdate.error) throw documentUpdate.error
    if (passport) {
      const previousChecklist = Array.isArray(application.checklist) ? application.checklist : []
      const imageIssueCodes = new Set(PASSPORT_IMAGE_CODES)
      // ⚠️ A SUPPRESSED DOWNGRADE MUST NOT LEAK INTO THE CHECKLIST EITHER. The filter strips the
      // old image codes; adding the new ones back would re-open image issues on a document whose
      // stored verdict is still `passed`, which is the same column-vs-report contradiction the
      // write above avoids, one layer up.
      const checklist = [...new Set([...previousChecklist.filter((item: string) => !imageIssueCodes.has(item)), 'ai_extraction_needs_review', ...(downgradeSuppressed ? [] : issues)])]
      const applicationUpdate = await db.from('visa_applications').update({ encrypted_payload: encryptVisaPayload(payload), checklist, updated_at: now, last_applicant_action_at: now }).eq('id', id).eq('user_id', userId).eq('updated_at', application.updated_at).select('id').maybeSingle()
      if (applicationUpdate.error) throw applicationUpdate.error
      // 0-row CAS miss is NOT success (audit P2 #10): a concurrent save raced this
      // merge — without the 409 the client got a success event + merged payload that
      // was never persisted, and the wizard showed fields the server doesn't have.
      if (!applicationUpdate.data) return NextResponse.json({ error: 'application_changed_retry' }, { status: 409 })
    }
    // ⚠️ THE EVENT IS THE ONE PLACE THAT RECORDS WHAT THE ANALYSIS ACTUALLY SAID. Everything else
    // above deliberately keeps the certified verdict, so without this the disagreement would be
    // erased rather than suppressed, and nobody could tell a stable pass from a contested one.
    await recordVisaEvent(id, 'system', passport ? 'passport_analyzed_and_extracted' : 'portrait_analyzed', undefined, {
      documentId: document.id, status: finalStatus, issues: downgradeSuppressed ? [] : issues,
      ...(downgradeSuppressed ? { suppressedDowngradeFrom: analysedStatus, suppressedIssues: issues } : {}),
      fieldsSuggested: Object.keys(suggestions).length, model: analysis.model, attempts: analysis.attempts,
    })
    // The client is told what the SERVER now holds, never what the discarded run said — otherwise
    // the card would paint red issue bullets under a green "Verified" badge.
    return NextResponse.json({
      document: {
        id: document.id,
        validationStatus: finalStatus,
        validationReport: downgradeSuppressed ? existingReport : validationReport,
      },
      payload: passport ? payload : undefined,
      suggestions: Object.keys(suggestions),
      issues: downgradeSuppressed ? [] : issues,
      // ⚠️ WARNINGS ARE GATED LIKE ISSUES. This field used to be returned raw while `issues` and
      // `validationReport` beside it were gated, which broke the rule stated 15 lines above — the
      // client is told what the SERVER holds, never what a discarded run said. It was inert only
      // because portraits hardcoded `warnings: []`; now that they emit real advisory codes, an
      // ungated field would paint fresh amber bullets from a run whose verdict we threw away,
      // beneath a green Verified badge earned by the stored report. Found in review.
      warnings: downgradeSuppressed ? [] : warnings,
    })
  } catch (error) {
    const failure = error as { name?: string; status?: number; code?: number | string }
    const status = aiErrorStatus(error)
    const capacityBusy = status === 429
    console.error('[visa-image-analysis] failed', { kind: parsed.data.kind, name: failure.name || 'Error', status, message: error instanceof Error ? error.message.slice(0, 300) : null })
    const issue = capacityBusy ? 'automatic_image_check_busy' : 'automatic_image_check_failed'
    const validationReport = { ...existingReport, version: VISA_IMAGE_RULES_VERSION, status: 'unavailable', issues: [issue], analyzedAt: new Date().toISOString() }
    await db.from('visa_documents').update({ validation_status: 'unavailable', validation_report: validationReport }).eq('id', document.id).neq('validation_status', 'passed')
    const response = NextResponse.json({ error: capacityBusy ? 'image_analysis_busy' : 'image_analysis_failed' }, { status: capacityBusy ? 429 : 502 })
    if (capacityBusy) response.headers.set('Retry-After', '60')
    return response
  }
}
