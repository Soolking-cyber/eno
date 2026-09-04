'use client'

// ── Identity verification — the declaration gate ─────────────────────────────────────────────────
//
// This route already had a caller before it had a page: `publishBlockedBody()` sends every blocked
// seller to /dashboard/account/verify, and until now that was a 404. A gate that refuses someone
// and then points them at a dead link is worse than no gate — it reads as the site being broken,
// on the one screen where we are asking for trust and identity documents.
//
// docs/compliance-2026.md §1. Declaration text + hashing: src/lib/compliance/declaration.ts.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Fingerprint, IdCard, ShieldCheck, Camera, User, Pencil, ChevronLeft } from "@/components/ui/icons"
import { StepWizard, type WizardStep } from '@/components/ui/step-wizard'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SectionHeader } from '@/components/marketplace/section-header'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Loader2 } from '@/components/ui/icons'
import { KycCapture } from '@/components/marketplace/kyc-capture'
import { readMrz, readFailureHint, namesFromNameLine, hasWellFormedPrefix, type MrzFieldPool } from '@/lib/identity/mrz-ocr'
// ⚠️ Via the identity boundary, NEVER '@/lib/visa/mrz' directly — KYC code routes MRZ parsing through
// `@/lib/identity/mrz` (which re-exports it) so the visa namespace never appears in a marketplace call
// site (agy, 2026-09-02). See the header of src/lib/identity/mrz.ts.
import { parsePassportMrz } from '@/lib/identity/mrz'
import { createMrzOcrEngine } from '@/lib/identity/mrz-ocr-tesseract'
// ⛔ `declaration-text`, NOT `declaration` — the latter imports node:crypto, and a 'use client'
// file importing it drags the whole Node crypto polyfill into the browser (measured: 435 KB
// raw / 130 KB gzip, 44% of this route's JS). The text module exists for exactly this import.
import { DECLARATIONS, CURRENT_DECLARATION } from '@/lib/compliance/declaration-text'
import { LEGAL_BASIS } from '@/lib/compliance/legal-basis'
// ⛔ EDITION-AWARE BRANDING, NOT A LITERAL. This file compiles into BOTH editions, and edition.ts
// exists because 58 hardcoded "| eno.vn" titles once put the LICENSED company's name on every
// eno.forum page. Copy that tells a seller to email ${COMPANY.email}, or names the account they already
// verified, is the same leak in a sentence (agy).
import { SITE_NAME } from '@/lib/edition'
// ⛔ `COMPANY.email`, NEVER A LITERAL AND NEVER `${COMPANY.email}`. site-legal.ts already owns the
// per-edition support mailbox, and its header records why: eno.forum once handed readers the
// marketplace's address, and these two fields now carry BINDING published commitments with deadlines
// attached (the PDPL contact, the complaint SLA). Composing an address from the brand name would fork
// that decision into a second place and could point a forum seller at an unprovisioned mailbox
// (agy + fable). One constant, one inbox.
import { COMPANY } from '@/lib/site-legal'

/**
 * Turn the still-missing MRZ fields into an actionable hint after a PARTIAL read: this capture read some
 * fields with valid check digits but not all. Each capture is self-contained (no cross-capture pooling),
 * so the honest guidance is to type the two lines — not to "capture again". Returns null when nothing was
 * recovered, so the UI shows the plain "type the two lines" fallback.
 */
function missingFieldsHint(
  missing: Array<'passportNumber' | 'dateOfBirth' | 'expiry'>,
  pool: MrzFieldPool,
): { en: string; vi: string } | null {
  const gotSomething = !!(pool.passportNumber || pool.dateOfBirth || pool.expiry || pool.nameLine)
  if (!gotSomething || missing.length === 0) return null
  const names: Record<'passportNumber' | 'dateOfBirth' | 'expiry', { en: string; vi: string }> = {
    passportNumber: { en: 'the passport number', vi: 'số hộ chiếu' },
    dateOfBirth: { en: 'the date of birth', vi: 'ngày sinh' },
    expiry: { en: 'the expiry date', vi: 'ngày hết hạn' },
  }
  const join = (arr: string[], sep: string) =>
    arr.length <= 1 ? (arr[0] ?? '') : `${arr.slice(0, -1).join(', ')}${sep}${arr[arr.length - 1]}`
  const en = join(missing.map((m) => names[m].en), ' and ')
  const vi = join(missing.map((m) => names[m].vi), ' và ')
  return {
    en: `We read part of your passport but not ${en}. Please check the fields above and type the two lines below.`,
    vi: `Chúng tôi chỉ đọc được một phần hộ chiếu, chưa có ${vi}. Vui lòng kiểm tra các ô ở trên và nhập hai dòng bên dưới.`,
  }
}

/**
 * What each submit refusal actually MEANS to the seller, and whether starting again can help.
 *
 * ⚠️ THE ROUTE'S OWN HEADER ASKS FOR THIS IN AS MANY WORDS — "EVERY CODE NEEDS BILINGUAL COPY AT THE
 * CALL SITE ... a bare code renders as a dead end" — and until now the call site had one sentence for
 * all ten. `terminal: true` means a fresh attempt CANNOT change the answer, so the flow says so
 * instead of inviting a retake that burns one of the seller's five daily submissions.
 * ⛔ Codes deliberately absent (challenge_missing / challenge_mismatch / path_not_owned /
 * tier_mismatch) describe a client bug or a probe, not anything a seller can act on; they keep the
 * generic "start again", which for those is the correct advice.
 */
/** Refusals the server returns BEFORE consuming the challenge, so the attempt is still alive and
 *  `resetAttempt()` must NOT run — it would clear a valid challenge and both uploaded photographs
 *  over something the seller can fix in the field in front of them. ⚠️ Only codes checked ahead of
 *  `consumeChallenge` belong here; everything else really has spent the code. */
const KEEPS_THE_ATTEMPT = new Set(['document_number_invalid'])

const SUBMIT_OUTCOMES: Record<string, { en: string; vi: string; enA?: string; viA?: string; terminal?: boolean; resumable?: boolean }> = {
  already_pending: {
    terminal: true,
    en: 'You already have a verification with us and a reviewer is looking at it. There is nothing more to send — we will email you the result, usually within a working day.',
    vi: 'Bạn đã có một hồ sơ xác minh và nhân viên của chúng tôi đang xem xét. Bạn không cần gửi thêm — chúng tôi sẽ gửi email kết quả, thường trong một ngày làm việc.',
  },
  duplicate_identity: {
    terminal: true,
    resumable: true, // they may need to try the OTHER document, or a different tier
    en: `This document is already verified on another ${SITE_NAME} account. If that account is yours, sign in with it instead. If it is not, please email ${COMPANY.email} — do not send the document again.`,
    vi: `Giấy tờ này đã được xác minh trên một tài khoản ${SITE_NAME} khác. Nếu đó là tài khoản của bạn, hãy đăng nhập bằng tài khoản đó. Nếu không, vui lòng gửi email tới ${COMPANY.email} — đừng gửi lại giấy tờ.`,
  },
  rejected: {
    terminal: true,
    resumable: true, // a renewed passport is a genuinely different attempt
    en: `We cannot accept this document. A passport must still be valid for at least six months, and the name on it has to correspond to your account name. Check both — sending the same document again will get the same answer. If you believe this is wrong, email ${COMPANY.email}.`,
    vi: `Chúng tôi không thể chấp nhận giấy tờ này. Hộ chiếu phải còn hiệu lực ít nhất sáu tháng và tên trên hộ chiếu phải tương ứng với tên tài khoản của bạn. Hãy kiểm tra cả hai — gửi lại cùng giấy tờ sẽ nhận kết quả như cũ. Nếu bạn cho rằng đây là nhầm lẫn, hãy gửi email tới ${COMPANY.email}.`,
    // ⚠️ TIER A GETS ITS OWN WORDS. A CCCD has no six-month rule and no machine-readable lines, so the
    // passport copy above would hand a Vietnamese seller instructions they cannot act on (fable).
    enA: `We cannot accept this document. The name on it has to correspond to your account name, and the card must be current. Check both — sending the same document again will get the same answer. If you believe this is wrong, email ${COMPANY.email}.`,
    viA: `Chúng tôi không thể chấp nhận giấy tờ này. Tên trên giấy tờ phải tương ứng với tên tài khoản của bạn và thẻ phải còn hiệu lực. Hãy kiểm tra cả hai — gửi lại cùng giấy tờ sẽ nhận kết quả như cũ. Nếu bạn cho rằng đây là nhầm lẫn, hãy gửi email tới ${COMPANY.email}.`,
  },
  rate_limited: {
    terminal: true,
    en: 'You have reached the limit of five verification attempts a day. Please try again tomorrow — your photographs were not the problem.',
    vi: 'Bạn đã đạt giới hạn năm lần gửi xác minh mỗi ngày. Vui lòng thử lại vào ngày mai — ảnh của bạn không phải là vấn đề.',
  },
  document_number_invalid: {
    // ⚠️ NAMES THE FIELD, NOT THE CAMERA. This used to arrive as `document_unreadable`, whose copy
    // says "photograph the card again" — for a number the seller TYPED. The web form now blocks this
    // before submit, so reaching here means another client; say something actionable anyway.
    en: 'That CCCD number does not look right — it should be the 12 digits printed on your card. Please check it and send again.',
    vi: 'Số CCCD chưa đúng — cần đủ 12 chữ số như in trên thẻ. Vui lòng kiểm tra và gửi lại.',
    resumable: true,
  },
  document_unreadable: {
    en: 'We could not read the details from what was sent, so we cleared the form. Start again and photograph the data page so the two lines of code across the bottom are sharp and completely inside the frame.',
    vi: 'Chúng tôi không đọc được thông tin từ ảnh đã gửi nên đã xóa biểu mẫu. Hãy bắt đầu lại và chụp trang thông tin sao cho hai dòng mã ở dưới cùng rõ nét và nằm trọn trong khung.',
    enA: 'We could not read the details from what was sent, so we cleared the form. Start again and photograph the side of the card with your photo on it, sharp and completely inside the frame.',
    viA: 'Chúng tôi không đọc được thông tin từ ảnh đã gửi nên đã xóa biểu mẫu. Hãy bắt đầu lại và chụp mặt thẻ có ảnh của bạn, rõ nét và nằm trọn trong khung.',
  },
  challenge_expired: {
    en: 'Your code expired before this was sent, so we cleared the form. Please start again — a fresh code takes a moment.',
    vi: 'Mã của bạn đã hết hạn trước khi gửi nên chúng tôi đã xóa biểu mẫu. Vui lòng bắt đầu lại — lấy mã mới rất nhanh.',
  },
  identity_hashing_unavailable: {
    // ⚠️ It says the photographs are gone, and it says the retry is not free. "Try again in a few
    // minutes" on its own reads as one tap, when it is in fact both photographs again and one of the
    // five submissions a day (fable).
    en: 'Verification is temporarily unavailable on our side — there is nothing wrong with your documents, but the form has been cleared. Please try again in a few minutes; you have five verification attempts a day.',
    vi: 'Hệ thống xác minh tạm thời không khả dụng từ phía chúng tôi — giấy tờ của bạn không có vấn đề gì, nhưng biểu mẫu đã bị xóa. Vui lòng thử lại sau vài phút; bạn có năm lần gửi xác minh mỗi ngày.',
  },
}

export function VerifyClient() {
  const { tr, lang } = useLanguage()
  const { user, loading } = useAuth()
  const userId = user?.id // ⚠️ the effect below keys on the ID, never the object — see its note
  const router = useRouter()
  const [accepted, setAccepted] = useState(false)
  const [tier, setTier] = useState<'A' | 'B' | null>(null)
  /**
   * ⛔ THE CHALLENGE IS ALSO THE CONSENT RECEIPT. Issuing one requires the declaration, and
   * `/api/seller/identity/documents` refuses without a live challenge — so nothing can be uploaded
   * before the affirmation is recorded. Both plan reviewers refused the design that wrote the
   * declaration at submit: `KycCapture` uploads each image the moment it is taken, so consent has
   * to precede the collection, not the submission.
   */
  const [challenge, setChallenge] = useState<{ code: string; expiresAt: string } | null>(null)
  const [starting, setStarting] = useState(false)
  const [documentPath, setDocumentPath] = useState<string | null>(null)
  const [selfiePath, setSelfiePath] = useState<string | null>(null)
  const [surname, setSurname] = useState('')
  const [givenNames, setGivenNames] = useState('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [documentExpiry, setDocumentExpiry] = useState('')
  const [mrzLine1, setMrzLine1] = useState('')
  /// ⛔ TWO SEPARATE FACTS, AND ONE FLAG FOR BOTH WAS THE BUG. `mrzDerived` = the values in the two
  /// boxes came from a READ (so they are synthesized and will not match the passport character for
  /// character); `mrzRevealed` = the seller asked to see them anyway. Collapsing keyed on a single
  /// flag made the explanatory copy flip to "these are derived" on the first keystroke of the MANUAL
  /// path — the opposite of what that seller needs to be told.
  /// ⚠️ NEITHER is `mrzValid`: that flips the instant the last character is typed, which would
  /// unmount the inputs under the seller's fingers (the same bug, caught on iOS today).
  const [mrzDerived, setMrzDerived] = useState(false)
  const [mrzRevealed, setMrzRevealed] = useState(false)
  /// ⛔ "TYPED IN THESE TWO BOXES", WHICH IS NOT WHAT `userEditedRef` MEANS. That ref is set by every
  /// field on the form — it gates whether a later read may prefill the NAME inputs — so keying the
  /// collapse on it meant a seller who typed their surname while the read was still running got the
  /// derived lines shown under "type exactly as printed": the original bug, reachable through
  /// ordinary behaviour. Only the MRZ inputs set this one.
  const mrzTypedRef = useRef(false)
  const [mrzLine2, setMrzLine2] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * ⛔ AN OUTCOME THAT RETRYING CANNOT FIX. The submit route answers with a specific code for each
   * refusal, and until now EVERY one of them rendered the same sentence: "that did not go through, so
   * we cleared the form — please choose how to verify and start again." For four of those codes that
   * sentence is false and actively harmful:
   *   · already_pending      — a case of theirs IS in review; there is nothing to send.
   *   · duplicate_identity   — the passport is verified on another account; a retake changes nothing.
   *   · rejected             — the document itself fails the decree's six-month rule (or the name does
   *                            not correspond); the same document will be refused every time.
   *   · rate_limited         — five submissions a day, strict. Starting again just burns the rest.
   * A seller told to "start again" photographs their passport and selfie again, burns another of five
   * daily attempts, and lands in the identical dead end — with no idea why. This state renders the
   * real reason INSTEAD of the tier picker, with an explicit way back for the cases that can change.
   */
  const [terminal, setTerminal] = useState<{ en: string; vi: string; resumable?: boolean } | null>(null)
  /**
   * ⛔ WHETHER THIS PERSON ALREADY HAS A CASE — asked ON ARRIVAL, not discovered at submit.
   * `submitKycForReview` refuses a second pending case with `already_pending`, and it refuses it at
   * the very END: after the seller has read the declaration, photographed their passport, written the
   * photographed a selfie, and pressed Send. Everything they did was
   * always going to be thrown away, and one of their five daily submissions goes with it. The same
   * applies to someone already `verified` who wandered back here. One GET at the top of the page
   * turns both into a sentence read before any work starts.
   * ⚠️ FAILS OPEN. A status call that errors, or a shape we do not recognise, leaves this null and the
   * flow behaves exactly as before — nobody is ever blocked from verifying by a failed status read.
   */
  const [existingCase, setExistingCase] = useState<'pending' | 'verified' | null>(null)
  /**
   * ⚠️ HAS THE SELLER ALREADY COMMITTED TO AN ATTEMPT? The status GET above races the page: on a slow
   * connection its reply lands AFTER the seller has read the declaration and picked a tier. Two things
   * follow, and they pull in opposite directions.
   *  · The panel must NOT replace the flow at that point — it would hide a refusal they need to read
   *    (codex). Hence this flag gates the replacement.
   *  · But the answer still matters: `pending` means the submission at the end of all that work is
   *    guaranteed to be refused. So it is shown INLINE instead, as a warning they can act on before
   *    photographing anything, rather than swallowed.
   */
  const [started, setStarted] = useState(false)
  /**
   * ⛔ THE STATUS GET NEEDS A GENERATION, NOT JUST A CLEARED FLAG. Nulling `existingCase` does not
   * cancel an in-flight request: its callback still fires and REPOPULATES the state it was supposed to
   * invalidate, and since `resetAttempt` also clears `started`, that late reply can put a stale
   * "you already have a verification" panel over the retry flow a seller is in the middle of (codex).
   * Every start and every reset bumps this; a reply whose generation has moved is dropped.
   */
  const statusGenRef = useRef(0)
  // ⚠️ RATE-LIMIT COUNTDOWN. When issuing a challenge is throttled (429) the server sends
  // `retryAfterSeconds`; `retryAt` is when a retry is allowed and `retrySecs` is the live seconds
  // left, so the user sees exactly how long to wait instead of a vague "try later" — and the tier
  // buttons are disabled until it reaches 0 so an impatient re-click can't extend a strict window.
  const [retryAt, setRetryAt] = useState<number | null>(null)
  const [retrySecs, setRetrySecs] = useState(0)
  // ⚠️ ONE STEP AT A TIME (owner, 2026-09-02: "show one step at a time so user can follow"). Once a
  // tier is chosen the flow is a wizard — document → selfie → details — never the old wall of every
  // step at once. Reset to 'document' whenever a tier (re)starts.
  const [wizardStep, setWizardStep] = useState<'document' | 'selfie' | 'details'>('document')

  // ── On-device passport MRZ scan (tier B) ──────────────────────────────────────────────────────
  // Reading the passport photo IN THE BROWSER and pre-filling the form was the owner's own design
  // (src/lib/identity/mrz-ocr.ts header, 2026-08-03). The Tesseract engine is created lazily on the
  // first scan and torn down on unmount; only tier B (passport, TD3 MRZ) scans — a CCCD has no TD3 MRZ.
  const [scan, setScan] = useState<'idle' | 'reading' | 'ok' | 'failed'>('idle')
  const [scanHint, setScanHint] = useState<{ en: string; vi: string } | null>(null)
  // 🔬 On-screen MRZ diagnostic — the only way to see the OCR internals on a phone (no dev console).
  // Surfaces whether the WASM engine initialised and what each variant read.
  // ⚠️ Read the flag in an EFFECT, not during render: `window.location` during render makes the server
  // (false) and first client render (true) disagree → a hydration mismatch (a trap this repo has hit).
  // ⛔ IT WAS BRIEFLY FORCED ON FOR EVERY TIER-B USER (the 2026-09-03 iOS diagnosis) and that shipped a
  // black terminal overlay of raw OCR text across a real seller's screen. Never do that again — gate it.
  // ⚠️ `#mrzdebug=1` IS ACCEPTED TOO because the query alone did not survive the way this page is reached
  // on a phone (owner, on-device 2026-09-03: "?mrzdebug=1 no this in domain"). The likely culprit is the
  // unauthenticated bounce through `/signin?next=/dashboard/account/verify`, which carries no query of
  // its own — ⚠️ NOT VERIFIED, and the hash may not survive that navigation either. The hash is offered
  // as a SECOND way in, not as a proven one; if neither arrives, paste the flag once already signed in.
  const [mrzDebug, setMrzDebug] = useState(false)
  useEffect(() => {
    try {
      const { search, hash } = window.location
      // ⚠️ PARSE the hash, never substring-match it: `#mrzdebug` inside an unrelated fragment (a deep
      // link, an anchor id) would otherwise switch raw OCR output on for a real seller (codex).
      // ⛔ EXACTLY '1'. An earlier draft accepted any value but `0` so that a bare `#mrzdebug` worked —
      // which also meant `?mrzdebug=false` switched it on. This panel renders passport-derived text, and
      // a link someone else crafts and sends is a real way to reach it on a signed-in phone, from where
      // it leaks by screenshot or screen-share (codex). The convenience is not worth that; type `=1`.
      const on = (v: string | null) => v === '1'
      const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
      setMrzDebug(on(new URLSearchParams(search).get('mrzdebug')) || on(hashParams.get('mrzdebug')))
    } catch { /* no window (never in an effect) — stay off */ }
  }, [])
  const [dbg, setDbg] = useState<string[]>([])
  // Accumulate into a REF and flush ONCE at the end of a read — a setState per OCR variant would re-render
  // VerifyClient mid-WASM and could trip the timeout (agy). The panel updates when the read completes.
  const dbgRef = useRef<string[]>([])
  const pushDbg = useCallback((s: string) => { dbgRef.current = [...dbgRef.current, s].slice(-40) }, [])
  const engineRef = useRef<ReturnType<typeof createMrzOcrEngine> | null>(null)
  // ⚠️ The highest upload id whose scan we've accepted. onImage fires the OCR on the captured still
  // AFTER upload (async); a decode with an id below this belongs to a superseded shot and is dropped,
  // so a slow read can never fill the wrong document's data.
  const latestUploadRef = useRef(0)
  // ⚠️ ATTEMPT EPOCH — bumped on every (re)start, reset, and Back-to-document. The post-capture OCR is
  // async; a reset/tier switch mid-read bumps this so the abandoned read is dropped, never filling a
  // fresh attempt with the old document's data.
  const attemptRef = useRef(0)
  const docAttemptRef = useRef(0) // the attempt a given upload belongs to (bound at upload time)
  // ⚠️ Has the user TYPED in a document field since the current scan began? If so, a successful scan
  // must NOT overwrite them — TD3 line 1 (the names) carries NO check digit, so a misread name would
  // silently replace a correct one and the server's check-digit re-derivation could never catch it.
  // The scan is a convenience pre-fill; once the user takes over by typing, their input wins.
  const userEditedRef = useRef(false)
  const markEdited = useCallback(() => { userEditedRef.current = true }, [])
  useEffect(() => () => { void engineRef.current?.terminate() }, [])

  /** Ask where this person stands. Bumps the generation, so any earlier reply in flight is dropped. */
  const readStatus = useCallback(() => {
    const gen = ++statusGenRef.current
    void fetch('/api/seller/identity/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { status?: string } | null) => {
        if (!d || gen !== statusGenRef.current) return
        if (d.status === 'pending' || d.status === 'verified') setExistingCase(d.status)
      })
      .catch(() => { /* fail open — see the note on existingCase */ })
  }, [])

  useEffect(() => {
    // ⛔ CLEAR FIRST, AND CLEAR EVERY PIECE. This effect re-runs when the account changes: a stale
    // value would show one person another's private verification status until the new read lands — or
    // indefinitely, if that read fails. Failing open means falling back to NO claim, not to the last
    // one. `terminal` and `started` describe the previous account's attempt just as much as
    // `existingCase` does, so a second account on the same mounted client would otherwise inherit the
    // first one's refusal, or have its own pre-flight suppressed (codex).
    // ⚠️ KEYED ON THE USER'S ID, NOT THE OBJECT. `useAuth` hands back a NEW object on a Supabase token
    // refresh or a tab refocus, and keying on identity would then wipe `terminal` mid-read — a seller
    // studying a rejection locks their phone, comes back, and finds the refusal gone and the tier
    // picker inviting exactly the retry that copy exists to prevent (fable).
    setExistingCase(null); setTerminal(null); setStarted(false)
    // ⛔ INVALIDATE BEFORE THE EARLY RETURN. On sign-out `userId` goes undefined and this used to
    // return without bumping, so a status request belonging to the PREVIOUS account could still resolve
    // and call setExistingCase — showing one person's verification state after they signed out (codex).
    statusGenRef.current += 1
    if (!userId) return
    readStatus()
  }, [userId, readStatus])

  // Tick the rate-limit countdown down to zero, then clear it (which re-enables the tier buttons).
  useEffect(() => {
    if (retryAt == null) { setRetrySecs(0); return }
    const tick = () => {
      const s = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
      setRetrySecs(s)
      if (s === 0) setRetryAt(null)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [retryAt])

  // A captured document arrived (from the hold-still auto-capture OR the manual shutter). Clear the
  // fields (mixed-document guard: a new photo may be a DIFFERENT document); the async post-capture OCR
  // (onDocImage) refills them when the read lands, and tier A / an unreadable passport leaves them for
  // the user to type.
  const onDocUploaded = useCallback((path: string, uploadId: number) => {
    // Mark this the newest upload + clear the fields. The post-capture OCR (onDocImage) refills them
    // asynchronously; tier A (no MRZ) leaves them for the user to type. Clearing here closes the
    // mixed-document window (a new photo, old data). userEdited resets so the fresh read may prefill.
    latestUploadRef.current = uploadId
    docAttemptRef.current = attemptRef.current
    userEditedRef.current = false
    setMrzLine1(''); setMrzLine2(''); setMrzDerived(false); setMrzRevealed(false); mrzTypedRef.current = false
    setSurname(''); setGivenNames(''); setDocumentNumber(''); setDocumentExpiry('')
    setScan(tier === 'B' ? 'reading' : 'idle'); setScanHint(null)
    setDocumentPath(path)
    // ⚠️ A NEW document invalidates the selfie taken for the PREVIOUS one — the pair must never be
    // submitted mismatched. Clearing it also re-locks the details step (submit is gated on both paths).
    setSelfiePath(null)
    // ⚠️ FUNCTIONAL + STEP-GATED. Only advance if we are STILL on the document step — an upload that
    // resolves after the user pressed Back / Start over must not yank the wizard forward.
    setWizardStep((s) => (s === 'document' ? 'selfie' : s))
  }, [tier])

  const onSelfieUploaded = useCallback((path: string) => {
    setSelfiePath(path)
    setWizardStep((s) => (s === 'selfie' ? 'details' : s)) // advance only from the selfie step
  }, [])

  // ── OCR ON THE CAPTURED STILL (tier B) → autofill, ASYNC after upload. Capture is NOT gated on this
  // (the shutter fires on hold-still), so a slow or unreadable passport never blocks it; the fields
  // fill in whenever the read finishes, on whatever step the user has reached. Guards: the uploadId +
  // attempt epoch drop a read for a superseded/abandoned document; userEditedRef never overwrites what
  // the user typed (TD3 line-1 names have no check digit). A failed read → "type the two lines".
  const onDocImage = useCallback(async (img: ImageData | null, uploadId: number) => {
    if (uploadId < latestUploadRef.current || docAttemptRef.current !== attemptRef.current) return
    if (!img) { setScan('failed'); setScanHint(null); return }
    setScan('reading'); setScanHint(null)
    if (!engineRef.current) engineRef.current = createMrzOcrEngine()
    const eng = engineRef.current
    // ⚠️ Debug is a passive observer — every push is wrapped so a throw in the trace can NEVER propagate
    // into readMrz's catch and manufacture the "engine failed" it was added to investigate (fable).
    if (mrzDebug) { dbgRef.current = []; pushDbg(`still ${img.width}×${img.height} — warming engine…`) }
    try {
      await eng.ready() // one-time ~6MB warm-up, outside the read timeout
      if (mrzDebug) pushDbg('engine READY')
      if (uploadId !== latestUploadRef.current || engineRef.current !== eng || docAttemptRef.current !== attemptRef.current) return
      let timer: ReturnType<typeof setTimeout> | undefined
      const engFn = mrzDebug
        ? async (image: Parameters<typeof eng.engine>[0], opts: Parameters<typeof eng.engine>[1]) => {
            const t = await eng.engine(image, opts)
            // ⛔ SHAPE, NEVER CONTENT. This used to print the raw OCR text, which is the passport's
            // machine-readable zone in plain characters. The flag is user-controlled, so a link
            // someone else crafts and sends reaches it on a signed-in phone, from where it leaks by
            // screenshot or screen-share (codex). What diagnosis actually needs is whether the engine
            // ran and whether the band contained anything MRZ-shaped — not the seller's document.
            try {
              const lines = t.split(/\r?\n/).filter((l) => l.trim().length > 0)
              const mrzish = lines.filter((l) => l.replace(/\s/g, '').length >= 40).length
              pushDbg(`v(up${opts.upscale} inv${opts.invert} top${opts.crop.top.toFixed(2)}) ${lines.length} lines, ${mrzish} mrz-shaped`)
            } catch { /* never affect the read */ }
            return t
          }
        : eng.engine
      // ⚠️ SINGLE-CAPTURE SCOPE. The four preprocessing variants of THIS still are fused internally by
      // readMrz — that is what recovers a valid MRZ from an imperfect webcam frame. Cross-CAPTURE pooling
      // was removed: the wizard advances to the selfie the moment a document uploads, and the only way
      // back clears the attempt, so a "second capture" the pool could complete is unreachable through the
      // UI (all three reviewers, 2026-09-02) — and persisting fields across captures risked fusing two
      // documents. Each capture is therefore self-contained; an incomplete read falls back to typing.
      // ⚠️ TWO DEADLINES, DELIBERATELY COORDINATED — codex caught the trap of moving only one. readMrz
      // owns a budget of ACTUAL OCR TIME (summed inside engine calls, clamped per call so a suspended
      // tab cannot spend it) and checks it before starting each call, so it degrades to "return
      // whatever was salvaged" instead of being killed mid-read. The race below is a HANG GUARD for a
      // single WASM call that never returns at all — the one failure the budget cannot see — which is
      // why it sits far above the budget rather than just above it.
      // ⚠️ The wait is HIDDEN: the wizard advances to the selfie step the moment the document uploads,
      // so this normally finishes while the seller is taking their selfie. It is not
      // free, though — the selfie camera is live alongside it, so the budget stays tight rather than
      // generous (agy: a long WASM sweep beside a live stream is how a phone thermally throttles).
      // ⚠️ 40s of ACTUAL OCR TIME (readMrz sums time inside engine calls; a backgrounded tab does not
      // spend it) under a 75s WALL-CLOCK hang guard. The guard is deliberately far above the budget:
      // it is not the thing that shapes the read — the budget is — it only catches a single WASM call
      // that never returns at all, which is the one failure the budget cannot see.
      const OCR_BUDGET_MS = 40_000
      // ⚠️ 150s, AND IT IS NOT A WORK LIMIT. The BUDGET bounds the work (40s of actual OCR); this only
      // catches a single WASM call that never returns. Set close to the budget it was killing reads the
      // budget had already finished with: two genuinely slow calls (the per-call clamp permits that)
      // ran past a 75s guard, and the guard REJECTS — throwing away a pool that had every field in it
      // (fable). ⛔ Its one residual cost, stated plainly: a tab SUSPENDED longer than this (a phone
      // locked mid-flow) resumes to a killed read and a
      // "type the two lines" message. That degrades gracefully; the reverse trade did not.
      const OCR_HARD_TIMEOUT_MS = 150_000
      const read = readMrz(img, engFn, {}, { budgetMs: OCR_BUDGET_MS }).finally(() => { if (timer) clearTimeout(timer) })
      void read.catch(() => {}) // a timeout-loser rejection must not become an unhandledrejection
      const result = await Promise.race([
        read,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('ocr_timeout')), OCR_HARD_TIMEOUT_MS) }),
      ])
      // ⛔ WHICH FIELDS, NOT WHAT THEY SAY — same reason as the per-variant line above.
      if (mrzDebug) {
        pushDbg(result.ok
          ? `result OK via ${result.variantIndex === -1 ? 'fusion' : `variant ${result.variantIndex}`} in ${result.attempts} calls; fields: ${Object.keys(result.mrz.fields).join(',') || 'none'}`
          : `result ${result.reason} in ${result.attempts} calls; recovered: ${Object.keys(result.pool).join(',') || 'none'}; missing: ${result.missing.join(',') || 'none'}`)
      }
      if (uploadId !== latestUploadRef.current || engineRef.current !== eng || docAttemptRef.current !== attemptRef.current) return
      // ⚠️ FILL EMPTY FIELDS ONLY — never discard a good read just because the user started typing during
      // the ~6MB warm-up, and never clobber what they typed. (The old early-return on userEdited stranded
      // a user who typed a surname before the read landed: the MRZ lines never filled and Send stayed
      // disabled — fable, 2026-09-02.) The uploadId/epoch guards above already reject a genuinely stale read.
      if (result.ok) {
        const f = result.mrz.fields
        // ⛔ NAME-LESS mrzLine1 ON EVERY PATH — not just the synthesized one. The FAST path (a single
        // variant fully validated) returns the raw OCR line 1 WITH its name, and the server prefers
        // MRZ-derived fields over the typed ones — so a user correcting a misread name would be overruled
        // at submit (fable, 2026-09-02). Keep `P<` + issuing state, drop the name: the name is authored
        // ONLY by the (required) typed surname/given fields, which are prefilled from f.* as a convenience.
        // ⛔ AND DO NOT CARRY A MANGLED PREFIX THROUGH EITHER. `slice(0, 5)` keeps whatever the OCR
        // made of `P<CCC`; on the measured read that is `ZTMBA`, which submits document code `ZT` and
        // issuing state `MBA` — neither has a check digit to catch it. When the prefix fails the same
        // width test the name extraction uses, emit a bare `P<` and let the issuing state be blank
        // rather than wrong: the server derives identity from line 2, which is check-validated.
        const nameLess = (l1: string) =>
          ((hasWellFormedPrefix(l1) ? l1.slice(0, 5) : 'P<') + '<'.repeat(44)).slice(0, 44)
        // ⛔ DECIDED OUTSIDE THE STATE UPDATER. Setting state from inside another setter's updater is
        // impure — StrictMode double-invokes it. ⚠️ AND NOT FROM `userEditedRef`: that means "touched
        // ANY field on this form" (it gates name prefill), so a seller typing their surname during the
        // read counted as having typed the MRZ boxes. `mrzTypedRef` tracks only these two inputs.
        // ⛔ FROM THE REF, NOT FROM `mrzLine1`/`mrzLine2`. Those are the CLOSURE's values, captured
        // when this handler was created — which is exactly why the two fills below use functional
        // updaters. Reading them here made a RETAKE (which the copy invites) see the previous read's
        // non-empty lines and conclude the seller had typed them, while the updaters saw the cleared
        // state and filled both boxes: derived lines, expanded, under "type exactly as printed" —
        // the original report, on the second attempt. The ref is cleared at both reset sites.
        setMrzDerived(!mrzTypedRef.current)
        setMrzLine1((v) => v.trim() ? v : nameLess(result.lines[0]))
        setMrzLine2((v) => v.trim() ? v : result.lines[1])
        // ⛔ FALL BACK TO THE POOLED LINE 1. A FUSED read carries no name by design, but the pool very
        // often holds a perfectly good one — measured on the owner's phone: line 1 read correctly at 36
        // characters, too short for `extractMrzLines`, so the whole capture fused and both name fields
        // came up empty while the name sat unread in `pool.nameLine`. See namesFromNameLine.
        const pooled = f.surname || f.givenNames ? {} : namesFromNameLine(result.pool.nameLine)
        const surnameRead = f.surname ?? pooled.surname
        const givenRead = f.givenNames ?? pooled.givenNames
        if (surnameRead) setSurname((v) => v.trim() ? v : surnameRead)
        if (givenRead) setGivenNames((v) => v.trim() ? v : givenRead)
        if (f.passportNumber) setDocumentNumber((v) => v.trim() ? v : f.passportNumber!)
        if (f.passportExpiryDate) setDocumentExpiry((v) => v ? v : f.passportExpiryDate!.slice(0, 10))
        setScan('ok')
        // ⚠️ A NAME-LESS read (line 2 recovered, line 1 not) fills the number + dates but not the name,
        // which is now required to submit. Without this the user saw "Read ✓" yet Send stayed disabled
        // with nothing explaining why (codex/fable, 2026-09-02). Tell them to type it; a read that DID
        // carry a name clears the hint.
        setScanHint(!surnameRead && !givenRead
          ? { en: 'We read your passport number and dates — please type your name as printed on the passport to finish.',
              vi: 'Chúng tôi đã đọc số hộ chiếu và ngày tháng — vui lòng nhập họ tên như in trên hộ chiếu để hoàn tất.' }
          : null)
      } else if (userEditedRef.current) {
        setScan('idle') // the user is typing it themselves; don't nag with a scan error
      } else {
        // ⚠️ NAME THE PHYSICAL CAUSE. `missingFieldsHint` only speaks when SOME field was recovered;
        // when nothing was, `readFailureHint` is the copy that tells the seller what to physically do
        // differently — "this is almost always glare, tilt the passport away from the light" for a
        // found-but-unreadable band, "make sure the whole bottom edge is inside the frame" for a band
        // we never found. It was written and unit-tested for exactly this moment and was never
        // rendered, so every failed read fell through to a generic "type the two lines".
        setScan('failed')
        setScanHint(missingFieldsHint(result.missing, result.pool) ?? readFailureHint(result))
      }
    } catch (err) {
      if (mrzDebug) pushDbg('EXCEPTION ' + (err instanceof Error ? err.message : String(err)))
      // A wedged read of the CURRENT upload: rebuild the engine so a retake scans fresh. Epoch-guarded so
      // an abandoned document's late timeout can't stamp 'failed' onto a fresh attempt (codex, 2026-09-02).
      if (uploadId === latestUploadRef.current && engineRef.current === eng && docAttemptRef.current === attemptRef.current) {
        void eng.terminate(); engineRef.current = null; setScan('failed')
      }
    } finally {
      if (mrzDebug) setDbg([...dbgRef.current]) // one render, after the read — see pushDbg note
    }
  }, [mrzDebug, pushDbg])

  /**
   * ⚠️ ONE CALL, AND IT CARRIES THE VERSION THE PAGE ACTUALLY RENDERED — not whatever is current
   * server-side when it lands. If a new declaration shipped between page load and click, stamping
   * the current one would attribute to this person a wording they never read.
   */
  const start = useCallback(async (chosen: 'A' | 'B') => {
    attemptRef.current += 1 // a (re)started attempt — any in-flight decode from the prior one is now abandoned
    setTier(chosen)
    setStarted(true)
    // ⛔ NO GENERATION BUMP HERE, AND THE OMISSION IS THE POINT — codex and agy both caught the bump
    // that used to be on this line cancelling the fix two rounds earlier. Picking a tier does NOT make
    // an in-flight status read irrelevant: `pending` still means the submission at the end of all this
    // work is guaranteed to be refused, which is exactly what the inline warning says. Dropping the
    // reply here made `existingCase === 'pending' && started` UNREACHABLE, so the warning could never
    // render and the seller photographed everything into the refusal anyway. The bump belongs only in
    // resetAttempt, where the read really has been superseded.
    setError(null)
    setTerminal(null)
    setStarting(true)
    // ⚠️ DROP ANY IN-FLIGHT PASSPORT SCAN when the tier (re)starts, and free the ~6MB worker. Tearing
    // the engine down makes an in-flight read throw (caught → no autofill); the next upload's id is
    // higher than any we've accepted, so its scan supersedes cleanly without touching latestUploadRef.
    setScan('idle'); setScanHint(null)
    setWizardStep('document') // a (re)started tier always begins at the first wizard step
    void engineRef.current?.terminate(); engineRef.current = null
    try {
      const r = await fetch('/api/seller/identity/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: CURRENT_DECLARATION, accepted: true }),
      })
      if (!r.ok) {
        if (r.status === 429) {
          // Both throttles (the 60s issuance cooldown and the hourly limiter) now send
          // `retryAfterSeconds` + a Retry-After header. Drive a live countdown from it; fall back to
          // a sane default if a proxy stripped both.
          const data = (await r.json().catch(() => null)) as { retryAfterSeconds?: number } | null
          const secs = Math.max(1, data?.retryAfterSeconds ?? (Number(r.headers.get('Retry-After')) || 30))
          setError(null)
          setRetryAt(Date.now() + secs * 1000)
        } else {
          setError(tr('We could not start verification. Please try again.', 'Không thể bắt đầu xác minh. Vui lòng thử lại.'))
        }
        return
      }
      setChallenge((await r.json()) as { code: string; expiresAt: string })
    } catch {
      setError(tr('We could not start verification. Please try again.', 'Không thể bắt đầu xác minh. Vui lòng thử lại.'))
    } finally {
      setStarting(false)
    }
  }, [tr])

  // Returns the flow to the tier-choice screen: clears the (now-burned) challenge and both uploaded
  // paths so a fresh attempt starts clean. Deliberately keeps `accepted` — the declaration was read.
  const resetAttempt = useCallback((opts: { refreshStatus?: boolean } = {}) => {
    attemptRef.current += 1 // abandon this attempt: a decode still in flight is now for a stale epoch
    // ⚠️ CLEARS EVERYTHING, so the "we cleared the form" copy is true and a restarted tier-A attempt
    // cannot carry stale tier-B MRZ text. `accepted` stays — the declaration was read, not undone.
    setChallenge(null); setTier(null); setDocumentPath(null); setSelfiePath(null)
    setSurname(''); setGivenNames(''); setDocumentNumber(''); setDocumentExpiry(''); setMrzLine1(''); setMrzLine2(''); setMrzDerived(false); setMrzRevealed(false); mrzTypedRef.current = false
    setScan('idle'); setScanHint(null)
    setStarted(false) // back at the tier choice: the pre-flight panel is meaningful again
    // ⛔ RE-ASK ONLY WHEN THE SELLER DELIBERATELY WENT BACK — never on a submit failure, and that
    // distinction is a bug this line already caused once. Re-asking unconditionally was the fix for
    // "Start over before the status reply lands leaves existingCase null forever" (codex + agy). But
    // resetAttempt ALSO runs on every submit refusal, and there the reply lands a moment later, flips
    // `showExistingPanel` back on, and UNMOUNTS the refusal the seller needs to read — resurrecting the
    // masking bug two rounds of review had already closed, and hijacking "Try a different document"
    // into the pre-flight panel as well (agy). The failure path clears `existingCase` and shows the
    // reason; only the Start-over button asks again.
    if (opts.refreshStatus) readStatus()
    else statusGenRef.current += 1 // still invalidate: whatever is in flight predates this reset
    void engineRef.current?.terminate(); engineRef.current = null // free the worker; don't leave OCR running
    // No latestUploadRef reset needed: KycCapture's upload id is module-global and only increases, so
    // the next attempt's scan always has a higher id than any we've accepted here.
  }, [readStatus])

  // Step back through the wizard. ⚠️ Going back CLEARS the capture for the step you land on and every
  // step after it, so revisiting a step is always a clean re-capture and the flow can never submit a
  // document/selfie pair where one half was replaced under the other. From step 1, Back exits to the
  // tier choice (resetAttempt clears both paths already).
  const goBack = useCallback(() => {
    // ⚠️ PURE CALLBACK, not a state-updater with side effects inside it. React updaters must be pure
    // (StrictMode double-invokes them); putting resetAttempt()/setState here fired the challenge
    // teardown and path clears TWICE. Branch on the current step read from state instead.
    if (wizardStep === 'details') { setSelfiePath(null); setWizardStep('selfie'); return }       // redo the selfie
    if (wizardStep === 'selfie') {
      // Back to redo the document: bump the epoch so the just-cleared document's in-flight OCR decode
      // is rejected (it belongs to a document that no longer exists) instead of filling the new one.
      attemptRef.current += 1
      setSelfiePath(null); setDocumentPath(null); setWizardStep('document'); return
    }
    resetAttempt() // step 1 → out to the tier choice
  }, [wizardStep, resetAttempt])

  const submit = useCallback(async () => {
    if (!tier || !challenge || !documentPath || !selfiePath) return
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch('/api/seller/identity/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // ⛔ THE TIER IS SENT EXPLICITLY. `decideTierB` reads `input.tier ?? 'B'`, and both plan
          // reviewers named that fallback: omitting it files a CCCD as a passport and applies
          // passport rules to a document that has none.
          tier,
          challengeCode: challenge.code,
          documentPath,
          selfiePath,
          consentVersion: CURRENT_DECLARATION,
          surname: surname.trim() || undefined,
          givenNames: givenNames.trim() || undefined,
          passportNumber: documentNumber.trim() || undefined,
          nationality: tier === 'A' ? 'VNM' : undefined,
          documentExpiry: documentExpiry || undefined,
          // ⚠️ MRZ ONLY FOR A PASSPORT, and only because tier B's decision REQUIRES a reliable read:
          // `decideTierB` rejects a tier B case with neither valid check digits nor a provider. A
          // CCCD has no MRZ at all and its branch does not ask for one.
          mrzLine1: tier === 'B' ? (mrzLine1.trim().toUpperCase() || undefined) : undefined,
          // ⛔ THE RAW READ, UNCHANGED — AND A CLIENT THAT RE-MINTS CHECK DIGITS IS A BYPASS.
          // A previous pass wrote the confirmed number and expiry back into line 2 and recomputed the
          // checksums, to close the mod-10 hole below. That turns the expiry box into self-service:
          // a seller whose passport expired in 2024 edits the date to 2030, the client mints a valid
          // composite, and the server — which prefers MRZ-derived fields — sees an unexpired document.
          // It also destroys the read-vs-typed discrepancy a human reviewer needs. Whatever the OCR
          // actually read is what gets submitted; the typed fields travel alongside it.
          // ⚠️ THE MOD-10 HOLE IS THEREFORE STILL OPEN, and it is a SERVER problem: `G`/`6`, `S`/`8`
          // and `L`/`1` have ICAO values differing by exactly ten, so those misreads leave every
          // check digit valid and the MRZ number silently wins over the seller's correction.
          // Closing it means reconciling the two SERVER-side — prefer the typed number when it
          // differs from the MRZ only by such a substitution — which is not a client change.
          mrzLine2: tier === 'B' ? (mrzLine2.trim().toUpperCase() || undefined) : undefined,
        }),
      })
      // ⛔ ANY FAILURE HERE HAS ALREADY BURNED THE CHALLENGE (consumeChallenge burns the code on
      // every answer), so retrying the SAME submit only hits `no_challenge` and re-uploading now
      // 403s — the reviewer's stranding path. Reset to the start instead: the next attempt issues a
      // fresh code and takes fresh photos. (The 60s issue cooldown is handled by `start`, which
      // shows "please wait a moment" on a 429.)
      const body = (await r.clone().json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!r.ok || body.ok === false) {
        // ⚠️ THE FORM IS CLEARED FOR ALMOST EVERY CODE, and that is mechanical, not editorial:
        // `consumeChallenge` BURNS the code on every answer, so re-sending only ever hits
        // `challenge_missing` and re-uploading 403s. What differs is what the seller is TOLD.
        // ⛔ THE EXCEPTION IS A REFUSAL THAT COST NOTHING. A malformed CCCD number is checked BEFORE
        // the challenge is consumed, so the attempt is still alive — clearing it would throw away a
        // valid challenge and both photographs over a digit the seller can fix in the field in front
        // of them. This form blocks that number ahead of the network call, so the branch is a
        // backstop; it exists because the client check is not the guarantee, the server's ordering is.
        if (!body.error || !KEEPS_THE_ATTEMPT.has(body.error)) resetAttempt()
        // ⛔ AND THE PREFLIGHT IS NOW STALE. `existingCase` was read when the page loaded; a reply that
        // landed while the seller worked would, the moment resetAttempt() clears the challenge, render
        // its "you already have a verification, nothing to send again" panel OVER the refusal they
        // actually need to read (fable). They have just submitted — whatever that read said, it is old.
        setExistingCase(null)
        // ⛔ THE BODY, NOT THE STATUS. A 429 from an edge or WAF never reached the route — the challenge
        // was never consumed and no submission was counted — so declaring "you have used today's five
        // attempts" would be a fabrication about a limit that did not fire (fable). Only the route's own
        // `rate_limited` body means the daily cap; anything else falls to the generic message.
        const code = body.error
        // ⚠️ NOT a bare index: `SUBMIT_OUTCOMES['constructor']` returns a FUNCTION off the prototype
        // whose `.en` is undefined, so a cleared form would show no message at all (fable).
        // ⛔ AND NOT `Object.hasOwn`, WHICH IS ES2022 AND THROWS ON iOS SAFARI BELOW 15.4 — browsers
        // that support modules, so no nomodule polyfill bundle rescues them (codex + fable). It would
        // throw HERE, after resetAttempt() has burned the challenge and cleared the form, replacing
        // the explanation this whole table exists to give with nothing at all.
        const raw = code && Object.prototype.hasOwnProperty.call(SUBMIT_OUTCOMES, code) ? SUBMIT_OUTCOMES[code] : undefined
        const outcome = raw && tier === 'A' && raw.enA && raw.viA ? { ...raw, en: raw.enA, vi: raw.viA } : raw
        if (outcome?.terminal) { setTerminal(outcome); setError(null); return }
        setError(outcome
          ? (lang === 'vi' ? outcome.vi : outcome.en)
          : tr(
              'That did not go through, so we cleared the form. Please choose how to verify and start again.',
              'Chưa gửi được nên chúng tôi đã xóa biểu mẫu. Vui lòng chọn cách xác minh và bắt đầu lại.',
            ))
        return
      }
      setSubmitted(true)
    } catch {
      setError(tr('We could not accept that. Check the details and try again.', 'Chưa gửi được. Vui lòng kiểm tra lại thông tin.'))
    } finally {
      setSubmitting(false)
    }
  }, [tier, challenge, documentPath, selfiePath, surname, givenNames, documentNumber, documentExpiry, mrzLine1, mrzLine2, tr, lang, resetAttempt])

  // Same client gate every sibling section uses — a SERVER redirect here would race the session
  // restore and reproduce the signin↔dashboard bounce /dashboard/page.tsx warns about.
  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/account/verify')
  }, [loading, user, router])

  if (loading || !user) {
    // ⚠️ THE APP HAS ONE SKELETON SYSTEM AND THIS USED TO BE OUTSIDE IT: a single
    // `h-64 animate-pulse rounded-2xl bg-muted/40` slab — a hand-rolled placeholder idiom
    // (opacity pulse over bg-muted) competing with the shared `.shimmer` <Skeleton>, and an
    // opaque 256px box standing in for a `mx-auto max-w-2xl space-y-6` article. Content-shaped
    // now, matching the header → declaration card → tier buttons below it, like every sibling
    // dashboard gate.
    return (
      <>
      {/* ⚠️ THE TITLE BAR IS IN THE SKELETON TOO. Without it the back affordance appears only after
          the session resolves, so a phone briefly shows a pushed screen with no way out of it. */}
      <SectionHeader title={tr('Verify your identity', 'Xác minh danh tính')} fallbackHref="/dashboard/verification" />
      <div role="status" aria-label={tr('Loading…', 'Đang tải…')} className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-2">
          {/* h1 — h-display + the h-8 seal beside it (fluid: 28 → 40px × 1.12) */}
          <Skeleton className="h-[calc(var(--text-display)*1.12)] w-72 max-w-full" />
          <div className="space-y-1">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-2/3" />
          </div>
          <Skeleton className="h-4 w-3/4 max-w-full" />
        </div>
        {/* Declaration card (rounded-2xl border p-5) — heading, the numbered body, the consent row */}
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <Skeleton className="h-[calc(var(--text-section)*1.3)] w-40" />
          <div className="space-y-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className={i === 4 ? 'h-[22px] w-1/2' : 'h-[22px] w-full'} />
            ))}
          </div>
          <Skeleton className="h-[68px] w-full rounded-xl" />
        </div>
        {/* "Choose how to verify" + the two tier buttons */}
        <div className="space-y-3">
          <Skeleton className="h-[calc(var(--text-section)*1.3)] w-48" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-[86px] rounded-2xl" />
            <Skeleton className="h-[86px] rounded-2xl" />
          </div>
        </div>
      </div>
      </>
    )
  }

  const decl = DECLARATIONS[CURRENT_DECLARATION]
  // ⚠️ Render the language the user is reading, but the HASH covers both (see declaration.ts).
  // What is on screen is a courtesy; what is recorded is the whole declaration.
  const body = lang === 'vi' ? decl.vi : decl.en

  // The wizard rail — one node per step, in order. Labels are the accessible/announced names; the
  // document label follows the tier (CCCD vs passport). The shell shows a tick on done steps.
  const wizardSteps: WizardStep[] = [
    {
      key: 'document',
      icon: <Camera className="size-4" />,
      label: tier === 'A' ? tr('CCCD photo', 'Ảnh CCCD') : tr('Passport photo', 'Ảnh hộ chiếu'),
    },
    { key: 'selfie', icon: <User className="size-4" />, label: tr('Selfie', 'Ảnh chân dung') },
    { key: 'details', icon: <Pencil className="size-4" />, label: tr('Check details', 'Kiểm tra thông tin') },
  ]

  // ⛔ The identity fields the server actually needs, so submit can't fire with them BLANK — which
  // matters because onDocUploaded clears them for BOTH tiers (the mixed-document guard) and tier A
  // has no OCR to refill them, so the details step opens empty. Submitting blank wastes the
  // single-use challenge on a certain refusal (codex). Tier A: the four typed fields. Tier B: the two
  // MRZ lines the server re-derives identity from (the preview fields are filled from these).
  // ⛔ Tier B gates on an ACTUALLY-VALID MRZ (parse + check digits), not merely non-empty lines, so a
  // user who hand-types garbage can't pass the client gate, hit the server's mrz_invalid refusal, and
  // burn the single-use challenge (fable, 2026-09-02) — plus the name, which the MRZ line 1 no longer
  // carries (so a nameless read cannot submit; the human-confirmed typed name is authoritative).
  // ⚠️ PARSED ONCE, because the per-field diagnosis below needs the SAME `checks` object the gate
  // decides on — two calls would let the gate and the explanation disagree after an edit.
  const mrzParsed = tier === 'B' && (mrzLine1.trim() || mrzLine2.trim()) ? parsePassportMrz(mrzLine1, mrzLine2) : null
  const mrzValid = tier === 'B' && !!mrzLine1.trim() && !!mrzLine2.trim() && !!mrzParsed?.valid
  // ⚠️ AT LEAST ONE name part, NOT both. Many holders have a single legal name (a mononym) whose passport
  // carries no given name — requiring both permanently locked them out of submit (agy, 2026-09-02). This
  // still blocks a fully nameless read (both empty), which is the case that mattered.
  const nameMissing = !surname.trim() && !givenNames.trim()
  // ⛔ THE CCCD NUMBER IS CHECKED HERE, BEFORE ANY ATTEMPT IS SPENT. The server refuses a number that
  // is not 12 digits — but it refuses it AFTER consuming the single-use consent challenge and one of
  // the seller's five daily submissions, with copy that says "photograph the card again" for a field
  // they TYPED. One dropped digit would cost an attempt, five typos would lock them out for the day.
  // A format this simple belongs in front of the button, not behind the network call.
  const cccdDigits = documentNumber.replace(/[\s.-]/g, '')
  const cccdNumberBad = tier === 'A' && cccdDigits.length > 0 && !/^\d{12}$/.test(cccdDigits)
  // ⚠️ NO EXPIRY REQUIRED FOR A CCCD. A card issued to someone over 60 reads "Không thời hạn" — no
  // expiry at all — and the server stores null for it. Requiring one here locked that entire cohort
  // out of verification while the server was perfectly willing to accept them.
  const detailsIncomplete = tier === 'A'
    ? (!surname.trim() || !givenNames.trim() || !cccdDigits || cccdNumberBad)
    : (!mrzValid || nameMissing)

  /**
   * ⚠️ SAY WHICH LINE, OR WHICH CHECK DIGIT, IS WRONG. Hand-typing 88 characters of OCR-B off a
   * passport on a phone WILL go wrong, and until now the only feedback was a Send button that stayed
   * disabled — blind trial and error over 88 characters. Every one of these is derivable: a TD3 line
   * is exactly 44 characters, and each field on line 2 carries its own mod-10 check digit, so the
   * parser already knows precisely which seven-character group does not add up.
   * ⛔ ALL FIVE CHECKS, not the three obvious ones (codex): `optionalData` and the trailing
   * `composite` are check digits the parser validates too, and a mismatch in either is exactly the
   * kind of typo — one character in the long filler run — a seller cannot find unaided.
   * Built in JS: design-lint forbids a bare string literal in JSX.
   */
  // ⚠️ THE SAME NORMALISATION `parsePassportMrz` APPLIES INTERNALLY (`cleanLine` in lib/visa/mrz.ts:
  // uppercase, strip whitespace, strip anything outside the MRZ alphabet) — VERIFIED, not assumed. Two
  // reviewers have now filed "the diagnosis normalises but the gate parses raw, so a pasted lowercase
  // line reads 44/44 with every check failing"; it does not, because the parser cleans first and the
  // two are character-for-character identical. Keep them that way, or that finding becomes true.
  const clean = (v: string) => v.toUpperCase().replace(/\s/g, '').replace(/[^A-Z0-9<]/g, '')
  // ⛔ THE CONFIRMED FIELDS AND THE MRZ MUST AGREE, OR THE SELLER'S CORRECTION IS THROWN AWAY.
  // The MRZ checksum is mod-10 and the ICAO values of `G`/`6`, `S`/`8`, `L`/`1` differ by exactly ten,
  // so those misreads leave every check digit valid: the read reports success with a WRONG passport
  // number. The seller is told to check the details above, fixes the number — and the server prefers
  // MRZ-derived fields, so the misread is what gets recorded against their identity.
  // ⚠️ THE CLIENT MUST NOT "FIX" THIS BY REWRITING LINE 2. That was tried and is a bypass: re-minting
  // check digits over a typed expiry lets anyone with an expired passport edit the date into a valid
  // MRZ. The safe move is to refuse to submit a disagreement and show the seller where it is.
  const mrzDisagreement: { en: string; vi: string } | null = (() => {
    if (tier !== 'B' || !mrzValid || !mrzParsed) return null
    const typedNumber = documentNumber.trim().toUpperCase()
    const readNumber = mrzParsed.fields.passportNumber
    if (typedNumber && readNumber && typedNumber !== readNumber) {
      return {
        en: `The code lines say your passport number is ${readNumber}, but the field above says ${typedNumber}. Correct whichever is wrong — the code lines are what we verify against.`,
        vi: `Hai dòng mã ghi số hộ chiếu là ${readNumber}, nhưng ô ở trên ghi ${typedNumber}. Hãy sửa phần nào sai — chúng tôi đối chiếu theo hai dòng mã.`,
      }
    }
    const typedExpiry = documentExpiry.trim()
    const readExpiry = mrzParsed.fields.passportExpiryDate?.slice(0, 10)
    if (typedExpiry && readExpiry && typedExpiry !== readExpiry) {
      return {
        en: `The code lines say your passport expires on ${readExpiry}, but the field above says ${typedExpiry}. Correct whichever is wrong — the code lines are what we verify against.`,
        vi: `Hai dòng mã ghi ngày hết hạn là ${readExpiry}, nhưng ô ở trên ghi ${typedExpiry}. Hãy sửa phần nào sai — chúng tôi đối chiếu theo hai dòng mã.`,
      }
    }
    return null
  })()

  const mrzProblem: string | null = (() => {
    if (tier !== 'B' || !mrzParsed || mrzParsed.valid) return null
    const l1 = clean(mrzLine1), l2 = clean(mrzLine2)
    const wrongLength = [l1.length !== 44 ? 1 : 0, l2.length !== 44 ? 2 : 0].filter(Boolean)
    if (wrongLength.length > 0) {
      const parts = wrongLength.map((n) => `${tr('line', 'dòng')} ${n}: ${n === 1 ? l1.length : l2.length}/44`)
      return `${tr('Each line is exactly 44 characters', 'Mỗi dòng có đúng 44 ký tự')} — ${parts.join(', ')}.`
    }
    if (!l1.startsWith('P')) return tr('Line 1 of a passport starts with P.', 'Dòng 1 của hộ chiếu bắt đầu bằng chữ P.')
    const names: Array<[keyof typeof mrzParsed.checks, string, string]> = [
      ['passportNumber', 'the passport number', 'số hộ chiếu'],
      ['dateOfBirth', 'the date of birth', 'ngày sinh'],
      ['expiryDate', 'the expiry date', 'ngày hết hạn'],
      ['optionalData', 'the characters after the expiry date', 'các ký tự sau ngày hết hạn'],
      ['composite', 'the very last character of line 2', 'ký tự cuối cùng của dòng 2'],
    ]
    const bad = names.filter(([k]) => !mrzParsed.checks[k]).map(([, en, vi]) => tr(en, vi))
    // ⛔ NEVER null WITH AN INVALID MRZ. Every path above should have named something, but if the
    // parser ever refuses a line for a reason none of them covers, silence here is a dead Send button
    // with no explanation — the exact failure this whole block exists to end (fable).
    if (bad.length === 0) {
      return tr(
        "These two lines don't match what is printed on your passport yet — please check them character by character.",
        'Hai dòng này chưa khớp với thông tin in trên hộ chiếu — vui lòng kiểm tra từng ký tự.',
      )
    }
    const joined = bad.length <= 1 ? bad[0] : `${bad.slice(0, -1).join(', ')}${tr(' and ', ' và ')}${bad[bad.length - 1]}`
    return `${tr("This doesn't add up yet — check", 'Chưa khớp — hãy kiểm tra')} ${joined}.`
  })()

  // Which required field is still empty — the sentence form of `detailsIncomplete`, so the disabled
  // Send button is never a mystery. Built in JS: design-lint forbids a bare string literal in JSX.
  const sendBlockedReason: string | null = (() => {
    if (!tier || !detailsIncomplete) return null
    const bits: string[] = []
    if (tier === 'A') {
      // ⚠️ NAMED SEPARATELY. Tier A requires BOTH parts, so "your name" leaves a seller who filled one
      // of the two staring at a disabled button with a sentence that looks already satisfied (codex).
      if (!surname.trim()) bits.push(tr('your surname', 'họ của bạn'))
      if (!givenNames.trim()) bits.push(tr('your given names', 'tên của bạn'))
      if (!cccdDigits) bits.push(tr('your CCCD number', 'số CCCD của bạn'))
      else if (cccdNumberBad) bits.push(tr('a 12-digit CCCD number', 'số CCCD gồm 12 chữ số'))
    } else {
      if (nameMissing) bits.push(tr('your name as printed on the passport', 'họ tên như in trên hộ chiếu'))
      if (!mrzValid) bits.push(tr('the two machine-readable lines below', 'hai dòng mã máy đọc bên dưới'))
    }
    if (bits.length === 0) return null
    const joined = bits.length <= 1
      ? bits[0]
      : `${bits.slice(0, -1).join(', ')}${tr(' and ', ' và ')}${bits[bits.length - 1]}`
    return `${tr('To send this we still need', 'Để gửi được, chúng tôi vẫn cần')} ${joined}.`
  })()

  /**
   * ⛔ ONE BOOLEAN DECIDES BOTH, AND THAT IS THE WHOLE POINT. All three reviewers independently found
   * the same dead end in the previous shape: the declaration and tier picker hid on `existingCase`
   * while the panel that replaces them hid on `started`, so a status reply landing AFTER the seller
   * picked a tier — then a 429 on the challenge, or "Start over" — left both sides hidden and nothing
   * at all rendered below the header. Two conditions that must be exact complements cannot be written
   * twice; they are written once here and negated at the other site.
   */
  const showExistingPanel = !!existingCase && !challenge && !submitted && !terminal && !started

  // The rate-limit countdown line (static tr() parts + the live number interpolated in JS).
  const retryMsg = retrySecs > 0
    ? `${tr('Please wait', 'Vui lòng đợi')} ${retrySecs}${tr('s before trying again.', ' giây trước khi thử lại.')}`
    : null

  return (
    <>
      {/**
        * ⛔ `fallbackHref` POINTS AT THE HUB, NOT THE DEFAULT `/dashboard/listings`. This screen is
        * reached two ways — from the Verification section, and from a publish refusal — and on a
        * DEEP LINK there is no history to pop. Landing someone on their listings after they were
        * just told to verify is the dead end this page's own header warns about, one step later.
        */}
      <SectionHeader title={tr('Verify your identity', 'Xác minh danh tính')} fallbackHref="/dashboard/verification" />
      <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        {/* ⚠️ `hidden lg:flex` — SectionHeader already renders this title as the mobile bar, so an
            always-visible h1 put "Verify your identity" on the phone TWICE (two h1s). Desktop has
            no SectionHeader, so the h1 shows there. The description below stays on both. */}
        <h1 className="h-display hidden items-center gap-2 text-foreground lg:flex">
          {/* Identity verification is first-party trust → the eno seal, not lucide ShieldCheck
              (icon-language §0b). Washed chief carries the brand; the LINE is currentColor and
              inherits the heading's ink (§0) — a blue outline beside a near-black heading would
              spend §6's link-blue on a non-interactive mark. h-8 against the ~40px display
              heading: at h-6 the seal read as a bullet, not a signature (R2 critic). */}
          <ShieldCheck className="h-8 w-8" />
          {tr('Verify your identity', 'Xác minh danh tính')}
        </h1>
        <p className="text-body">
          {tr(
            'Vietnamese law requires sellers to verify their identity before publishing. Your documents are checked by VNPT eKYC, a licensed Vietnamese identity-verification provider.',
            'Theo quy định của pháp luật Việt Nam, người bán phải xác minh danh tính trước khi đăng tin. Giấy tờ của bạn được kiểm tra bởi VNPT eKYC — đơn vị xác minh danh tính được cấp phép tại Việt Nam.',
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {lang === 'vi' ? LEGAL_BASIS.identityDecree.vi : LEGAL_BASIS.identityDecree.en}
          {' · '}
          {lang === 'vi' ? LEGAL_BASIS.ecommerceLaw.vi : LEGAL_BASIS.ecommerceLaw.en}
        </p>
      </header>

      {/* ⚠️ THE DECLARATION COMES BEFORE THE UPLOAD BUTTONS, NOT AFTER.
          Putting it after — as a confirm step on submit — means the person has already spent five
          minutes photographing a passport, and the checkbox becomes something to click past to
          avoid losing that work. Read first, then act: it is the difference between a declaration
          and a toll. */}
      {/* INTRO ONLY — the declaration + tier choice show until a tier is picked; then the flow
          becomes a one-step-at-a-time wizard (owner, 2026-09-02) and this is out of the way. */}
      {(!challenge || !tier) && !submitted && !terminal && !showExistingPanel && (
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <h2 className="h-section text-foreground">{tr('Your declaration', 'Cam đoan của bạn')}</h2>
        {/* whitespace-pre-line: the text is authored as numbered lines and must render that way. */}
        <p className="whitespace-pre-line text-sm leading-relaxed text-body">{body}</p>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-muted/40 p-3">
          {/* ⚠️ NEVER PRE-CHECKED. buildDeclaration() refuses a record without explicit acceptance,
              and a pre-ticked box would make that server-side guard a formality over a UI that had
              already decided for the user.
              h-5: ONE check-this shape across the dashboard. The primitive's h-4 default under the
              7px radius token renders as a CIRCLE (radio-shaped) — at h-5 the same radius reads as
              the rounded square the listing-row select and availability boxes already draw. */}
          <Checkbox checked={accepted} onChange={setAccepted} className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="text-sm font-medium text-foreground">
            {tr(
              'I have read the above and I confirm it is true. I accept legal responsibility for this declaration.',
              'Tôi đã đọc nội dung trên và xác nhận là đúng sự thật. Tôi chịu trách nhiệm trước pháp luật về nội dung cam đoan này.',
            )}
          </span>
        </label>
      </section>
      )}

      {/* ⚠️ NO aria-disabled HERE. A <section> has an implicit role=region, which does not support
          it — so it announces nothing while looking like an accessibility affordance. The real
          signal is on the buttons, which carry a genuine `disabled`. */}
      <section className="space-y-3">
        {(!challenge || !tier) && !submitted && !terminal && !showExistingPanel && (<>
        <h2 className="h-section text-foreground">{tr('Choose how to verify', 'Chọn cách xác minh')}</h2>

        {/* ⚠️ DISABLED, NOT HIDDEN. Hiding the options until the box is ticked leaves the page
            looking broken — a declaration with no visible consequence. Showing them greyed makes
            the causal link obvious: read, agree, then these become available. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            type="button"
            variant={tier === 'A' ? 'cta' : 'outline'}
            disabled={!accepted || retrySecs > 0}
            onClick={() => void start('A')}
            aria-busy={starting && tier === 'A'}
            className="h-auto flex-col items-start gap-1 rounded-2xl p-4 text-left"
          >
            {/* §2: tier-choice leads are BUTTON content, not nav chrome — the hand-typed 2.25
                was tier drift; the UI default (lucide's own 2) is the law for this surface. */}
            <span className="flex items-center gap-2 font-bold"><Fingerprint className="h-5 w-5" />{tr('Vietnamese citizen', 'Công dân Việt Nam')}</span>
            <span className="text-xs font-normal opacity-80">{tr('VNeID or CCCD — about two minutes', 'VNeID hoặc CCCD — khoảng hai phút')}</span>
          </Button>
          <Button
            type="button"
            variant={tier === 'B' ? 'cta' : 'outline'}
            disabled={!accepted || retrySecs > 0}
            onClick={() => void start('B')}
            aria-busy={starting && tier === 'B'}
            className="h-auto flex-col items-start gap-1 rounded-2xl p-4 text-left"
          >
            <span className="flex items-center gap-2 font-bold"><IdCard className="h-5 w-5" />{tr('Foreign resident', 'Người nước ngoài')}</span>
            {/* ⚠️ THIS SENTENCE WAS FALSE AND HAD TO CHANGE. It said "read on your device, not
                uploaded" — true when the plan was local-only MRZ reading, and untrue the moment
                VNPT makes the decision, because their API takes an uploaded image hash. On a page
                asking someone for a passport, an inaccurate privacy claim is the worst possible
                thing to get wrong. It now names what actually happens, and the selfie, which the
                face-match step requires. */}
            {/* ⚠️ IT NO LONGER SAYS "sent to VNPT". That integration is blocked and v1 is human
                review by our own team, so the old sentence described a data flow that does not
                happen. This file's own history warns about exactly this: an inaccurate privacy
                claim on the page asking for a passport is the worst thing here to get wrong. */}
            <span className="text-xs font-normal opacity-80">{tr('Passport + a selfie — checked by our team', 'Hộ chiếu + ảnh chân dung — đội ngũ của chúng tôi kiểm tra')}</span>
          </Button>
        </div>
        </>)}

        {/* ⛔ THE LATE ANSWER, SHOWN RATHER THAN SWALLOWED — see the note on `started`. It sits ABOVE
            the wizard and never replaces it: the seller keeps every control they had, and simply learns
            before the photographs that this submission cannot be accepted (codex). */}
        {existingCase === 'pending' && started && !submitted && !terminal && (
          <Alert>
            <AlertDescription>
              {tr(
                'Heads up: you already have a verification in review, so sending another one will be refused. We will email you the result of the first.',
                'Lưu ý: bạn đã có một hồ sơ xác minh đang được xét duyệt, nên gửi thêm hồ sơ sẽ bị từ chối. Chúng tôi sẽ gửi email kết quả của hồ sơ đầu tiên.',
              )}
            </AlertDescription>
          </Alert>
        )}

        {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}

        {/* Live rate-limit countdown — exact seconds left, not a vague "try later" (owner). Ticks via
            the effect above; the tier buttons stay disabled until it hits 0. Built in JS (design-lint
            forbids a string literal in JSX). */}
        {retryMsg && (
          <p role="status" aria-live="polite" className="text-sm font-semibold text-destructive">{retryMsg}</p>
        )}

        {showExistingPanel ? (
          // ⚠️ READ BEFORE ANY WORK STARTS — see the note on `existingCase`. The two states DIFFER, and
          // an earlier version of this comment claimed both were dismissible when only one is (fable):
          //  · `verified` IS dismissible — that seller may be here precisely because they renewed the
          //    passport the record was built on, and the route will accept the new document.
          //  · `pending` is NOT, because the route refuses a second pending case outright; a "do it
          //    anyway" button would walk them through both photographs to a certain refusal.
          // ⚠️ Which is correct only while /status reports `pending` exactly when the submit route
          // answers `already_pending`. Both read the same table today — deriveVerification returns
          // pending iff a pending row exists — so they agree by construction. If that route ever grows
          // a state the submit path does not treat as blocking, this stops being a warning and becomes
          // a lock, and it will be silent: "fails open" covers errors, not wrong well-formed answers.
          <div className="space-y-3">
            <Alert>
              <AlertDescription>
                {existingCase === 'pending'
                  ? tr(
                      'You already have a verification with us and a reviewer is looking at it. There is nothing to send again — we will email you the result, usually within a working day.',
                      'Bạn đã có một hồ sơ xác minh và nhân viên của chúng tôi đang xem xét. Bạn không cần gửi lại — chúng tôi sẽ gửi email kết quả, thường trong một ngày làm việc.',
                    )
                  : tr(
                      'Your identity is already verified. You only need to do this again if your document has been renewed or replaced.',
                      'Danh tính của bạn đã được xác minh. Bạn chỉ cần làm lại nếu giấy tờ đã được gia hạn hoặc thay mới.',
                    )}
              </AlertDescription>
            </Alert>
            {/* ⛔ NO "DO IT ANYWAY" UNDER `pending`. The route refuses a second pending case outright,
                so that button would walk the seller through both photographs to a refusal that was
                certain before they started — and cost them one of five daily submissions doing it
                (codex). `verified` is different: there IS no pending row, so a renewed document is a
                submission the route will genuinely accept. */}
            {existingCase === 'verified' ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setExistingCase(null)}>
                {tr('Verify a renewed document', 'Xác minh giấy tờ đã gia hạn')}
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => router.push('/dashboard/verification')}>
                {tr('Back to verification', 'Quay lại phần xác minh')}
              </Button>
            )}
          </div>
        ) : terminal ? (
          // ⛔ INSTEAD OF THE TIER PICKER, not beside it. The whole point is that the next thing on
          // screen must not be an invitation to do the thing that just failed for a reason a retake
          // cannot change. "Try a different way" is still offered, because a rejected document can be
          // replaced (a renewed passport) and a duplicate can be resolved — just not right now.
          <div className="space-y-3">
            <Alert>
              <AlertDescription>{lang === 'vi' ? terminal.vi : terminal.en}</AlertDescription>
            </Alert>
            {/* ⚠️ THE ACTION FOLLOWS THE OUTCOME. Offering "back to verification options" under
                `already_pending` or `rate_limited` invites exactly the restart the sentence above it
                just called pointless (codex) — so those two send the seller OUT, to the hub, and only
                the outcomes a different document or a later day can change offer a way back in. */}
            {terminal.resumable ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setTerminal(null)}>
                {tr('Try a different document', 'Thử giấy tờ khác')}
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => router.push('/dashboard/verification')}>
                {tr('Back to verification', 'Quay lại phần xác minh')}
              </Button>
            )}
          </div>
        ) : submitted ? (
          <Alert>
            <AlertDescription>
              {tr(
                'Sent. A person reviews this by hand, usually within a working day, and we will email you the result.',
                'Đã gửi. Một nhân viên sẽ kiểm tra thủ công, thường trong một ngày làm việc, và chúng tôi sẽ gửi email kết quả.',
              )}
            </AlertDescription>
          </Alert>
        ) : challenge && tier ? (
          // ⚠️ ONE STEP AT A TIME (owner, 2026-09-02) via the shared <StepWizard>: a top rail showing
          // done / current / remaining, one step's body, the action pinned to the bottom on mobile and
          // inline on desktop. document → selfie advance themselves as each photo commits; details
          // carries the submit. Back (header) steps back and clears downstream captures; Start over
          // (below) is the always-present escape hatch for an expired single-use challenge.
          <StepWizard
            steps={wizardSteps}
            current={wizardStep}
            offsetBottom="4.5rem"
            actionBarLabel={tr('Identity verification', 'Xác minh danh tính')}
            className="rounded-2xl border border-border bg-card p-5"
            header={
              <button
                type="button"
                onClick={goBack}
                // ⛔ Disabled while a submit is in flight: Back clears downstream state, and letting it
                // fire mid-submit would race the request — it could resolve against a flow the user
                // already navigated away from (codex). Same reason as Start over below.
                disabled={submitting}
                className="press mb-4 -ml-1 inline-flex items-center gap-1 self-start text-sm font-semibold text-muted-foreground disabled:opacity-50"
              >
                <ChevronLeft className="size-4" aria-hidden /> {tr('Back', 'Quay lại')}
              </button>
            }
            {...(wizardStep === 'details'
              ? {
                  primaryAction: {
                    label: tr('Send for review', 'Gửi để xét duyệt'),
                    onClick: () => void submit(),
                    // ⛔ A DISAGREEMENT BLOCKS SEND. Letting it through means the seller's correction
                    // is silently discarded in favour of a check-valid misread — see mrzDisagreement.
                    disabled: submitting || !documentPath || !selfiePath || detailsIncomplete || !!mrzDisagreement,
                    icon: submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : undefined,
                  },
                }
              : {})}
          >
            {/* ── STEP 1: document — guided LIVE capture, cropped to the page (clean read) ── */}
            {wizardStep === 'document' && (
              <div>
                <h3 className="font-bold text-foreground">
                  {tier === 'A' ? tr('Photograph your CCCD', 'Chụp ảnh CCCD') : tr('Photograph your passport page', 'Chụp trang hộ chiếu')}
                </h3>
                <p className="mt-1 text-sm text-body">
                  {tier === 'A'
                    ? tr('The side with your photo. Line it up inside the frame.', 'Mặt có ảnh của bạn. Căn thẻ vào trong khung.')
                    : tr('The page with your photo and the two lines of code at the bottom. Line it up inside the frame.', 'Trang có ảnh của bạn và hai dòng mã ở dưới cùng. Căn trang vào trong khung.')}
                </p>
                <KycCapture
                  // ⚠️ key={tier}: remount on a tier switch so a CCCD shot cannot linger and re-fire
                  // the OCR effect, and a passport shot cannot carry into a tier-A attempt.
                  key={tier}
                  kind="document"
                  guide={tier === 'B' ? 'passport' : 'id'}
                  alt={tier === 'A' ? tr('Your CCCD photo', 'Ảnh CCCD của bạn') : tr('Your passport photo', 'Ảnh hộ chiếu của bạn')}
                  onUploaded={onDocUploaded}
                  {...(tier === 'B' ? { onImage: onDocImage } : {})}
                  className="mt-3"
                />
              </div>
            )}

            {/* ── STEP 2: selfie — the code shown large AND overlaid beside the face in the camera ── */}
            {wizardStep === 'selfie' && (
              <div>
                <h3 className="font-bold text-foreground">{tr('Take a selfie', 'Chụp ảnh chân dung')}</h3>
                {/* ⛔ THE PAPER CODE IS GONE (owner, 2026-09-04) and with it the step's whole former
                    argument: a stolen document photo could not produce a LIVE selfie of its owner
                    holding TODAY's code, and now nothing ties the selfie to a moment. What remains is
                    what a reviewer can still do by eye — compare this face against the passport
                    photograph. ⚠️ The challenge itself is STILL ISSUED: it is the consent receipt, and
                    `/api/seller/identity/documents` refuses an upload without a live one. It is simply
                    no longer shown to anyone. */}
                <p className="mt-1 text-sm text-body">
                  {tr('Look straight at the camera with your face inside the oval, in good light.', 'Nhìn thẳng vào máy ảnh, đưa khuôn mặt vào khung oval, nơi đủ sáng.')}
                </p>
                <KycCapture kind="selfie" guide="selfie" alt={tr('Your selfie', 'Ảnh chân dung của bạn')} onUploaded={onSelfieUploaded} className="mt-3" />
              </div>
            )}

            {/* ── STEP 3: confirm details (pre-filled by the passport scan); submit is the shell CTA ── */}
            {wizardStep === 'details' && (
            <div className="space-y-3">
              <h3 className="font-bold text-foreground">{tr('Check your details', 'Kiểm tra thông tin')}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel>{tr('Surname', 'Họ')}</FieldLabel>
                  <Input value={surname} onChange={(e) => { setSurname(e.target.value); markEdited() }} autoComplete="family-name" />
                </Field>
                <Field>
                  <FieldLabel>{tr('Given names', 'Tên')}</FieldLabel>
                  <Input value={givenNames} onChange={(e) => { setGivenNames(e.target.value); markEdited() }} autoComplete="given-name" />
                </Field>
                <Field>
                  <FieldLabel>{tier === 'A' ? tr('CCCD number', 'Số CCCD') : tr('Passport number', 'Số hộ chiếu')}</FieldLabel>
                  <Input value={documentNumber} onChange={(e) => { setDocumentNumber(e.target.value); markEdited() }} inputMode="text" />
                </Field>
                <Field>
                  <FieldLabel>{tr('Expiry date', 'Ngày hết hạn')}</FieldLabel>
                  <Input type="date" value={documentExpiry} onChange={(e) => { setDocumentExpiry(e.target.value); markEdited() }} />
                </Field>
              </div>

              {/*
                ⛔ THE MRZ IS ASKED FOR ON A PASSPORT AND ONLY ON A PASSPORT, and it is not busywork:
                `decideTierB` REJECTS a tier B case that was not read reliably, and with the provider
                integration blocked the check digits in these two lines are the only reliable read
                available. A CCCD has no MRZ, and its branch does not ask for one.
              */}
              {/*
                ⛔ THE RAW LINES ARE FOR TYPING, NOT FOR CHECKING — and showing them after a good scan
                asked the seller to do something impossible. What goes in these boxes is DERIVED, not
                transcribed: line 1 is deliberately name-less on every path (see nameLess above, so a
                misread name cannot overrule the typed one), and a FUSED line 2 carries filler in the
                optional-data field and a freshly computed composite. Neither matches what is printed
                on the passport. The copy nonetheless said "these are the two lines across the bottom
                of your passport page — check they are right", so the owner compared them to his own
                passport, found they did not match, and reported it as a bug. He was reading the
                screen correctly; the screen was wrong.
                So they appear only when the scan did NOT deliver and the seller has to type them.
              */}
              {/* SCAN STATUS — always visible for tier B. ⚠️ It must live OUTSIDE the typing block
                  below: hiding the raw lines after a good read would otherwise have taken the
                  "Read from your passport" confirmation and the name-still-needed hint with it. */}
              {tier === 'B' && (
                <div className="space-y-2">
                  {scan === 'reading' && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden /> {tr('Reading your passport…', 'Đang đọc hộ chiếu…')}
                    </p>
                  )}
                  {scan === 'ok' && (
                    <>
                      <p className="text-xs font-medium text-success" role="status">
                        {tr('Read from your passport — please check the details above.', 'Đã đọc từ hộ chiếu — vui lòng kiểm tra thông tin ở trên.')}
                      </p>
                      {/* A name-less read still needs the name typed — surface that here, not just on failure. */}
                      {scanHint && (
                        <Alert>
                          <AlertDescription className="text-xs">{lang === 'vi' ? scanHint.vi : scanHint.en}</AlertDescription>
                        </Alert>
                      )}
                    </>
                  )}
                  {scan === 'failed' && (
                    <Alert>
                      <AlertDescription className="text-xs">
                        {scanHint
                          ? (lang === 'vi' ? scanHint.vi : scanHint.en)
                          : tr('We could not read your passport this time — please type the two lines below.', 'Lần này chúng tôi không đọc được hộ chiếu — vui lòng tự nhập hai dòng bên dưới.')}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}

              {/* ⛔ COLLAPSED AFTER A GOOD READ, NEVER REMOVED — and the difference matters. Hiding
                  these outright made a whole class of misread UNCORRECTABLE: the MRZ check digits are
                  mod-10, so any swap whose character values differ by a multiple of ten (G↔6, S↔8,
                  L↔1) leaves every checksum valid. A passport number misread that way passes, the
                  seller is told to "check the details above", they fix the visible field — and the
                  hidden line 2 still carries the misread and is what gets submitted.
                  ⚠️ NOT WHILE A READ IS IN FLIGHT either: inviting someone to type beside
                  "Reading your passport…" is what strands a half-typed line. */}
              {mrzDisagreement && (
                <Alert variant="destructive">
                  <AlertDescription className="text-xs">
                    {lang === 'vi' ? mrzDisagreement.vi : mrzDisagreement.en}
                  </AlertDescription>
                </Alert>
              )}
              {tier === 'B' && mrzDerived && scan === 'ok' && !mrzDisagreement
                && !mrzTypedRef.current && (mrzLine1.trim() || mrzLine2.trim()) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={mrzRevealed}
                  aria-controls="mrz-lines"
                  className="h-auto self-start p-0 text-xs font-medium text-muted-foreground underline underline-offset-2"
                  // ⚠️ A TOGGLE, NOT A ONE-WAY REVEAL — and it stays mounted. Unmounting the control
                  // on click drops keyboard focus to <body>. It also no longer calls `markEdited()`:
                  // opening a panel changes no data, and that ref gates whether later reads may
                  // prefill the NAME fields, which has nothing to do with looking at the code lines.
                  onClick={() => setMrzRevealed((v) => !v)}
                >
                  {mrzRevealed
                    ? tr('Hide the code lines', 'Ẩn hai dòng mã')
                    : tr('Show the code lines', 'Hiện hai dòng mã')}
                </Button>
              )}
              {/* ⛔ COLLAPSED ONLY ON A SUCCESSFUL READ THE SELLER HAS NOT OPENED. Every other state
                  renders the inputs, INCLUDING while a read is in flight: gating them off during
                  `reading` stranded anyone whose OCR engine never resolved — "Reading your passport…"
                  forever, no inputs, and no way back to the manual path this block exists to be. */}
              {/* ⛔ COLLAPSES ONLY ON A CLEAN, UNTOUCHED, AGREEING READ — every other state renders the
                  inputs. Each clause is a bug that happened: `mrzRevealed` for the seller who opened
                  it; `mrzTypedRef` because the first Backspace in line 2 made the line invalid, which
                  made the disagreement vanish, which unmounted the inputs under the cursor;
                  `mrzDisagreement` so a mod-10 misread cannot be corrected out of sight; and
                  `scan === 'ok'` so a hung engine never hides the manual fallback. Expressed as one
                  condition rather than an effect — the effect version was a conditional hook. */}
              {tier === 'B' && !(
                mrzDerived && scan === 'ok' && !mrzRevealed && !mrzDisagreement
                && !mrzTypedRef.current && !mrzProblem
              ) && (
                <div id="mrz-lines" className="space-y-2">
                  {/* ⛔ THE COPY MUST MATCH WHAT IS ACTUALLY IN THE BOXES. "Exactly as printed" is
                      right when the seller is typing from the passport, and WRONG when a scan filled
                      these: line 1 is name-less by design and a fused line 2 carries filler and a
                      recomputed composite, so neither matches the page. Telling someone to compare
                      them to their passport is what produced the original bug report. */}
                  {/* ⛔ KEYED ON WHERE THE VALUES CAME FROM, NOT ON WHETHER THE BOXES HAVE TEXT. The
                      earlier version checked the box contents, so on the MANUAL path the instruction
                      flipped from "type exactly as printed" to "these are derived" on the seller's
                      FIRST KEYSTROKE — the opposite of what they need. And the derived copy no longer
                      claims the typed number "takes priority": the server prefers MRZ-derived fields,
                      so saying otherwise would be a false promise about the one value that matters. */}
                  <p className="text-xs text-muted-foreground">
                    {mrzDerived
                      ? tr(
                          'These are rebuilt from what we read, so they will not match your passport character for character. They are also what we check your details against — so if the number or dates above are wrong, correct them HERE, or retake the photo.',
                          'Hai dòng này được dựng lại từ kết quả đọc nên sẽ không trùng khớp từng ký tự với hộ chiếu. Đây cũng là phần chúng tôi dùng để đối chiếu — nếu số hộ chiếu hoặc ngày tháng ở trên bị sai, hãy sửa Ở ĐÂY, hoặc chụp lại ảnh.',
                        )
                      : tr(
                          'Type the two lines of letters and numbers across the bottom of your passport page, exactly as printed.',
                          'Hãy nhập hai dòng chữ và số ở cuối trang hộ chiếu, đúng như in trên hộ chiếu.',
                        )}
                  </p>
                  <Input value={mrzLine1} onChange={(e) => { setMrzLine1(e.target.value); mrzTypedRef.current = !!(e.target.value.trim() || mrzLine2.trim()); markEdited() }} placeholder="P<VNMNGUYEN<<VAN<A<<<<<<<<<<<<<<<<<<<<<<<<<<" className="font-mono" />
                  <Input value={mrzLine2} // ⚠️ CLEARED WHEN BOTH BOXES ARE EMPTY AGAIN. A single keystroke followed by Backspace otherwise
                    // left the ref true with nothing in the boxes, so the next read filled them with derived
                    // lines under "type exactly as printed" — the original report, one undo away.
                    onChange={(e) => { setMrzLine2(e.target.value); mrzTypedRef.current = !!(e.target.value.trim() || mrzLine1.trim()); markEdited() }} placeholder="C12345678VNM9001011M3001011<<<<<<<<<<<<<<04" className="font-mono" />
                  {/* Live diagnosis of a typed/edited MRZ — see mrzProblem. role=status, not alert:
                      it changes on every keystroke and must not interrupt a screen reader mid-word. */}
                  {mrzProblem && (
                    <p role="status" aria-live="polite" className="text-xs font-medium text-destructive">{mrzProblem}</p>
                  )}
                  {mrzValid && (
                    <p role="status" className="text-xs font-medium text-success">{tr('Both lines check out.', 'Hai dòng đã khớp.')}</p>
                  )}
                </div>
              )}
            </div>
            )}

            {/* ⛔ NAME WHAT IS STILL MISSING. `detailsIncomplete` disables Send, and a disabled button
                explains nothing — a seller whose scan came back name-less (a fused MRZ is deliberately
                name-less) saw "Read ✓" and a dead Send with no connection between them (codex). This is
                the same predicate the button uses, rendered as a sentence. */}
            {wizardStep === 'details' && sendBlockedReason && (
              <p role="status" aria-live="polite" className="text-xs font-medium text-muted-foreground">{sendBlockedReason}</p>
            )}

            {/* ⛔ ALWAYS AN ESCAPE HATCH. The challenge is single-use and time-limited: if it expires
                between the document and the selfie, the selfie upload 403s and the submit stays
                disabled with no way forward (reviewer-caught). Rather than special-case every stuck
                state, one "Start over" is always here — it clears the burned challenge and both
                photos so a fresh attempt gets a fresh code. It is the wizard's last child, so it sits
                below the step body and above the (mobile) action bar / (desktop) inline submit. */}
            <button
              type="button"
              onClick={() => resetAttempt({ refreshStatus: true })}
              disabled={submitting}
              className="mx-auto mt-5 block text-xs font-semibold text-muted-foreground underline underline-offset-2 disabled:opacity-50"
            >
              {tr('Start over', 'Bắt đầu lại')}
            </button>
          </StepWizard>
        ) : null}

      </section>

      {/*
        ⛔ REWRITTEN BECAUSE THE OLD TEXT DESCRIBED A DATA FLOW THAT DOES NOT HAPPEN. It said the
        images go to VNPT and that "eno.vn deletes its own copy as soon as the check finishes" —
        true of the planned provider integration, false of what v1 does, which is hold both images
        in our own private storage for a person on our team to look at. This file's own history
        already records one correction for exactly this class of error; an inaccurate privacy claim
        on the page asking for a passport is the worst thing on it to get wrong.
      */}
      <p className="text-xs text-muted-foreground">
        {tr(
          'Your two photographs are stored privately by eno.vn and are opened only by a reviewer on our team, through a link that expires in ten minutes. We keep the result, the document expiry date, and a one-way fingerprint that lets us spot duplicate accounts — never the document number itself.',
          'Hai ảnh của bạn được eno.vn lưu trữ riêng tư và chỉ được mở bởi nhân viên xét duyệt của chúng tôi, qua đường dẫn hết hạn sau mười phút. Chúng tôi lưu kết quả, ngày hết hạn giấy tờ và một dấu vân tay một chiều để phát hiện tài khoản trùng lặp — không bao giờ lưu số giấy tờ.',
        )}
      </p>
      </div>
      {/* Diagnostic only — gated on ?mrzdebug=1 / #mrzdebug, and shown only once a capture has produced
          trace data. A real seller never sees this. */}
      {mrzDebug && tier === 'B' && dbg.length > 0 && (
        // pointer-events-none so it never blocks the buttons underneath; flex-col justify-end pins the
        // newest lines (the result) to the bottom, visible even if the trace overflows.
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex max-h-[32vh] flex-col justify-end overflow-hidden whitespace-pre-wrap break-all bg-black/90 p-2 font-mono text-3xs leading-tight text-success">
          {dbg.join('\n')}
        </div>
      )}
    </>
  )
}
