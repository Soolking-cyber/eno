'use client'

// ── "FILL IT IN FROM MY CV" — THE READING PANEL (owner, 2026-10-15) ───────────────────────────────────────────────────
// The CV door ends here: the teacher chooses a file (their CV — a PDF, a Word file or a photo of it), POST
// /api/teachers/me/import reads it with Gemini on Vertex, and the form fills ONLY the answers still empty
// (import-map.ts mergeImport) — then this panel says what it filled, step by step, with Undo. Nothing is published:
// the answers go into the account's private draft and the teacher checks each step.
// ⛔ THE NOTICE IS BESIDE THE ACT (PDP Law 91/2025 Art 9; Decree 356/2025 Art 6): its lead is always on screen, the rest
// in a disclosure that stays in the page, and the button that opens the picker carries the agreement in its label. The
// version goes with the file; the server refuses another one and records the consent BEFORE the file leaves.
// ⛔ Signed in only: the reading is recorded against a person, and its limits are per account.

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Check, ChevronDown, ChevronLeft, Loader2 } from '@/components/ui/icons'
import { aiConsentNeeded, askAiConsent } from '@/lib/ai-consent'
import { compressImageFile } from '@/lib/normalize-image'
import { readDocxText } from '@/lib/teachers/docx-text'
import { IMPORT_MAX_BYTES } from '@/lib/teachers/import-limits'
import { IMPORT_AGREE_LABEL, IMPORT_NOTICE_DETAILS, IMPORT_NOTICE_LEAD, TEACHER_IMPORT_NOTICE_VERSION } from '@/lib/teachers/import-notice'
import type { ImportField, ImportSource, ImportedAnswers } from '@/lib/teachers/import-map'
import type { TeacherInput, TeacherStep } from '@/lib/teachers/profile'
import { importSummary } from '@/components/teachers/import-summary'

/** What the route answers with (src/app/api/teachers/me/import/route.ts). */
export type ImportResult = { source: ImportSource; fields: ImportedAnswers; phone: string | null; skippedJobs: number }
/** The last reading the form applied: what it filled, what those answers were before (Undo), and the file itself. */
export type LastImport = ImportResult & {
  filled: ImportField[]
  before: Partial<TeacherInput>
  /** The PDF (≤ 10 MB, teachers/me/cv's cap) — attached as the CV schools may be sent, and offered again if removed. */
  file: File | null
  /** The CV's phone number went into the empty phone field (owner, 2026-10-16: autofilled, not offered). */
  phoneAdded: boolean
  /** The PDF was attached as the profile's CV (none was attached or saved). */
  cvAttached: boolean
}

/** The CV route's own cap (api/teachers/me/cv) — a larger PDF is read, but not offered there. */
const CV_ATTACH_MAX_BYTES = 10 * 1024 * 1024
/** A Word file this large is not a CV; never unzipped in the tab. */
const DOCX_MAX_BYTES = 20 * 1024 * 1024
/** The reading takes 10-30 s; past this the panel says it is still at it. */
const SLOW_AFTER_MS = 20_000
/** The route may take up to 120 s (its maxDuration): given up a little before. */
const GIVE_UP_AFTER_MS = 110_000

type ReadError =
  | 'import_unavailable' | 'import_capacity' | 'import_rate_hour' | 'import_rate_day' | 'import_busy' | 'import_size'
  | 'import_type' | 'import_doc' | 'import_locked' | 'import_too_long' | 'import_unreadable' | 'import_failed'
  | 'not_cv' | 'empty' | 'session' | 'notice' | 'network' | 'timeout'
const ROUTE_ERRORS: readonly ReadError[] = [
  'import_unavailable', 'import_capacity', 'import_rate_hour', 'import_rate_day', 'import_busy', 'import_size', 'import_type',
  'import_locked', 'import_too_long', 'import_unreadable', 'import_failed',
]

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const isDocx = (f: File) => f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(f.name)
const isOldWord = (f: File) => f.type === 'application/msword' || /\.(doc|rtf|odt|pages)$/i.test(f.name)
const isImage = (f: File) => /^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)
/** What the picker offers: PDF, Word, and a photo (the phone's camera or library). */
export const IMPORT_ACCEPT = '.pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'

/**
 * The file as the route takes it: a PDF as is; a Word file as its VISIBLE text, read here (the server never opens a
 * ZIP — import-file.ts); a photo re-encoded small (HEIC included). The server sniffs the bytes again either way.
 */
/** SHA-256 of the notice exactly as this page SHOWED it (any of the eleven languages) — recorded with the consent. */
async function shownHash(shown: string): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(shown))
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}

export async function prepareImport(file: File, lang: string, shown = ''): Promise<{ body: FormData; keep: File | null } | ReadError> {
  const body = new FormData()
  let keep: File | null = null
  if (isPdf(file)) {
    if (file.size > IMPORT_MAX_BYTES) return 'import_size'
    body.set('file', file)
    keep = file.size <= CV_ATTACH_MAX_BYTES ? file : null
  } else if (isDocx(file)) {
    if (file.size > DOCX_MAX_BYTES) return 'import_size'
    const read = readDocxText(new Uint8Array(await file.arrayBuffer()))
    if (read === 'not_docx') return 'import_type'
    if (read === 'too_big') return 'import_too_long'
    if (read === 'empty') return 'import_unreadable'
    body.set('text', read.text)
  } else if (isOldWord(file)) {
    return 'import_doc'
  } else if (isImage(file)) {
    let small: File
    try { small = await compressImageFile(file) } catch { return 'import_unreadable' }
    if (small.size > IMPORT_MAX_BYTES) return 'import_size'
    body.set('file', small)
  } else {
    return 'import_type'
  }
  body.set('notice', TEACHER_IMPORT_NOTICE_VERSION)
  // The language the page was READ in (one of the eleven), and the hash of the words it showed — the record says which
  // words the teacher saw, machine-translated ones included.
  body.set('lang', lang)
  const sha = shown ? await shownHash(shown) : null
  if (sha) body.set('shown', sha)
  return { body, keep }
}

type Props = {
  userId: string | null
  /** The account's saved draft has loaded (and saving works): the reading fills ITS empty answers. */
  ready: boolean
  /**
   * Why reading cannot start yet: still loading, or a load that is being retried — or a state waiting cannot fix: the
   * session ended (sign in again), or the saved answers changed or went elsewhere (the form holds the choice).
   */
  blocked: 'loading' | 'retrying' | 'signed_out' | 'conflict' | null
  /** Undo of the last reading is on its way: the summary's buttons wait. */
  undoing: boolean
  lastImport: LastImport | null
  /**
   * ⛔ NEVER "SAVED" FOR ANSWERS THAT ARE NOT (the form's draft line, commit gate 2026-10-11): what the account's draft
   * save of this reading has done — on its way, landed, or not (failed, refused, or saving stopped).
   */
  saveState: 'saving' | 'saved' | 'later' | 'conflict' | 'signed_out' | 'not_saved'
  /** The steps still to answer once this reading is in — for the summary. */
  stillToAnswer: TeacherStep[]
  stepLabel: (s: TeacherStep) => string
  /** "Back to the form" — the step the panel was opened from (2026-10-16: no start screen any more). */
  canGoBack: boolean
  onBack: () => void
  onSignIn: () => void
  onImported: (result: ImportResult, file: File | null) => void
  onUndo: () => void
  onContinue: () => void
  onSelf: () => void
  /** The form, where the saved-answers choice (or "Sign in again") lives. */
  onOpenForm: () => void
  /** 409 teacher_exists: this account published a profile meanwhile — the form says where it is. */
  onExisting: () => void
}

export function TeacherImportPanel(p: Props) {
  const { tr, lang } = useLanguage()
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'reading'; name: string } | { kind: 'error'; code: ReadError }>({ kind: 'idle' })
  const [slow, setSlow] = useState(false)
  // The app's own question (App Store gate — src/lib/ai-consent.ts) was answered "yes" just now: the next tap picks.
  const [gateOk, setGateOk] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  // Unmounted (Continue, another account — TeacherForm remounts): a reading on its way is cut off and its answer dropped.
  useEffect(() => () => { seq.current++; abort.current?.abort() }, [])
  useEffect(() => {
    if (state.kind !== 'reading') { setSlow(false); return }
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    return () => clearTimeout(t)
  }, [state])
  // The summary replaces the panel: focus moves to its heading, so a screen reader hears what was filled.
  // (A reading ends without a tap of its own: shown as focused only where a keyboard would expect it — teacher-form.tsx.)
  useEffect(() => { if (p.lastImport) document.querySelector<HTMLElement>('[data-testid="import-summary"] [data-screen-heading]')?.focus({ preventScroll: true, focusVisible: false } as FocusOptions & { focusVisible?: boolean }) }, [p.lastImport])

  const pick = async () => {
    if (!p.userId) { p.onSignIn(); return }
    if (!p.ready) return
    // In the apps with the review gate on, Google AI is asked about first — and a file picker opened after that await
    // is refused by the WebView, so the "yes" arms the button and the next tap opens the picker.
    if (!gateOk && aiConsentNeeded('teacher_cv', p.userId)) {
      if (await askAiConsent('teacher_cv', { userId: p.userId })) setGateOk(true)
      return
    }
    input.current?.click()
  }

  const read = async (file: File) => {
    const ticket = ++seq.current
    setState({ kind: 'reading', name: file.name })
    // The notice as shown, in order — the lead, each detail, the button: what the consent record's shownSha covers.
    const shown = [tr(IMPORT_NOTICE_LEAD.en, IMPORT_NOTICE_LEAD.vi), ...IMPORT_NOTICE_DETAILS.map((d) => tr(d.en, d.vi)), tr(IMPORT_AGREE_LABEL.en, IMPORT_AGREE_LABEL.vi)].join('\n')
    const prepared = await prepareImport(file, lang, shown)
    if (ticket !== seq.current) return
    if (typeof prepared === 'string') { setState({ kind: 'error', code: prepared }); return }
    const ctl = new AbortController()
    abort.current = ctl
    let gaveUp = false
    const giveUp = setTimeout(() => { gaveUp = true; ctl.abort() }, GIVE_UP_AFTER_MS)
    try {
      const res = await fetch('/api/teachers/me/import', { method: 'POST', body: prepared.body, signal: ctl.signal })
      const d = (await res.json().catch(() => ({}))) as { import?: ImportResult | null; reason?: string; error?: string }
      if (ticket !== seq.current) return
      if (res.ok && d.import) {
        setState({ kind: 'idle' })
        p.onImported(d.import, prepared.keep)
        return
      }
      if (res.ok) { setState({ kind: 'error', code: d.reason === 'not_cv' ? 'not_cv' : 'empty' }); return }
      if (res.status === 409 && d.error === 'teacher_exists') { setState({ kind: 'idle' }); p.onExisting(); return }
      if (res.status === 409 && d.error === 'notice_changed') { setState({ kind: 'error', code: 'notice' }); return }
      if (res.status === 401) { setState({ kind: 'error', code: 'session' }); return }
      const code = ROUTE_ERRORS.find((c) => c === d.error)
      setState({ kind: 'error', code: code ?? 'import_failed' })
    } catch {
      if (ticket !== seq.current) return
      setState({ kind: 'error', code: gaveUp ? 'timeout' : 'network' })
    } finally {
      clearTimeout(giveUp)
      if (abort.current === ctl) abort.current = null
    }
  }
  const cancel = () => { seq.current++; abort.current?.abort(); setState({ kind: 'idle' }); heading.current?.focus() }

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept={IMPORT_ACCEPT}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f) }}
    />
  )
  const selfLink = (
    <Button variant="link" size="none" type="button" className="inline-flex min-h-11 items-center text-sm font-semibold" onClick={p.onSelf}>
      {tr('Fill it in myself', 'Tự điền')}
    </Button>
  )

  // ── What was filled ─────────────────────────────────────────────────────────────────────────────────────────────
  if (p.lastImport) {
    const li = p.lastImport
    const groups = importSummary(li.fields, li.filled, tr, lang)
    const n = groups.reduce((sum, g) => sum + g.rows.length, 0)
    const fromWhat = tr('from your CV', 'từ CV của bạn')
    return (
      <div className="mx-auto max-w-xl space-y-5" data-testid="import-summary">
        <div>
          <h1 data-screen-heading tabIndex={-1} className="flex items-start gap-2 h-title text-foreground outline-none">
            <Check aria-hidden className="mt-1 size-5 shrink-0 text-success" />
            <span>{n ? `${tr('We filled in', 'Chúng tôi đã điền')} ${n} ${n === 1 ? tr('answer', 'câu trả lời') : tr('answers', 'câu trả lời')} ${fromWhat}` : tr('Your answers were already filled in', 'Các câu trả lời đã được điền sẵn')}</span>
          </h1>
          {n ? (
            <>
              <p role="status" className="mt-1 text-sm text-muted-foreground" data-testid="import-save-state">
                {p.saveState === 'saved' ? tr('Saved to your account as a private draft.', 'Đã lưu vào tài khoản dưới dạng bản nháp riêng tư.')
                  : p.saveState === 'conflict' ? tr('Your saved answers were changed in another window or on another device — continue to choose which to keep.', 'Các câu trả lời đã lưu đã được thay đổi ở cửa sổ hoặc thiết bị khác — hãy tiếp tục để chọn bản muốn giữ.')
                  : p.saveState === 'signed_out' ? tr('You are signed out — continue, then sign in again to keep saving.', 'Bạn đã đăng xuất — hãy tiếp tục, rồi đăng nhập lại để tiếp tục lưu.')
                  : p.saveState === 'saving' ? tr('Saving to your account as a private draft…', 'Đang lưu vào tài khoản dưới dạng bản nháp riêng tư…')
                  : p.saveState === 'later' ? tr('Saved to your account as a private draft when you move on from the first step.', 'Được lưu vào tài khoản dưới dạng bản nháp riêng tư khi bạn chuyển khỏi bước đầu tiên.')
                  : tr('Not saved to your account yet — the answers stay on this page.', 'Chưa lưu vào tài khoản — các câu trả lời vẫn ở trên trang này.')}
              </p>
              <p className="mt-1 text-sm text-body">{tr('Check them as you go — you can change anything, and nothing is public until you publish.', 'Hãy kiểm tra khi điền tiếp — bạn có thể sửa mọi thứ, và chưa có gì được công khai cho đến khi bạn đăng hồ sơ.')}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-body">{tr('Nothing from the file replaced an answer you had already given.', 'Không có thông tin nào từ tệp thay thế câu trả lời bạn đã nhập.')}</p>
          )}
        </div>
        {groups.map((g) => (
          <section key={g.step} aria-labelledby={`import-${g.step}`} className="space-y-2">
            <h2 id={`import-${g.step}`} className="text-sm font-semibold text-foreground">{p.stepLabel(g.step)}</h2>
            <dl className="space-y-1.5">
              {g.rows.map((r) => (
                <div key={r.key} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 text-sm">
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd className="min-w-0 break-words text-body">
                    {r.value}
                    {r.check && <span className="block text-xs text-warning">{tr('Worked out from your file — check it.', 'Tính từ tệp của bạn — hãy kiểm tra lại.')}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {(li.skippedJobs > 0 || li.phoneAdded || li.cvAttached) && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-body">
            {li.skippedJobs > 0 && (
              <li>{li.skippedJobs === 1
                ? tr('One past job had no end date, so we left it out — add it on “Your teaching” if you want it.', 'Một công việc trước đây không có ngày kết thúc nên chúng tôi đã bỏ qua — hãy thêm ở bước “Việc giảng dạy” nếu bạn muốn.')
                : `${li.skippedJobs} ${tr('past jobs had no end date, so we left them out — add them on “Your teaching” if you want them.', 'công việc trước đây không có ngày kết thúc nên chúng tôi đã bỏ qua — hãy thêm ở bước “Việc giảng dạy” nếu bạn muốn.')}`}</li>
            )}
            {/* Autofilled, not offered (owner, 2026-10-16) — so said here, with where to change it. */}
            {li.phoneAdded && li.phone && <li>{tr('We added the phone number from your CV:', 'Chúng tôi đã thêm số điện thoại trong CV:')} {li.phone} — {tr('it stays private. Change it on the last step.', 'số này được giữ riêng tư. Bạn có thể đổi ở bước cuối.')}</li>}
            {/* "When you publish", not "attached" (gate review, 2026-10-16): the file waits in this page until Publish uploads
                it — a reload before then drops it, and the last step shows whether it is still there. */}
            {li.cvAttached && <li>{tr('Your CV will be attached to your profile when you publish. It stays private — schools get it only when you share it in a chat. Remove it on the last step if you prefer.', 'CV của bạn sẽ được đính kèm vào hồ sơ khi bạn đăng. CV được giữ riêng tư — các trường chỉ nhận được khi bạn chia sẻ trong tin nhắn. Bạn có thể xoá ở bước cuối nếu muốn.')}</li>}
          </ul>
        )}
        {p.stillToAnswer.length > 0 && (
          <p className="text-sm text-body">
            <span className="font-semibold text-foreground">{tr('Still to answer:', 'Còn cần trả lời:')}</span>{' '}
            {p.stillToAnswer.map(p.stepLabel).join(' · ')}
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button variant="cta" type="button" className="w-full sm:w-auto" disabled={p.undoing} onClick={p.onContinue} data-testid="import-continue">{tr('Continue', 'Tiếp tục')}</Button>
          {n > 0 && <Button variant="secondary" type="button" className="w-full sm:w-auto" loading={p.undoing} disabled={p.undoing} onClick={p.onUndo}>{p.undoing ? tr('Undoing…', 'Đang hoàn tác…') : tr('Undo', 'Hoàn tác')}</Button>}
        </div>
      </div>
    )
  }

  // ── Choose a file ───────────────────────────────────────────────────────────────────────────────────────────────
  const reading = state.kind === 'reading'
  const agreeLabel = tr(IMPORT_AGREE_LABEL.en, IMPORT_AGREE_LABEL.vi)
  return (
    <div className="mx-auto max-w-xl space-y-5" data-testid="import-panel">
      {p.canGoBack && !reading && (
        <Button variant="link" size="none" type="button" className="-mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold" onClick={p.onBack}>
          <ChevronLeft className="size-4" aria-hidden />{tr('Back to the form', 'Quay lại biểu mẫu')}
        </Button>
      )}
      <div>
        <h1 ref={heading} data-screen-heading tabIndex={-1} className="h-title text-foreground outline-none">
          {tr('Fill it in from your CV', 'Điền tự động từ CV')}
        </h1>
      </div>

      {/* What is filled, and what happens to the file, is the notice's to say (below, beside the button) — said once. */}
      <p className="text-sm text-body">{tr('Choose your CV — a PDF, a Word file (.docx) or a clear photo of it.', 'Chọn CV của bạn — tệp PDF, Word (.docx) hoặc ảnh chụp rõ nét.')}</p>

      {reading ? (
        <div role="status" aria-live="polite" className="space-y-3 rounded-2xl bg-tint p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {tr('Reading your CV…', 'Đang đọc CV…')}
          </p>
          <p className="break-all text-xs text-muted-foreground">{state.name}</p>
          <p className="text-sm text-body">{slow
            ? tr('Still reading — long files take a little longer.', 'Vẫn đang đọc — tệp dài cần thêm chút thời gian.')
            : tr('This usually takes 10–30 seconds.', 'Thường mất khoảng 10–30 giây.')}</p>
          <Button variant="secondary" size="sm" type="button" onClick={cancel}>{tr('Cancel', 'Huỷ')}</Button>
        </div>
      ) : (
        <>
          {state.kind === 'error' && (
            <div role="alert" className="space-y-2 rounded-xl bg-warning/10 px-3.5 py-2.5 text-sm text-warning">
              <p>{errorLine(state.code, tr)}</p>
              {state.code === 'session' && (
                <Button variant="link" size="none" type="button" className="inline-flex min-h-11 items-center text-sm font-semibold" onClick={p.onSignIn}>{tr('Sign in again', 'Đăng nhập lại')}</Button>
              )}
              {state.code === 'notice' && (
                <Button variant="link" size="none" type="button" className="inline-flex min-h-11 items-center text-sm font-semibold" onClick={() => window.location.reload()}>{tr('Reload the page', 'Tải lại trang')}</Button>
              )}
            </div>
          )}
          <div className="space-y-1">
            <p id="import-notice" className="text-xs leading-relaxed text-body">{tr(IMPORT_NOTICE_LEAD.en, IMPORT_NOTICE_LEAD.vi)}</p>
            <Collapsible>
              <CollapsibleTrigger
                render={<Button variant="bare" size="none" type="button" className="group inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-accent-foreground hover:underline" />}
              >
                {tr('How we read your CV', 'Cách chúng tôi đọc CV')}
                <ChevronDown className="size-3.5 transition-transform duration-200 group-data-[panel-open]:rotate-180" aria-hidden />
              </CollapsibleTrigger>
              {/* keepMounted: the second layer is part of the same notice — in the page, folded, never a separate page. */}
              <CollapsiblePanel keepMounted className="space-y-1.5 pb-1 data-[closed]:hidden">
                {IMPORT_NOTICE_DETAILS.map((d) => <p key={d.en} className="text-xs leading-relaxed text-muted-foreground">{tr(d.en, d.vi)}</p>)}
                <a href="/privacy" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-xs font-semibold text-accent-foreground underline underline-offset-2">
                  {tr('Privacy Policy', 'Chính sách bảo vệ dữ liệu cá nhân')}
                </a>
              </CollapsiblePanel>
            </Collapsible>
          </div>
          <div className="flex flex-col gap-3">
            {p.userId ? (
              <Button variant="cta" type="button" className="w-full sm:w-auto sm:self-start" disabled={!p.ready} aria-describedby="import-notice" onClick={() => { void pick() }} data-testid="import-choose">
                {/* ⛔ ONE LABEL IN EVERY STATE: it is part of the words the consent record hashes (IMPORT_NOTICE_PARTS). */}
                {agreeLabel}
              </Button>
            ) : (
              <>
                <Button variant="cta" type="button" className="w-full sm:w-auto sm:self-start" onClick={p.onSignIn} data-testid="import-sign-in">
                  {tr('Sign in to choose your CV', 'Đăng nhập để chọn CV')}
                </Button>
                <p className="text-xs text-muted-foreground">{tr('A few seconds — then your answers are saved to your account as you go.', 'Chỉ vài giây — sau đó câu trả lời được lưu vào tài khoản khi bạn điền.')}</p>
              </>
            )}
            {p.userId && !p.ready && p.blocked === 'signed_out' ? (
              <p role="alert" className="text-sm text-warning">
                {tr('You are signed out — sign in again to read your file.', 'Bạn đã đăng xuất — hãy đăng nhập lại để đọc tệp.')}{' '}
                <Button variant="link" size="none" type="button" className="inline-flex min-h-11 items-center text-sm font-semibold" onClick={p.onSignIn}>{tr('Sign in again', 'Đăng nhập lại')}</Button>
              </p>
            ) : p.userId && !p.ready && p.blocked === 'conflict' ? (
              <p role="alert" className="text-sm text-warning">
                {tr('Your saved answers were changed in another window or on another device. Choose which to keep first.', 'Các câu trả lời đã lưu đã được thay đổi ở cửa sổ hoặc thiết bị khác. Hãy chọn bản muốn giữ trước.')}{' '}
                <Button variant="link" size="none" type="button" className="inline-flex min-h-11 items-center text-sm font-semibold" onClick={p.onOpenForm}>{tr('Open the form', 'Mở biểu mẫu')}</Button>
              </p>
            ) : p.userId && !p.ready ? (
              <p role="status" className="text-xs text-muted-foreground">{p.blocked === 'retrying'
                ? tr('Could not load your saved answers yet — we are trying again. Reading your file waits until they load.', 'Chưa tải được các câu trả lời đã lưu — chúng tôi đang thử lại. Việc đọc tệp sẽ chờ đến khi tải xong.')
                : tr('Loading your saved answers…', 'Đang tải các câu trả lời đã lưu…')}</p>
            ) : null}
            {gateOk && <p role="status" className="text-xs text-body">{tr('Thanks — now choose your file.', 'Cảm ơn — giờ hãy chọn tệp của bạn.')}</p>}
            <div>{selfLink}</div>
          </div>
        </>
      )}
      {fileInput}
    </div>
  )
}

/** Each refusal as the teacher's next step — and "Fill it in myself" is always beside it. */
function errorLine(code: ReadError, tr: (en: string, vi: string) => string): string {
  switch (code) {
    case 'import_unavailable': return tr('Reading files isn’t available right now. Fill in your profile yourself — it takes about 5 minutes.', 'Hiện chưa thể đọc tệp. Hãy tự điền hồ sơ — chỉ mất khoảng 5 phút.')
    case 'import_capacity': return tr('We’re reading a lot of files right now. Try again later today, or fill it in yourself.', 'Hiện có quá nhiều tệp đang được đọc. Hãy thử lại sau trong ngày, hoặc tự điền.')
    case 'import_rate_hour': return tr('You’ve read several files in the last hour. Try again in an hour, or fill it in yourself.', 'Bạn đã đọc nhiều tệp trong một giờ qua. Hãy thử lại sau một giờ, hoặc tự điền.')
    case 'import_rate_day': return tr('You’ve reached today’s limit for reading files. Try again tomorrow, or fill it in yourself.', 'Bạn đã đạt giới hạn đọc tệp của hôm nay. Hãy thử lại vào ngày mai, hoặc tự điền.')
    case 'import_busy': return tr('We’re still reading your last file — wait a moment, then try again.', 'Chúng tôi vẫn đang đọc tệp trước — hãy đợi giây lát rồi thử lại.')
    case 'import_size': return tr('That file is too big. Choose one under 8 MB — a PDF of a CV is usually much smaller.', 'Tệp quá lớn. Hãy chọn tệp dưới 8 MB — CV dạng PDF thường nhỏ hơn nhiều.')
    case 'import_type': return tr('We can read a PDF, a Word file (.docx) or a photo (JPG, PNG, HEIC). Save your CV as a PDF and try again.', 'Chúng tôi đọc được PDF, Word (.docx) hoặc ảnh (JPG, PNG, HEIC). Hãy lưu CV dưới dạng PDF rồi thử lại.')
    case 'import_doc': return tr('That’s an older document format. Save it as a PDF or .docx (in Word or Google Docs: File › Download), then choose it again.', 'Đây là định dạng tài liệu cũ. Hãy lưu thành PDF hoặc .docx (trong Word hoặc Google Docs: Tệp › Tải xuống), rồi chọn lại.')
    case 'import_locked': return tr('That PDF is password-protected. Save a copy without the password, then choose it.', 'Tệp PDF này có mật khẩu. Hãy lưu một bản không có mật khẩu rồi chọn lại.')
    case 'import_too_long': return tr('That file is too long to be a CV. Choose a shorter one — a CV is a few pages.', 'Tệp quá dài so với một CV. Hãy chọn tệp ngắn hơn — CV thường chỉ vài trang.')
    case 'import_unreadable': return tr('We couldn’t read that file. Try a PDF of your CV, or a sharper photo of it.', 'Chúng tôi không đọc được tệp này. Hãy thử CV dạng PDF, hoặc ảnh chụp rõ nét hơn.')
    case 'not_cv': return tr('That doesn’t look like a CV. Choose your CV — a PDF, a Word file or a clear photo of it.', 'Tệp này không giống một CV. Hãy chọn CV của bạn — tệp PDF, Word hoặc ảnh chụp rõ nét.')
    case 'empty': return tr('We read the file but found nothing we could fill in. Try another file, or fill it in yourself.', 'Chúng tôi đã đọc tệp nhưng không tìm thấy thông tin nào để điền. Hãy thử tệp khác, hoặc tự điền.')
    case 'session': return tr('You’re signed out — sign in again to read your file.', 'Bạn đã đăng xuất — hãy đăng nhập lại để đọc tệp.')
    case 'notice': return tr('The words on this page changed since you opened it. Reload the page to read them, then try again.', 'Nội dung trên trang đã thay đổi kể từ khi bạn mở. Hãy tải lại trang để đọc, rồi thử lại.')
    case 'network': return tr('Couldn’t reach eno — check your connection and try again.', 'Không kết nối được với eno — hãy kiểm tra kết nối rồi thử lại.')
    case 'timeout': return tr('Reading took too long. Try again, or try a shorter file.', 'Việc đọc mất quá nhiều thời gian. Hãy thử lại, hoặc dùng tệp ngắn hơn.')
    default: return tr('Reading your file didn’t work. Please try again.', 'Không đọc được tệp của bạn. Vui lòng thử lại.')
  }
}
