import 'server-only'
import { vnptCredentials, vnptHeaders, type VnptCredentials } from './vnpt-auth'

// ── VNPT IDG eKYC client ────────────────────────────────────────────────────────────────────────
//
// Built against the official integration doc (2026-08-03). Base: https://api.idg.vnpt.vn — which
// confirms what the `idgv2-` client-id prefix implied: this is their Identity Gateway v2.
//
// The flow is two-phase and NOT optional: every AI endpoint takes an image HASH, never bytes. You
// upload to /file-service/v1/addFile, receive a hash, and pass that hash onward.
//
// ⚠️⚠️ THE IMAGE LEAVES THE DEVICE. This changes the Tier-B privacy story recorded in
// docs/compliance-2026.md §1.4: local MRZ reading keeps the passport on-device for DATA ENTRY, but
// the moment we use VNPT to make the verification DECISION, the document is uploaded to a third
// party and stored under their retention policy, not ours. That is a defensible trade — they are an
// authorised provider and it is what finally gives Tier B a trust anchor the client cannot forge —
// but the privacy copy on /dashboard/account/verify says "read on your device, not uploaded", and
// that sentence MUST change before this path goes live or it becomes a false statement to users.
//
// ⚠️ SERVER-ONLY. Credentials in a WebView are extractable; every call goes through us.

const BASE = process.env.VNPT_EKYC_BASE_URL || 'https://api.idg.vnpt.vn'

/** VNPT signals success in the BODY, not the HTTP status. See assertOk(). */
export const IDG_SUCCESS = 'IDG-00000000'

export type IdgError = { code: string; detail?: string; transient: boolean }

/**
 * ⚠️ HTTP 200 IS NOT SUCCESS HERE — `message` IS. VNPT returns 200 with
 * `{"message":"IDG-00010102", "errors":[...]}` for a rejected input, so a `res.ok` check passes
 * and the caller happily treats a failure as a verified identity. This is the single most likely
 * way to get this integration wrong, and it fails OPEN, which is the direction that matters.
 */
function assertOk(json: unknown): { ok: true; object: Record<string, unknown> } | { ok: false; error: IdgError } {
  const j = (json ?? {}) as Record<string, unknown>
  const message = typeof j.message === 'string' ? j.message : ''
  if (message === IDG_SUCCESS) {
    return { ok: true, object: (j.object ?? {}) as Record<string, unknown> }
  }
  const errors = Array.isArray(j.errors) ? j.errors.join('; ') : undefined
  return {
    ok: false,
    error: {
      code: message || 'IDG-UNKNOWN',
      detail: errors,
      // ⚠️ A 5xx-shaped failure is US being unable to ASK, not the document being rejected. Those
      // must route to human review, never to `rejected` — see provider.ts.
      transient: String(j.statusCode ?? '').startsWith('5'),
    },
  }
}

/** Network/timeout failures are transient by definition — we never got an answer. */
function transient(reason: string): { ok: false; error: IdgError } {
  return { ok: false, error: { code: 'IDG-TRANSPORT', detail: reason, transient: true } }
}

const TIMEOUT_MS = Number(process.env.VNPT_TIMEOUT_MS || 30_000)

async function post(
  path: string,
  init: { headers: Record<string, string>; body: BodyInit },
): Promise<ReturnType<typeof assertOk>> {
  // ⚠️ ALWAYS BOUND THE CALL. A hung upload on a seller's verification is indistinguishable from a
  // broken one, and an unbounded fetch holds a Cloud Run request slot until the platform kills it.
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}${path}`, { method: 'POST', signal: ctl.signal, ...init })
    const text = await res.text()
    try {
      return assertOk(JSON.parse(text))
    } catch {
      // Non-JSON means a gateway/proxy answered, not VNPT — transient, not a rejection.
      return transient(`non-JSON response (HTTP ${res.status})`)
    }
  } catch (e) {
    return transient(e instanceof Error ? e.message : 'fetch failed')
  } finally {
    clearTimeout(t)
  }
}

/**
 * `client_session` has a PRESCRIBED SHAPE:
 *   <IOS|ANDROID>_<model>_<os>_<Device|Simulator>_<sdk>_<deviceId>_<timestamp>
 *
 * ⚠️ WE ARE A SERVER, NOT A HANDSET, and inventing plausible-looking device fields would put false
 * telemetry into a provider's audit trail — the opposite of what an identity system should do. So
 * the platform slot says WEB and the device slot carries our own opaque request id. It satisfies
 * the format without asserting a device that does not exist.
 */
export function clientSession(requestId: string, nowMs: number): string {
  const safe = requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 32) || 'req'
  return `WEB_enovn_server_Device_1.0.0_${safe}_${nowMs}`
}

export type UploadResult =
  | { ok: true; hash: string; fileType?: string }
  | { ok: false; error: IdgError }

/** Phase 1: upload an image, receive the hash every other endpoint consumes. */
export async function uploadImage(
  bytes: Uint8Array,
  filename: string,
  opts: { title: string; description: string },
  creds?: VnptCredentials,
): Promise<UploadResult> {
  const c = creds ?? vnptCredentials()
  if (!c) return { ok: false, error: { code: 'IDG-NOT-CONFIGURED', transient: true } }

  const form = new FormData()
  form.append('file', new Blob([bytes as unknown as BlobPart]), filename)
  form.append('title', opts.title)
  form.append('description', opts.description)

  // ⚠️ NO Content-Type HEADER. fetch must set it itself so the multipart BOUNDARY is included;
  // setting 'multipart/form-data' by hand omits the boundary and the upload fails as malformed.
  const headers = vnptHeaders(c, await accessToken())
  const r = await post('/file-service/v1/addFile', { headers, body: form })
  if (!r.ok) return r
  const hash = typeof r.object.hash === 'string' ? r.object.hash : ''
  if (!hash) return { ok: false, error: { code: 'IDG-NO-HASH', detail: 'upload succeeded without a hash', transient: true } }
  return { ok: true, hash, fileType: typeof r.object.fileType === 'string' ? r.object.fileType : undefined }
}

/** Document types VNPT's classifier returns. 5 = passport, which is what Tier B needs. */
export const DOC_TYPE = {
  0: 'cccd_old_front', 1: 'cccd_old_back', 2: 'cccd_new_front', 3: 'cccd_new_back',
  4: 'other', 5: 'passport', 6: 'driver_license_front', 7: 'military_front', 8: 'military_back',
} as const

export type ClassifyResult =
  | { ok: true; type: number; kind: string; name: string }
  | { ok: false; error: IdgError }

/** Phase 2 (example): classify the uploaded document. */
export async function classifyDocument(
  imgHash: string,
  requestId: string,
  nowMs: number,
  creds?: VnptCredentials,
): Promise<ClassifyResult> {
  const c = creds ?? vnptCredentials()
  if (!c) return { ok: false, error: { code: 'IDG-NOT-CONFIGURED', transient: true } }

  const r = await post('/ai/v1/classify/id', {
    headers: {
      ...vnptHeaders(c, await accessToken()),
      'Content-Type': 'application/json',
      // ⚠️ Required by the AI endpoints (not by addFile). We are a server with no MAC to report;
      // the doc's own example is the literal `TEST1`, so this is an identifier slot, not a real
      // hardware address. Overridable per-environment so prod and staging are distinguishable
      // in VNPT's transaction history.
      'mac-address': process.env.VNPT_MAC_ADDRESS || 'ENOVN',
    },
    body: JSON.stringify({
      img_card: imgHash,
      client_session: clientSession(requestId, nowMs),
      // "String of random characters (can not use special characters)".
      token: requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 32),
    }),
  })
  if (!r.ok) return r
  const type = Number(r.object.type)
  if (!Number.isFinite(type)) return { ok: false, error: { code: 'IDG-BAD-TYPE', transient: false } }
  return {
    ok: true,
    type,
    kind: DOC_TYPE[type as keyof typeof DOC_TYPE] ?? 'unknown',
    name: typeof r.object.name === 'string' ? r.object.name : '',
  }
}

/**
 * ⚠️ STILL THE BLOCKER, AND THE OFFICIAL DOC CONFIRMS IT.
 * "Step 2. Access Token Management, get the Token Key, Token ID, Access token" — the documented
 * way to obtain an access token is to COPY IT FROM THE CONSOLE BY HAND. There is no minting
 * endpoint in the public API list, and the console states the token expires in 8 hours.
 *
 * That is not operable: seller verification would break three times a day at unpredictable hours,
 * with a 401 indistinguishable from a bad credential. The "API sinh Access Token" must be requested
 * from VNPT (the console's Liên hệ link) before Tier A or Tier B can go live.
 *
 * Until then this reads a manually-set env var so the integration is testable end-to-end, and
 * throws a NAMED error rather than a generic 401 when it is stale — so the failure says what it is.
 */
async function accessToken(): Promise<string> {
  const t = process.env.VNPT_EKYC_ACCESS_TOKEN
  if (!t) {
    throw new Error(
      'VNPT_EKYC_ACCESS_TOKEN is not set. VNPT has no documented token-minting endpoint — request ' +
      'the "API sinh Access Token" from them; a hand-copied 8h token cannot run in production.',
    )
  }
  return t
}

// ── Document authenticity (API 3) ───────────────────────────────────────────────────────────────
//
// ⚠️⚠️ THIS IS THE TIER-B TRUST ANCHOR I SAID WAS MISSING, AND IT CHANGES THE DESIGN.
// docs/compliance-2026.md §1.4 records that local MRZ reading proves only that we READ correctly,
// never that the document is GENUINE — check digits are a mod-10 sum, so a forged MRZ passes.
// `/ai/v1/card/liveness` answers a different question: was this photographed from a REAL physical
// document, or from a screen / a printout / a doctored image. Combined with `tampering.is_legal`
// and `id_fake_warning` from the OCR call, Tier B finally has evidence a client cannot author.
//
// It is still NOT a registry check — nothing here says "this passport was issued and is not
// reported stolen", and no such check is available to private operators. The accepted-risk record
// in verify-decision.ts stays exactly as it is; this raises the floor, it does not remove the gap.

export type LivenessResult =
  | { ok: true; real: boolean; message: string; faceSwapping: boolean; recaptured: boolean }
  | { ok: false; error: IdgError }

export async function checkDocumentLiveness(
  imgHash: string,
  requestId: string,
  nowMs: number,
  creds?: VnptCredentials,
): Promise<LivenessResult> {
  const c = creds ?? vnptCredentials()
  if (!c) return { ok: false, error: { code: 'IDG-NOT-CONFIGURED', transient: true } }

  const r = await post('/ai/v1/card/liveness', {
    headers: { ...vnptHeaders(c, await accessToken()), 'Content-Type': 'application/json', 'mac-address': macAddress() },
    body: JSON.stringify({ img: imgHash, client_session: clientSession(requestId, nowMs) }),
  })
  if (!r.ok) return r
  // ⚠️ THREE INDEPENDENT SIGNALS, ALL OF WHICH MUST BE CLEAN. `liveness: "success"` alone is not
  // enough: the payload separately reports `fake_liveness` (a re-capture — a photo of a screen) and
  // `face_swapping` (the portrait replaced). Reading only the headline field would accept a
  // document that the provider itself flagged as manipulated.
  const real = String(r.object.liveness) === 'success'
    && r.object.fake_liveness !== true
    && r.object.face_swapping !== true
  return {
    ok: true,
    real,
    message: typeof r.object.liveness_msg === 'string' ? r.object.liveness_msg : '',
    faceSwapping: r.object.face_swapping === true,
    recaptured: r.object.fake_liveness === true,
  }
}

function macAddress() { return process.env.VNPT_MAC_ADDRESS || 'ENOVN' }

// ── OCR (APIs 4–6) ──────────────────────────────────────────────────────────────────────────────

/** `type` values the OCR endpoints accept. -1 covers both old and new Vietnamese ID cards. */
export const OCR_TYPE = { idCard: -1, passport: 5, driverLicense: 6, military: 7 } as const

export type OcrField = { value: string; confidence: number | null }
export type OcrResult =
  | {
      ok: true
      /** Absent fields are omitted, never returned as the literal "-". See extractField(). */
      fields: Record<string, OcrField>
      cardType: string
      /** Provider's own verdicts — these are the authenticity signals, not the OCR text. */
      legal: boolean
      fakeWarning: boolean
      expiryWarning: boolean
      /** Image-quality warnings, paired with their human messages for the retry hint. */
      warnings: { code: string; message: string }[]
    }
  | { ok: false; error: IdgError }

/**
 * ⚠️ `"-"` WITH `prob: 0` MEANS *NOT PRESENT*, NOT *LOW CONFIDENCE* — and conflating them rejects
 * valid documents. The doc's own sample shows `gender: "-", gender_prob: 0` and
 * `nationality: "-", nationality_prob: 0` on a perfectly good ID card: those fields simply do not
 * exist on that card type. A naive `if (prob < threshold) reject` fails every such document.
 * Absent → omitted from `fields`. Present-but-uncertain → included, with its confidence, so the
 * DECISION layer can apply a threshold to fields that actually exist.
 */
function extractField(obj: Record<string, unknown>, key: string): OcrField | null {
  const raw = obj[key]
  if (typeof raw !== 'string' || raw === '' || raw === '-') return null
  const prob = obj[`${key}_prob`]
  return { value: raw, confidence: typeof prob === 'number' ? prob : null }
}

const OCR_FIELDS = [
  'id', 'name', 'birth_day', 'gender', 'nationality', 'valid_date',
  'issue_date', 'issue_place', 'origin_location', 'recent_location', 'citizen_id',
] as const

export async function ocrDocument(
  input: { imgFront: string; imgBack?: string; type: number; validatePostcode?: boolean },
  requestId: string,
  nowMs: number,
  creds?: VnptCredentials,
): Promise<OcrResult> {
  const c = creds ?? vnptCredentials()
  if (!c) return { ok: false, error: { code: 'IDG-NOT-CONFIGURED', transient: true } }

  // API 6 (front+back) when a back image exists, otherwise API 4 (front only). A passport has no
  // back side, so Tier B always takes the front-only path.
  const path = input.imgBack ? '/ai/v1/ocr/id' : '/ai/v1/ocr/id/front'
  const token = requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 32)
  const body: Record<string, unknown> = {
    img_front: input.imgFront,
    client_session: clientSession(requestId, nowMs),
    type: input.type,
    token,
    validate_postcode: input.validatePostcode ?? false,
  }
  if (input.imgBack) body.img_back = input.imgBack

  const r = await post(path, {
    headers: { ...vnptHeaders(c, await accessToken()), 'Content-Type': 'application/json', 'mac-address': macAddress() },
    body: JSON.stringify(body),
  })
  if (!r.ok) return r
  const o = r.object

  const fields: Record<string, OcrField> = {}
  for (const k of OCR_FIELDS) {
    const f = extractField(o, k)
    if (f) fields[k] = f
  }

  // ⚠️ PAIR warning CODES WITH THEIR MESSAGES BY INDEX. The API returns two parallel arrays
  // (`warning` + `warning_msg`); dropping either leaves the user with an untranslatable code or an
  // unloggable sentence. "anh_dau_vao_mo_nhoe" tells us the photo was blurry — that is the retry
  // hint that makes a second attempt succeed, and it is worthless if we keep only one array.
  const codes = Array.isArray(o.warning) ? o.warning.map(String) : []
  const msgs = Array.isArray(o.warning_msg) ? o.warning_msg.map(String) : []
  const warnings = codes.map((code, i) => ({ code, message: msgs[i] ?? '' }))

  const tampering = (o.tampering ?? {}) as Record<string, unknown>
  return {
    ok: true,
    fields,
    cardType: typeof o.card_type === 'string' ? o.card_type : '',
    // ⚠️ DEFAULT TO NOT-LEGAL WHEN THE FIELD IS ABSENT. A missing verdict is not a pass; treating
    // an unparseable/omitted `tampering` block as clean would accept exactly the response shape a
    // partial failure produces.
    legal: String(tampering.is_legal ?? 'no') === 'yes',
    fakeWarning: String(o.id_fake_warning ?? 'yes') !== 'no',
    expiryWarning: String(o.expire_warning ?? 'no') !== 'no' || String(o.back_expire_warning ?? 'no') !== 'no',
    warnings,
  }
}

// ── Face binding (APIs 7, 8, 9) ─────────────────────────────────────────────────────────────────
//
// ⚠️⚠️ APIs 10–13 ARE DELIBERATELY NOT IMPLEMENTED, AND THAT IS AN ARCHITECTURAL DECISION.
// /face-service/face/{add,verify,search,search-k} ENROL a person into VNPT's searchable biometric
// database — a face template stored permanently against their passport or CCCD number, retrievable
// by similarity search. We do not need it: /ai/v1/face/compare (API 7) answers the only question
// seller verification asks — "is the person holding the camera the person on this document?" —
// STATELESSLY, comparing two images we supply and keeping nothing.
//
// Enrolling every eno.vn seller in a third-party face-search index would be a far larger data
// commitment than the obligation requires, it is biometric data under Vietnam's personal-data
// regime, and it is irreversible in a way document images are not (we can delete an image; we
// cannot un-enrol a template from someone else's index). Proportionality is the test. If enrolment
// is ever wanted, it needs its own legal basis, its own consent, and its own entry in
// docs/compliance-2026.md §4.2 — not a quiet reuse of this client.

export type FaceMatchResult =
  | { ok: true; match: boolean; probability: number; message: string }
  | { ok: false; error: IdgError }

/**
 * API 7 — compare the portrait on the document against a live selfie.
 *
 * ⚠️ TRUST `msg`, NOT OUR OWN THRESHOLD ON `prob`. The doc states msg is decided "according to the
 * recommended threshold of VNPT" — they calibrate it against their model. Inventing our own cutoff
 * on a number whose scale and distribution we do not control is how you get both false rejections
 * of real expats and false acceptances of near-matches. `prob` is recorded as EVIDENCE, not used
 * as the decision.
 * ⚠️ `prob` IS 0–100, NOT 0–1 — the doc's own NOMATCH example is 58.26. Treating it as a fraction
 * would make every comparison look like a certainty.
 */
export async function compareFaces(
  imgFrontHash: string,
  imgFaceHash: string,
  requestId: string,
  nowMs: number,
  creds?: VnptCredentials,
): Promise<FaceMatchResult> {
  const c = creds ?? vnptCredentials()
  if (!c) return { ok: false, error: { code: 'IDG-NOT-CONFIGURED', transient: true } }
  const r = await post('/ai/v1/face/compare', {
    headers: { ...vnptHeaders(c, await accessToken()), 'Content-Type': 'application/json', 'mac-address': macAddress() },
    body: JSON.stringify({
      img_front: imgFrontHash,
      img_face: imgFaceHash,
      client_session: clientSession(requestId, nowMs),
      token: requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 32),
    }),
  })
  if (!r.ok) return r
  return {
    ok: true,
    match: String(r.object.msg).toUpperCase() === 'MATCH',
    probability: typeof r.object.prob === 'number' ? r.object.prob : 0,
    message: typeof r.object.result === 'string' ? r.object.result : '',
  }
}

export type FaceLivenessResult =
  | { ok: true; real: boolean; eyesOpen: boolean; message: string }
  | { ok: false; error: IdgError }

/**
 * API 8 — is the selfie a live human, or a photo of a photo?
 *
 * ⚠️ WITHOUT THIS, FACE COMPARE IS DEFEATED BY A PRINTOUT. Someone holding a stolen passport can
 * photograph the portrait page and submit that same portrait as their "selfie" — the two images
 * match perfectly. Liveness is what makes the binding mean anything, so a compare result must
 * never be accepted without it.
 */
export async function checkFaceLiveness(
  imgHash: string,
  requestId: string,
  nowMs: number,
  creds?: VnptCredentials,
): Promise<FaceLivenessResult> {
  const c = creds ?? vnptCredentials()
  if (!c) return { ok: false, error: { code: 'IDG-NOT-CONFIGURED', transient: true } }
  const r = await post('/ai/v1/face/liveness', {
    headers: { ...vnptHeaders(c, await accessToken()), 'Content-Type': 'application/json', 'mac-address': macAddress() },
    body: JSON.stringify({
      img: imgHash,
      client_session: clientSession(requestId, nowMs),
      token: requestId.replace(/[^A-Za-z0-9]/g, '').slice(0, 32),
    }),
  })
  if (!r.ok) return r
  return {
    ok: true,
    real: String(r.object.liveness) === 'success',
    // ⚠️ Advisory, NOT a rejection. Closed eyes correlate with a photo-of-a-photo, but they also
    // happen to people who blink — and refusing a real seller for blinking is the kind of false
    // positive this platform's launch posture explicitly rejects. Surface it as a retry hint.
    eyesOpen: String(r.object.is_eye_open ?? 'yes') === 'yes',
    message: typeof r.object.liveness_msg === 'string' ? r.object.liveness_msg : '',
  }
}

export type FaceMaskResult = { ok: true; masked: boolean } | { ok: false; error: IdgError }

/** API 9 — is the face obstructed? Advisory: drives "remove your mask and retake", not a rejection. */
export async function checkFaceMask(
  imgHash: string,
  requestId: string,
  nowMs: number,
  creds?: VnptCredentials,
): Promise<FaceMaskResult> {
  const c = creds ?? vnptCredentials()
  if (!c) return { ok: false, error: { code: 'IDG-NOT-CONFIGURED', transient: true } }
  const r = await post('/ai/v1/face/mask', {
    headers: { ...vnptHeaders(c, await accessToken()), 'Content-Type': 'application/json', 'mac-address': macAddress() },
    body: JSON.stringify({ img: imgHash, client_session: clientSession(requestId, nowMs) }),
  })
  if (!r.ok) return r
  return { ok: true, masked: String(r.object.masked) === 'yes' }
}
