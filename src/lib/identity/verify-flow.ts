import 'server-only'
import { uploadImage, checkDocumentLiveness, ocrDocument, compareFaces, checkFaceLiveness, OCR_TYPE, type IdgError } from './vnpt-client'
import { reserveQuota, releaseQuota } from './quota'
import { decideTierB, type ProviderSignals, type TierBDecision } from './verify-decision'

// ── The verification flow, both tiers ───────────────────────────────────────────────────────────
//
// ⚠️ ONE FLOW SERVES BOTH TIERS, and reading the API docs is what made that obvious. Tier A (CCCD)
// and Tier B (passport) hit the SAME endpoints — /file-service/addFile, /ai/v1/card/liveness,
// /ai/v1/ocr/id, /ai/v1/face/compare — differing only in the `type` value (-1 vs 5) and whether a
// back image exists. The earlier design had them as separate integrations, which would have been
// two code paths drifting apart around one provider. `provider.ts`'s "do not ship Tier A until the
// mapping is checked" note is now discharged: the mapping is the same mapping.
//
// ⚠️ THE ORDER IS DELIBERATE — CHEAPEST AND MOST DECISIVE FIRST.
//   1. quota reservation  — costs nothing, and refusing here spends no VNPT call at all
//   2. upload             — required before anything else can reference the image
//   3. document liveness  — an affirmative forgery signal; no point OCRing a screen photo
//   4. OCR                — the fields, plus tampering/fake verdicts
//   5. face liveness      — is the selfie a person
//   6. face compare       — is that person the document holder
// Each step that fails stops the rest, so a forged document costs three calls rather than six.

export type VerifyInput = {
  tier: 'A' | 'B'
  documentFront: Uint8Array
  /** CCCD has a back; a passport does not. */
  documentBack?: Uint8Array
  portrait: Uint8Array
  accountName: string
  residenceExpiresAt?: Date | null
  requestId: string
}

export type VerifyOutcome =
  | { status: 'verified' | 'rejected' | 'pending'; decision: TierBDecision; signals?: ProviderSignals }
  /** ⚠️ We could not ASK. Never a rejection of the person — see provider.ts. */
  | { status: 'unavailable'; reason: string; error?: IdgError }

const unavailable = (reason: string, error?: IdgError): VerifyOutcome => ({ status: 'unavailable', reason, error })

export async function runVerification(input: VerifyInput, now: Date = new Date()): Promise<VerifyOutcome> {
  const nowMs = now.getTime()
  const rid = input.requestId

  // 1. Quota. ⚠️ RESERVE ONE UNIT PER BILLABLE REQUEST, NOT ONE PER VERIFICATION — codex caught
  //    this. A single verification makes SIX or SEVEN VNPT calls (2-3 uploads + document liveness +
  //    OCR + face liveness + face compare), so reserving one unit undercounts the free tier by ~6x
  //    and we would discover exhaustion by 429 rather than by our own accounting.
  const calls = input.documentBack ? 7 : 6
  const res = await reserveQuota(now, calls)
  if (!res.ok) {
    return unavailable(res.reason === 'exhausted'
      ? 'monthly eKYC quota exhausted'
      : 'eKYC quota not configured (VNPT_MONTHLY_QUOTA unset)')
  }

  // ⚠️ RELEASE ON EVERY PATH THAT NEVER BILLED A CALL. A `return` inside the block below that
  // forgets this silently burns quota, and the symptom appears weeks later as premature exhaustion
  // with no way to trace which path leaked.
  // ⚠️ RELEASE ONLY WHAT WAS NEVER SPENT, AND DO IT IN `finally`. Two separate bugs codex found:
  // a `return` that forgets the release silently burns quota, and a THROWN error leaks the whole
  // reservation permanently — both surface weeks later as premature exhaustion with no way to
  // trace which path leaked. `spent` counts requests VNPT actually processed; a processed-but-
  // rejected request is still billed, so it counts.
  let spent = 0
  try {
    return await attempt()
  } finally {
    const unspent = calls - spent
    if (unspent > 0) await releaseQuota(now, unspent)
  }

  async function attempt(): Promise<VerifyOutcome> {
  const up = await uploadImage(input.documentFront, 'front.jpg', { title: 'identity', description: `tier ${input.tier} front` })
  spent++ // the request reached VNPT and is billed whether it succeeded or not
  if (!up.ok) return unavailable('document upload failed', up.error)

  const portrait = await uploadImage(input.portrait, 'face.jpg', { title: 'identity', description: 'portrait' })
  spent++
  if (!portrait.ok) return unavailable('portrait upload failed', portrait.error)

  let backHash: string | undefined
  if (input.documentBack) {
    const back = await uploadImage(input.documentBack, 'back.jpg', { title: 'identity', description: 'back' })
    spent++
  if (!back.ok) return unavailable('document back upload failed', back.error)
    backHash = back.hash
  }

  // 3. Is the document a real physical object?
  const live = await checkDocumentLiveness(up.hash, rid, nowMs)
  spent++
  if (!live.ok) return unavailable('document liveness check failed', live.error)

  // 4. OCR — fields plus the provider's own tampering/fake verdicts.
  const ocr = await ocrDocument(
    { imgFront: up.hash, imgBack: backHash, type: input.tier === 'B' ? OCR_TYPE.passport : OCR_TYPE.idCard, validatePostcode: input.tier === 'A' },
    rid, nowMs,
  )
  spent++
  if (!ocr.ok) return unavailable('document OCR failed', ocr.error)

  // 5 + 6. Face: alive, then the same person.
  const faceLive = await checkFaceLiveness(portrait.hash, rid, nowMs)
  spent++
  if (!faceLive.ok) return unavailable('face liveness check failed', faceLive.error)
  const match = await compareFaces(up.hash, portrait.hash, rid, nowMs)
  spent++
  if (!match.ok) return unavailable('face comparison failed', match.error)

  const signals: ProviderSignals = {
    documentIsReal: live.real,
    legal: ocr.legal,
    fakeWarning: ocr.fakeWarning,
    faceMatches: match.match,
    faceIsLive: faceLive.real,
  }

  // ⚠️ FIELDS STRAIGHT FROM THE PROVIDER — NO FAKED MRZ STRUCT. An earlier version built a
  // PassportMrzResult with `parsePassportMrz('', '')` and forced `valid: true`, which turned the
  // decision's check-digit guard into a no-op while still looking like it ran. Both codex and agy
  // caught it. VNPT's OCR is the source here, so `mrzValid` is FALSE: no check digits were
  // verified, and the decision records a correspondingly honest assurance level.
  const fullName = ocr.fields.name?.value ?? ''
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  // ⚠️ VIETNAMESE NAME ORDER IS SURNAME-FIRST ("NGUYỄN QUANG HUY"), WESTERN IS SURNAME-LAST.
  // namesCorrespond() compares token SETS, so the split only has to be consistent, not correct —
  // but the surname must be a real token or the surname-present check fails for everyone.
  const surname = input.tier === 'A' ? (parts[0] ?? '') : (parts[parts.length - 1] ?? '')
  const givenNames = input.tier === 'A' ? parts.slice(1).join(' ') : parts.slice(0, -1).join(' ')

  const decision = decideTierB({
    tier: input.tier,
    surname,
    givenNames,
    documentExpiry: toIsoDate(ocr.fields.valid_date?.value),
    mrzValid: false,
    accountName: input.accountName,
    residenceExpiresAt: input.residenceExpiresAt,
    provider: signals,
    now,
  })

  return { status: decision.status, decision, signals }
  }
}

/**
 * VNPT returns dates as DD/MM/YYYY; the decision layer parses ISO.
 *
 * ⚠️ DD/MM, NOT MM/DD. `new Date("02/01/2030")` is 2 January in Vietnam and 1 February in a US
 * locale — a silent ~11-month error in an EXPIRY check, in the direction that accepts documents
 * that have already lapsed. Parsed positionally rather than handed to the Date constructor.
 */
function toIsoDate(v: string | undefined): string | undefined {
  if (!v) return undefined
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined
}

export { toIsoDate as __toIsoDate }
