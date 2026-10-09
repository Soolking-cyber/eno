'use client'

// ── TEACHER FORM ────────────────────────────────────────────────────────────────────────────────
// The teacher sign-up + edit flow (owner, 2026-09-30), SITUATION FIRST since the onboarding redesign (owner,
// 2026-10-08): the teacher taps where they are now and what work they want, and every later screen shows only what
// fits them. One StepWizard, six steps (profile.ts teacherSteps decides which of them a teacher sees):
//   1 Your plans · 2 Where you teach · 3 Your teaching · 4 About you — need no account: teacher.eno.vn serves these;
//   5 Cover lessons (only where the home province has cover) · 6 Photo & publish — need a session on eno.vn.
// ⛔ teacher.eno.vn has no session (cookies are host-scoped), so after step 4 it hands the answers to eno.vn in the URL
// FRAGMENT (`#d=`, v2: the draft steps' fields only), which no server ever sees. On eno.vn the sign-in comes right
// after "About you", so the cover switch, the two opt-ins and Publish — each one act, with its notice beside it —
// happen once, on eno.vn, and nothing is lost in the hand-off or a Google sign-in.
// Validation is src/lib/teachers/profile.ts — the same functions the server runs; the screens are ./steps/*.tsx; the
// form's own derivations (one answer re-deriving another, the edit warnings, the hand-off) are teacher-form-rules.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { StepWizard, type WizardStep } from '@/components/ui/step-wizard'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { BookOpen, CalendarDays, Camera, Check, Compass, ExternalLink, Loader2, MapPin, User } from '@/components/ui/icons'
import { compressImageFile } from '@/lib/normalize-image'
import { uploadListingVideo } from '@/lib/video-upload-client'
import {
  AI_NOTICE_VERSION, DRAFT_STEPS, EMPTY_TEACHER, PUBLISH_NOTICE_VERSION, TEACHER_STEPS, hasTeachingGoal, normalizeForSave,
  normalizeTeacherInput, splitGoalErrors, teacherSteps, type TeacherErrors, type TeacherInput, type TeacherStep,
} from '@/lib/teachers/profile'
import { TEACHER_DRAFT_HASH_KEY } from '@/lib/teachers/constants'
import { COVER_CONSENT_VERSION, coverStamp, mergeStaleCover, type SavedCover } from '@/lib/teachers/cover'
import { HCMC, coverReachOf, placeLabel } from '@/lib/teachers/places'
import { type CoverPatch } from '@/components/teachers/cover-fields'
import { CoverSummary } from '@/components/teachers/cover-summary'
import {
  ACCOUNT_STEPS, checkSteps, decodeHandoff, draftPart, droppedAnswers, encodeHandoff, firstStepWithError, forDraft, fromDraft,
  isTeacherStep, nothingDropped, type DroppedField,
} from '@/components/teachers/teacher-form-rules'
import { makeErrText, type StepProps } from '@/components/teachers/steps/shared'
import { PlansStep } from '@/components/teachers/steps/plans-step'
import { WhereStep } from '@/components/teachers/steps/where-step'
import { TeachingStep } from '@/components/teachers/steps/teaching-step'
import { AboutStep } from '@/components/teachers/steps/about-step'
import { CoverStep } from '@/components/teachers/steps/cover-step'
import { FinishStep } from '@/components/teachers/steps/finish-step'
import { scrollBehavior } from '@/lib/reduced-motion'
import { PushOptInCard } from '@/components/marketplace/push-opt-in-card'

const DRAFT_KEY = 'eno.teacherDraft.v1'

type Mode = 'join' | 'edit'

/**
 * ⛔ THE DRAFT IS CRASH INSURANCE, NOT A DRAFTS FEATURE — the /post wizard's rule (post-wizard DRAFT_TTL_MS; gate reviews,
 * 2026-10-08). It lives in THIS TAB (sessionStorage) for DRAFT_TTL_MS after the last real change: long enough for a reload
 * and for the sign-in after "About you" (Google's full-page redirect comes back to the same tab; the code sign-in never
 * leaves the page), never long enough to hand a shared computer's next user the last person's name, phone and bio — as
 * the old device-wide draft, kept for good, did. Only real typing is kept (an untouched form writes nothing); an account
 * change in the tab starts a fresh form and clears it (TeacherForm); a publish clears it. ⚠️ Accepted, as for /post:
 * someone using the SAME tab within that window, after the last person walked away without signing out.
 * Four rounds of per-person ownership (owner stamps, an account store, adoption at sign-in) each grew a new edge; this is
 * the contract the codebase already keeps.
 * v4 (2026-10-08): `{ v: 4, savedAt, step, t }` under the same key (so the /privacy storage row stays true) — the STEP
 * is kept, so a reload or the Google round trip lands where the teacher was (or where "Sign in" was taking
 * them). ⛔ It never holds the photo, the video, the cover switch or a consent (teacher-form-rules forDraft): each is
 * asked again where it is given. A v3 draft from the previous form is read once through the legacy mapping
 * (profile.ts normalizeTeacherInput → fromLegacyTeacher) and opens on its first step that fails.
 * `districtNotSaying` (only when true): the HCMC district was answered "Prefer not to say" — an answer that stores
 * nothing, so it rides beside `t`, never in it (gate review, 2026-10-08; the form's districtNotSaying below).
 */
const DRAFT_TTL_MS = 15 * 60_000
type StoredDraft = { v: 4; savedAt: number; step: TeacherStep; t: TeacherInput; districtNotSaying?: true }
export type ReadDraft = { t: unknown; step: TeacherStep | null; districtNotSaying?: true }
export const readStoredDraft = (now = Date.now()): ReadDraft | null => {
  try {
    localStorage.removeItem(DRAFT_KEY) // the old device-wide draft, kept for good: deleted unread
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null') as { v?: unknown; savedAt?: unknown; step?: unknown; t?: unknown; districtNotSaying?: unknown } | null
    if (d && (d.v === 4 || d.v === 3) && d.t && typeof d.savedAt === 'number' && now - d.savedAt < DRAFT_TTL_MS) {
      return { t: d.t, step: d.v === 4 && isTeacherStep(d.step) ? d.step : null, ...(d.v === 4 && d.districtNotSaying === true ? { districtNotSaying: true as const } : {}) }
    }
    sessionStorage.removeItem(DRAFT_KEY)
    return null
  } catch { return null }
}
export const writeStoredDraft = (t: TeacherInput, step: TeacherStep, ui: { districtNotSaying?: boolean } = {}) => {
  try {
    const draft: StoredDraft = { v: 4, savedAt: Date.now(), step, t: forDraft(t), ...(ui.districtNotSaying ? { districtNotSaying: true as const } : {}) }
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch { /* private mode: the draft just does not persist */ }
}
const clearStored = () => {
  try { sessionStorage.removeItem(DRAFT_KEY); localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
}

/** The rail's synthetic last node on teacher.eno.vn — "Finish on eno.vn", never a step of its own (never current). */
const HANDOFF_NODE = 'handoff'

type TeacherFormProps = { mode: Mode; draftHost: boolean; apexOrigin: string; goal?: 'cover' | null }

/**
 * How many times a SIGNED-IN account has left this page — a sign-out, or another account. A sign-in (none → an account) is
 * not a leave: the teacher signs in mid-flow (after "About you") and keeps their place. React's "adjust state while
 * rendering" pattern, so the count moves in the very render that sees the new account — never one commit of the old form
 * under it.
 */
export function useAccountLeaves(uid: string | null): number {
  const [seen, setSeen] = useState({ uid, leaves: 0 })
  if (seen.uid === uid) return seen.leaves
  const next = { uid, leaves: seen.uid !== null ? seen.leaves + 1 : seen.leaves }
  setSeen(next)
  return next.leaves
}

/**
 * ⛔ THE FORM IS ONE PERSON'S (gate reviews, 2026-10-07/08). Sign-out does not reload the page, and a session change from
 * another tab arrives the same way:
 *   · edit — another account (or none) gets a FRESH form: every loaded value, private video link, base and in-flight answer
 *     of the previous account goes with the old instance;
 *   · join — a sign-in keeps the instance (above); a signed-in account LEAVING gets a fresh one, which clears the stored
 *     draft instead of restoring it: until that moment it was the previous person's. The app's own sign-out clears it too
 *     (src/lib/sign-out-storage.ts); a session that ended elsewhere — another tab, an expired one — does not, and the
 *     remounted form would have restored it, or the old one written it back.
 */
export function TeacherForm(props: TeacherFormProps) {
  const { user } = useAuth()
  const uid = user?.id ?? null
  const leaves = useAccountLeaves(uid)
  return <TeacherFormForAccount key={props.mode === 'edit' ? `acct:${uid ?? 'none'}` : `join:${leaves}`} {...props} restoreDraft={leaves === 0} />
}

type PendingChange = { next: TeacherInput; touched: readonly (keyof TeacherInput)[]; fields: DroppedField[]; places: string[] }

function TeacherFormForAccount({ mode, draftHost, apexOrigin, goal = null, restoreDraft = true }: TeacherFormProps & { restoreDraft?: boolean }) {
  const { tr, lang } = useLanguage()
  const { user, loading: authLoading, openSignIn } = useAuth()
  const uid = user?.id ?? null
  const coverIntent = goal === 'cover'
  const [t, setTState] = useState<TeacherInput>(EMPTY_TEACHER)
  // The step BY KEY, never by index: when an answer adds or removes a step (a home with cover, "Online only"), the rail
  // re-counts around the step the teacher is on — it never moves them silently.
  const [stepKey, setStepKey] = useState<TeacherStep>('plans')
  const [errors, setErrors] = useState<TeacherErrors>({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState<'' | 'photo' | 'video' | 'saving'>('')
  const [cvFile, setCvFile] = useState<File | null>(null)
  const [cvName, setCvName] = useState<string | null>(null)
  const [status, setStatus] = useState<'live' | 'hidden'>('live')
  const [done, setDone] = useState<{ listingId: string; live: boolean; noGoal: boolean } | null>(null)
  const [loaded, setLoaded] = useState(mode === 'join')
  // Edit: the signed-in account has no teacher profile — it is offered Create, never an empty edit form.
  const [noProfile, setNoProfile] = useState(false)
  const [existing, setExisting] = useState(false)
  // Join: answers ARRIVED — a teacher.eno.vn hand-off or a restored draft (or typed here before signing in) — so a
  // signed-in account that already has a profile is offered to review them in it, rather than having them thrown away.
  const [arrived, setArrived] = useState(false)
  const [handoffArrived, setHandoffArrived] = useState(false)
  const [listingLive, setListingLive] = useState(true)
  // GET /api/teachers/me: whether this account may publish right now (shown at the TOP of the last step), and — with no
  // profile yet — what the account already knows, OFFERED, never filled in unasked.
  const [publishGate, setPublishGate] = useState<{ ok: boolean; code: string | null } | null>(null)
  const [prefill, setPrefill] = useState<{ displayName: string | null; avatarUrl: string | null; phone: string | null } | null>(null)
  // Where to go once signed in: "Sign in", a hand-off, or a draft that was on a step needing an account.
  const [resumeTo, setResumeTo] = useState<TeacherStep | null>(null)
  const signInAsked = useRef(false)
  // Edit: a stored consent given under an OLDER notice — loaded OFF, so it is given again under today's words (D5).
  const [reconfirm, setReconfirm] = useState({ cover: false, optIns: false })
  // Edit: a hand-off's answers were filled in over the saved profile ("Review these answers in my profile"), unsaved —
  // and what saving them would clear from the saved profile, said up front (the edit warning's list, for the batch).
  const [applied, setApplied] = useState<{ fields: DroppedField[]; places: string[] } | null>(null)
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null)
  const [whatsPublic, setWhatsPublic] = useState(false)
  // Cover lessons (2026-10-07): the cover availability AS LAST SAVED (the summary card and its "Still available"
  // tap work on this, never on unsaved edits in `t` — gate review), when it was last confirmed, and the save state.
  const [savedCover, setSavedCover] = useState<SavedCover | null>(null)
  const [coverConfirmedAt, setCoverConfirmedAt] = useState<string | null>(null)
  const [coverSave, setCoverSave] = useState<'' | 'saving' | 'saved' | 'error'>('')
  // After a stale-window refusal: what reloadSavedCover says, on the cover card.
  const [coverNotice, setCoverNotice] = useState('')
  // What the card's last "Still available" left public (PATCH /api/teachers/me/cover `live`) — false: saved, but the
  // profile is not shown, so the card must not read as if schools see the confirmed cover (gate review, 2026-10-09).
  const [coverLive, setCoverLive] = useState(true)
  // "Show my profile to schools" outside the Visibility switch (the done screen, the cover card) is on its way.
  const [showing, setShowing] = useState(false)
  // The intro video (2026-10-07, owner: "show their intro video in profile or hide and send upon request"): whether a
  // PRIVATE one is stored — its address never reaches the form — and the version this form loaded, sent back as
  // `videoBase` so a stale window can never publish, hide, replace or delete a newer choice (src/lib/teachers/video.ts).
  const [privateVideo, setPrivateVideo] = useState(false)
  const [videoBase, setVideoBase] = useState<number | null>(null)
  const [videoRemoving, setVideoRemoving] = useState(false)
  const [confirmVideoRemove, setConfirmVideoRemove] = useState(false)
  // The public video AS SAVED: hiding THAT one cannot recall copies of its link (the note under the choice says so).
  const [savedPublicUrl, setSavedPublicUrl] = useState<string | null>(null)
  // The TeacherProfile this form loaded — Save and Remove name it, and the server refuses another account's (409).
  const [teacherProfileId, setTeacherProfileId] = useState<string | null>(null)
  // The teacher's own look at their private video — a 10-minute link from GET /api/teachers/me/video.
  const [ownVideoUrl, setOwnVideoUrl] = useState<string | null>(null)
  const [ownVideoBusy, setOwnVideoBusy] = useState(false)
  // Every Watch takes a ticket, and a reload of the saved video takes a newer one: an answer for an older one is dropped.
  // (Another account gets another form instance altogether — TeacherForm.)
  const ownSeq = useRef(0)
  const coverReloadSeq = useRef(0)
  const hydrated = useRef(false)
  // tr changes identity with the language; a load must never re-run (and overwrite edits) because of it.
  const trRef = useRef(tr)
  trRef.current = tr
  // ⛔ THE FORM'S LATEST VALUE, WRITTEN BY EVERY CHANGE AS IT HAPPENS — never synced by an effect after the render (gate
  // review, 2026-10-07): a re-read answering between an edit and that effect would judge the edit "untouched" and
  // overwrite it (reloadSavedCover). Every write goes through setT, which updates this first.
  const tRef = useRef(t)
  const setT = useCallback((u: TeacherInput | ((prev: TeacherInput) => TeacherInput)) => {
    const next = typeof u === 'function' ? u(tRef.current) : u
    tRef.current = next
    setTState(next)
  }, [])
  // ⛔ "PREFER NOT TO SAY" IS THE FORM'S TO KEEP (gate review, 2026-10-08). It stores nothing — currentDistrictKey '',
  // exactly like the optional question left empty — so the district field cannot hold it: the field remounts with its
  // step, and the answer it kept for itself showed as unanswered after every step change, reload and Google round trip.
  // It stands while HCMC is the home (a saved district always shows as itself); a new home lets it go — that home's
  // district is a new question — adjusted while rendering (useAccountLeaves' pattern). The draft carries it. ⚠️ Bounded
  // to THIS TAB on purpose: the teacher.eno.vn `#d=` fragment carries answers only (decodeHandoff), and a saved profile
  // stores none — an edit opens such a district empty, which is what was stored.
  const [districtNotSaying, setDistrictNotSaying] = useState(false)
  if (districtNotSaying && !(t.livesIn === 'city' && t.currentCity === HCMC)) setDistrictNotSaying(false)
  // Edit: a save that would HIDE the profile, held until the teacher says so (the dialog below).
  const [confirmHide, setConfirmHide] = useState(false)
  // The success screen replaces a long wizard: bring its heading into view (preview check, 2026-10-07 — after Publish
  // or Save it sat above the viewport, wherever the last step had been scrolled to).
  useEffect(() => { if (done) window.scrollTo({ top: 0, behavior: scrollBehavior() }) }, [done])

  // ── The steps this teacher sees — re-derived from their answers (profile.ts teacherSteps) ─────────────────────────
  const steps = useMemo(() => teacherSteps(t, { draftHost }), [t, draftHost])
  const step: TeacherStep = steps.includes(stepKey)
    ? stepKey
    : steps.find((s) => TEACHER_STEPS.indexOf(s) > TEACHER_STEPS.indexOf(stepKey)) ?? steps[steps.length - 1]
  const stepIdx = steps.indexOf(step)
  const errText = useMemo(() => makeErrText(tr), [tr])

  const clearErrorsFor = (keys: readonly string[]) => setErrors((prev) => {
    if (!keys.some((k) => prev[k as keyof TeacherErrors])) return prev
    const n = { ...prev }
    for (const k of keys) delete n[k as keyof TeacherErrors]
    return n
  })
  const set = useCallback(<K extends keyof TeacherInput>(k: K, v: TeacherInput[K]) => {
    setT((prev) => ({ ...prev, [k]: v }))
    setErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev))
  }, [setT])
  const patch = useCallback((p: Partial<TeacherInput>) => {
    setT((prev) => ({ ...prev, ...p }))
    clearErrorsFor(Object.keys(p))
  }, [setT])
  /**
   * A change that re-derives other answers. ⛔ ON AN EDIT, NOTHING SAVED IS DROPPED WITHOUT A WARNING (plan, 2026-10-08):
   * removing Full-time takes the salary (and the start month without Part-time); moving abroad switches cover off; a
   * new home drops the old home's places. The dialog lists what would go; only "Change it" applies it. A new profile
   * has nothing saved to lose — its hidden answers stay in the form and come back with the question.
   */
  const update = useCallback((next: TeacherInput, touched: readonly (keyof TeacherInput)[], direct: readonly DroppedField[] = []) => {
    if (mode === 'edit') {
      // What the teacher clears THEMSELVES (their district, set to "Prefer not to say") is their answer, not a casualty.
      const d = droppedAnswers(tRef.current, next)
      const dropped = { fields: d.fields.filter((f) => !direct.includes(f)), places: d.places }
      if (!nothingDropped(dropped)) { setPendingChange({ next, touched, ...dropped }); return }
    }
    setT(next)
    clearErrorsFor(touched)
  }, [mode, setT])
  const applyPendingChange = () => {
    if (!pendingChange) return
    setT(pendingChange.next)
    clearErrorsFor(pendingChange.touched)
    setPendingChange(null)
  }

  // ── Restore: a `#d=` hand-off from teacher.eno.vn wins, then this tab's draft ────────────────────────────────────
  useEffect(() => {
    if (mode !== 'join' || hydrated.current) return
    hydrated.current = true
    // The form that replaced a signed-in account's (TeacherForm): a fresh start, and that account's draft goes.
    if (!restoreDraft) { clearStored(); return }
    const m = window.location.hash.match(new RegExp(`[#&]${TEACHER_DRAFT_HASH_KEY}=([^&]+)`))
    if (m) {
      // Strip the fragment first, whatever it holds, so a reload or a shared link never re-carries the draft.
      history.replaceState(null, '', window.location.pathname + window.location.search)
      // ⛔ ONLY THE DRAFT STEPS' FIELDS CROSS (decodeHandoff): never a consent, the cover switch, a phone or an upload —
      // a crafted `#d=` link could otherwise arrive with them set (gate review, 2026-10-07). A v1 fragment from before
      // the redesign is mapped at this boundary (plan review D2).
      const handed = decodeHandoff(m[1])
      if (handed) {
        setT(handed)
        setArrived(true)
        // Steps 1–4 complete: sign in (opened once, below) and land on Cover — where offered — or Photo & publish.
        // Otherwise the first step that fails.
        const bad = firstStepWithError(checkSteps(handed, DRAFT_STEPS), DRAFT_STEPS)
        const next = teacherSteps(handed, { draftHost: false }).find((s) => ACCOUNT_STEPS.includes(s)) ?? 'finish'
        if (bad) setStepKey(bad)
        else { setStepKey('about'); setResumeTo(next); setHandoffArrived(true) }
        writeStoredDraft(handed, bad ?? next)
      }
      return
    }
    const stored = readStoredDraft()
    if (!stored) return
    // ⛔ Nor from a stored draft: the uploads, the cover switch and the consents are not in it (forDraft) and are stripped
    // again on the way in (fromDraft) — the key is per TAB, and on a shared browser a tab can be the next person's.
    const restored = fromDraft(stored.t)
    setT(restored)
    if (stored.districtNotSaying) setDistrictNotSaying(true)
    setArrived(true)
    // Back where it was — never past the first draft step that fails (a v3 draft, with no step, opens there).
    const order = (s: TeacherStep) => TEACHER_STEPS.indexOf(s)
    const bad = firstStepWithError(checkSteps(restored, DRAFT_STEPS), DRAFT_STEPS)
    const want = stored.step
    const target: TeacherStep = bad && (!want || order(bad) < order(want)) ? bad : want ?? bad ?? 'plans'
    // A step that needs an account is shown once signed in; until then, the last step before it.
    if (ACCOUNT_STEPS.includes(target)) { setStepKey('about'); setResumeTo(target) }
    else setStepKey(target)
  }, [mode, restoreDraft, setT])

  // Signed in (in place, or back from Google): on to where the teacher was going — ⛔ only past four valid draft steps.
  useEffect(() => {
    if (!resumeTo || authLoading || !uid) return
    const bad = firstStepWithError(checkSteps(tRef.current, DRAFT_STEPS), DRAFT_STEPS)
    setStepKey(bad ?? resumeTo)
    setResumeTo(null)
  }, [resumeTo, uid, authLoading])
  // A step that needs an account, with none (a session that ended): the last step before it, and resume after.
  useEffect(() => {
    if (mode !== 'join' || draftHost || authLoading || uid || !ACCOUNT_STEPS.includes(stepKey)) return
    setResumeTo(stepKey)
    setStepKey('about')
  }, [mode, draftHost, authLoading, uid, stepKey])
  const signInNote = () => tr('Sign in to add cover lessons, your photo and publish your teacher profile. Your answers are kept.', 'Đăng nhập để thêm dạy thay, ảnh và đăng hồ sơ giáo viên. Câu trả lời của bạn được giữ lại.')
  // The teacher.eno.vn hand-off arrived complete and signed out: the sign-in opens, ONCE (closing it leaves "Sign in to
  // continue" on step 4).
  useEffect(() => {
    if (!handoffArrived || authLoading || uid || signInAsked.current) return
    signInAsked.current = true
    openSignIn({ note: signInNote() })
  }, [handoffArrived, authLoading, uid, openSignIn]) // once per arrival (signInNote is copy)

  // ── Edit: load the saved profile ───────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'edit' || authLoading) return
    if (!uid) { setLoaded(true); return }
    let alive = true
    fetch('/api/teachers/me')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        if (d?.publishGate) setPublishGate(d.publishGate)
        const tp = d?.teacher
        if (!tp) { setNoProfile(true); setLoaded(true); return }
        // ⛔ A CONSENT COUNTS ONLY UNDER THE NOTICE IN FORCE. The cover switch and the two opt-ins load ON only when their
        // stored version is today's; an older one loads OFF and the step says why — switching it on again is the fresh
        // consent (a save of a pre-ticked old opt-in would have recorded consent to words the teacher never saw — the
        // skill plan's review, and plan review D5).
        const coverCurrent = tp.coverOpen === true && tp.coverConsentVersion === COVER_CONSENT_VERSION
        const emailCurrent = tp.matchEmailOptIn === true && tp.matchEmailNoticeVersion === AI_NOTICE_VERSION
        const callsCurrent = tp.staffContactOptIn === true && tp.staffContactNoticeVersion === AI_NOTICE_VERSION
        let next = normalizeTeacherInput({
          ...tp,
          availableFrom: tp.availableFrom ? String(tp.availableFrom).slice(0, 10) : null,
          teachAreasConfirmed: !!tp.teachAreasConfirmedAt,
          coverOpen: coverCurrent,
          coverConsent: coverCurrent,
          matchEmailOptIn: emailCurrent,
          staffContactOptIn: callsCurrent,
        })
        // "Review these answers in my profile" (the join page, over an existing profile): the hand-off's draft-step
        // answers over the saved profile — UNSAVED until Save changes. The draft then goes: it has done its job.
        const params = new URLSearchParams(window.location.search)
        if (params.get('review') === 'draft') {
          const stored = readStoredDraft()
          if (stored) {
            const before = next
            next = { ...next, ...draftPart(fromDraft(stored.t)) }
            setApplied(droppedAnswers(before, next))
            if (stored.districtNotSaying) setDistrictNotSaying(true)
          }
          clearStored()
          params.delete('review')
          history.replaceState(null, '', window.location.pathname + (params.toString() ? `?${params}` : ''))
        }
        setT(next)
        setReconfirm({ cover: tp.coverOpen === true && !coverCurrent, optIns: (tp.matchEmailOptIn === true && !emailCurrent) || (tp.staffContactOptIn === true && !callsCurrent) })
        setCoverConfirmedAt(tp.coverConfirmedAt ?? null)
        setSavedCover({
          coverOpen: tp.coverOpen === true, coverSlots: tp.coverSlots ?? [], coverAreas: tp.coverAreas ?? [],
          coverRateVnd: tp.coverRateVnd ?? null, consentCurrent: tp.coverConsentVersion === COVER_CONSENT_VERSION,
        })
        setCvName(tp.cvFileName ?? null)
        setPrivateVideo(tp.hasPrivateVideo === true)
        setVideoBase(typeof tp.videoVersion === 'number' ? tp.videoVersion : null)
        setSavedPublicUrl(tp.videoUrl ?? null)
        setTeacherProfileId(typeof tp.id === 'string' ? tp.id : null)
        setStatus(tp.status === 'hidden' ? 'hidden' : 'live')
        setListingLive(tp.listingLive !== false)
        // A deep link (`/teachers/edit?step=finish` — the done screen's "Add more to stand out").
        const want = params.get('step')
        if (isTeacherStep(want)) setStepKey(want)
        setLoaded(true)
      })
      .catch(() => { if (alive) { setFormError(trRef.current('Could not load your profile.', 'Không tải được hồ sơ.')); setLoaded(true) } })
    return () => { alive = false }
  }, [mode, uid, authLoading, setT])

  useEffect(() => {
    // ⛔ Never after a publish: clearStored() has run, and the saved video's setT must not write the draft — phone, name
    // and bio included — back for the next person on a shared browser (integration review, 2026-10-08).
    // Only real typing: an untouched form writes nothing (it would only replace a draft with an empty one).
    // The step written is where a reload should land: where "Sign in" is taking them, else where they are.
    if (mode === 'join' && hydrated.current && !done && t !== EMPTY_TEACHER) writeStoredDraft(t, resumeTo ?? stepKey, { districtNotSaying })
  }, [t, stepKey, resumeTo, mode, done, districtNotSaying])

  // /join with a profile already: saving here would overwrite it, so it is offered Edit instead. With no profile: what
  // the account can offer the form, and whether it may publish now.
  useEffect(() => {
    if (mode !== 'join' || !uid) return
    let alive = true
    fetch('/api/teachers/me').then((r) => r.json()).then((d) => {
      if (!alive) return
      if (d?.publishGate) setPublishGate(d.publishGate)
      if (d?.teacher) setExisting(true)
      else if (d?.prefill) setPrefill(d.prefill)
    }).catch(() => {})
    return () => { alive = false }
  }, [mode, uid])

  const publishErrText = (code: string): string => {
    if (code === 'contact_in_text' || code === 'contact_in_name') return tr('Please remove phone numbers, emails and links from your profile text — schools get your contact only when you share it in chat.', 'Vui lòng xoá số điện thoại, email và liên kết khỏi hồ sơ — trường chỉ nhận liên hệ khi bạn chia sẻ trong tin nhắn.')
    if (code === 'banned_words') return tr('Your profile contains a word we do not allow. Please rephrase.', 'Hồ sơ có từ không được phép. Vui lòng viết lại.')
    if (code === 'account_restricted') return tr('Your account cannot publish right now.', 'Tài khoản của bạn hiện chưa thể đăng.')
    if (code.startsWith('identity_')) return tr('Please verify your identity in Account settings before publishing.', 'Vui lòng xác minh danh tính trong Cài đặt tài khoản trước khi đăng.')
    if (code === 'rate_limited') return tr('Too many saves — please wait a few minutes.', 'Lưu quá nhiều lần — vui lòng đợi vài phút.')
    // A notice beside a consent changed while this page was open: its words must be read again (409 notice_changed).
    if (code === 'notice_changed') return tr('Some of the wording on this page has changed since you opened it. Reload the page to read it, then save again.', 'Một số nội dung trên trang đã thay đổi kể từ khi bạn mở. Hãy tải lại trang để đọc, rồi lưu lại.')
    // Join mode loaded no saved video either: the server refuses a change over a stored one (video.ts, no base).
    if (code === 'video_changed' && mode === 'join') return tr('You already have a teacher profile. Open it from your account (Teacher profile) to make changes.', 'Bạn đã có hồ sơ giáo viên. Hãy mở hồ sơ trong tài khoản (Hồ sơ giáo viên) để chỉnh sửa.')
    if (code === 'video_store_failed') return tr('Your intro video could not be saved just now. Please try again.', 'Chưa lưu được video giới thiệu. Vui lòng thử lại.')
    // Join mode loaded no saved cover, so the server will not let it overwrite one that is ON (publish.ts assertCoverBase).
    if (code === 'cover_changed' && mode === 'join') return tr('You already have a teacher profile that offers cover lessons. Open it from your account (Teacher profile) to make changes.', 'Bạn đã có hồ sơ giáo viên đang nhận dạy thay. Hãy mở hồ sơ trong tài khoản (Hồ sơ giáo viên) để chỉnh sửa.')
    return tr('Something went wrong. Please try again.', 'Đã có lỗi. Vui lòng thử lại.')
  }

  /**
   * ⛔ A REFUSAL MUST BE SEEN (preview check, 2026-10-07). On a phone a refused Next left the screen unchanged while the
   * cover step's only error sat ~2,300px below the viewport, and a refused save landed under the sticky action bar. So
   * after any refusal the first error (an aria-invalid control, else a group marked data-invalid, else an alert) is
   * scrolled to and its control focused. Two frames: the errors and any step change render first.
   */
  const revealFirstError = (opts: { formLineFirst?: boolean } = {}) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // In this order: an invalid field (a control, or a group of chips marked data-invalid), then the form's own error
      // line — never another card's alert first. After a SERVER refusal with no field errors the new line comes first:
      // a field marked earlier must not pull the page away from the reason the save just failed (gate review).
      const field = () => document.querySelector<HTMLElement>('main [aria-invalid="true"], main [data-invalid]')
      const line = () => document.querySelector<HTMLElement>('main [data-form-error]')
      const el = (opts.formLineFirst ? line() ?? field() : field() ?? line()) ?? document.querySelector<HTMLElement>('main [role="alert"]')
      if (!el) return
      el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
      // Base UI's radios, checkboxes and switches keep a hidden <input> beside the control (aria-hidden, tabindex -1):
      // focus the control a person would, never that.
      const focusable = 'input:not([aria-hidden="true"]):not([tabindex="-1"]), textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      const control = el.matches(focusable) ? el : el.querySelector<HTMLElement>(focusable)
      control?.focus({ preventScroll: true })
    }))
  }
  /** Show `errs`, go to the first step that holds one (on this teacher's rail) and bring it into view. */
  const refuse = (errs: TeacherErrors, opts: { formLineFirst?: boolean } = {}) => {
    setErrors(errs)
    const bad = firstStepWithError(errs, steps)
    if (bad) setStepKey(bad)
    revealFirstError(opts)
  }
  const goTo = (s: TeacherStep) => setStepKey(s)

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
      setConfirmVideoRemove(false)
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

  // ── Hand-off, sign-in, publish ──────────────────────────────────────────────────────────────────────────────────
  /** Steps 1–4 must hold before the account half: what a hand-off or "Sign in" checks first. */
  const draftStepsOk = (): boolean => {
    const e = checkSteps(t, DRAFT_STEPS)
    if (!Object.keys(e).length) return true
    refuse(e)
    return false
  }
  const handOff = () => {
    if (!draftStepsOk()) return
    // teacher.eno.vn → eno.vn: the fragment carries the draft steps' answers (v2), never a consent; no server sees it.
    window.location.assign(`${apexOrigin}/teachers/join#${TEACHER_DRAFT_HASH_KEY}=${encodeHandoff(t)}`)
  }
  const signInToContinue = () => {
    if (!draftStepsOk()) return
    // The step after "About you" is kept in the draft, so a Google round trip lands on it; a code sign-in moves on by
    // itself (the resume effect above).
    const next = steps.find((s) => ACCOUNT_STEPS.includes(s)) ?? 'finish'
    setResumeTo(next)
    writeStoredDraft(t, next, { districtNotSaying })
    openSignIn({ note: signInNote() })
  }

  /** ⚠️ Called with no argument (or `{ hideConfirmed: true }` from the hide dialog) — never handed a click event. */
  const publish = async (opts?: { hideConfirmed?: boolean }) => {
    if (busy) return
    // ⛔ SIGN-IN FIRST: photo, video and CV can only be uploaded signed in, so validating the whole form before this would
    // stop a signed-out teacher on "photo required" with no way forward (agy, commit gate 09-30).
    if (!user) { signInToContinue(); return }
    // Validated as the server will validate it: what a save keeps, every step (profile.ts). ⛔ On an EDIT the goal rule
    // (no work wanted and cover off) never blocks: the save goes through and HIDES the profile — a withdrawal never
    // requires inventing a goal (plan review D6). A new profile with no goal is refused, as the server refuses it.
    const checked = checkSteps(t, TEACHER_STEPS)
    const all = mode === 'edit' ? splitGoalErrors(checked).other : checked
    if (Object.keys(all).length) { refuse(all); return }
    // ⛔ A SAVE THAT HIDES A SHOWN PROFILE IS ASKED FIRST (gate review, 2026-10-08). With no work wanted and no public
    // cover the server saves and HIDES (D6, publish.ts noGoal) — and "Save changes" is on every step, while the
    // warnings sat on two of them: a cover-only teacher whose cover loaded OFF under a newer notice, in on
    // `?step=about` to fix a typo, saved a withdrawal they never made and found the profile hidden. The goal rule
    // still never REFUSES an edit (D6): "Save and hide" goes through. Judged on what the save keeps, as the server is.
    if (mode === 'edit' && status === 'live' && opts?.hideConfirmed !== true && !hasTeachingGoal(normalizeForSave(t))) {
      setConfirmHide(true)
      return
    }
    setBusy('saving'); setFormError('')
    try {
      const body = {
        ...t,
        // ⛔ THE PUBLISH TAP IS THE CONSENT — under the notice beside it (the action bar's line and "What's public?").
        publishNotice: PUBLISH_NOTICE_VERSION,
        // The cover switch is its own consent, under the notice beside it on the Cover step.
        ...(t.coverOpen ? { coverNotice: COVER_CONSENT_VERSION } : {}),
        // Each opt-in is its own consent, under the AI note beside them (it names Anthropic and the transfer abroad).
        ...(t.matchEmailOptIn || t.staffContactOptIn ? { aiNotice: AI_NOTICE_VERSION } : {}),
        // `coverBase`: the cover state this form loaded — the server refuses (409 cover_changed) if another window changed it.
        coverBase: mode === 'edit' && savedCover ? coverStamp(savedCover) : null,
        videoBase: mode === 'edit' ? videoBase : null,
        // ⛔ A save names the profile it edits, or claims there is none — never neither (api/teachers/me PUT).
        teacherProfileId: mode === 'edit' ? teacherProfileId : null,
      }
      const res = await fetch('/api/teachers/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (d.error === 'invalid_teacher_profile' && d.fields) {
          // An upload that is not (or no longer) provably theirs: the form goes back to what is STORED and the line asks for a
          // new upload. ⛔ Never null: null over a stored PUBLIC video is the explicit Remove — the next save would delete the
          // published video though the teacher never tapped Remove (integration review, 2026-10-08). Null is right only
          // over a private one, whose card then comes back — and savedPublicUrl is null exactly then.
          if ((d.fields as Record<string, unknown>).videoUrl === 'not_owned') {
            setT((p) => ({ ...p, videoUrl: savedPublicUrl }))
            const { videoUrl: _gone, ...rest } = d.fields as TeacherErrors
            void _gone
            setErrors(rest) // said once, on the form line — not also under the stored video it was restored to
            setFormError(errText('videoUrl', 'not_owned'))
            revealFirstError({ formLineFirst: true })
            return
          }
          // The server's field errors may sit on another step: go there first, or there is nothing to reveal (gate review).
          refuse(d.fields as TeacherErrors)
          return
        }
        // Saved under a session that is now another account's (or the profile was recreated elsewhere): nothing was written.
        if (d.error === 'profile_changed') {
          // Join mode claims there is no profile yet (api/teachers/me PUT): one exists — this account already had one, or
          // another tab just made it. The line says where it is.
          setFormError(mode === 'join'
            ? tr('You already have a teacher profile. Open it from your account (Teacher profile) to make changes.', 'Bạn đã có hồ sơ giáo viên. Hãy mở hồ sơ trong tài khoản (Hồ sơ giáo viên) để chỉnh sửa.')
            : profileChangedLine())
          revealFirstError({ formLineFirst: true })
          return
        }
        // The intro video changed in another window: the SAVED video state replaces this window's — a rare race, and the
        // line says to make the video change again. Never a merge: a stale window must not publish, hide or replace it.
        if (d.error === 'video_changed' && mode === 'edit') {
          setFormError(staleVideoLine(await reloadSavedVideo()))
          revealFirstError({ formLineFirst: true })
          return
        }
        // A stale cover from Save changes: the latest saved cover is loaded into the Cover step, which is shown with the
        // line saying so — every other step's edits stay (reloadSavedCover).
        if (d.error === 'cover_changed' && mode === 'edit') {
          // The line is written once the re-read has answered — never a claim the re-read then contradicts.
          const { r, reconsent } = await reloadSavedCover()
          if (r !== 'superseded') { setFormError(staleCoverLine(r, reconsent)); revealFirstError({ formLineFirst: true }) }
          return
        }
        // A screened text: the server names the FIELD it refused (never the word) — the form goes to it.
        if (typeof d.detail === 'string' && d.detail && typeof d.error === 'string' && !d.error.startsWith('identity_')) {
          setFormError(publishErrText(String(d.error)))
          refuse({ [d.detail]: d.error } as TeacherErrors)
          return
        }
        setFormError(publishErrText(String(d.error || '')))
        revealFirstError({ formLineFirst: !d.fields })
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
      setCoverNotice('')
      // Saved under today's notices: nothing is waiting for a fresh "yes" any more.
      setReconfirm({ cover: false, optIns: false })
      setApplied(null)
      // The video AS STORED: where it lives now (a private one has no URL here) and the next save's base.
      if (d.video) applySavedVideo(d.video)
      if (typeof d.teacherProfileId === 'string') setTeacherProfileId(d.teacherProfileId)
      // No job goal and no cover left: the save went through and HID the profile (plan review D6) — the done screen says so.
      if (d.noGoal === true) setStatus('hidden')
      setDone({ listingId: d.listingId, live: d.live === true, noGoal: d.noGoal === true })
    } catch {
      setFormError(publishErrText(''))
      revealFirstError()
    } finally { setBusy('') }
  }

  /**
   * ⛔ THE ONE WAY A HIDDEN PROFILE COMES BACK (gate review, 2026-10-09): PATCH /api/teachers/me/status (publish.ts
   * setTeacherStatus) — behind the Visibility switch AND every "Show my profile to schools" this form offers where it says
   * the profile is hidden (the done screen, the cover card). A save never shows one: an edit never publishes. Showing is a
   * relist, so the server re-runs the publish gates and refuses a profile with nothing to be found for (409
   * no_teaching_goal — the state D6 hides). Answers the refusal's words (null: done), for the caller to say where the tap
   * was; on success, nothing on the page keeps saying the opposite.
   */
  const changeVisibility = async (live: boolean): Promise<string | null> => {
    const next = live ? 'live' : 'hidden'
    try {
      const res = await fetch('/api/teachers/me/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) })
      if (res.ok) {
        setStatus(next); setListingLive(true)
        setDone((d) => (d ? { ...d, live } : d))
        setCoverLive(live)
        return null
      }
      const d = await res.json().catch(() => ({}))
      // The goal first, SAVED: the server judges the stored profile — work picked on step 1 but not saved does not count.
      if (d.error === 'no_teaching_goal') return tr('Pick the work you want, or switch cover lessons on, and save first.', 'Hãy chọn công việc bạn muốn hoặc bật dạy thay rồi lưu lại trước đã.')
    } catch { /* said below, like any other failure */ }
    return tr('Could not change visibility.', 'Không đổi được chế độ hiển thị.')
  }
  /** The Visibility switch (Photo & publish): a refusal on the form's line, brought into view above the action bar. */
  const toggleStatus = async (live: boolean) => {
    const refused = await changeVisibility(live)
    if (refused) { setFormError(refused); revealFirstError({ formLineFirst: true }) }
  }
  /** "Show my profile to schools" where the form says the profile is hidden — a refusal is said right there too. */
  const showProfile = async (sayRefusal: (line: string) => void) => {
    if (showing) return
    setShowing(true)
    try {
      const refused = await changeVisibility(true)
      if (refused) sayRefusal(refused)
    } finally { setShowing(false) }
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

  // ── Intro video (2026-10-07) ─────────────────────────────────────────────────────────────────────
  // ⚠️ `setT` here and below is the form's latest-value setter (it writes tRef first — see its definition above), never the
  // raw React one: a save after a 409 reload sends the reloaded video, not the stale window's.
  const applySavedVideo = (v: { onRequest?: boolean; version?: number; hasPrivate?: boolean; url?: string | null }) => {
    setPrivateVideo(v.hasPrivate === true)
    setVideoBase(typeof v.version === 'number' ? v.version : null)
    setSavedPublicUrl(v.url ?? null)
    setConfirmVideoRemove(false) // never a "Remove for good" left armed over the NEXT video
    ownSeq.current += 1; setOwnVideoUrl(null) // a link to a video that may since have moved or gone — late ones too
    setT((p) => ({ ...p, videoUrl: v.url ?? null, videoOnRequest: v.onRequest === true }))
  }
  /** The teacher watches their own private video: their data, and the only way to see what they keep private. */
  const watchOwnVideo = async () => {
    if (ownVideoBusy) return
    const ticket = ++ownSeq.current
    setOwnVideoBusy(true); setFormError('')
    try {
      const res = await fetch('/api/teachers/me/video')
      const d = await res.json().catch(() => ({}))
      if (ticket !== ownSeq.current) return // the account changed (or the video moved) meanwhile
      if (res.ok && typeof d.url === 'string') setOwnVideoUrl(d.url)
      else if (d.error === 'video_missing') { const r = await reloadSavedVideo(); if (r !== 'ok') setFormError(staleVideoLine(r)) }
      else setFormError(tr('Could not load your video. Please try again.', 'Không tải được video. Vui lòng thử lại.'))
    } catch {
      if (ticket === ownSeq.current) setFormError(tr('Could not load your video. Please try again.', 'Không tải được video. Vui lòng thử lại.'))
    } finally { setOwnVideoBusy(false) }
  }
  /**
   * After a 409 video_changed: the saved video state, re-read — 'failed' when it could not be loaded, 'other' when it belongs
   * to ANOTHER TeacherProfile (a session switched in another tab, or the profile recreated elsewhere). ⛔ Another profile's
   * state never enters this form (its next Save or Remove would act on that profile): the line asks for a reload instead.
   */
  const reloadSavedVideo = async (): Promise<'ok' | 'failed' | 'other'> => {
    try {
      const res = await fetch('/api/teachers/me')
      const tp = res.ok ? (await res.json())?.teacher : null
      // No profile any more, or another one: either way not the profile this form loaded.
      if (!tp) return res.ok && teacherProfileId ? 'other' : 'failed'
      if (teacherProfileId && tp.id !== teacherProfileId) return 'other'
      applySavedVideo({ onRequest: tp.videoOnRequest, version: tp.videoVersion, hasPrivate: tp.hasPrivateVideo, url: tp.videoUrl })
      return 'ok'
    } catch { return 'failed' }
  }
  const profileChangedLine = () => tr('Your teacher profile changed in another window or account. Reload this page before saving.', 'Hồ sơ giáo viên đã thay đổi ở cửa sổ hoặc tài khoản khác. Hãy tải lại trang trước khi lưu.')
  const staleVideoLine = (r: 'ok' | 'failed' | 'other') => r === 'other' ? profileChangedLine() : r === 'ok'
    ? tr('Your intro video was changed in another window — this form now shows the saved video. Make your video change again if you still want it, then save.', 'Video giới thiệu đã được thay đổi ở cửa sổ khác — biểu mẫu này đang hiển thị video đã lưu. Hãy thay đổi lại video nếu bạn vẫn muốn, rồi lưu.')
    : tr('Your intro video was changed in another window, and the saved version could not be loaded. Try again in a moment.', 'Video giới thiệu đã được thay đổi ở cửa sổ khác và không tải được bản đã lưu. Hãy thử lại sau giây lát.')
  /** A PRIVATE video is removed by its own call (a save never holds its address), under the version this form loaded. */
  const removePrivateVideo = async () => {
    if (videoRemoving) return
    setVideoRemoving(true); setFormError('')
    try {
      const res = await fetch(`/api/teachers/me/video?base=${videoBase ?? ''}&tp=${encodeURIComponent(teacherProfileId ?? '')}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      // Removed: the private video and the base move on; an unsaved visibility choice stays the teacher's (gate review).
      if (res.ok && d.video) {
        ownSeq.current += 1 // a Watch still out for the removed video must not reopen it
        setPrivateVideo(false); setOwnVideoUrl(null); setConfirmVideoRemove(false)
        if (typeof d.video.version === 'number') setVideoBase(d.video.version)
      }
      else if (d.error === 'video_changed') { setConfirmVideoRemove(false); setFormError(staleVideoLine(await reloadSavedVideo())); revealFirstError({ formLineFirst: true }) }
      else if (d.error === 'video_missing') { setConfirmVideoRemove(false); const r = await reloadSavedVideo(); if (r !== 'ok') setFormError(staleVideoLine(r)) }
      else setFormError(tr('Could not remove your video. Please try again.', 'Không xoá được video. Vui lòng thử lại.'))
    } catch {
      setFormError(tr('Could not remove your video. Please try again.', 'Không xoá được video. Vui lòng thử lại.'))
    } finally { setVideoRemoving(false) }
  }

  // ── Cover lessons (2026-10-07) ───────────────────────────────────────────────────────────────────
  const setCover = (p: CoverPatch) => {
    // ⛔ THE SWITCH IS THE CONSENT (2026-10-08): on gives it, off withdraws it — never one without the other, so switching
    // back on after switching off is a fresh consent the record shows as such (gate review, 2026-10-07).
    const q = p.coverOpen === undefined ? p : { ...p, coverConsent: p.coverOpen }
    setT((prev) => ({ ...prev, ...q }))
    setCoverNotice('') // the card's line was about the state before this edit
    clearErrorsFor([...Object.keys(q), 'coverOpen', 'coverConsent'])
    setCoverSave('')
  }
  /**
   * "Still available": re-send the cover values AS SAVED (PATCH /api/teachers/me/cover), which re-confirms them.
   * ⚠️ THERE IS NO QUICK SAVE OF EDITED VALUES ON PURPOSE. It existed and every review round found another way its
   * edited state disagreed with the saved profile (a city added but not saved, a switch-off confirmed by accident) —
   * so edits go through the one full save, like every other field, and this only re-confirms what the server holds.
   * ⚠️ The body carries NO areas: the reach is derived from the STORED teach areas (publish.ts saveTeacherCover), and a
   * cover body with areas is an old panel's, refused (409) when it switches cover on.
   */
  const saveCover = async (v: { coverOpen: boolean; coverSlots: string[]; coverRateVnd: number | null; coverConsent: boolean }) => {
    if (coverSave === 'saving') return
    setCoverSave('saving')
    try {
      const res = await fetch('/api/teachers/me/cover', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...v, coverBase: savedCover ? coverStamp(savedCover) : null, coverNotice: COVER_CONSENT_VERSION }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (d.error === 'invalid_teacher_profile' && d.fields) setErrors(d.fields)
        // A stale window: the saved cover is re-read into the card, which then says what happened (reloadSavedCover).
        if (d.error === 'cover_changed') {
          const { r, open } = await reloadSavedCover()
          setCoverSave('')
          if (r === 'superseded') return
          // Said for the state the card now shows: never "tap Still available" over a card that has no such button.
          setCoverNotice(r === 'failed'
            ? staleCoverLine('failed')
            : open
              ? tr('Changed in another window — the card now shows the saved version. Tap “Still available” again to confirm it.', 'Đã thay đổi ở cửa sổ khác — thẻ đang hiển thị bản đã lưu. Bấm “Vẫn còn rảnh” lần nữa để xác nhận.')
              : tr('Cover lessons were switched off in another window.', 'Dạy thay đã được tắt ở cửa sổ khác.'))
          return
        }
        setCoverSave('error')
        return
      }
      setCoverConfirmedAt(d.confirmedAt ?? null)
      setSavedCover({ coverOpen: d.coverOpen === true, coverSlots: d.coverSlots ?? [], coverAreas: d.coverAreas ?? [], coverRateVnd: d.coverRateVnd ?? null, consentCurrent: true })
      // ⛔ SAVED IS NOT SHOWN (gate review, 2026-10-09): a cover save never re-shows a hidden profile, so the card reads
      // `live` and says when schools cannot see what was just confirmed; a save that HID the profile (cover off, no job
      // goal — D6) moves the Visibility switch with it. Absent (an older server) claims nothing.
      if (d.hidden === true) setStatus('hidden')
      setCoverLive(d.live !== false)
      setCoverSave('saved')
      setCoverNotice('')
    } catch {
      setCoverSave('error')
    }
  }
  /** "Still available": re-confirm the availability AS SAVED — never unsaved edits, and never a switch-off. */
  const confirmSavedCover = () => {
    // Not while a full save is out: its own stale-window re-read would be superseded by this one's and say nothing.
    if (!savedCover?.coverOpen || busy === 'saving') return
    // Saved under an older notice: the teacher must read the current one and switch cover on again under it.
    if (!savedCover.consentCurrent) {
      setCoverNotice(tr('The cover-lessons notice was updated. To keep cover on, tap “Change”, switch cover on again under the new notice, then save.', 'Thông báo về dạy thay đã được cập nhật. Để tiếp tục nhận dạy thay, hãy bấm “Thay đổi”, bật lại dạy thay theo thông báo mới rồi lưu.'))
      return
    }
    void saveCover({ coverOpen: true, coverSlots: savedCover.coverSlots, coverRateVnd: savedCover.coverRateVnd, coverConsent: true })
  }
  // Order-insensitive, like the server's own conflict check (coverStamp sorts): re-ticking a period is not a change. The
  // reach is compared too — the form's is derived from its (maybe unsaved) teach areas, the saved one is stored.
  const coverDirty = !!savedCover && savedCover.consentCurrent && coverStamp(savedCover) !== coverStamp({ ...t, coverAreas: t.coverOpen ? coverReachOf(t) : [] })
  /**
   * ⛔ A STALE WINDOW: WHAT THE TEACHER DID NOT TOUCH FOLLOWS THE SERVER; WHAT THEY EDITED STAYS THEIRS (gate reviews,
   * 2026-10-07). After a 409 cover_changed — from "Still available" or from Save changes — the SAVED cover is re-read
   * into the base (the card shows it; the next save is no longer stale). Then, judged at RESPONSE time against the base
   * the form had when the re-read began: untouched cover fields take the saved values — a bio-only save must never
   * switch cover back on after a withdrawal in another window — and edited ones are kept, with a line saying a save
   * replaces the saved version with them. A newer re-read supersedes an older one, which then says nothing at all.
   * 2026-10-08: the switch IS the consent, so a merge that keeps cover on without the consent (it never crosses a
   * withdrawal — cover.ts mergeStaleCover) shows the switch OFF: switching it on again is how the consent is given.
   */
  const reloadSavedCover = async (): Promise<{ r: 'untouched' | 'edited' | 'failed' | 'superseded'; open: boolean; reconsent: boolean }> => {
    const seq = ++coverReloadSeq.current
    const base = savedCover
    try {
      const res = await fetch('/api/teachers/me')
      const tp = res.ok ? (await res.json())?.teacher : null
      if (seq !== coverReloadSeq.current) return { r: 'superseded', open: false, reconsent: false }
      if (!tp) return { r: 'failed', open: false, reconsent: false }
      const fresh: SavedCover = {
        coverOpen: tp.coverOpen === true, coverSlots: tp.coverSlots ?? [], coverAreas: tp.coverAreas ?? [],
        coverRateVnd: tp.coverRateVnd ?? null, consentCurrent: tp.coverConsentVersion === COVER_CONSENT_VERSION,
      }
      // Field by field, and the consent never across a withdrawal (cover.ts mergeStaleCover — table-tested there).
      const { cover, untouched, reconsent } = mergeStaleCover(tRef.current, base, fresh)
      const shown = cover.coverOpen && !cover.coverConsent ? { ...cover, coverOpen: false } : cover
      setT((prev) => ({ ...prev, ...shown }))
      setSavedCover(fresh)
      setCoverConfirmedAt(tp.coverConfirmedAt ?? null)
      // The card's last line and status were about the version just replaced (gate review, 2026-10-07): the caller says
      // what is true now — "Still available" on the card, Save changes on the form.
      setCoverNotice('')
      setCoverSave('')
      return { r: untouched ? 'untouched' : 'edited', open: fresh.coverOpen, reconsent }
    } catch {
      return { r: seq === coverReloadSeq.current ? 'failed' : 'superseded', open: false, reconsent: false }
    }
  }
  const staleCoverLine = (r: 'untouched' | 'edited' | 'failed', reconsent = false) => r === 'untouched'
    ? reconsent
      ? tr('Your cover lessons were changed in another window — this form now shows the saved version. Switch cover on again on the Cover step, then save to keep your other changes.', 'Lịch dạy thay của bạn đã được thay đổi ở cửa sổ khác — biểu mẫu này đang hiển thị bản đã lưu. Hãy bật lại dạy thay ở bước Dạy thay rồi lưu để giữ các thay đổi khác của bạn.')
      : tr('Your cover lessons were changed in another window — this form now shows the saved version. Check the Cover step, then save again to keep your other changes.', 'Lịch dạy thay của bạn đã được thay đổi ở cửa sổ khác — biểu mẫu này đang hiển thị bản đã lưu. Hãy kiểm tra bước Dạy thay rồi lưu lại để giữ các thay đổi khác của bạn.')
    : r === 'edited'
      ? reconsent
        ? tr('Your cover lessons were changed in another window — the card at the top shows the saved version. To save your changes on the Cover step instead, switch cover on again there.', 'Lịch dạy thay của bạn đã được thay đổi ở cửa sổ khác — thẻ ở đầu trang đang hiển thị bản đã lưu. Để lưu các thay đổi của bạn ở bước Dạy thay, hãy bật lại dạy thay ở đó.')
        : tr('Your cover lessons were changed in another window — the card at the top shows the saved version. Saving again replaces it with your changes on the Cover step.', 'Lịch dạy thay của bạn đã được thay đổi ở cửa sổ khác — thẻ ở đầu trang đang hiển thị bản đã lưu. Lưu lại sẽ thay bản đó bằng các thay đổi của bạn ở bước Dạy thay.')
      : tr('Your cover lessons were changed in another window, and the saved version could not be loaded. Try again in a moment.', 'Lịch dạy thay của bạn đã được thay đổi ở cửa sổ khác và không tải được bản đã lưu. Hãy thử lại sau giây lát.')

  // ── The rail ──────────────────────────────────────────────────────────────────────────────────────
  const stepLabel = (s: TeacherStep | typeof HANDOFF_NODE): string => {
    switch (s) {
      case 'plans': return tr('Your plans', 'Kế hoạch của bạn')
      case 'where': return tr('Where you teach', 'Nơi bạn dạy')
      case 'teaching': return tr('Your teaching', 'Việc giảng dạy')
      case 'about': return tr('About you', 'Về bạn')
      case 'cover': return tr('Cover lessons', 'Dạy thay')
      case 'finish': return tr('Photo & publish', 'Ảnh & đăng')
      default: return tr('Finish on eno.vn', 'Hoàn tất trên eno.vn')
    }
  }
  const STEP_ICON: Record<TeacherStep | typeof HANDOFF_NODE, React.ReactNode> = {
    plans: <Compass className="size-4" />, where: <MapPin className="size-4" />, teaching: <BookOpen className="size-4" />,
    about: <User className="size-4" />, cover: <CalendarDays className="size-4" />, finish: <Camera className="size-4" />,
    [HANDOFF_NODE]: <ExternalLink className="size-4" />,
  }
  // teacher.eno.vn: the four draft steps, then "Finish on eno.vn" — a node that is never current, so never tappable.
  const railKeys: (TeacherStep | typeof HANDOFF_NODE)[] = draftHost ? [...steps, HANDOFF_NODE] : steps
  const rail: WizardStep[] = railKeys.map((k) => ({ key: k, icon: STEP_ICON[k], label: stepLabel(k) }))

  // ── The action bar ──────────────────────────────────────────────────────────────────────────────
  const isLast = stepIdx === steps.length - 1
  const next = () => {
    const e = checkSteps(t, [step])
    if (Object.keys(e).length) { setErrors(e); revealFirstError(); return }
    setErrors({})
    setStepKey(steps[stepIdx + 1])
  }
  const savingLabel = tr('Saving…', 'Đang lưu…')
  // `() => publish()`, never `publish` itself: the bar hands its onClick the click event, which must not reach `opts`.
  const primary = mode === 'edit'
    ? { label: busy === 'saving' ? savingLabel : tr('Save changes', 'Lưu thay đổi'), onClick: () => { void publish() }, disabled: busy !== '' }
    : draftHost && step === 'about'
      ? { label: tr('Continue on eno.vn', 'Tiếp tục trên eno.vn'), onClick: handOff }
      : !user && step === 'about'
        // "Sign in", not "Sign in": the longer label wrapped to two lines in the 375px action bar (and the
        // Vietnamese is longer still) — the line above the bar already says sign-in comes next (browser run, 2026-10-09).
        ? { label: tr('Sign in', 'Đăng nhập'), onClick: signInToContinue, disabled: authLoading }
        : isLast
          ? { label: busy === 'saving' ? savingLabel : tr('Publish profile', 'Đăng hồ sơ'), onClick: () => { void publish() }, disabled: busy !== '' }
          : { label: tr('Next', 'Tiếp'), onClick: next }
  const secondary = mode === 'edit'
    ? (!isLast ? { label: tr('Next step', 'Bước tiếp'), onClick: () => setStepKey(steps[stepIdx + 1]) } : stepIdx > 0 ? { label: tr('Back', 'Quay lại'), onClick: () => setStepKey(steps[stepIdx - 1]) } : undefined)
    : stepIdx > 0 ? { label: tr('Back', 'Quay lại'), onClick: () => setStepKey(steps[stepIdx - 1]) } : undefined
  // ⛔ THE PUBLISH NOTICE, beside the tap that is the consent: on the last step of a new profile, on every step of an
  // edit (Save changes publishes too). Its meaning is PUBLISH_NOTICE_VERSION (profile.ts) — sent as `publishNotice`.
  const showPublishNote = mode === 'edit' || (!draftHost && isLast && !!user)
  const publishNote = showPublishNote ? (
    <p className="text-xs text-body" data-testid="publish-notice">
      {mode === 'edit'
        ? tr('Saving updates your public profile: schools and search engines see everything except your phone, email, CV and a private video.', 'Khi lưu, hồ sơ công khai của bạn được cập nhật: các trường và công cụ tìm kiếm thấy mọi thứ trừ số điện thoại, email, CV và video riêng tư.')
        : tr('Publishing shows your profile to schools and search engines — everything except your phone, email, CV and a private video.', 'Khi đăng, hồ sơ của bạn hiển thị với các trường và công cụ tìm kiếm — mọi thứ trừ số điện thoại, email, CV và video riêng tư.')}{' '}
      <Button variant="link" size="none" type="button" className="text-xs font-semibold" onClick={() => setWhatsPublic(true)}>{tr('What’s public?', 'Những gì được công khai?')}</Button>
    </p>
  ) : null

  // ── Screens other than the wizard ───────────────────────────────────────────────────────────────
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
  if (mode === 'edit' && noProfile) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="h-title text-foreground">{tr('You don’t have a teacher profile yet', 'Bạn chưa có hồ sơ giáo viên')}</h1>
        <p className="mt-2 text-sm text-body">{tr('It is free, and schools across Vietnam can find you once it is published.', 'Hồ sơ miễn phí, và các trường trên toàn Việt Nam có thể tìm thấy bạn khi hồ sơ được đăng.')}</p>
        <Button variant="cta" className="mt-4" asChild><Link href="/teachers/join">{tr('Create my teacher profile', 'Tạo hồ sơ giáo viên')}</Link></Button>
      </div>
    )
  }
  if (existing && !done) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="h-title text-foreground">{tr('You already have a teacher profile', 'Bạn đã có hồ sơ giáo viên')}</h1>
        {arrived || t !== EMPTY_TEACHER ? (
          <>
            {/* A hand-off (or this tab's draft) onto an account that already has a profile: its answers are offered to the
                profile — filled in, unsaved, for the teacher to check — or let go. Never saved over it unasked. */}
            <p className="mt-2 text-sm text-body">{tr('You just answered the first questions again. Use these answers in your profile (you check them before anything is saved), or keep your profile as it is.', 'Bạn vừa trả lời lại các câu hỏi đầu tiên. Dùng các câu trả lời này trong hồ sơ (bạn kiểm tra trước khi lưu), hoặc giữ nguyên hồ sơ.')}</p>
            <div className="mt-4 flex flex-col items-center gap-3">
              <Button variant="cta" asChild><Link href="/teachers/edit?review=draft">{tr('Review these answers in my profile', 'Xem lại các câu trả lời này trong hồ sơ')}</Link></Button>
              <Button variant="secondary" type="button" onClick={() => { clearStored(); window.location.assign('/teachers/edit') }}>{tr('Keep my profile', 'Giữ nguyên hồ sơ')}</Button>
            </div>
          </>
        ) : (
          <Button variant="cta" className="mt-4" asChild><Link href="/teachers/edit">{tr('Edit my profile', 'Sửa hồ sơ')}</Link></Button>
        )}
      </div>
    )
  }
  if (done) {
    // "Add more to stand out", most useful first — each opens the step that asks it.
    const more: { step: TeacherStep; label: string }[] = [
      ...(!t.videoUrl && !privateVideo ? [{ step: 'finish' as const, label: tr('Add an intro video', 'Thêm video giới thiệu') }] : []),
      ...(!t.bio ? [{ step: 'about' as const, label: tr('Say more about yourself', 'Giới thiệu thêm về bạn') }] : []),
      ...(!t.certificates.length ? [{ step: 'teaching' as const, label: tr('Add your certificates', 'Thêm chứng chỉ') }] : []),
      ...(!t.experience.length ? [{ step: 'teaching' as const, label: tr('Add your teaching jobs', 'Thêm công việc giảng dạy') }] : []),
    ]
    // The chat's Share button, by the name the teacher will actually see there (teacher-thread-strip.tsx, amendment A3):
    // with no phone on file it reads "Share my email & CV".
    const shareWords = t.phone ? tr('Share my phone, email & CV', 'Chia sẻ số điện thoại, email và CV') : tr('Share my email & CV', 'Chia sẻ email và CV')
    // ⛔ "SCHOOLS CAN NOW FIND YOU" ONLY WHEN THEY CAN (gate review, 2026-10-09). `done.live` is what the save left public
    // (listing active AND verified), and a save never shows a hidden profile (an edit never publishes), so one hidden
    // before it — by the teacher, by D6, by moderation — is still hidden after it. The screen says so, with the way back
    // right there: "Show my profile to schools" (the Visibility switch's own call, gates and refusals) when the teacher's
    // switch is what hides it; when D6 hid it, the goal first — the server refuses to show a profile with nothing to be
    // found for (setTeacherStatus); and nothing to tap when the switch is ON and the listing is held anyway (moderation,
    // an identity hold) — not the teacher's to lift, as the Visibility step says too.
    const held = !done.live && !done.noGoal && status === 'live'
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-tint text-brand"><Check className="size-6" /></span>
        <h1 className="mt-4 h-title text-foreground">{mode === 'edit' || !done.live ? tr('Profile saved', 'Đã lưu hồ sơ') : tr('Your profile is live', 'Hồ sơ của bạn đã được đăng')}</h1>
        {done.live ? (
          <p className="mt-2 text-sm text-body">
            {tr('Schools can now find you. When one messages you, reply — and tap', 'Các trường giờ có thể tìm thấy bạn. Khi có trường nhắn tin, hãy trả lời — và bấm')} “{shareWords}” {tr('if you want them to have your contact details and CV.', 'nếu bạn muốn gửi thông tin liên hệ và CV.')}
          </p>
        ) : done.noGoal ? (
          <>
            <p className="mt-2 text-sm text-warning">{tr('Your profile is now hidden: you are not looking for work and cover lessons are off, so schools have nothing to find you for. To show it again, pick the work you want or switch cover lessons on and save — then tap “Show my profile to schools”.', 'Hồ sơ của bạn đang bị ẩn: bạn không tìm việc và đã tắt dạy thay, nên các trường không có gì để tìm bạn. Để hiển thị lại, hãy chọn công việc bạn muốn hoặc bật dạy thay rồi lưu — sau đó bấm “Hiển thị hồ sơ cho các trường”.')}</p>
            {/* An edit's alone (a new profile with no goal is refused): the steps that give it one, opened in place. */}
            {mode === 'edit' && (
              <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
                <Button variant="link" size="none" type="button" className="text-sm font-semibold" onClick={() => { setDone(null); setStepKey('plans') }}>{tr('Pick the work you want', 'Chọn công việc bạn muốn')}</Button>
                {steps.includes('cover') && (
                  <Button variant="link" size="none" type="button" className="text-sm font-semibold" onClick={() => { setDone(null); setStepKey('cover') }}>{tr('Go to cover lessons', 'Đến bước Dạy thay')}</Button>
                )}
              </div>
            )}
          </>
        ) : held ? (
          <p className="mt-2 text-sm text-warning">{tr('Your profile is under review and not visible right now. Contact support if you think this is a mistake.', 'Hồ sơ của bạn đang được xem xét và tạm thời không hiển thị. Liên hệ hỗ trợ nếu bạn cho rằng có nhầm lẫn.')}</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-warning">{tr('Your profile is hidden: schools can’t find it or open it.', 'Hồ sơ của bạn đang bị ẩn: các trường không tìm thấy và không mở được hồ sơ.')}</p>
            <Button variant="cta" type="button" className="mt-4" loading={showing} onClick={() => { setFormError(''); void showProfile(setFormError) }}>{tr('Show my profile to schools', 'Hiển thị hồ sơ cho các trường')}</Button>
          </>
        )}
        {formError && <p role="alert" data-form-error className="mt-3 text-sm text-destructive">{formError}</p>}
        {/* Push only where a school may need the teacher today: cover lessons on. */}
        {t.coverOpen && <PushOptInCard surface="teacher" className="mt-4" />}
        {more.length > 0 && (
          <div className="mt-6 space-y-2 text-left">
            <h2 className="text-sm font-semibold text-foreground">{tr('Add more to stand out', 'Thêm thông tin để nổi bật')}</h2>
            <ul className="space-y-1">
              {more.map((m) => (
                <li key={m.label}>
                  {mode === 'edit'
                    ? <Button variant="link" size="none" type="button" className="text-sm font-semibold" onClick={() => { setDone(null); setStepKey(m.step) }}>{m.label}</Button>
                    : <Link href={`/teachers/edit?step=${m.step}`} className="text-sm font-semibold text-brand underline">{m.label}</Link>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-6 flex justify-center gap-3">
          {/* While it is hidden, showing it is the one thing to do: viewing steps back. */}
          <Button variant={done.live ? 'cta' : 'secondary'} asChild><Link href={`/listings/${done.listingId}`}>{tr('View my profile', 'Xem hồ sơ')}</Link></Button>
          {mode === 'edit'
            ? <Button variant="secondary" onClick={() => { setDone(null); setStepKey(steps[0]) }}>{tr('Keep editing', 'Tiếp tục sửa')}</Button>
            : <Button variant="secondary" asChild><Link href="/teachers/edit">{tr('Edit', 'Sửa')}</Link></Button>}
        </div>
      </div>
    )
  }

  const stepProps: StepProps = { t, set, patch, update, errors, errText, mode }
  const droppedWords = (f: DroppedField): string => {
    switch (f) {
      case 'expectedSalaryM': return tr('your expected salary', 'mức lương mong muốn')
      case 'availableFrom': return tr('your start month', 'tháng có thể bắt đầu')
      case 'teachLanguages': return tr('the languages you teach', 'các ngôn ngữ bạn dạy')
      case 'englishLevel': return tr('your English level', 'trình độ tiếng Anh')
      case 'degreeDetails': return tr('your degree’s major, university and year', 'chuyên ngành, trường và năm của bằng cấp')
      case 'optIns': return tr('your job-match emails and staff calls', 'email gợi ý việc làm và cuộc gọi từ nhân viên')
      case 'cover': return tr('cover lessons (they switch off)', 'dạy thay (sẽ bị tắt)')
      case 'currentDistrictKey': return tr('your district', 'quận của bạn')
    }
  }
  // ⛔ A CONSENT THAT LOADED OFF IS SAID ON EVERY STEP (gate review, 2026-10-08). "Save changes" is on every step and a
  // save with it off withdraws it, but this line sat on step 1 alone — a teacher who came in on `?step=about` (the done
  // screen's "Add more to stand out" links there) saved it away unwarned. Not on the step whose own line says it beside
  // the switches (CoverStep's, FinishStep's), and gone once there is nothing left to switch on again.
  const reconfirmCoverLine = reconfirm.cover && !t.coverOpen && steps.includes('cover') && step !== 'cover'
  const optInStepLine = step === 'finish' && !t.matchEmailOptIn && !t.staffContactOptIn // FinishStep's own line shows
  const reconfirmOptInLine = reconfirm.optIns && t.jobTypes.length > 0 && !(t.matchEmailOptIn && t.staffContactOptIn) && !optInStepLine
  // What the hide dialog says: cover off because its notice changed (no act of the teacher's), or simply off.
  const hideForNotice = reconfirm.cover && !t.coverOpen

  return (
    <>
      <StepWizard
        steps={rail}
        current={step}
        // A new profile jumps back only (the rail's default); an edit, both ways — every step is already answered.
        onStepSelect={(k) => { if (isTeacherStep(k)) setStepKey(k) }}
        allowForward={mode === 'edit'}
        primaryAction={primary}
        secondaryAction={secondary}
        actionNote={publishNote}
        // The action bar clears the phone's bottom MobileNav pill (the post wizard's own offset — post-wizard.tsx).
        offsetBottom="4.5rem"
        header={
          <div className="mb-4 space-y-3">
            {mode === 'edit' && step === 'plans' && (steps.includes('cover') || savedCover?.coverOpen) && (
              <CoverSummary
                savedOpen={savedCover?.coverOpen === true}
                slots={savedCover?.coverSlots.length ?? 0}
                areas={savedCover?.coverAreas.length ?? 0}
                rateVnd={savedCover?.coverRateVnd ?? null}
                confirmedAt={coverConfirmedAt}
                dirty={coverDirty}
                status={coverSave}
                onConfirm={confirmSavedCover}
                onEdit={() => setStepKey(steps.includes('cover') ? 'cover' : 'where')}
                notice={coverNotice}
                // Saved but not shown: the way back on the card itself — unless the teacher's switch is already ON and the
                // listing is held (moderation, an identity hold), which no tap of theirs lifts.
                hidden={coverSave === 'saved' && !coverLive
                  ? { onShow: status === 'live' ? null : () => { setCoverNotice(''); void showProfile(setCoverNotice) }, showing }
                  : null}
              />
            )}
            <div>
              <h1 className="h-title text-foreground">{mode === 'edit' ? tr('Your teacher profile', 'Hồ sơ giáo viên của bạn') : tr('Create your teacher profile', 'Tạo hồ sơ giáo viên')}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{tr('Free. Schools across Vietnam see your profile; your phone, email and CV stay private until you share them.', 'Miễn phí. Các trường trên toàn Việt Nam xem được hồ sơ; số điện thoại, email và CV được giữ kín đến khi bạn chia sẻ.')}</p>
            </div>
            {mode === 'edit' && applied && (
              <div role="status" className="space-y-1 rounded-xl bg-tint px-3.5 py-2.5 text-sm text-body">
                <p>{tr('Your new answers are filled in below and are not saved yet. Check each step, then tap “Save changes” to keep them.', 'Các câu trả lời mới đã được điền bên dưới và chưa được lưu. Hãy kiểm tra từng bước rồi bấm “Lưu thay đổi” để giữ lại.')}</p>
                {!nothingDropped(applied) && (
                  // The edit warning, for the whole batch at once: what saving them clears from the saved profile.
                  <p className="text-warning">
                    {tr('Saving them also clears:', 'Khi lưu, những mục này cũng bị xoá:')}{' '}
                    {[...applied.fields.map(droppedWords), ...(applied.places.length ? [`${tr('places you can teach:', 'những nơi bạn có thể dạy:')} ${applied.places.map((k) => placeLabel(k, lang)).join(' · ')}`] : [])].join('; ')}
                  </p>
                )}
              </div>
            )}
            {mode === 'edit' && (reconfirmCoverLine || reconfirmOptInLine) && (
              <div role="status" className="space-y-1 rounded-xl bg-warning/10 px-3.5 py-2.5 text-sm text-warning">
                {reconfirmCoverLine && <p>{tr('Cover lessons: the notice changed — switch cover on again on the Cover step to keep offering them.', 'Dạy thay: thông báo đã thay đổi — hãy bật lại dạy thay ở bước Dạy thay để tiếp tục.')}</p>}
                {reconfirmOptInLine && <p>{tr('Job matches: the notice changed — switch them on again on the Photo & publish step to keep getting them.', 'Gợi ý việc làm: thông báo đã thay đổi — hãy bật lại ở bước Ảnh & đăng để tiếp tục nhận.')}</p>}
              </div>
            )}
          </div>
        }
      >
        <div className="space-y-8 pb-6">
          {step === 'plans' && <PlansStep {...stepProps} coverIntent={coverIntent} signedIn={!!user} districtNotSaying={districtNotSaying} onDistrictNotSaying={setDistrictNotSaying} />}
          {step === 'where' && <WhereStep {...stepProps} coverIntent={coverIntent} onGoTo={goTo} />}
          {step === 'teaching' && <TeachingStep {...stepProps} />}
          {step === 'about' && <AboutStep {...stepProps} prefillName={prefill?.displayName ?? null} draftHost={draftHost} signedIn={!!user} />}
          {step === 'cover' && <CoverStep t={t} errors={errors} errText={errText} onCover={setCover} onGoTo={goTo} reconsentLine={reconfirm.cover} hidesProfile={mode === 'edit' && !t.coverOpen && !t.jobTypes.length} />}
          {step === 'finish' && (
            <FinishStep
              {...stepProps}
              signedIn={!!user}
              publishGate={publishGate}
              prefillAvatar={mode === 'join' ? prefill?.avatarUrl ?? null : null}
              prefillPhone={mode === 'join' ? prefill?.phone ?? null : null}
              optInsNoticeChanged={reconfirm.optIns}
              media={{
                busy, onPhoto: uploadPhoto, onVideo: uploadVideo, privateVideo, savedPublicUrl, ownVideoUrl, ownVideoBusy, videoRemoving,
                confirmVideoRemove, setConfirmVideoRemove, onWatchOwnVideo: watchOwnVideo, onCloseOwnVideo: () => setOwnVideoUrl(null),
                onOwnVideoError: () => { setOwnVideoUrl(null); setFormError(tr('Your video could not be played. Tap Watch to try again.', 'Không phát được video của bạn. Bấm Xem để thử lại.')) },
                onRemovePrivateVideo: removePrivateVideo, cvName, cvFile, onCvPick: setCvFile, onCvDiscard: () => setCvFile(null),
                onCvRemove: mode === 'edit' ? removeCv : null,
              }}
              edit={mode === 'edit' ? { live: status === 'live', listingLive, onToggleLive: toggleStatus, onDelete: deleteProfile } : null}
            />
          )}
          {formError && <p role="alert" data-form-error className="text-sm text-destructive">{formError}</p>}
        </div>
      </StepWizard>

      {/* ⛔ THE EDIT WARNING — before a change drops answers that are saved (plan, 2026-10-08). */}
      <AlertDialog open={!!pendingChange} onOpenChange={(open) => { if (!open) setPendingChange(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('This change clears some of your answers', 'Thay đổi này sẽ xoá một số câu trả lời')}</AlertDialogTitle>
            <AlertDialogDescription>{tr('When you save, these go from your profile:', 'Khi bạn lưu, những mục này sẽ bị xoá khỏi hồ sơ:')}</AlertDialogDescription>
          </AlertDialogHeader>
          {pendingChange && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-body">
              {pendingChange.fields.map((f) => <li key={f}>{droppedWords(f)}</li>)}
              {pendingChange.places.length > 0 && (
                <li>{tr('places you can teach:', 'những nơi bạn có thể dạy:')} {pendingChange.places.map((k) => placeLabel(k, lang)).join(' · ')}</li>
              )}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Keep my answers', 'Giữ câu trả lời')}</AlertDialogCancel>
            <AlertDialogAction onClick={applyPendingChange}>{tr('Change it', 'Vẫn thay đổi')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ⛔ THE HIDE WARNING — before an edit save that would hide a shown profile, on whichever step it was tapped (gate
          review, 2026-10-08). Saving still goes through ("Save and hide", D6); the cover step is offered when cover can be
          switched on there — the switch itself stays the teacher's own act, under its notice. */}
      <AlertDialog open={confirmHide} onOpenChange={setConfirmHide}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('Saving hides your profile', 'Khi lưu, hồ sơ của bạn sẽ bị ẩn')}</AlertDialogTitle>
            <AlertDialogDescription>
              {hideForNotice
                ? tr('The cover-lessons notice has changed, so cover lessons stay off until you switch them on again — and no work is chosen in step 1. Saved like this, schools have nothing to find you for.', 'Thông báo về dạy thay đã thay đổi, nên dạy thay sẽ tắt cho đến khi bạn bật lại — và bạn chưa chọn công việc nào ở bước 1. Nếu lưu như vậy, các trường không có gì để tìm bạn.')
                // Never "any time": showing it again needs a goal first (setTeacherStatus refuses one with none — gate review, 2026-10-09).
                : tr('No work is chosen in step 1 and cover lessons are off, so schools have nothing to find you for. To show your profile again later, pick the work you want or switch cover lessons on first.', 'Bạn chưa chọn công việc nào ở bước 1 và đã tắt dạy thay, nên các trường không có gì để tìm bạn. Để hiển thị lại hồ sơ sau này, trước hết hãy chọn công việc bạn muốn hoặc bật dạy thay.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Stacked at every width: three buttons in a row overflow the dialog's 384px (sm:max-w-sm) — in English too. */}
          <AlertDialogFooter className="sm:flex-col-reverse">
            <AlertDialogCancel>{tr('Keep editing', 'Tiếp tục sửa')}</AlertDialogCancel>
            {steps.includes('cover') && step !== 'cover' && !t.coverOpen && (
              <AlertDialogAction variant="secondary" onClick={() => setStepKey('cover')}>{tr('Go to cover lessons', 'Đến bước Dạy thay')}</AlertDialogAction>
            )}
            <AlertDialogAction onClick={() => { void publish({ hideConfirmed: true }) }}>{tr('Save and hide', 'Lưu và ẩn hồ sơ')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* "What's public?" — every field, beside the Publish notice. Wording: owner to approve (plan amendment A5). */}
      <Drawer open={whatsPublic} onOpenChange={setWhatsPublic} showSwipeHandle>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-left text-base font-bold">{tr('What’s public?', 'Những gì được công khai?')}</DrawerTitle>
            <DrawerDescription className="text-left">{tr('Your profile is a public page: schools and search engines can see it.', 'Hồ sơ của bạn là một trang công khai: các trường và công cụ tìm kiếm có thể xem.')}</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 pt-4 text-sm text-body">
            <div className="space-y-2">
              <p className="font-semibold text-foreground">{tr('Shown on your profile', 'Hiển thị trên hồ sơ')}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{tr('Your name, photo, headline and about text', 'Tên, ảnh, tiêu đề và phần giới thiệu')}</li>
                <li>{tr('Your nationality, your English level and the languages you speak', 'Quốc tịch, trình độ tiếng Anh và các ngôn ngữ bạn nói')}</li>
                <li>{tr('Where you live — your city or province, and your HCMC district if you gave one — or “Not in Vietnam yet”', 'Nơi bạn sống — thành phố hoặc tỉnh, và quận ở TP.HCM nếu bạn cho biết — hoặc “Chưa ở Việt Nam”')}</li>
                <li>{tr('The places you can teach, Online included', 'Những nơi bạn có thể dạy, kể cả trực tuyến')}</li>
                <li>{tr('What you teach, who you teach and how long you have taught; your teaching jobs, degree and certificates', 'Môn dạy, đối tượng và thời gian giảng dạy; công việc giảng dạy, bằng cấp và chứng chỉ')}</li>
                <li>{tr('The work you want, when you can start and your expected salary', 'Công việc bạn muốn, thời gian có thể bắt đầu và mức lương mong muốn')}</li>
                <li>{tr('Your intro video — only if you choose to show it', 'Video giới thiệu — chỉ khi bạn chọn hiển thị')}</li>
                <li>{tr('Cover lessons — your free periods, hourly rate and where schools find you — only while cover is on', 'Dạy thay — các buổi rảnh, mức phí theo giờ và nơi các trường tìm bạn — chỉ khi đang bật dạy thay')}</li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="font-semibold text-foreground">{tr('Never public', 'Không bao giờ công khai')}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{tr('Your phone number, email and CV — a school gets them only when you tap the Share button in your chat', 'Số điện thoại, email và CV — trường chỉ nhận được khi bạn bấm nút Chia sẻ trong tin nhắn')}</li>
                <li>{tr('An intro video you keep private — you send it to the schools you choose', 'Video giới thiệu bạn giữ riêng tư — bạn gửi cho trường bạn chọn')}</li>
              </ul>
            </div>
            <p>{tr('Hide or delete your profile at any time in your profile settings.', 'Bạn có thể ẩn hoặc xoá hồ sơ bất cứ lúc nào trong phần cài đặt hồ sơ.')}</p>
          </div>
          <DrawerFooter>
            <Button variant="secondary" type="button" onClick={() => setWhatsPublic(false)}>{tr('Close', 'Đóng')}</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  )
}
