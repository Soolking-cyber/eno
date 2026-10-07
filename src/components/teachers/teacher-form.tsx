'use client'

// ── TEACHER FORM ────────────────────────────────────────────────────────────────────────────────
// The teacher sign-up + edit flow (owner, 2026-09-30). One StepWizard, two halves:
//   · steps 1-4 (about, location, experience, qualifications) need no account — this is what
//     teacher.eno.vn serves;
//   · step 5 (photo, video, CV, phone, consents) and Publish need a session on eno.vn.
// ⛔ teacher.eno.vn has no session (cookies are host-scoped), so on that host the last button hands
// the draft to eno.vn in the URL FRAGMENT (`#d=`), which no server ever sees. On eno.vn the draft
// lives in localStorage so it survives the sign-in round trip, like the post wizard's.
// Validation is src/lib/teachers/profile.ts — the same functions the server runs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { StepWizard, type WizardStep } from '@/components/ui/step-wizard'
import { Field, FieldControl, FieldDescription, FieldError } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Award, Briefcase, CalendarDays, Camera, Check, FileText, GraduationCap, Loader2, MapPin, Plus, Trash2, User, Video, X } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { compressImageFile } from '@/lib/normalize-image'
import { uploadListingVideo } from '@/lib/video-upload-client'
import {
  COVER_FIELDS, DRAFT_STEPS, EMPTY_TEACHER, LIMITS, TEACHER_OPTIONS, TEACHER_STEP_FIELDS, normalizeTeacherInput,
  validateTeacherInput, type TeacherErrors, type TeacherInput, type TeacherStep,
} from '@/lib/teachers/profile'
import { ALL_COUNTRY_CODES, COMMON_TEACHER_NATIONALITIES, countryName } from '@/lib/teachers/countries'
import { TEACHER_DRAFT_HASH_KEY } from '@/lib/teachers/constants'
import { COVER_CONSENT_VERSION, coverStamp } from '@/lib/teachers/cover'
import { CoverFields, type CoverPatch } from '@/components/teachers/cover-fields'
import { CoverSummary } from '@/components/teachers/cover-summary'
import { PushOptInCard } from '@/components/marketplace/push-opt-in-card'

const DRAFT_KEY = 'eno.teacherDraft.v1'
const STEP_ORDER = Object.keys(TEACHER_STEP_FIELDS) as TeacherStep[]
const CURRENT_CITY_OPTIONS = TEACHER_OPTIONS.workIn.filter((o) => o.value !== 'anywhere' && o.value !== 'online')

type Mode = 'join' | 'edit'
/** The cover availability as last saved — `consentCurrent`: saved under today's notice (COVER_CONSENT_VERSION). */
type SavedCover = { coverOpen: boolean; coverSlots: string[]; coverAreas: string[]; coverRateVnd: number | null; consentCurrent: boolean }
type Opt = { value: string; label: string; labelVi: string }

function encodeDraft(t: TeacherInput): string {
  const bytes = new TextEncoder().encode(JSON.stringify(t))
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function decodeDraft(s: string): unknown {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
  } catch {
    return null
  }
}
const readStored = (): unknown => {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch { return null }
}
const writeStored = (t: TeacherInput) => {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(t)) } catch { /* private mode: the draft just does not persist */ }
}
const clearStored = () => {
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
}

/** Multi-pick chip row — the post wizard's chip look (bare button, pill when picked). */
function MultiChips({ options, value, onChange, lang }: { options: readonly Opt[]; value: string[]; onChange: (v: string[]) => void; lang: string }) {
  void lang // kept for the call sites; the label goes through tr() so the nine machine-translated languages get one
  const { tr } = useLanguage()
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <Button
            key={o.value}
            variant="bare"
            size="none"
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn('relative rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors cursor-pointer tap-44', on ? 'bg-primary text-white' : 'text-body hover:bg-muted')}
          >
            {tr(o.label, o.labelVi)}
          </Button>
        )
      })}
    </div>
  )
}

function SingleChips({ options, value, onChange, lang }: { options: readonly Opt[]; value: string | null; onChange: (v: string) => void; lang: string }) {
  void lang
  const { tr } = useLanguage()
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => (
        <Button
          key={o.value}
          variant="bare"
          size="none"
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('relative rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors cursor-pointer tap-44', value === o.value ? 'bg-primary text-white' : 'text-body hover:bg-muted')}
        >
          {tr(o.label, o.labelVi)}
        </Button>
      ))}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

export function TeacherForm({ mode, draftHost, apexOrigin }: { mode: Mode; draftHost: boolean; apexOrigin: string }) {
  const { tr, lang } = useLanguage()
  const { user, loading: authLoading, openSignIn } = useAuth()
  const [t, setT] = useState<TeacherInput>(EMPTY_TEACHER)
  const [stepIdx, setStepIdx] = useState(0)
  const [errors, setErrors] = useState<TeacherErrors>({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState<'' | 'photo' | 'video' | 'saving'>('')
  const [cvFile, setCvFile] = useState<File | null>(null)
  const [cvName, setCvName] = useState<string | null>(null)
  const [status, setStatus] = useState<'live' | 'hidden'>('live')
  const [done, setDone] = useState<{ listingId: string; live: boolean } | null>(null)
  const [loaded, setLoaded] = useState(mode === 'join')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [langsText, setLangsText] = useState('')
  const [existing, setExisting] = useState(false)
  const [listingLive, setListingLive] = useState(true)
  // Cover lessons (2026-10-07): the cover availability AS LAST SAVED (the summary card and its "Still available"
  // tap work on this, never on unsaved edits in `t` — gate review), when it was last confirmed, and the save state.
  const [savedCover, setSavedCover] = useState<SavedCover | null>(null)
  const [coverConfirmedAt, setCoverConfirmedAt] = useState<string | null>(null)
  const [coverSave, setCoverSave] = useState<'' | 'saving' | 'saved' | 'error'>('')
  const hydrated = useRef(false)

  const step = STEP_ORDER[stepIdx]
  const set = useCallback(<K extends keyof TeacherInput>(k: K, v: TeacherInput[K]) => {
    setT((prev) => ({ ...prev, [k]: v }))
    setErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev))
  }, [])

  // ── Restore: a `#d=` hand-off from teacher.eno.vn wins, then the local draft ──────────────────
  useEffect(() => {
    if (mode !== 'join' || hydrated.current) return
    hydrated.current = true
    const m = window.location.hash.match(new RegExp(`[#&]${TEACHER_DRAFT_HASH_KEY}=([^&]+)`))
    const fromHash = m ? decodeDraft(m[1]) : null
    if (fromHash) {
      // ⛔ THE COVER CONSENT NEVER TRAVELS IN THE FRAGMENT (gate review, 2026-10-07): a crafted `#d=` link could
      // otherwise arrive with it ticked. It is asked again here, where the profile is published.
      const next = { ...normalizeTeacherInput(fromHash), coverConsent: false }
      setT(next)
      writeStored(next)
      // Strip the fragment so a reload or a shared link never re-carries the draft.
      history.replaceState(null, '', window.location.pathname + window.location.search)
      if (Object.keys(validateTeacherInput(next, DRAFT_STEPS.filter((s) => s !== 'cover'))).length === 0) {
        setStepIdx(STEP_ORDER.indexOf(next.coverOpen ? 'cover' : 'finish'))
      }
      return
    }
    const stored = readStored()
    // ⛔ Nor from a stored draft: the key is per DEVICE, not per person (a shared school or café browser), and a tick
    // kept from an older notice would be sent as consent to today's (gate review, 2026-10-07). Asked again on the step.
    if (stored) setT({ ...normalizeTeacherInput(stored), coverConsent: false })
  }, [mode])

  // ── Edit: load the saved profile ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'edit' || authLoading) return
    if (!user) { setLoaded(true); return }
    let alive = true
    fetch('/api/teachers/me')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        const tp = d?.teacher
        if (tp) {
          setT(normalizeTeacherInput({
            ...tp,
            availableFrom: tp.availableFrom ? String(tp.availableFrom).slice(0, 10) : null,
            consentPublic: true,
            // The cover tick stays ticked only under the notice version they agreed to — a new version asks again.
            coverConsent: tp.coverOpen === true && tp.coverConsentVersion === COVER_CONSENT_VERSION,
          }))
          setCoverConfirmedAt(tp.coverConfirmedAt ?? null)
          setSavedCover({
            coverOpen: tp.coverOpen === true, coverSlots: tp.coverSlots ?? [], coverAreas: tp.coverAreas ?? [],
            coverRateVnd: tp.coverRateVnd ?? null, consentCurrent: tp.coverConsentVersion === COVER_CONSENT_VERSION,
          })
          setCvName(tp.cvFileName ?? null)
          setStatus(tp.status === 'hidden' ? 'hidden' : 'live')
          setListingLive(tp.listingLive !== false)
          if (tp.listingId) setDone(null)
        }
        setLoaded(true)
      })
      .catch(() => { if (alive) { setFormError(tr('Could not load your profile.', 'Không tải được hồ sơ.')); setLoaded(true) } })
    return () => { alive = false }
  }, [mode, user, authLoading, tr])

  useEffect(() => {
    if (mode === 'join' && hydrated.current) writeStored(t)
  }, [t, mode])
  // The languages box is free text while typing (a parsed value would eat the comma); it follows
  // the parsed list whenever that changes from outside the box (restore, edit load).
  const langsKey = t.languages.join('|')
  useEffect(() => {
    setLangsText((cur) => (cur.split(',').map((s) => s.trim()).filter(Boolean).join('|') === langsKey ? cur : t.languages.join(', ')))
  }, [langsKey])

  // /join while already having a profile: saving here would overwrite it, so send them to edit.
  useEffect(() => {
    if (mode !== 'join' || !user) return
    fetch('/api/teachers/me').then((r) => r.json()).then((d) => { if (d?.teacher) setExisting(true) }).catch(() => {})
  }, [mode, user])

  const errText = (code: string | undefined): string => {
    switch (code) {
      case 'required': return tr('This is required.', 'Mục này là bắt buộc.')
      case 'too_short': return tr('Please write a little more (at least 10 characters).', 'Vui lòng viết thêm (ít nhất 10 ký tự).')
      case 'invalid': return tr('Please check this value.', 'Vui lòng kiểm tra lại.')
      case 'incomplete': return tr('Fill in the role and the school, or remove this entry.', 'Điền vị trí và nơi làm việc, hoặc xoá mục này.')
      case 'dates': return tr('The end date is before the start date.', 'Ngày kết thúc trước ngày bắt đầu.')
      case 'rate_range': return tr('Please enter a rate between 50,000 đ and 2,000,000 đ an hour.', 'Vui lòng nhập mức phí từ 50.000 đ đến 2.000.000 đ một giờ.')
      default: return ''
    }
  }
  const publishErrText = (code: string): string => {
    if (code === 'contact_in_text' || code === 'contact_in_name') return tr('Please remove phone numbers, emails and links from your profile text — schools get your contact only when you share it in chat.', 'Vui lòng xoá số điện thoại, email và liên kết khỏi hồ sơ — trường chỉ nhận liên hệ khi bạn chia sẻ trong tin nhắn.')
    if (code === 'banned_words') return tr('Your profile contains a word we do not allow. Please rephrase.', 'Hồ sơ có từ không được phép. Vui lòng viết lại.')
    if (code === 'account_restricted') return tr('Your account cannot publish right now.', 'Tài khoản của bạn hiện chưa thể đăng.')
    if (code.startsWith('identity_')) return tr('Please verify your identity in Account settings before publishing.', 'Vui lòng xác minh danh tính trong Cài đặt tài khoản trước khi đăng.')
    if (code === 'rate_limited') return tr('Too many saves — please wait a few minutes.', 'Lưu quá nhiều lần — vui lòng đợi vài phút.')
    // Join mode loaded no saved cover, so the server will not let it overwrite one that is ON (publish.ts assertCoverBase).
    if (code === 'cover_changed' && mode === 'join') return tr('You already have a teacher profile that offers cover lessons. Open it from your account (Teacher profile) to make changes.', 'Bạn đã có hồ sơ giáo viên đang nhận dạy thay. Hãy mở hồ sơ trong tài khoản (Hồ sơ giáo viên) để chỉnh sửa.')
    if (code === 'cover_changed') return tr('Your cover lessons were changed in another window. Reload this page to see the latest, then save again.', 'Lịch dạy thay của bạn đã được thay đổi ở cửa sổ khác. Hãy tải lại trang để xem bản mới nhất rồi lưu lại.')
    return tr('Something went wrong. Please try again.', 'Đã có lỗi. Vui lòng thử lại.')
  }

  const checkStep = (s: TeacherStep): boolean => {
    const e = validateTeacherInput(t, [s])
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // ── Media ───────────────────────────────────────────────────────────────────────────────────────
  const uploadPhoto = async (file: File) => {
    setBusy('photo'); setFormError('')
    try {
      const small = await compressImageFile(file)
      const form = new FormData(); form.append('files', small)
      form.append('kind', 'avatar') // a headshot: never watermarked
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const d = await res.json().catch(() => ({}))
      if (!d.urls?.[0]) throw new Error('upload')
      set('photoUrl', d.urls[0])
    } catch {
      setFormError(tr('Photo upload failed. Try a JPG or PNG under 12 MB.', 'Tải ảnh thất bại. Thử ảnh JPG hoặc PNG dưới 12 MB.'))
    } finally { setBusy('') }
  }
  const uploadVideo = async (file: File) => {
    setBusy('video'); setFormError('')
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('size')
      const url = await uploadListingVideo(file)
      if (!url) throw new Error('video')
      set('videoUrl', url)
    } catch {
      setFormError(tr('Video upload failed. Keep it under 60 seconds and 50 MB (MP4 or MOV).', 'Tải video thất bại. Giữ dưới 60 giây và 50 MB (MP4 hoặc MOV).'))
    } finally { setBusy('') }
  }
  const uploadCv = async (file: File): Promise<boolean> => {
    const form = new FormData(); form.append('file', file)
    const res = await fetch('/api/teachers/me/cv', { method: 'POST', body: form })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) {
      setFormError(d.error === 'cv_type' ? tr('Your CV must be a PDF.', 'CV phải là tệp PDF.') : d.error === 'cv_size' ? tr('Your CV must be under 10 MB.', 'CV phải dưới 10 MB.') : tr('CV upload failed.', 'Tải CV thất bại.'))
      return false
    }
    setCvName(d.cvFileName ?? file.name); setCvFile(null)
    return true
  }

  // ── Publish / continue ──────────────────────────────────────────────────────────────────────────
  const handOff = () => {
    // teacher.eno.vn → eno.vn: the fragment carries the draft; no server sees it.
    window.location.assign(`${apexOrigin}/teachers/join#${TEACHER_DRAFT_HASH_KEY}=${encodeDraft(t)}`)
  }

  const publish = async () => {
    if (busy) return
    // ⛔ SIGN-IN FIRST. Photo, video and CV can only be uploaded signed in, so validating the whole
    // form before this would stop a signed-out teacher on "photo required" with no way forward
    // (agy, commit gate 09-30). The draft steps are checked first so sign-in is not asked in vain.
    if (!user) {
      const draftErrs = validateTeacherInput(t, DRAFT_STEPS)
      if (Object.keys(draftErrs).length) {
        setErrors(draftErrs)
        const firstBad = STEP_ORDER.findIndex((s) => TEACHER_STEP_FIELDS[s].some((f) => Object.keys(draftErrs).some((k) => k === f || k.startsWith(`${f}.`))))
        if (firstBad >= 0) setStepIdx(firstBad)
        return
      }
      openSignIn({ note: tr('Sign in to add your photo and publish your teacher profile. Your answers are kept.', 'Đăng nhập để thêm ảnh và đăng hồ sơ giáo viên. Câu trả lời của bạn được giữ lại.') })
      return
    }
    const all = validateTeacherInput(t)
    if (Object.keys(all).length) {
      setErrors(all)
      const firstBad = STEP_ORDER.findIndex((s) => TEACHER_STEP_FIELDS[s].some((f) => Object.keys(all).some((k) => k === f || k.startsWith(`${f}.`))))
      if (firstBad >= 0) setStepIdx(firstBad)
      return
    }
    setBusy('saving'); setFormError('')
    try {
      // `coverBase`: the cover state this form loaded — the server refuses (409 cover_changed) if another window changed it.
      // `coverNotice`: the cover notice this page shows — the server counts the tick only under the one in force.
      const res = await fetch('/api/teachers/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...t, coverBase: mode === 'edit' && savedCover ? coverStamp(savedCover) : null, coverNotice: COVER_CONSENT_VERSION }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (d.error === 'invalid_teacher_profile' && d.fields) setErrors(d.fields)
        setFormError(publishErrText(String(d.error || '')))
        return
      }
      // The profile is saved either way; a failed CV upload is reported on the done screen and can be
      // retried from Edit — never leave the teacher on the form thinking nothing was published.
      if (cvFile) await uploadCv(cvFile)
      clearStored()
      // The cover AS STORED (the server returns it): the next save's base and the real "confirmed on" date —
      // never the form's own copy, whose order and date the server does not share (gate review).
      if (d.cover) {
        setSavedCover({ coverOpen: d.cover.coverOpen === true, coverSlots: d.cover.coverSlots ?? [], coverAreas: d.cover.coverAreas ?? [], coverRateVnd: d.cover.coverRateVnd ?? null, consentCurrent: d.cover.coverConsentVersion === COVER_CONSENT_VERSION })
        setCoverConfirmedAt(d.cover.coverConfirmedAt ?? null)
      }
      setDone({ listingId: d.listingId, live: d.live === true })
    } catch {
      setFormError(publishErrText(''))
    } finally { setBusy('') }
  }

  const toggleStatus = async (live: boolean) => {
    const next = live ? 'live' : 'hidden'
    const res = await fetch('/api/teachers/me/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) })
    if (res.ok) { setStatus(next); setListingLive(true) }
    else setFormError(tr('Could not change visibility.', 'Không đổi được chế độ hiển thị.'))
  }
  const deleteProfile = async () => {
    const res = await fetch('/api/teachers/me', { method: 'DELETE' })
    if (res.ok) window.location.assign('/')
    else setFormError(tr('Could not delete your profile.', 'Không xoá được hồ sơ.'))
  }
  const removeCv = async () => {
    const res = await fetch('/api/teachers/me/cv', { method: 'DELETE' })
    if (res.ok) setCvName(null)
  }

  // ── Cover lessons (2026-10-07) ───────────────────────────────────────────────────────────────────
  const setCover = (patch: CoverPatch) => {
    // ⛔ Switching cover OFF withdraws the consent too: switching it back on must ask for the tick again, or the
    // record would show a fresh consent the teacher never gave after withdrawing (gate review, 2026-10-07).
    const p = patch.coverOpen === false ? { ...patch, coverConsent: false } : patch
    setT((prev) => ({ ...prev, ...p }))
    setErrors((prev) => {
      const n = { ...prev }
      for (const k of Object.keys(p)) delete n[k as keyof TeacherErrors]
      return n
    })
    setCoverSave('')
  }
  /**
   * "Still available": re-send the cover values AS SAVED (PATCH /api/teachers/me/cover), which re-confirms them.
   * ⚠️ THERE IS NO QUICK SAVE OF EDITED VALUES ON PURPOSE. It existed and every review round found another way its
   * edited state disagreed with the saved profile (a city added but not saved, a switch-off confirmed by accident) —
   * so edits go through the one full save, like every other field, and this only re-confirms what the server holds.
   */
  const saveCover = async (v: Pick<TeacherInput, (typeof COVER_FIELDS)[number]>) => {
    if (coverSave === 'saving') return
    const e = validateTeacherInput({ ...t, ...v }, ['cover'])
    if (Object.keys(e).length) { setErrors(e); setStepIdx(STEP_ORDER.indexOf('cover')); return }
    setCoverSave('saving')
    try {
      const res = await fetch('/api/teachers/me/cover', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...Object.fromEntries(COVER_FIELDS.map((k) => [k, v[k]])), coverBase: savedCover ? coverStamp(savedCover) : null, coverNotice: COVER_CONSENT_VERSION }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (d.error === 'invalid_teacher_profile' && d.fields) setErrors(d.fields)
        if (d.error === 'cover_changed') setFormError(publishErrText('cover_changed'))
        setCoverSave('error')
        return
      }
      setCoverConfirmedAt(d.confirmedAt ?? null)
      setSavedCover({ coverOpen: d.coverOpen === true, coverSlots: d.coverSlots ?? [], coverAreas: d.coverAreas ?? [], coverRateVnd: d.coverRateVnd ?? null, consentCurrent: true })
      setCoverSave('saved')
    } catch {
      setCoverSave('error')
    }
  }
  /** "Still available": re-confirm the availability AS SAVED — never unsaved edits, and never a switch-off. */
  const confirmSavedCover = () => {
    if (!savedCover?.coverOpen) return
    // Saved under an older notice: the teacher must read and tick the current one first.
    if (!savedCover.consentCurrent) { setErrors({ coverConsent: 'required' }); setStepIdx(STEP_ORDER.indexOf('cover')); return }
    void saveCover({ coverOpen: true, coverSlots: savedCover.coverSlots, coverAreas: savedCover.coverAreas, coverRateVnd: savedCover.coverRateVnd, coverConsent: true })
  }
  // Order-insensitive, like the server's own conflict check (coverStamp sorts): re-ticking a period is not a change.
  const coverDirty = !!savedCover && coverStamp(savedCover) !== coverStamp(t)

  const steps: WizardStep[] = useMemo(() => [
    { key: 'about', icon: <User className="size-4" />, label: tr('About you', 'Về bạn') },
    { key: 'location', icon: <MapPin className="size-4" />, label: tr('Location', 'Địa điểm') },
    { key: 'experience', icon: <Briefcase className="size-4" />, label: tr('Experience', 'Kinh nghiệm') },
    { key: 'cover', icon: <CalendarDays className="size-4" />, label: tr('Cover lessons', 'Dạy thay') },
    { key: 'qualifications', icon: <GraduationCap className="size-4" />, label: tr('Qualifications', 'Bằng cấp') },
    { key: 'finish', icon: <Award className="size-4" />, label: tr('Photo & publish', 'Ảnh & đăng') },
  ], [tr])

  const isLast = stepIdx === STEP_ORDER.length - 1
  const onDraftHostEnd = draftHost && step === 'qualifications'
  const primary = onDraftHostEnd
    ? { label: tr('Continue to sign in', 'Tiếp tục để đăng nhập'), onClick: () => { if (checkStep(step)) handOff() } }
    : isLast
      ? { label: busy === 'saving' ? tr('Saving…', 'Đang lưu…') : mode === 'edit' ? tr('Save changes', 'Lưu thay đổi') : tr('Publish profile', 'Đăng hồ sơ'), onClick: publish, disabled: busy !== '' }
      : { label: tr('Next', 'Tiếp'), onClick: () => { if (checkStep(step)) setStepIdx((i) => i + 1) } }
  const secondary = stepIdx > 0 ? { label: tr('Back', 'Quay lại'), onClick: () => setStepIdx((i) => i - 1) } : undefined

  if (!loaded) {
    return <div className="flex justify-center py-24"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
  }
  if (mode === 'edit' && !user) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-body">{tr('Sign in to edit your teacher profile.', 'Đăng nhập để sửa hồ sơ giáo viên.')}</p>
        <Button variant="cta" className="mt-4" onClick={() => openSignIn()}>{tr('Sign in', 'Đăng nhập')}</Button>
      </div>
    )
  }
  if (existing && !done) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-body">{tr('You already have a teacher profile.', 'Bạn đã có hồ sơ giáo viên.')}</p>
        <Button variant="cta" className="mt-4" asChild><Link href="/teachers/edit">{tr('Edit my profile', 'Sửa hồ sơ')}</Link></Button>
      </div>
    )
  }
  if (done) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-tint text-brand"><Check className="size-6" /></span>
        <h1 className="mt-4 text-xl font-semibold text-foreground">{mode === 'edit' || !done.live ? tr('Profile saved', 'Đã lưu hồ sơ') : tr('Your profile is live', 'Hồ sơ của bạn đã được đăng')}</h1>
        <p className="mt-2 text-sm text-body">
          {tr('Schools can now find you. When one messages you, reply and tap “Share my phone, email & CV” if you want them to have your phone, email and CV.', 'Các trường giờ có thể tìm thấy bạn. Khi có trường nhắn tin, hãy trả lời và bấm “Chia sẻ số điện thoại, email và CV” nếu bạn muốn gửi số điện thoại, email và CV.')}
        </p>
        {formError && <p role="alert" className="mt-3 text-sm text-destructive">{formError}</p>}
        {t.coverOpen && <PushOptInCard surface="teacher" className="mt-4" />}
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="cta" asChild><Link href={`/listings/${done.listingId}`}>{tr('View my profile', 'Xem hồ sơ')}</Link></Button>
          {mode === 'edit'
            ? <Button variant="secondary" onClick={() => { setDone(null); setStepIdx(0) }}>{tr('Keep editing', 'Tiếp tục sửa')}</Button>
            : <Button variant="secondary" asChild><Link href="/teachers/edit">{tr('Edit', 'Sửa')}</Link></Button>}
        </div>
      </div>
    )
  }

  const L = (o: Opt) => tr(o.label, o.labelVi)
  const countryOptions = [...COMMON_TEACHER_NATIONALITIES, ...ALL_COUNTRY_CODES.filter((c) => !(COMMON_TEACHER_NATIONALITIES as readonly string[]).includes(c))]
  const countryItems = Object.fromEntries(countryOptions.map((c) => [c, countryName(c, lang)]))

  return (
    <StepWizard
      steps={steps}
      current={step}
      onStepSelect={(_k, i) => { if (i < stepIdx) setStepIdx(i) }}
      primaryAction={primary}
      secondaryAction={secondary}
      // The action bar clears the phone's bottom MobileNav pill (the post wizard's own offset — post-wizard.tsx).
      offsetBottom="4.5rem"
      header={
        <div className="mb-2">
          {mode === 'edit' && step !== 'cover' && (
            <CoverSummary
              savedOpen={savedCover?.coverOpen === true}
              slots={savedCover?.coverSlots.length ?? 0}
              areas={savedCover?.coverAreas.length ?? 0}
              rateVnd={savedCover?.coverRateVnd ?? null}
              confirmedAt={coverConfirmedAt}
              dirty={coverDirty}
              status={coverSave}
              onConfirm={confirmSavedCover}
              onEdit={() => setStepIdx(STEP_ORDER.indexOf('cover'))}
            />
          )}
          <h1 className="text-xl font-semibold text-foreground">{mode === 'edit' ? tr('Your teacher profile', 'Hồ sơ giáo viên của bạn') : tr('Create your teacher profile', 'Tạo hồ sơ giáo viên')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tr('Free. Schools across Vietnam see your profile; your phone, email and CV stay private until you share them.', 'Miễn phí. Các trường trên toàn Việt Nam xem được hồ sơ; số điện thoại, email và CV được giữ kín đến khi bạn chia sẻ.')}</p>
          {/* Cover lessons (2026-10-07): the teacher.eno.vn pitch — the step itself comes after Experience. */}
          {mode === 'join' && <p className="mt-1 text-sm text-body">{tr('New: offer cover lessons too — tap the periods you are free and set an hourly rate.', 'Mới: nhận cả dạy thay — chạm vào các buổi bạn rảnh và đặt mức phí theo giờ.')}</p>}
        </div>
      }
    >
      <div className="space-y-8 pb-6">
        {step === 'about' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field invalid={!!errors.fullName}>
                <Label htmlFor="tf-name">{tr('Full name', 'Họ và tên')}</Label>
                <FieldControl id="tf-name" render={<Input id="tf-name" autoComplete="name" value={t.fullName} maxLength={LIMITS.name} onChange={(e) => set('fullName', e.target.value)} />} />
                {errors.fullName && <FieldError>{errText(errors.fullName)}</FieldError>}
              </Field>
              <Field invalid={!!errors.nationality}>
                <Label htmlFor="tf-nat">{tr('Nationality', 'Quốc tịch')}</Label>
                <Select items={countryItems} value={t.nationality || null} onValueChange={(v) => set('nationality', typeof v === 'string' ? v : '')}>
                  <SelectTrigger id="tf-nat" className="min-h-11 w-full rounded-xl"><SelectValue placeholder={tr('Choose', 'Chọn')} /></SelectTrigger>
                  <SelectContent>
                    {countryOptions.map((c) => <SelectItem key={c} value={c}>{countryItems[c]}</SelectItem>)}
                  </SelectContent>
                </Select>
                {errors.nationality && <FieldError>{errText(errors.nationality)}</FieldError>}
              </Field>
            </div>
            <Field invalid={!!errors.headline}>
              <Label htmlFor="tf-headline">{tr('Headline', 'Tiêu đề')}</Label>
              <FieldControl id="tf-headline" render={<Input id="tf-headline" value={t.headline} maxLength={LIMITS.headline} placeholder={tr('e.g. CELTA-certified English teacher, 5 years with young learners', 'vd. Giáo viên tiếng Anh có CELTA, 5 năm dạy trẻ em')} onChange={(e) => set('headline', e.target.value)} />} />
              {errors.headline && <FieldError>{errText(errors.headline)}</FieldError>}
            </Field>
            <Field>
              <Label htmlFor="tf-bio">{tr('About you (optional)', 'Giới thiệu (không bắt buộc)')}</Label>
              <FieldControl id="tf-bio" render={<Textarea id="tf-bio" rows={5} value={t.bio} maxLength={LIMITS.bio} onChange={(e) => set('bio', e.target.value)} />} />
              <FieldDescription className="text-muted-foreground">{tr('Your teaching style and what you are looking for. No phone numbers or emails here.', 'Phong cách giảng dạy và công việc bạn tìm. Không ghi số điện thoại hay email.')}</FieldDescription>
            </Field>
            <Section title={tr('Native English speaker?', 'Người bản ngữ tiếng Anh?')}>
              <Switch checked={t.nativeSpeaker} onChange={(v: boolean) => set('nativeSpeaker', v)} label={tr('Native speaker', 'Người bản ngữ')} />
            </Section>
            <Field>
              <Label htmlFor="tf-langs">{tr('Other languages you speak (comma separated)', 'Ngôn ngữ khác (cách nhau bằng dấu phẩy)')}</Label>
              <FieldControl id="tf-langs" render={<Input id="tf-langs" value={langsText} onChange={(e) => { setLangsText(e.target.value); set('languages', e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, LIMITS.languages)) }} onBlur={() => setLangsText(t.languages.join(', '))} />} />
            </Field>
          </>
        )}

        {step === 'location' && (
          <>
            <Section title={tr('Where do you live now?', 'Bạn đang sống ở đâu?')}>
              <SingleChips options={CURRENT_CITY_OPTIONS} value={t.currentCity || null} onChange={(v) => set('currentCity', v)} lang={lang} />
              {errors.currentCity && <p className="text-sm text-destructive">{errText(errors.currentCity)}</p>}
              <Field>
                <Label htmlFor="tf-district">{tr('District (optional)', 'Quận/huyện (không bắt buộc)')}</Label>
                <FieldControl id="tf-district" render={<Input id="tf-district" value={t.currentDistrict} maxLength={LIMITS.shortText} onChange={(e) => set('currentDistrict', e.target.value)} />} />
              </Field>
            </Section>
            <Section title={tr('Where do you want to work?', 'Bạn muốn làm việc ở đâu?')} hint={tr('Pick every city you would take a job in.', 'Chọn mọi thành phố bạn sẵn sàng làm việc.')}>
              <MultiChips options={TEACHER_OPTIONS.workIn} value={t.preferredCities} onChange={(v) => set('preferredCities', v)} lang={lang} />
              {errors.preferredCities && <p className="text-sm text-destructive">{errText(errors.preferredCities)}</p>}
              <Switch checked={t.openToOnline} onChange={(v: boolean) => set('openToOnline', v)} label={tr('Also open to online teaching', 'Nhận cả dạy trực tuyến')} />
            </Section>
            <Field>
              <Label htmlFor="tf-avail">{tr('Available from (optional)', 'Có thể bắt đầu từ (không bắt buộc)')}</Label>
              <FieldControl id="tf-avail" render={<Input id="tf-avail" type="date" value={t.availableFrom ?? ''} onChange={(e) => set('availableFrom', e.target.value || null)} />} />
            </Field>
          </>
        )}

        {step === 'experience' && (
          <>
            <Section title={tr('What do you teach?', 'Bạn dạy môn gì?')}>
              <MultiChips options={TEACHER_OPTIONS.subject} value={t.subjects} onChange={(v) => set('subjects', v)} lang={lang} />
              {errors.subjects && <p className="text-sm text-destructive">{errText(errors.subjects)}</p>}
            </Section>
            <Section title={tr('Who do you teach?', 'Bạn dạy đối tượng nào?')}>
              <MultiChips options={TEACHER_OPTIONS.ageGroup} value={t.ageGroups} onChange={(v) => set('ageGroups', v)} lang={lang} />
              {errors.ageGroups && <p className="text-sm text-destructive">{errText(errors.ageGroups)}</p>}
            </Section>
            <Section title={tr('What kind of job are you looking for?', 'Bạn tìm loại công việc nào?')}>
              <MultiChips options={TEACHER_OPTIONS.jobType} value={t.jobTypes} onChange={(v) => set('jobTypes', v)} lang={lang} />
              {errors.jobTypes && <p className="text-sm text-destructive">{errText(errors.jobTypes)}</p>}
            </Section>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="tf-years">{tr('Years of teaching experience', 'Số năm kinh nghiệm giảng dạy')}</Label>
                <FieldControl id="tf-years" render={<Input id="tf-years" type="number" inputMode="numeric" min={0} max={LIMITS.maxYears} value={t.yearsExperience} onChange={(e) => set('yearsExperience', Math.max(0, Math.min(LIMITS.maxYears, Number(e.target.value) || 0)))} />} />
              </Field>
              <Field>
                <Label htmlFor="tf-salary">{tr('Expected salary, million VND / month (optional)', 'Mức lương mong muốn, triệu đồng / tháng (không bắt buộc)')}</Label>
                <FieldControl id="tf-salary" render={<Input id="tf-salary" type="number" inputMode="numeric" min={0} max={LIMITS.maxSalaryM} value={t.expectedSalaryM ?? ''} onChange={(e) => set('expectedSalaryM', e.target.value === '' ? null : Math.max(0, Math.min(LIMITS.maxSalaryM, Number(e.target.value) || 0)))} />} />
              </Field>
            </div>
            <Section title={tr('Teaching experience', 'Kinh nghiệm giảng dạy')} hint={tr('Your most recent roles first. Optional, but schools read this closely.', 'Công việc gần nhất trước. Không bắt buộc, nhưng các trường rất quan tâm.')}>
              <div className="space-y-4">
                {t.experience.map((x, i) => (
                  <div key={i} className="space-y-3 border-b border-border pb-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Input aria-label={tr('Role', 'Vị trí')} placeholder={tr('Role', 'Vị trí')} value={x.role} maxLength={LIMITS.shortText} onChange={(e) => set('experience', t.experience.map((y, j) => (j === i ? { ...y, role: e.target.value } : y)))} />
                      <Input aria-label={tr('School or company', 'Trường hoặc công ty')} placeholder={tr('School or company', 'Trường hoặc công ty')} value={x.employer} maxLength={LIMITS.shortText} onChange={(e) => set('experience', t.experience.map((y, j) => (j === i ? { ...y, employer: e.target.value } : y)))} />
                      <Input aria-label={tr('City', 'Thành phố')} placeholder={tr('City', 'Thành phố')} value={x.city} maxLength={LIMITS.shortText} onChange={(e) => set('experience', t.experience.map((y, j) => (j === i ? { ...y, city: e.target.value } : y)))} />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Input type="month" aria-label={tr('From', 'Từ')} className="w-auto" value={x.from} onChange={(e) => set('experience', t.experience.map((y, j) => (j === i ? { ...y, from: e.target.value } : y)))} />
                      <span className="text-sm text-muted-foreground">–</span>
                      <Input type="month" aria-label={tr('To (empty = now)', 'Đến (để trống = hiện tại)')} className="w-auto" value={x.to} onChange={(e) => set('experience', t.experience.map((y, j) => (j === i ? { ...y, to: e.target.value } : y)))} />
                      <Button variant="ghost" size="sm" type="button" onClick={() => set('experience', t.experience.filter((_, j) => j !== i))}><Trash2 className="size-4" />{tr('Remove', 'Xoá')}</Button>
                    </div>
                    {errors[`experience.${i}`] && <p className="text-sm text-destructive">{errText(errors[`experience.${i}`])}</p>}
                  </div>
                ))}
                {t.experience.length < LIMITS.experienceEntries && (
                  <Button variant="secondary" size="sm" type="button" onClick={() => set('experience', [...t.experience, { role: '', employer: '', city: '', from: '', to: '' }])}><Plus className="size-4" />{tr('Add a role', 'Thêm công việc')}</Button>
                )}
              </div>
            </Section>
          </>
        )}

        {step === 'cover' && (
          <>
            <CoverFields value={t} onChange={setCover} errors={errors} />
            {t.coverOpen && user && <PushOptInCard surface="teacher" />}
          </>
        )}

        {step === 'qualifications' && (
          <>
            <p className="text-sm text-muted-foreground">{tr('Just type your qualifications — please do not upload certificates or diplomas. Schools check documents directly with you.', 'Chỉ cần nhập thông tin bằng cấp — vui lòng không tải lên chứng chỉ hay bằng. Các trường sẽ xác minh trực tiếp với bạn.')}</p>
            <Section title={tr('Highest degree', 'Bằng cấp cao nhất')}>
              <SingleChips options={TEACHER_OPTIONS.degree} value={t.degreeLevel} onChange={(v) => set('degreeLevel', v)} lang={lang} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Input aria-label={tr('Major', 'Chuyên ngành')} placeholder={tr('Major, e.g. English Literature', 'Chuyên ngành, vd. Văn học Anh')} value={t.degreeMajor} maxLength={LIMITS.shortText} onChange={(e) => set('degreeMajor', e.target.value)} />
                <Input aria-label={tr('University', 'Trường đại học')} placeholder={tr('University', 'Trường đại học')} value={t.degreeInstitution} maxLength={LIMITS.shortText} onChange={(e) => set('degreeInstitution', e.target.value)} />
                <Input aria-label={tr('Year', 'Năm')} placeholder={tr('Year', 'Năm')} type="number" inputMode="numeric" value={t.degreeYear ?? ''} onChange={(e) => set('degreeYear', e.target.value ? Number(e.target.value) : null)} />
              </div>
            </Section>
            <Section title={tr('Teaching certificates', 'Chứng chỉ giảng dạy')}>
              <div className="space-y-4">
                {t.certificates.map((c, i) => (
                  <div key={i} className="space-y-3 border-b border-border pb-4">
                    <SingleChips options={TEACHER_OPTIONS.cert} value={c.type || null} onChange={(v) => set('certificates', t.certificates.map((y, j) => (j === i ? { ...y, type: v } : y)))} lang={lang} />
                    <div className="flex flex-wrap items-center gap-3">
                      <Input aria-label={tr('Hours', 'Số giờ')} placeholder={tr('Hours', 'Số giờ')} type="number" inputMode="numeric" className="w-28" value={c.hours ?? ''} onChange={(e) => set('certificates', t.certificates.map((y, j) => (j === i ? { ...y, hours: e.target.value ? Number(e.target.value) : null } : y)))} />
                      <Input aria-label={tr('Provider', 'Đơn vị cấp')} placeholder={tr('Provider', 'Đơn vị cấp')} className="w-56" value={c.provider} maxLength={LIMITS.shortText} onChange={(e) => set('certificates', t.certificates.map((y, j) => (j === i ? { ...y, provider: e.target.value } : y)))} />
                      <Input aria-label={tr('Year', 'Năm')} placeholder={tr('Year', 'Năm')} type="number" inputMode="numeric" className="w-24" value={c.year ?? ''} onChange={(e) => set('certificates', t.certificates.map((y, j) => (j === i ? { ...y, year: e.target.value ? Number(e.target.value) : null } : y)))} />
                      <Button variant="ghost" size="sm" type="button" onClick={() => set('certificates', t.certificates.filter((_, j) => j !== i))}><Trash2 className="size-4" />{tr('Remove', 'Xoá')}</Button>
                    </div>
                    {errors[`certificates.${i}`] && <p className="text-sm text-destructive">{errText(errors[`certificates.${i}`])}</p>}
                  </div>
                ))}
                {t.certificates.length < LIMITS.certificates && (
                  <Button variant="secondary" size="sm" type="button" onClick={() => set('certificates', [...t.certificates, { type: '', hours: null, provider: '', year: null }])}><Plus className="size-4" />{tr('Add a certificate', 'Thêm chứng chỉ')}</Button>
                )}
              </div>
            </Section>
            {draftHost && (
              <p className="text-sm text-muted-foreground">{tr('Next you sign in to add your photo, intro video and CV, and publish. Your answers come with you.', 'Tiếp theo bạn đăng nhập để thêm ảnh, video giới thiệu, CV và đăng hồ sơ. Câu trả lời sẽ được giữ nguyên.')}</p>
            )}
          </>
        )}

        {step === 'finish' && (
          <>
            {!user && !authLoading && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-tint p-4">
                <p className="text-sm text-body">{tr('Sign in to add your photo, video and CV. Your answers are saved on this device.', 'Đăng nhập để thêm ảnh, video và CV. Câu trả lời được lưu trên thiết bị này.')}</p>
                <Button variant="cta" size="sm" onClick={() => openSignIn()}>{tr('Sign in', 'Đăng nhập')}</Button>
              </div>
            )}
            <Section title={tr('Profile photo', 'Ảnh hồ sơ')} hint={tr('A clear, friendly headshot.', 'Ảnh chân dung rõ mặt, thân thiện.')}>
              <div className="flex items-center gap-4">
                <span className="relative flex size-20 items-center justify-center overflow-hidden rounded-full bg-muted">
                  {t.photoUrl ? <img src={t.photoUrl} alt="" className="size-full object-cover" /> : <Camera className="size-6 text-muted-foreground" />}
                </span>
                <label className={cn('inline-flex cursor-pointer items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-body hover:bg-muted', !user && 'pointer-events-none opacity-50')}>
                  {busy === 'photo' ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
                  {t.photoUrl ? tr('Change photo', 'Đổi ảnh') : tr('Upload photo', 'Tải ảnh lên')}
                  <input type="file" accept="image/jpeg,image/png,image/webp,.heic,.heif" className="sr-only" disabled={!user} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f) }} />
                </label>
              </div>
              {errors.photoUrl && <p className="text-sm text-destructive">{errText(errors.photoUrl)}</p>}
            </Section>
            <Section title={tr('Intro video (optional)', 'Video giới thiệu (không bắt buộc)')} hint={tr('Up to 60 seconds: say hello and show how you teach.', 'Tối đa 60 giây: chào hỏi và cho thấy cách bạn dạy.')}>
              {t.videoUrl ? (
                <div className="flex items-center gap-3">
                  <video src={t.videoUrl} controls className="h-40 rounded-xl bg-black" />
                  <Button variant="ghost" size="sm" type="button" onClick={() => set('videoUrl', null)}><X className="size-4" />{tr('Remove', 'Xoá')}</Button>
                </div>
              ) : (
                <label className={cn('inline-flex cursor-pointer items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-body hover:bg-muted', !user && 'pointer-events-none opacity-50')}>
                  {busy === 'video' ? <Loader2 className="size-4 animate-spin" /> : <Video className="size-4" />}
                  {busy === 'video' ? tr('Uploading…', 'Đang tải…') : tr('Upload video', 'Tải video lên')}
                  <input type="file" accept="video/mp4,video/quicktime,video/webm" className="sr-only" disabled={!user} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadVideo(f) }} />
                </label>
              )}
            </Section>
            <Section title={tr('CV (optional)', 'CV (không bắt buộc)')} hint={tr('PDF, up to 10 MB. Private: a school gets it only when you tap “Share my phone, email & CV” in your chat with them.', 'PDF, tối đa 10 MB. Riêng tư: trường chỉ nhận được khi bạn bấm “Chia sẻ số điện thoại, email và CV” trong tin nhắn.')}>
              <div className="flex flex-wrap items-center gap-3">
                {(cvFile || cvName) && <span className="inline-flex items-center gap-2 text-sm text-body"><FileText className="size-4" />{cvFile?.name ?? cvName}</span>}
                <label className={cn('inline-flex cursor-pointer items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-body hover:bg-muted', !user && 'pointer-events-none opacity-50')}>
                  <FileText className="size-4" />
                  {cvFile || cvName ? tr('Replace CV', 'Thay CV') : tr('Choose PDF', 'Chọn tệp PDF')}
                  <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={!user} onChange={(e) => { const f = e.target.files?.[0]; if (f) setCvFile(f) }} />
                </label>
                {mode === 'edit' && cvName && !cvFile && <Button variant="ghost" size="sm" type="button" onClick={removeCv}><Trash2 className="size-4" />{tr('Remove', 'Xoá')}</Button>}
              </div>
            </Section>
            <Field invalid={!!errors.phone}>
              <Label htmlFor="tf-phone">{tr('Phone number', 'Số điện thoại')}</Label>
              <FieldControl id="tf-phone" render={<Input id="tf-phone" type="tel" inputMode="tel" autoComplete="tel" value={t.phone} maxLength={20} placeholder="0901 234 567" onChange={(e) => set('phone', e.target.value)} />} />
              <FieldDescription className="text-muted-foreground">{tr('Never shown publicly. Shared with a school only when you tap “Share my phone, email & CV” in your chat.', 'Không bao giờ công khai. Chỉ chia sẻ với trường khi bạn bấm “Chia sẻ số điện thoại, email và CV” trong tin nhắn.')}</FieldDescription>
              {errors.phone && <FieldError>{errText(errors.phone)}</FieldError>}
            </Field>
            <Section title={tr('Your choices', 'Lựa chọn của bạn')}>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-relaxed text-body">
                <Checkbox checked={t.consentPublic} onChange={(v: boolean) => set('consentPublic', v)} className="mt-0.5 h-5 w-5" />
                <span>{tr('Publish my profile (name, photo, video, experience and qualifications) on this site, where schools and search engines can see it. Required.', 'Đăng hồ sơ của tôi (tên, ảnh, video, kinh nghiệm và bằng cấp) trên trang này, nơi các trường và công cụ tìm kiếm có thể xem. Bắt buộc.')}</span>
              </label>
              {errors.consentPublic && <p className="text-sm text-destructive">{errText(errors.consentPublic)}</p>}
              <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-relaxed text-body">
                <Checkbox checked={t.matchEmailOptIn} onChange={(v: boolean) => set('matchEmailOptIn', v)} className="mt-0.5 h-5 w-5" />
                <span>{tr('Email me jobs that match my profile. Optional.', 'Gửi email cho tôi các việc làm phù hợp. Không bắt buộc.')}</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-relaxed text-body">
                <Checkbox checked={t.staffContactOptIn} onChange={(v: boolean) => set('staffContactOptIn', v)} className="mt-0.5 h-5 w-5" />
                <span>{tr('Our staff may call me about matching jobs and introduce my profile to those schools. Optional.', 'Nhân viên của chúng tôi có thể gọi cho tôi về việc làm phù hợp và giới thiệu hồ sơ của tôi với các trường đó. Không bắt buộc.')}</span>
              </label>
              <p className="text-xs text-muted-foreground">
                {tr('Matching uses AI services (Google Gemini) to compare your profile with jobs. See our ', 'Việc so khớp dùng dịch vụ AI (Google Gemini) để so sánh hồ sơ với việc làm. Xem ')}
                <Link href="/privacy" className="underline">{tr('privacy policy', 'chính sách quyền riêng tư')}</Link>.
              </p>
            </Section>
            {mode === 'edit' && (
              <Section title={tr('Visibility', 'Hiển thị')}>
                <Switch checked={status === 'live' && listingLive} onChange={(v: boolean) => toggleStatus(v)} label={tr('Show my profile to schools', 'Hiển thị hồ sơ cho các trường')} />
                {status === 'live' && !listingLive && <p className="text-sm text-muted-foreground">{tr('Your profile is under review and not visible right now. Contact support if you think this is a mistake.', 'Hồ sơ của bạn đang được xem xét và tạm thời không hiển thị. Liên hệ hỗ trợ nếu bạn cho rằng có nhầm lẫn.')}</p>}
                {!confirmDelete ? (
                  <Button variant="ghost" size="sm" type="button" className="text-destructive" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" />{tr('Delete my teacher profile', 'Xoá hồ sơ giáo viên')}</Button>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-body">{tr('Delete your profile, video link and CV for good?', 'Xoá vĩnh viễn hồ sơ, video và CV?')}</span>
                    <Button variant="destructive" size="sm" type="button" onClick={deleteProfile}>{tr('Delete', 'Xoá')}</Button>
                    <Button variant="ghost" size="sm" type="button" onClick={() => setConfirmDelete(false)}>{tr('Cancel', 'Huỷ')}</Button>
                  </div>
                )}
              </Section>
            )}
          </>
        )}

        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      </div>
    </StepWizard>
  )
}
