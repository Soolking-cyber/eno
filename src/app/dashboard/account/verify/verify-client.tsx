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
import { readMrz, type MrzFieldPool } from '@/lib/identity/mrz-ocr'
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

export function VerifyClient() {
  const { tr, lang } = useLanguage()
  const { user, loading } = useAuth()
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
  const [mrzLine2, setMrzLine2] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    setMrzLine1(''); setMrzLine2('')
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
    try {
      await eng.ready() // one-time ~6MB warm-up, outside the read timeout
      if (uploadId !== latestUploadRef.current || engineRef.current !== eng || docAttemptRef.current !== attemptRef.current) return
      let timer: ReturnType<typeof setTimeout> | undefined
      // ⚠️ SINGLE-CAPTURE SCOPE. The four preprocessing variants of THIS still are fused internally by
      // readMrz — that is what recovers a valid MRZ from an imperfect webcam frame. Cross-CAPTURE pooling
      // was removed: the wizard advances to the selfie the moment a document uploads, and the only way
      // back clears the attempt, so a "second capture" the pool could complete is unreachable through the
      // UI (all three reviewers, 2026-09-02) — and persisting fields across captures risked fusing two
      // documents. Each capture is therefore self-contained; an incomplete read falls back to typing.
      const read = readMrz(img, eng.engine).finally(() => { if (timer) clearTimeout(timer) })
      void read.catch(() => {}) // a timeout-loser rejection must not become an unhandledrejection
      const result = await Promise.race([
        read,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('ocr_timeout')), 45000) }),
      ])
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
        const nameLess = (l1: string) => (l1.slice(0, 5) + '<'.repeat(44)).slice(0, 44)
        setMrzLine1((v) => v.trim() ? v : nameLess(result.lines[0]))
        setMrzLine2((v) => v.trim() ? v : result.lines[1])
        if (f.surname) setSurname((v) => v.trim() ? v : f.surname!)
        if (f.givenNames) setGivenNames((v) => v.trim() ? v : f.givenNames!)
        if (f.passportNumber) setDocumentNumber((v) => v.trim() ? v : f.passportNumber!)
        if (f.passportExpiryDate) setDocumentExpiry((v) => v ? v : f.passportExpiryDate!.slice(0, 10))
        setScan('ok')
        // ⚠️ A NAME-LESS read (line 2 recovered, line 1 not) fills the number + dates but not the name,
        // which is now required to submit. Without this the user saw "Read ✓" yet Send stayed disabled
        // with nothing explaining why (codex/fable, 2026-09-02). Tell them to type it; a read that DID
        // carry a name clears the hint.
        setScanHint(!f.surname && !f.givenNames
          ? { en: 'We read your passport number and dates — please type your name as printed on the passport to finish.',
              vi: 'Chúng tôi đã đọc số hộ chiếu và ngày tháng — vui lòng nhập họ tên như in trên hộ chiếu để hoàn tất.' }
          : null)
      } else if (userEditedRef.current) {
        setScan('idle') // the user is typing it themselves; don't nag with a scan error
      } else {
        setScan('failed'); setScanHint(missingFieldsHint(result.missing, result.pool))
      }
    } catch {
      // A wedged read of the CURRENT upload: rebuild the engine so a retake scans fresh. Epoch-guarded so
      // an abandoned document's late timeout can't stamp 'failed' onto a fresh attempt (codex, 2026-09-02).
      if (uploadId === latestUploadRef.current && engineRef.current === eng && docAttemptRef.current === attemptRef.current) {
        void eng.terminate(); engineRef.current = null; setScan('failed')
      }
    }
  }, [])

  /**
   * ⚠️ ONE CALL, AND IT CARRIES THE VERSION THE PAGE ACTUALLY RENDERED — not whatever is current
   * server-side when it lands. If a new declaration shipped between page load and click, stamping
   * the current one would attribute to this person a wording they never read.
   */
  const start = useCallback(async (chosen: 'A' | 'B') => {
    attemptRef.current += 1 // a (re)started attempt — any in-flight decode from the prior one is now abandoned
    setTier(chosen)
    setError(null)
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
  const resetAttempt = useCallback(() => {
    attemptRef.current += 1 // abandon this attempt: a decode still in flight is now for a stale epoch
    // ⚠️ CLEARS EVERYTHING, so the "we cleared the form" copy is true and a restarted tier-A attempt
    // cannot carry stale tier-B MRZ text. `accepted` stays — the declaration was read, not undone.
    setChallenge(null); setTier(null); setDocumentPath(null); setSelfiePath(null)
    setSurname(''); setGivenNames(''); setDocumentNumber(''); setDocumentExpiry(''); setMrzLine1(''); setMrzLine2('')
    setScan('idle'); setScanHint(null)
    void engineRef.current?.terminate(); engineRef.current = null // free the worker; don't leave OCR running
    // No latestUploadRef reset needed: KycCapture's upload id is module-global and only increases, so
    // the next attempt's scan always has a higher id than any we've accepted here.
  }, [])

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
          mrzLine2: tier === 'B' ? (mrzLine2.trim().toUpperCase() || undefined) : undefined,
        }),
      })
      // ⛔ ANY FAILURE HERE HAS ALREADY BURNED THE CHALLENGE (consumeChallenge burns the code on
      // every answer), so retrying the SAME submit only hits `no_challenge` and re-uploading now
      // 403s — the reviewer's stranding path. Reset to the start instead: the next attempt issues a
      // fresh code and takes fresh photos. (The 60s issue cooldown is handled by `start`, which
      // shows "please wait a moment" on a 429.)
      if (!r.ok || ((await r.clone().json().catch(() => ({}))) as { ok?: boolean }).ok === false) {
        resetAttempt()
        setError(tr(
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
  }, [tier, challenge, documentPath, selfiePath, surname, givenNames, documentNumber, documentExpiry, mrzLine1, mrzLine2, tr])

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
    { key: 'selfie', icon: <User className="size-4" />, label: tr('Selfie with code', 'Ảnh chân dung cùng mã') },
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
  const mrzValid = tier === 'B' && !!mrzLine1.trim() && !!mrzLine2.trim() && parsePassportMrz(mrzLine1, mrzLine2).valid
  // ⚠️ AT LEAST ONE name part, NOT both. Many holders have a single legal name (a mononym) whose passport
  // carries no given name — requiring both permanently locked them out of submit (agy, 2026-09-02). This
  // still blocks a fully nameless read (both empty), which is the case that mattered.
  const nameMissing = !surname.trim() && !givenNames.trim()
  const detailsIncomplete = tier === 'A'
    ? (!surname.trim() || !givenNames.trim() || !documentNumber.trim() || !documentExpiry)
    : (!mrzValid || nameMissing)

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
      {(!challenge || !tier) && !submitted && (
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
        {(!challenge || !tier) && !submitted && (<>
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

        {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}

        {/* Live rate-limit countdown — exact seconds left, not a vague "try later" (owner). Ticks via
            the effect above; the tier buttons stay disabled until it hits 0. Built in JS (design-lint
            forbids a string literal in JSX). */}
        {retryMsg && (
          <p role="status" aria-live="polite" className="text-sm font-semibold text-destructive">{retryMsg}</p>
        )}

        {submitted ? (
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
                    disabled: submitting || !documentPath || !selfiePath || detailsIncomplete,
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
                {/* ⚠️ SURFACE THE CODE FROM STEP 1. The challenge is time-limited (~10 min from when the
                    tier was chosen), and the selfie step needs it WRITTEN on paper. Showing it only at
                    step 2 let a slow user burn the window on the document and reach the selfie with an
                    expired code (codex). Here they can write it down while doing the document photo. */}
                <div className="mt-3 rounded-xl border border-border bg-tint px-3 py-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {tr('Write this code on paper now — you will hold it in the selfie:', 'Viết mã này ra giấy ngay — bạn sẽ cầm nó trong ảnh chân dung:')}
                  </p>
                  <p className="mt-0.5 font-mono text-xl font-bold tracking-[0.3em] text-foreground">{challenge.code}</p>
                </div>
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
                <h3 className="font-bold text-foreground">{tr('Take a selfie with your code', 'Chụp ảnh chân dung cùng mã')}</h3>
                {/* ⛔ THE CODE IS THE WHOLE ANTI-FRAUD MECHANISM: a stolen document photo cannot produce
                    a LIVE selfie of its owner holding TODAY's code. Shown here to write down, and
                    overlaid in the live view so the framing is obvious. */}
                <p className="mt-1 text-sm text-body">
                  {tr('Write this code on paper and hold it beside your face. It is valid for only a few minutes.', 'Viết mã này ra giấy và cầm cạnh khuôn mặt. Mã chỉ có hiệu lực trong vài phút.')}
                </p>
                <p className="mt-2 font-mono text-3xl font-bold tracking-[0.3em] text-foreground">{challenge.code}</p>
                <KycCapture kind="selfie" guide="selfie" code={challenge.code} alt={tr('Your selfie with the code', 'Ảnh chân dung của bạn cùng mã')} onUploaded={onSelfieUploaded} className="mt-3" />
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
              {tier === 'B' && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      'These are the two lines of letters and numbers across the bottom of your passport page. We read them from your photo automatically — check they are right, or type them if the scan could not.',
                      'Đây là hai dòng chữ và số ở cuối trang hộ chiếu. Chúng tôi tự động đọc từ ảnh của bạn — hãy kiểm tra lại, hoặc tự nhập nếu quét không được.',
                    )}
                  </p>
                  {/* Scan status. The two inputs stay editable throughout: a valid MRZ read pre-fills
                      them and the details above, but the user always confirms, and can type instead. */}
                  {scan === 'reading' && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden /> {tr('Reading your passport…', 'Đang đọc hộ chiếu…')}
                    </p>
                  )}
                  {scan === 'ok' && (
                    <>
                      <p className="text-xs font-medium text-success" role="status">
                        {tr('Read from your passport — please check it is correct.', 'Đã đọc từ hộ chiếu — vui lòng kiểm tra lại.')}
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
                  <Input value={mrzLine1} onChange={(e) => { setMrzLine1(e.target.value); markEdited() }} placeholder="P<VNMNGUYEN<<VAN<A<<<<<<<<<<<<<<<<<<<<<<<<<<" className="font-mono" />
                  <Input value={mrzLine2} onChange={(e) => { setMrzLine2(e.target.value); markEdited() }} placeholder="C12345678VNM9001011M3001011<<<<<<<<<<<<<<04" className="font-mono" />
                </div>
              )}
            </div>
            )}

            {/* ⛔ ALWAYS AN ESCAPE HATCH. The challenge is single-use and time-limited: if it expires
                between the document and the selfie, the selfie upload 403s and the submit stays
                disabled with no way forward (reviewer-caught). Rather than special-case every stuck
                state, one "Start over" is always here — it clears the burned challenge and both
                photos so a fresh attempt gets a fresh code. It is the wizard's last child, so it sits
                below the step body and above the (mobile) action bar / (desktop) inline submit. */}
            <button
              type="button"
              onClick={resetAttempt}
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
    </>
  )
}
