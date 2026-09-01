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
import { Fingerprint, IdCard, ShieldCheck } from "@/components/ui/icons"
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
import { readMrz, readFailureHint } from '@/lib/identity/mrz-ocr'
import { createMrzOcrEngine } from '@/lib/identity/mrz-ocr-tesseract'
// ⛔ `declaration-text`, NOT `declaration` — the latter imports node:crypto, and a 'use client'
// file importing it drags the whole Node crypto polyfill into the browser (measured: 435 KB
// raw / 130 KB gzip, 44% of this route's JS). The text module exists for exactly this import.
import { DECLARATIONS, CURRENT_DECLARATION } from '@/lib/compliance/declaration-text'
import { LEGAL_BASIS } from '@/lib/compliance/legal-basis'

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

  // ── On-device passport MRZ scan (tier B) ──────────────────────────────────────────────────────
  // Reading the passport photo IN THE BROWSER and pre-filling the form was the owner's own design
  // (src/lib/identity/mrz-ocr.ts header, 2026-08-03). The Tesseract engine is created lazily on the
  // first scan and torn down on unmount; only tier B (passport, TD3 MRZ) scans — a CCCD has no TD3 MRZ.
  const [scan, setScan] = useState<'idle' | 'reading' | 'ok' | 'failed'>('idle')
  const [scanHint, setScanHint] = useState<{ en: string; vi: string } | null>(null)
  const engineRef = useRef<ReturnType<typeof createMrzOcrEngine> | null>(null)
  // ⚠️ The highest upload id we've accepted a scan for. KycCapture mints a MONOTONIC id per upload
  // (module-global, survives remounts), so a decode that resolves AFTER a newer upload arrives with a
  // LOWER id and is rejected — it can never overwrite the newer document's data. Latest-wins done
  // right: the id is the upload's identity, not a counter this handler bumps for itself.
  const latestUploadRef = useRef(0)
  // ⚠️ Has the user TYPED in a document field since the current scan began? If so, a successful scan
  // must NOT overwrite them — TD3 line 1 (the names) carries NO check digit, so a misread name would
  // silently replace a correct one and the server's check-digit re-derivation could never catch it.
  // The scan is a convenience pre-fill; once the user takes over by typing, their input wins.
  const userEditedRef = useRef(false)
  const markEdited = useCallback(() => { userEditedRef.current = true }, [])
  useEffect(() => () => { void engineRef.current?.terminate() }, [])

  // ⚠️ THE DOCUMENT UPLOAD IS WHERE STALE DATA IS INVALIDATED — synchronously, before any async OCR.
  // A new upload = a new stored document, so the previous MRZ + details (scanned OR typed for the OLD
  // image) no longer correspond to it and must be gone the instant documentPath changes. Clearing
  // here (not after the decode) closes the window where documentPath already points at the new image
  // while the fields still hold the old one's data — the mixed-document hole. onImage's scan (below)
  // then refills from THIS document. Wired for tier B only; tier A (CCCD) has no MRZ scan.
  const onDocUploaded = useCallback((path: string, uploadId: number) => {
    // ⚠️ MARK THIS UPLOAD THE NEWEST NOW — at upload time, BEFORE its async OCR decode. This closes
    // the window where documentPath already points at the new image but an OLDER in-flight scan can
    // still match latestUploadRef and fill the previous document's data against the new path. The
    // field clear (below) is the synchronous half; this ref bump is the guard the decode reads.
    latestUploadRef.current = uploadId
    userEditedRef.current = false // fresh document — the upcoming scan may pre-fill freely
    setMrzLine1(''); setMrzLine2('')
    setSurname(''); setGivenNames(''); setDocumentNumber(''); setDocumentExpiry('')
    setScan('idle'); setScanHint(null)
    setDocumentPath(path)
  }, [])

  const onDocImage = useCallback(async (img: ImageData | null, uploadId: number) => {
    // ⚠️ REJECT A STALE DECODE. uploadId only increases (module-global in KycCapture), and onDocUploaded
    // already set latestUploadRef to the newest upload's id. An id below it belongs to a superseded
    // shot whose result would describe a different document than the one now stored — drop it.
    if (uploadId < latestUploadRef.current) return
    // A null decode (very old engine, corrupt/OOM file) is not a "reading" — surface it as a failure
    // so the user is told to type the lines (the fields were already cleared by onDocUploaded).
    if (!img) { setScan('failed'); setScanHint(null); return }
    setScan('reading')
    setScanHint(null)
    // ⚠️ DO NOT reset userEditedRef here — onDocUploaded already reset it at upload time, and the user
    // may have started typing during the decode window between then and now. Resetting here would
    // forget that and let the scan overwrite them.
    if (!engineRef.current) engineRef.current = createMrzOcrEngine()
    // ⚠️ CAPTURE the engine — a reset/tier-switch can null or replace engineRef mid-scan, and the
    // catch must be able to tell "my engine wedged" from "my attempt was abandoned" (identity check).
    const eng = engineRef.current
    try {
      // ⚠️ WARM THE WORKER OUTSIDE THE READ TIMEOUT. The one-time ~6MB download+compile must not count
      // against the 20s read budget, or a slow-network user times out mid-download and re-fetches from
      // zero every retry (fable's finding). `ready()` is unbounded save a generous 90s hung-fetch cap;
      // the race below then bounds only the recognition, which is fast once loaded.
      await eng.ready()
      // ⚠️ engineRef.current === eng in the RESULT path too, not just the catch. During the long
      // ready() a reset/tier-switch can null or replace the engine; without this check the resumed
      // scan would fill the OLD passport's data into the new/reset attempt (a tier-A submit carrying
      // the previous passport's number against a CCCD photo). Bail unless we're still the live scan.
      if (uploadId !== latestUploadRef.current || engineRef.current !== eng) return
      // clearTimeout on settle so a resolved read leaves no orphaned 20s timer / dangling rejection.
      let timer: ReturnType<typeof setTimeout> | undefined
      const read = readMrz(img, eng.engine).finally(() => { if (timer) clearTimeout(timer) })
      // ⚠️ If the TIMEOUT wins the race, `read` is still pending; the catch below terminates the
      // worker, which later rejects that recognize. Swallow it here so it isn't an unhandledrejection
      // in prod error telemetry (fable). The race still awaits `read` for the real result when it wins.
      void read.catch(() => {})
      const result = await Promise.race([
        read,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('ocr_timeout')), 45000) }),
      ])
      if (uploadId !== latestUploadRef.current || engineRef.current !== eng) return // superseded/abandoned — drop it
      if (result.ok) {
        // ⚠️ DEFER TO A USER WHO STARTED TYPING during the read. Overwriting their input with an
        // imperfect scan is unsafe on the name lines especially (TD3 line 1 has no check digit). If
        // they took over, keep their values and just clear the "reading…" status.
        if (userEditedRef.current) { setScan('idle'); return }
        // ⚠️ Autofill the MRZ LINES — the submit path (kyc/service.ts) re-derives the fields from
        // these authoritatively when the check digits pass. The field pre-fill below is a READABLE
        // PREVIEW so the user can confirm the read; it stays editable and a valid MRZ wins server-side.
        setMrzLine1(result.lines[0])
        setMrzLine2(result.lines[1])
        const f = result.mrz.fields
        if (f.surname) setSurname(f.surname)
        if (f.givenNames) setGivenNames(f.givenNames)
        if (f.passportNumber) setDocumentNumber(f.passportNumber)
        if (f.passportExpiryDate) setDocumentExpiry(f.passportExpiryDate.slice(0, 10))
        setScan('ok')
      } else {
        setScanHint(readFailureHint(result))
        setScan('failed')
      }
    } catch {
      // ⚠️ ABANDON QUIETLY unless BOTH hold: this is still the current upload, AND `eng` is still the
      // active engine. The engine identity check is what stops a stale scan — one whose attempt was
      // reset/tier-switched (engineRef nulled or replaced) — from writing a ghost "scan failed" alert
      // into a fresh attempt (fable) or tearing down a newer scan's worker (codex). A genuinely wedged
      // read of the CURRENT attempt still lands here (eng === engineRef.current) and rebuilds fresh.
      if (uploadId === latestUploadRef.current && engineRef.current === eng) {
        void eng.terminate()
        engineRef.current = null
        setScan('failed')
        setScanHint(null)
      }
    }
  }, [])

  /**
   * ⚠️ ONE CALL, AND IT CARRIES THE VERSION THE PAGE ACTUALLY RENDERED — not whatever is current
   * server-side when it lands. If a new declaration shipped between page load and click, stamping
   * the current one would attribute to this person a wording they never read.
   */
  const start = useCallback(async (chosen: 'A' | 'B') => {
    setTier(chosen)
    setError(null)
    setStarting(true)
    // ⚠️ DROP ANY IN-FLIGHT PASSPORT SCAN when the tier (re)starts, and free the ~6MB worker. Tearing
    // the engine down makes an in-flight read throw (caught → no autofill); the next upload's id is
    // higher than any we've accepted, so its scan supersedes cleanly without touching latestUploadRef.
    setScan('idle'); setScanHint(null)
    void engineRef.current?.terminate(); engineRef.current = null
    try {
      const r = await fetch('/api/seller/identity/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: CURRENT_DECLARATION, accepted: true }),
      })
      if (!r.ok) {
        setError(r.status === 429
          ? tr('Please wait a moment before trying again.', 'Vui lòng đợi một lát rồi thử lại.')
          : tr('We could not start verification. Please try again.', 'Không thể bắt đầu xác minh. Vui lòng thử lại.'))
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
    // ⚠️ CLEARS EVERYTHING, so the "we cleared the form" copy is true and a restarted tier-A attempt
    // cannot carry stale tier-B MRZ text. `accepted` stays — the declaration was read, not undone.
    setChallenge(null); setTier(null); setDocumentPath(null); setSelfiePath(null)
    setSurname(''); setGivenNames(''); setDocumentNumber(''); setDocumentExpiry(''); setMrzLine1(''); setMrzLine2('')
    setScan('idle'); setScanHint(null)
    void engineRef.current?.terminate(); engineRef.current = null // free the worker; don't leave OCR running
    // No latestUploadRef reset needed: KycCapture's upload id is module-global and only increases, so
    // the next attempt's scan always has a higher id than any we've accepted here.
  }, [])

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

      {/* ⚠️ NO aria-disabled HERE. A <section> has an implicit role=region, which does not support
          it — so it announces nothing while looking like an accessibility affordance. The real
          signal is on the buttons, which carry a genuine `disabled`. */}
      <section className="space-y-3">
        <h2 className="h-section text-foreground">{tr('Choose how to verify', 'Chọn cách xác minh')}</h2>

        {/* ⚠️ DISABLED, NOT HIDDEN. Hiding the options until the box is ticked leaves the page
            looking broken — a declaration with no visible consequence. Showing them greyed makes
            the causal link obvious: read, agree, then these become available. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            type="button"
            variant={tier === 'A' ? 'cta' : 'outline'}
            disabled={!accepted}
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
            disabled={!accepted}
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

        {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}

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
          <div className="space-y-5 rounded-2xl border border-border bg-card p-5">
            {/*
              ⛔ THE CODE IS THE WHOLE ANTI-FRAUD MECHANISM, so it is stated before the camera opens
              rather than buried under it. A stolen document photograph cannot produce a selfie of
              its owner holding today's code on paper; that pairing is what a reviewer is judging.
            */}
            <div>
              <h3 className="font-bold text-foreground">{tr('Step 1 — write this code on paper', 'Bước 1 — viết mã này ra giấy')}</h3>
              <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-foreground">{challenge.code}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {tr(
                  'Hold the paper next to your face in the selfie. The code is only valid for a few minutes.',
                  'Cầm tờ giấy cạnh khuôn mặt khi chụp ảnh chân dung. Mã chỉ có hiệu lực trong vài phút.',
                )}
              </p>
            </div>

            <div>
              <h3 className="font-bold text-foreground">
                {tier === 'A'
                  ? tr('Step 2 — photograph your CCCD', 'Bước 2 — chụp ảnh CCCD')
                  : tr('Step 2 — photograph your passport page', 'Bước 2 — chụp trang hộ chiếu')}
              </h3>
              <KycCapture
                // ⚠️ key={tier}: remount on a tier switch so a CCCD shot cannot linger and re-fire
                // the OCR effect (a stale "no MRZ found" alert), and a passport shot cannot carry
                // into a tier-A attempt. Fresh capture state per tier.
                key={tier}
                kind="document"
                onUploaded={tier === 'B' ? onDocUploaded : setDocumentPath}
                {...(tier === 'B' ? { onImage: onDocImage } : {})}
                className="mt-2"
              />
            </div>

            <div>
              <h3 className="font-bold text-foreground">{tr('Step 3 — selfie holding the code', 'Bước 3 — ảnh chân dung cầm mã')}</h3>
              <KycCapture kind="selfie" onUploaded={setSelfiePath} className="mt-2" />
            </div>

            <div className="space-y-3">
              <h3 className="font-bold text-foreground">{tr('Step 4 — your details', 'Bước 4 — thông tin của bạn')}</h3>
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
                    <p className="text-xs font-medium text-success" role="status">
                      {tr('Read from your passport — please check it is correct.', 'Đã đọc từ hộ chiếu — vui lòng kiểm tra lại.')}
                    </p>
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

            {/*
              ⚠️ DISABLED UNTIL BOTH IMAGES ARE UP, because the server refuses without them and a
              button that submits into a refusal wastes the challenge — `consumeChallenge` burns the
              code whatever the answer, so a premature submit costs the person a restart.
            */}
            <Button
              variant="cta"
              className="w-full"
              disabled={submitting || !documentPath || !selfiePath}
              onClick={() => void submit()}
            >
              {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {tr('Send for review', 'Gửi để xét duyệt')}
            </Button>

            {/* ⛔ ALWAYS AN ESCAPE HATCH. The challenge is single-use and time-limited: if it expires
                between the document and the selfie, the selfie upload 403s and "Send for review"
                stays disabled with no way forward (reviewer-caught). Rather than special-case every
                stuck state, one "Start over" is always here during capture — it clears the burned
                challenge and both photos so a fresh attempt gets a fresh code. */}
            <button
              type="button"
              onClick={resetAttempt}
              className="mx-auto block text-xs font-semibold text-muted-foreground underline underline-offset-2"
            >
              {tr('Start over', 'Bắt đầu lại')}
            </button>
          </div>
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
