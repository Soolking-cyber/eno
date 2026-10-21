'use client'

// ── TEACHER FORM ────────────────────────────────────────────────────────────────────────────────
// The teacher sign-up + edit flow (owner, 2026-09-30), SITUATION FIRST since the onboarding redesign (owner,
// 2026-10-08): the teacher taps where they are now and what work they want, and every later screen shows only what
// fits them. One StepWizard, six steps (profile.ts teacherSteps decides which of them a teacher sees):
//   1 Your plans — needs no account: teacher.eno.vn serves it (PRE_SIGNIN_STEPS, since 2026-10-11);
//   2 Where you teach · 3 Your teaching · 4 About you · 5 Cover lessons (only where the home province has cover) ·
//   6 Photo & publish — on eno.vn, signed in, every step saved to the account's draft.
// ⛔ teacher.eno.vn has no session (cookies are host-scoped), so after step 1 it hands the answers to eno.vn in the URL
// FRAGMENT (`#d=`, v2: step 1's fields only), which no server ever sees. On eno.vn the sign-in comes right after step 1,
// so the cover switch, the two opt-ins and Publish — each one act, with its notice beside it — happen once, on eno.vn,
// and nothing is lost in the hand-off or a Google sign-in.
// A NEW profile opens on step 1 (owner, 2026-10-16: "start with this page and move cv read for later pages before its
// needed" — teacher-start.tsx). The CV reader is offered on "Your teaching" and "About you" once signed in (cvHandy), and
// its panel (teacher-import-panel.tsx) fills only EMPTY answers from the teacher's own file (import-map.ts mergeImport),
// saves them to the account's draft and says what it filled, with Undo — then goes back to the step it was opened from.
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
import { BookOpen, CalendarDays, Camera, Check, Compass, ExternalLink, FileText, Loader2, MapPin, User } from '@/components/ui/icons'
import { compressImageFile } from '@/lib/normalize-image'
import { uploadListingVideo } from '@/lib/video-upload-client'
import { prepareTeacherVideo, type TeacherVideoPrepError } from '@/lib/teachers/video-prep'
import {
  AI_NOTICE_VERSION, DRAFT_STEPS, EMPTY_TEACHER, LIMITS, PRE_SIGNIN_STEPS, PUBLISH_NOTICE_VERSION, TEACHER_STEPS, TEACHER_STEP_FIELDS, teacherFreeTextFields, hasTeachingGoal, normalizeForSave,
  normalizeTeacherInput, splitGoalErrors, teacherSteps, isTeacherPhone, type TeacherErrors, type TeacherInput, type TeacherStep,
} from '@/lib/teachers/profile'
import { TEACHER_DRAFT_HASH_KEY, cvRequiredSince, isCvUploadToken, videoRequiredSince } from '@/lib/teachers/constants'
import { COVER_CONSENT_VERSION, coverStamp, mergeStaleCover, type SavedCover } from '@/lib/teachers/cover'
import { HCMC, coverReachOf, placeLabel } from '@/lib/teachers/places'
import { type CoverPatch } from '@/components/teachers/cover-fields'
import { CoverSummary } from '@/components/teachers/cover-summary'
import {
  ACCOUNT_STEPS, campaignQuery, checkSteps, cvPickError, decodeHandoff, draftPart, draftResumeStep, droppedAnswers, encodeHandoff, firstStepWithError,
  forDraft, fromDraft, handoffPart, isTeacherStep, mergeReview, nothingDropped, nothingToSave, refusalEvents, sameDraftAnswers, step1Answered, textRefusals, type DroppedField,
} from '@/components/teachers/teacher-form-rules'
import { continueSourceEvent, type TeacherFormEvent } from '@/lib/signup-prompt'
import { OpenInBrowser, type EscapeOffer } from '@/components/teachers/open-in-browser'
import { makeErrText, type StepProps } from '@/components/teachers/steps/shared'
import { teacherRefusedWords } from '@/lib/teachers/text-screen'
import { PlansStep } from '@/components/teachers/steps/plans-step'
import { WhereStep } from '@/components/teachers/steps/where-step'
import { TeachingStep } from '@/components/teachers/steps/teaching-step'
import { AboutStep, type BioAiError } from '@/components/teachers/steps/about-step'
import { CoverStep } from '@/components/teachers/steps/cover-step'
import { FinishStep, type FinishIdentityMark } from '@/components/teachers/steps/finish-step'
import { NO_MARK, markAfterSave, markFromMe, markRequest, type MarkSwitch } from '@/components/teachers/identity-mark-switch'
import { scrollBehavior } from '@/lib/reduced-motion'
import { PushOptInCard } from '@/components/marketplace/push-opt-in-card'
import { revalidateDashboard } from '@/hooks/use-dashboard'
import { ShareButton, ShareChannels } from '@/components/marketplace/share-button'
import { initialDoor, type Door, type TeacherStartProps } from '@/components/teachers/teacher-start'
import { countTeacherFormEvent } from '@/lib/signup-counters'
import { TeacherImportPanel, shownHash, type ImportResult, type LastImport } from '@/components/teachers/teacher-import-panel'
import { untouchedImport, undoImport } from '@/components/teachers/import-summary'
import { mergeImport } from '@/lib/teachers/import-map'
import { aiConsentNeeded, askAiConsent } from '@/lib/ai-consent'
import { BIO_OWN_TEXT_MIN } from '@/lib/teachers/bio-context'
import { BIO_ACTION_LABEL, BIO_NOTICE, TEACHER_BIO_NOTICE_VERSION } from '@/lib/teachers/bio-notice'

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
/**
 * `signIn` (2026-10-11): when THIS FORM opened a sign-in for these answers — the mark that lets them become the signed-in
 * account's saved draft (src/lib/teachers/draft.ts) when that sign-in lands, here or back from Google. Never set by a
 * sign-in from anywhere else (the header, the tab bar), and dropped when the visitor closes the popup without signing in,
 * so a later sign-in by someone else in this tab never takes the last person's answers as its own (plan review).
 */
type DraftBase = { uid: string; rev: number; gen: string }
// `owner`: the account signed in when the copy was written — ⛔ a copy is put back only for it (commit gate, round 11).
type StoredDraft = { v: 5; savedAt: number; step: TeacherStep; t: TeacherInput; districtNotSaying?: true; signIn?: number; base?: DraftBase; owner?: string }
export type ReadDraft = { t: unknown; step: TeacherStep | null; districtNotSaying?: true; signIn?: number; base?: DraftBase; owner?: string }
export const readStoredDraft = (now = Date.now()): ReadDraft | null => {
  try {
    localStorage.removeItem(DRAFT_KEY) // the old device-wide draft, kept for good: deleted unread
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null') as { v?: unknown; savedAt?: unknown; step?: unknown; t?: unknown; districtNotSaying?: unknown; signIn?: unknown; base?: unknown; owner?: unknown } | null
    if (d && (d.v === 5 || d.v === 4 || d.v === 3) && d.t && typeof d.savedAt === 'number' && now - d.savedAt < DRAFT_TTL_MS) {
      // ⛔ NOTHING OWNERLESS CARRIES MORE THAN STEP 1 (commit gate, codex + opus rounds 13-14). A copy written signed out
      // — or before copies had an owner (v3/v4: the form before 2026-10-12, which a signed-out visitor could fill through
      // "About you") — is read as what a signed-out visitor gives: step 1. Never a previous person's name or bio on a
      // shared tab, nor an old or crafted link's; a copy with an owner is put back only for that account (the restore).
      const owner = d.v === 5 && typeof d.owner === 'string' && d.owner ? d.owner : null
      return {
        t: owner ? d.t : handoffPart(fromDraft(d.t)), step: d.v !== 3 && isTeacherStep(d.step) ? d.step : null,
        ...(d.v !== 3 && d.districtNotSaying === true ? { districtNotSaying: true as const } : {}),
        ...(d.v === 5 && typeof d.signIn === 'number' && now - d.signIn < DRAFT_TTL_MS ? { signIn: d.signIn } : {}),
        ...(owner && isDraftBase(d.base) ? { base: d.base } : {}),
        ...(owner ? { owner } : {}),
      }
    }
    sessionStorage.removeItem(DRAFT_KEY)
    return null
  } catch { return null }
}
export const writeStoredDraft = (t: TeacherInput, step: TeacherStep, ui: { districtNotSaying?: boolean; signIn?: number | null; base?: DraftBase | null; owner?: string | null } = {}) => {
  try {
    const draft: StoredDraft = {
      v: 5, savedAt: Date.now(), step, t: forDraft(t),
      ...(ui.districtNotSaying ? { districtNotSaying: true as const } : {}),
      ...(ui.signIn ? { signIn: ui.signIn } : {}),
      ...(ui.base ? { base: ui.base } : {}),
      ...(ui.owner ? { owner: ui.owner } : {}),
    }
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch { /* private mode: the draft just does not persist */ }
}
/**
 * `base` (2026-10-11): the account and the saved-draft revision this tab's copy builds on. A reload mid-step finds the
 * typing of that step only here (a step is saved when the teacher moves on): when the account's saved draft is STILL
 * that revision, this copy is the newer one and wins; any later save (another device) wins over it instead.
 */
const isDraftBase = (v: unknown): v is DraftBase =>
  !!v && typeof v === 'object' && typeof (v as { uid?: unknown }).uid === 'string' && Number.isInteger((v as { rev?: unknown }).rev)
  && typeof (v as { gen?: unknown }).gen === 'string'

/**
 * ⛔ A RESTORED SIGN-IN MARK COUNTS ONLY ON THE RETURN FROM THAT SIGN-IN (commit gate, opus 2026-10-11): the form puts
 * this parameter on its own URL before it opens a sign-in, so the OAuth `next` (read from the URL) carries it back. A
 * page opened any other way — someone else signing in from the header, then coming here — has no marker, and a stored
 * mark is dropped unused.
 */
const SIGNIN_RETURN_PARAM = 'teacher_signin'
const setSignInReturn = (on: boolean) => {
  try {
    const u = new URL(window.location.href)
    if (on === u.searchParams.has(SIGNIN_RETURN_PARAM)) return
    if (on) u.searchParams.set(SIGNIN_RETURN_PARAM, '1')
    else u.searchParams.delete(SIGNIN_RETURN_PARAM)
    history.replaceState(history.state, '', `${u.pathname}${u.search}${u.hash}`)
  } catch { /* no history API: the stored mark alone decides, within its TTL */ }
}

/** The popup closed without a sign-in: the answers stay, the mark that would let a sign-in adopt them goes. */
const clearStoredSignIn = () => {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null') as Record<string, unknown> | null
    if (d && typeof d === 'object' && 'signIn' in d) { delete d.signIn; sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)) }
  } catch { /* private mode: nothing stored */ }
}
const clearStored = () => {
  try { sessionStorage.removeItem(DRAFT_KEY); localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
}

/** The rail's synthetic last node on teacher.eno.vn — "Finish on eno.vn", never a step of its own (never current). */
const HANDOFF_NODE = 'handoff'
/** The step sign-in follows (owner, 2026-10-11: sign in after step 1, then every answer is saved) — "Sign in" sits on it. */
const LAST_PRE_SIGNIN = PRE_SIGNIN_STEPS[PRE_SIGNIN_STEPS.length - 1]
/**
 * Where a signed-in teacher goes from the pre-sign-in step: the first step after it that fails (draftResumeStep) — never
 * past the first step that needs an account (Cover, where it is offered, then Photo & publish), so a complete four-step
 * answer set (an older teacher.eno.vn tab's fragment) still meets the cover offer, as it did before 2026-10-11.
 */
const afterSignIn = (t: TeacherInput): TeacherStep => {
  const steps = teacherSteps(t, { draftHost: false })
  const bad = draftResumeStep(t, null).step
  const firstAccount = steps.find((s) => ACCOUNT_STEPS.includes(s))
  return firstAccount && steps.indexOf(firstAccount) < steps.indexOf(bad) ? firstAccount : bad
}
/**
 * The account's saved draft (src/lib/teachers/draft.ts) is saved on every STEP CHANGE — Next, Back, the rail — and a failed
 * save (or load) is tried again after RETRY. A load that does not answer within LOAD_TIMEOUT counts as failed.
 */
const DRAFT_RETRY_MS = 30_000
const DRAFT_LOAD_TIMEOUT_MS = 10_000
// A save waits longer: one cut off client-side may still commit, and its retry would then meet a false conflict.
const DRAFT_SAVE_TIMEOUT_MS = 30_000
/**
 * How long a new profile's CV, uploaded before its Publish (uploadPendingCv), is named again by a later Publish instead of
 * uploaded twice. Half the hour the server keeps an upload nobody claimed (storage-tombstones.ts TOMBSTONE_GRACE_MS): older
 * than this, it is uploaded again — never named so late that the sweep could be taking it.
 */
const CV_PENDING_REUSE_MS = 30 * 60_000
/** A draft request that gives up after `ms`: a stalled network never holds the save queue, Publish or Start over. */
function draftFetch(url: string, init: RequestInit = {}, ms = DRAFT_LOAD_TIMEOUT_MS): Promise<Response> {
  const ctl = new AbortController()
  const slow = setTimeout(() => ctl.abort(), ms)
  return fetch(url, { ...init, signal: ctl.signal }).finally(() => clearTimeout(slow))
}
const DRAFT_URL = '/api/teachers/me/draft'
/** ⛔ What a save sends: the tab draft's shape (no upload, cover switch or consent — forDraft) and never the phone. */
const draftBody = (t: TeacherInput, step: TeacherStep, rev: number, gen: string | null) =>
  JSON.stringify({ t: { ...forDraft(t), phone: '' }, step, rev, ...(gen ? { gen } : {}) })
/** A fresh generation for a first save (rev 0): proposed by the tab, so a cut-off one is recognised exactly. */
function newDraftGen(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** "Improve with AI" under the About text (owner, 2026-10-21) — the route (api/teachers/me/bio-rewrite) and its wait. */
const BIO_REWRITE_URL = '/api/teachers/me/bio-rewrite'
// The route gives up on the model at ~55 s (its own deadline, under maxDuration 60): past this the tab stops waiting.
const BIO_GIVE_UP_MS = 65_000
/**
 * ⛔ WHAT "IMPROVE WITH AI" SENDS — the answers bio-notice.ts names, read FIELD BY FIELD from what a save keeps
 * (normalizeForSave: a hidden answer is never sent), never `...t`: the name, the phone, the photo and video, the salary, the
 * start month, cover and every consent stay on eno.vn (the server reads only these again — bio-context.ts teacherBioRequest).
 */
const BIO_REWRITE_FIELDS = [
  'livesIn', 'currentCity', 'currentDistrictKey', 'currentProvince', 'jobTypes', 'relocate', 'teachAreas', 'teachAreasConfirmed',
  'subjects', 'teachLanguages', 'ageGroups', 'experienceBand', 'experience', 'degreeLevel', 'degreeMajor', 'degreeInstitution',
  'degreeYear', 'certificates', 'nationality', 'englishLevel', 'languages', 'headline', 'bio',
] as const satisfies readonly (keyof TeacherInput)[]
type BioRewriteAnswers = Pick<TeacherInput, (typeof BIO_REWRITE_FIELDS)[number]>
const bioRewriteAnswers = (t: TeacherInput): BioRewriteAnswers => {
  const kept = normalizeForSave(t)
  return Object.fromEntries(BIO_REWRITE_FIELDS.map((k) => [k, kept[k]])) as BioRewriteAnswers
}
/** A refusal as the line About says (the route's answers: 401 · 409 notice_changed · 429 · 503 · 400 too_short · 502). */
const bioErrorOf = (status: number, code: unknown): BioAiError =>
  status === 401 ? 'session'
    : status === 409 && code === 'notice_changed' ? 'notice'
      : status === 429 ? 'rate'
        : status === 503 ? 'unavailable'
          : status === 400 && code === 'too_short' ? 'short'
            : 'failed'

/** `start`: the join page's first-paint decisions for the start screen (teachers/join/page.tsx) — absent, no doors. */
type TeacherFormProps = {
  mode: Mode; draftHost: boolean; apexOrigin: string; goal?: 'cover' | null; start?: TeacherStartProps
  /** teacher.eno.vn inside Meta's built-in browser on a phone: step 1 offers the real browser (open-in-browser.tsx). */
  escape?: EscapeOffer | null
}

/** The later steps of a NEW profile, as the form counts them (signup-prompt.ts step_<step>). */
const STEP_REACHED: Partial<Record<TeacherStep, TeacherFormEvent>> = {
  where: 'step_where', teaching: 'step_teaching', about: 'step_about', cover: 'step_cover', finish: 'step_finish',
}

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

function TeacherFormForAccount({ mode, draftHost, apexOrigin, goal = null, start, escape = null, restoreDraft = true }: TeacherFormProps & { restoreDraft?: boolean }) {
  const { tr, lang } = useLanguage()
  const { user, loading: authLoading, openSignIn, accountType, identityLoaded, markOnboarded } = useAuth()
  const uid = user?.id ?? null
  const coverIntent = goal === 'cover'
  const [t, setTState] = useState<TeacherInput>(EMPTY_TEACHER)
  // The step BY KEY, never by index: when an answer adds or removes a step (a home with cover, "Online only"), the rail
  // re-counts around the step the teacher is on — it never moves them silently.
  const [stepKey, setStepKey] = useState<TeacherStep>('plans')
  // The form, or the reading panel (the CV) in its place — teacher-start.tsx.
  const [door, setDoorState] = useState<Door>(() => (mode === 'join' ? initialDoor(start, draftHost) : 'self'))
  // The last reading the form applied (teacher-import-panel.tsx): what it filled, what was there before (Undo), the file.
  const [lastImport, setLastImport] = useState<LastImport | null>(null)
  // Join, signed in: GET /api/teachers/me has answered — no door shows before it is known whether a profile exists.
  const [meKnown, setMeKnown] = useState(false)
  // …and REALLY answered, for THIS account: the counters treat a profile as new only on that answer — never on the slow
  // timer, an error (unknown is not new) or another account's answer after a switch (review, 2026-10-17).
  const [meReadFor, setMeReadFor] = useState<string | null>(null)
  const meRead = uid !== null && meReadFor === uid
  // Undo of a reading is on its way: the summary's buttons wait for it (a Continue meanwhile would be wiped by it).
  const [undoing, setUndoing] = useState(false)
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
  const [noProfileDraft, setNoProfileDraft] = useState(false)
  const [existing, setExisting] = useState(false)
  // Join: answers ARRIVED — a teacher.eno.vn hand-off or a restored draft (or typed here before signing in) — so a
  // signed-in account that already has a profile is offered to review them in it, rather than having them thrown away.
  const [arrived, setArrived] = useState(false)
  /** This page opened with teacher.eno.vn's hand-off (`#d=`): its step 1 was done — and counted — over there. */
  const viaHandoff = useRef(false)
  const [handoffArrived, setHandoffArrived] = useState(false)
  const [listingLive, setListingLive] = useState(true)
  // Edit: the profile's public page (its Listing) — what "Share my profile" shares while schools can see it.
  const [profileListingId, setProfileListingId] = useState<string | null>(null)
  // …and the name and headline it shows: what "Share my profile" sends with the link — never an edit not yet saved.
  const [publicAs, setPublicAs] = useState<{ fullName: string; headline: string } | null>(null)
  // GET /api/teachers/me: whether this account may publish right now (shown at the TOP of the last step), and — with no
  // profile yet — what the account already knows, OFFERED, never filled in unasked.
  const [publishGate, setPublishGate] = useState<{ ok: boolean; code: string | null } | null>(null)
  const [prefill, setPrefill] = useState<{ displayName: string | null; avatarUrl: string | null; phone: string | null } | null>(null)
  // "IMPROVE WITH AI" UNDER THE ABOUT TEXT (owner, 2026-10-21): offered when GET /api/teachers/me says Gemini on Vertex is
  // configured (`bioAi`, in both modes — the edit page is static, so no server prop could say it); false until known.
  const [bioAiOn, setBioAiOn] = useState(false)
  const [bioWorking, setBioWorking] = useState(false)
  // A rewrite let go when the teacher left About is still running on the server, which takes one at a time per account
  // (bio-rewrite's lock — a second tap would only meet a 429): the chip waits for it to settle (gate review, 2026-10-21).
  const [bioSettling, setBioSettling] = useState(false)
  const [bioError, setBioError] = useState<BioAiError>('')
  // The last rewrite: Undo puts `before` back only while the text is still `after` (compare-and-swap — undoBio).
  const [bioUndo, setBioUndo] = useState<{ before: string; after: string } | null>(null)
  // Every tap takes a ticket, and an answer for an older one is dropped. `bioBusy` is the double-tap guard — state is a
  // render late, a ref is not — and `bioAbort` the request on its way (let go when the teacher leaves About).
  const bioSeq = useRef(0)
  const bioBusy = useRef(false)
  const bioAbort = useRef<AbortController | null>(null)
  // ⛔ THE TERMS LINE BESIDE PUBLISH (owner, 2026-10-11 — onboarding-gate.ts resumesInPlace): a new account that signed in
  // on this form never saw /onboard, so its first Publish is the assent — the line names the three documents and the
  // save sends `acceptTerms`; the SERVER records the account step (api/teachers/me PUT). Shown when this account is known
  // to be untyped, or once the server asked for it (409 terms_required: the identity was still loading, or stale here).
  const [termsAsked, setTermsAsked] = useState(false)
  // Where to go once signed in: "Sign in", a hand-off, or a draft that was on a step needing an account.
  const [resumeTo, setResumeTo] = useState<TeacherStep | null>(null)
  const signInAsked = useRef(false)
  // When THIS FORM opened a sign-in for the answers on screen (StoredDraft.signIn) — null once it lands or is closed.
  const adoptAt = useRef<number | null>(null)
  // A mark restored with this tab's copy (the Google round trip): honoured only if the page then loads SIGNED IN — one
  // that loads signed out is an abandoned sign-in, and its mark goes (commit gate, opus 2026-10-11).
  const restoredSignIn = useRef<number | null>(null)
  const restoredBase = useRef<DraftBase | null>(null)
  const restoredOwner = useRef<string | null>(null)
  const [ownedPending, setOwnedPending] = useState(false)
  const loadBackoff = useRef(0)
  const saveBackoff = useRef(0)
  const ownedCopy = useRef<{ stored: ReadDraft; returnedFromSignIn: boolean } | null>(null)
  const applyStoredRef = useRef<(stored: ReadDraft, returnedFromSignIn: boolean) => void>(() => {})
  const uidRef = useRef(uid)
  uidRef.current = uid
  // onDismiss fires ONLY when the visitor closes the popup without signing in (the ×, Esc, the backdrop) — never on a
  // successful sign-in, which closes it from onAuthStateChange (auth-context.tsx SignInContext.onDismiss).
  const dropAdoption = useCallback(() => { adoptAt.current = null; clearStoredSignIn(); setSignInReturn(false) }, [])
  /**
   * ⛔ THE ACCOUNT'S SAVED DRAFT (owner, 2026-10-11: "every step they input should be saved and able to resume when they
   * want to" — src/lib/teachers/draft.ts, /api/teachers/me/draft). Join mode, signed in, on eno.vn, no profile yet:
   *   · LOAD once the account is known. ⛔ The saved draft WINS over a `#d=` hand-off and a stranger's tab copy (plan
   *     review: a stale or crafted link must never replace a five-step draft with step 1) — the replaced answers stay one
   *     tap away; this tab's own copy wins only when it builds on the account's current revision (a reload mid-step).
   *     With none saved, this tab's answers become the draft only when THIS FORM opened the sign-in for them (adoptAt),
   *     or once the signed-in teacher moves to another step — never a stranger's answers left in a shared tab.
   *   · SAVE on every step change, one request at a time (a revision each). Refused as stale (another tab or device
   *     saved since) or gone (published, started over, expired): saving stops and the line under the title asks.
   *     Network and server failures are tried again every DRAFT_RETRY_MS; a refusal of the request itself is not.
   * `draftRev`: the revision this tab's answers build on — null until the GET answered (nothing is saved before), 0: none.
   */
  const draftRev = useRef<number | null>(null)
  // The saved draft's generation (a random id made with it, src/lib/teachers/draft.ts): named with the revision on every write.
  const draftGen = useRef<string | null>(null)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [draftState, setDraftState] = useState<'' | 'saving' | 'saved' | 'error' | 'failed' | 'stale' | 'gone'>('')
  // A save landed: what the screen says about it reads `savedT` (a ref), so a landing always renders — even when the
  // answer came back before "Saving…" did, and React folded saved → saving → saved into no change at all.
  const [, setSaveLanded] = useState(0)
  // Why the conflict choice is on screen: another tab or device saved since, or the saved draft arrived only now, after a
  // failed load, while the teacher was already working on the page.
  const [staleWhy, setStaleWhy] = useState<'elsewhere' | 'reconnect'>('elsewhere')
  const [confirmStartOver, setConfirmStartOver] = useState(false)
  // The answers and step last saved (or loaded): a save is due when either differs.
  const savedT = useRef<TeacherInput | null>(null)
  const savedStep = useRef<TeacherStep | null>(null)
  const saveQ = useRef({ inFlight: null as Promise<void> | null, gen: 0 })
  // ⛔ SAVING STOPPED — refused as stale, gone or "a profile exists", or a Publish on its way: no timer, retry or page-exit
  // save may fire until the teacher chooses (commit gate, opus 2026-10-11: a refused save rescheduled itself every few
  // seconds). (Another account never inherits any of this: TeacherForm remounts the form whenever an account leaves.)
  const halted = useRef(false)
  // REFUSED — stale, gone or "a profile exists": saving waits for the teacher's choice. Kept apart from `halted` (a
  // Publish or Start over in progress), so ending a pause never ends a refusal (commit gate, opus 2026-10-11).
  const refused = useRef(false)
  // Why the last save could not be retried: an ended session (sign in again) or a refusal of the request itself.
  const failedWhy = useRef<'session' | 'refused'>('refused')
  // Edit: a stored consent given under an OLDER notice — loaded OFF, so it is given again under today's words (D5).
  const [reconfirm, setReconfirm] = useState({ cover: false, optIns: false })
  /**
   * ⛔ "IDENTITY VERIFIED" (owner, 2026-10-15; AUTOMATIC since 2026-10-16) — THE SWITCH'S OWN STATE, NEVER IN `t` (plan
   * review R2): it is not part of the profile or a draft. The mark shows by itself once the identity is verified; the switch
   * HIDES it (and shows it again). With a profile it saves ON TOGGLE through PUT /api/teachers/me/identity-mark
   * (toggleMark), and an edit's profile save never carries it (nor un-hides it), so `reconfirm` has nothing to do with it.
   * `mark` is always the server's last word — the GET, or the last toggle's answer; never ahead of it. The rules:
   * identity-mark-switch.ts.
   */
  const [mark, setMark] = useState<MarkSwitch>(NO_MARK)
  const [markBusy, setMarkBusy] = useState(false)
  const [markMessage, setMarkMessage] = useState<FinishIdentityMark['message']>('')
  // A NEW profile (join): the teacher's hide, held on this page until Publish — owner, 2026-10-16: the teacher keeps a way
  // to hide it "BEFORE publishing too". Sent with the first Publish as the create-only `identityMarkHidden: true`
  // (publish), never anywhere else: not `t`, not a draft (a reload starts from the default again, as the draft line on
  // this step says), not an edit's save.
  const [joinMarkHidden, setJoinMarkHidden] = useState(false)
  // Every read and toggle takes a ticket, and an answer for an older one is dropped. A re-read asked for while a toggle
  // is on its way waits for it (markRefreshDue): a toggle's answer is never dropped for a read that began before it.
  const markSeq = useRef(0)
  const markBusyRef = useRef(false)
  const markRefreshDue = useRef(false)
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
  // "Hide my profile from search engines" (owner decision 14, 2026-10-20) — edit only, saved on toggle through its own
  // endpoint (PUT /api/teachers/me/search). As the SERVER last said it: null = not loaded (the switch is disabled), never
  // moved ahead of an answer. `searchMessage`: the line after a refusal or a failure.
  const [searchHidden, setSearchHidden] = useState<boolean | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchMessage, setSearchMessage] = useState<'' | 'rate_limited' | 'failed'>('')
  // The intro video (2026-10-07, owner: "show their intro video in profile or hide and send upon request"): whether a
  // PRIVATE one is stored — its address never reaches the form — and the version this form loaded, sent back as
  // `videoBase` so a stale window can never publish, hide, replace or delete a newer choice (src/lib/teachers/video.ts).
  const [privateVideo, setPrivateVideo] = useState(false)
  const [videoBase, setVideoBase] = useState<number | null>(null)
  const [videoRemoving, setVideoRemoving] = useState(false)
  const [confirmVideoRemove, setConfirmVideoRemove] = useState(false)
  // The public video AS SAVED: hiding THAT one cannot recall copies of its link (the note under the choice says so).
  const [savedPublicUrl, setSavedPublicUrl] = useState<string | null>(null)
  // A video being prepared: the compression's progress (0–1) while a clip over the storage ceiling is made smaller.
  const [videoProgress, setVideoProgress] = useState<number | null>(null)
  // THE PROFILE PHOTO CHECK (owner, 2026-10-16): asked as soon as a photo is on the last step (POST /api/teachers/me/
  // photo-check), so a refusal is said beside the photo, not at Publish. The save judges it again itself.
  const [photoCheck, setPhotoCheck] = useState<{ url: string; state: 'checking' | 'ok' | 'fail' | 'unavailable'; reason?: 'not_photo' | 'no_face' } | null>(null)
  // Edit: the saved photo, when it was created (the video and CV rules) and whether the re-check asked the teacher to change it.
  const [savedPhotoUrl, setSavedPhotoUrl] = useState<string | null>(null)
  const [profileCreatedAt, setProfileCreatedAt] = useState<string | null>(null)
  const [savedHadVideo, setSavedHadVideo] = useState(false)
  // …and whether a CV is saved (the CV rule's other half): from the load, true once an upload lands, false once one is removed.
  const [savedHadCv, setSavedHadCv] = useState(false)
  const [photoAsk, setPhotoAsk] = useState<{ reason: string } | null>(null)
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
  // A screen of this page replaced by another in place (a door, Continue, Undo): focus goes to the new screen's heading.
  const screenSwitched = useRef(false)
  /** The reading panel opened or closed: the address follows (`?import=cv`), so a reload — or Google's round trip — reopens
   *  it. (`start=self` belonged to the start screen's "myself" door, gone 2026-10-16: an old link's is simply dropped.) */
  const setDoor = useCallback((d: Door) => {
    setDoorState(d)
    screenSwitched.current = true
    try {
      const u = new URL(window.location.href)
      for (const k of ['import', 'start']) u.searchParams.delete(k)
      if (d === 'cv') u.searchParams.set('import', d)
      history.replaceState(history.state, '', `${u.pathname}${u.search}${u.hash}`)
    } catch { /* no history API: the screen still switches */ }
    window.scrollTo({ top: 0, behavior: scrollBehavior() })
  }, [])

  // ── The steps this teacher sees — re-derived from their answers (profile.ts teacherSteps) ─────────────────────────
  const steps = useMemo(() => teacherSteps(t, { draftHost }), [t, draftHost])
  // THE INTRO VIDEO "FROM NOW ON" (owner, 2026-10-16): every new profile, and a profile created since the cutoff
  // (constants.ts TEACHER_VIDEO_REQUIRED_FROM) that has one — the server's own rule (publish.ts): a profile made after the
  // cutoff under the old code (a slipped deploy) never had one, and its edits never demand one.
  const videoRequired = mode === 'join' || (videoRequiredSince(profileCreatedAt) && savedHadVideo)
  // THE CV "FROM NOW ON" (owner, 2026-10-21: "they should include cv") — the video's rule, with the video's guard
  // (constants.ts TEACHER_CV_REQUIRED_FROM): every new profile, and a profile created since the cutoff that has one, which
  // may replace it, never remove it. The server enforces both (publish.ts at create, the CV route's 409).
  const cvRequired = mode === 'join' || (cvRequiredSince(profileCreatedAt) && savedHadCv)

  const step: TeacherStep = steps.includes(stepKey)
    ? stepKey
    : steps.find((s) => TEACHER_STEPS.indexOf(s) > TEACHER_STEPS.indexOf(stepKey)) ?? steps[steps.length - 1]
  const stepIdx = steps.indexOf(step)
  // About ON SCREEN, read by an answer that lands some renders later ("Improve with AI" — improveBio). ⛔ Not just the step:
  // the CV reader's panel takes the form's place on About too (cvHandy → door 'cv'), and an answer landing behind it would
  // rewrite the text unseen and ride the reading's draft save (gate review, 2026-10-21).
  const aboutOnScreen = step === 'about' && !(mode === 'join' && !draftHost && door === 'cv')
  const aboutShown = useRef(aboutOnScreen)
  aboutShown.current = aboutOnScreen

  // ── The profile photo check (owner, 2026-10-16): asked once per photo, on the step that shows it ────────────────────
  // A NEW photo only: on an edit, the saved one is never re-judged (the server does not either). The answer is for that
  // URL alone — a photo changed meanwhile drops it. "Could not check" is no verdict: the save decides then.
  // ⛔ ONLY A PHOTO THE TEACHER CHOSE, ONLY ON "PHOTO & PUBLISH" (gate review, 2026-10-16): the account's own photo, filled
  // in by the autofill below, goes to the check only when the teacher taps Publish (the server checks every new photo
  // there) — never on its own; one the teacher uploads is checked at once, beside its notice. Publish checks it either way. The RENDERED step, not stepKey: answers that remove
  // the step the teacher was on move the screen forward without changing stepKey.
  const photoChecked = useRef<string | null>(null)
  useEffect(() => {
    const url = t.photoUrl
    if (step !== 'finish' || !uid || !url || url === prefilledPhoto.current || (mode === 'edit' && url === savedPhotoUrl) || photoChecked.current === url) return
    photoChecked.current = url
    let alive = true
    // Settled answers are kept for that photo: going Back and forward again never asks twice (gate review, 2026-10-16).
    let settled = false
    setPhotoCheck({ url, state: 'checking' })
    fetch('/api/teachers/me/photo-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) })
      .then(async (r) => ({ ok: r.ok, d: (await r.json().catch(() => ({}))) as { checked?: boolean; ok?: boolean; reason?: string } }))
      .then(({ ok, d }) => {
        if (!alive) return
        settled = true
        if (ok && d.checked === false) setPhotoCheck(null)
        else if (ok && d.ok === true) setPhotoCheck({ url, state: 'ok' })
        else if (ok && d.ok === false && (d.reason === 'not_photo' || d.reason === 'no_face')) setPhotoCheck({ url, state: 'fail', reason: d.reason })
        else { photoChecked.current = null; setPhotoCheck({ url, state: 'unavailable' }) }
      })
      .catch(() => { if (alive) { photoChecked.current = null; setPhotoCheck({ url, state: 'unavailable' }) } })
    return () => { alive = false; if (!settled && photoChecked.current === url) photoChecked.current = null }
  }, [t.photoUrl, uid, mode, savedPhotoUrl, step])
  // ⛔ THE PUBLISH NOTE'S PLACE — every step of an edit (Save changes publishes too), the last step of a new profile on
  // eno.vn — and the Terms line inside it renders EXACTLY when `needsTerms` is true, so `acceptTerms` is never sent for a
  // line the screen did not show (commit gate, opus 2026-10-11). Join: known untyped. Any mode: once the server asked
  // (409 terms_required — the identity was still loading, or an edit form with no profile loaded is creating one).
  const showPublishNote = mode === 'edit' || (!draftHost && stepIdx === steps.length - 1 && !!user)
  const needsTerms = !!user && showPublishNote && ((mode === 'join' && identityLoaded && !accountType) || termsAsked)
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

  // A stored copy put back: the answers, the step, a pending sign-in mark, the revision it built on, whose it is.
  applyStoredRef.current = (stored, returnedFromSignIn) => {
    // ⛔ Nor from a stored draft: the uploads, the cover switch and the consents are not in it (forDraft) and are stripped
    // again on the way in (fromDraft) — the key is per TAB, and on a shared browser a tab can be the next person's.
    const restored = fromDraft(stored.t)
    setT(restored)
    if (stored.districtNotSaying) setDistrictNotSaying(true)
    setArrived(true)
    // A sign-in this form opened for these answers, still pending (Google's round trip): they may become its draft.
    if (stored.signIn && returnedFromSignIn) restoredSignIn.current = stored.signIn
    else if (stored.signIn) clearStoredSignIn()
    if (stored.base) restoredBase.current = stored.base
    restoredOwner.current = stored.owner ?? null
    // Back where it was — never past the first step that fails (draftResumeStep; a v3 draft, with no step, opens there).
    const target = draftResumeStep(restored, stored.step).step
    // A step after sign-in is shown once signed in; until then, the step "Sign in" sits on.
    if (!PRE_SIGNIN_STEPS.includes(target)) { setStepKey(LAST_PRE_SIGNIN); setResumeTo(target) }
    else setStepKey(target)
  }

  // ── Restore: a `#d=` hand-off from teacher.eno.vn wins, then this tab's draft ────────────────────────────────────
  useEffect(() => {
    if (mode !== 'join' || hydrated.current) return
    hydrated.current = true
    // The form that replaced a signed-in account's (TeacherForm): a fresh start, and that account's draft goes.
    if (!restoreDraft) { clearStored(); setSignInReturn(false); return }
    const returnedFromSignIn = new URLSearchParams(window.location.search).has(SIGNIN_RETURN_PARAM)
    const m = window.location.hash.match(new RegExp(`[#&]${TEACHER_DRAFT_HASH_KEY}=([^&]+)`))
    if (m) {
      // Strip the fragment first, whatever it holds, so a reload or a shared link never re-carries the draft.
      history.replaceState(null, '', window.location.pathname + window.location.search)
      setSignInReturn(false)
      // ⛔ ONLY THE DRAFT STEPS' FIELDS CROSS (decodeHandoff): never a consent, the cover switch, a phone or an upload —
      // a crafted `#d=` link could otherwise arrive with them set (gate review, 2026-10-07). A v1 fragment from before
      // the redesign is mapped at this boundary (plan review D2).
      const handed = decodeHandoff(m[1])
      if (handed) {
        viaHandoff.current = true
        setT(handed)
        setArrived(true)
        // The pre-sign-in step answered (a fragment from a teacher.eno.vn tab from before 2026-10-11 carries all four draft
        // steps — still accepted): sign in (opened once, below), then on to the first step after it that fails. Otherwise
        // the pre-sign-in step that fails. The sign-in is this form's: it may adopt these answers (StoredDraft.signIn).
        const bad = firstStepWithError(checkSteps(handed, PRE_SIGNIN_STEPS), PRE_SIGNIN_STEPS)
        const next = afterSignIn(handed)
        if (bad) setStepKey(bad)
        else { setStepKey(LAST_PRE_SIGNIN); setResumeTo(next); setHandoffArrived(true) }
        // ⛔ Not adopted here: only a sign-in this form actually opens (signed out, below) may make these answers an
        // account's draft — a link opened while signed in saves nothing until the teacher changes something.
        writeStoredDraft(handed, bad ?? next)
      }
      return
    }
    const stored = readStoredDraft()
    // The return marker only means something with a stored mark beside it (below): otherwise it goes now.
    if (!stored?.signIn) setSignInReturn(false)
    if (!stored) return
    // ⛔ A COPY WRITTEN UNDER AN ACCOUNT IS THAT ACCOUNT'S ALONE (commit gate, codex + opus round 11: a teacher who signed
    // out on a page without this form leaves it in the tab, and the next person's form would show it, save it, publish
    // it). It waits for the session (below) and is put back only if that is its account — never shown before. A copy
    // written signed out holds what a signed-out visitor gives: step 1 (PRE_SIGNIN_STEPS).
    if (stored.owner) { ownedCopy.current = { stored, returnedFromSignIn }; setOwnedPending(true); return }
    applyStoredRef.current(stored, returnedFromSignIn)
  }, [mode, restoreDraft, setT])
  // The copy that waited for its account: put back for it (unless the teacher has typed meanwhile); for anyone else, or
  // no one, deleted unread — unless a newer copy has replaced it since.
  useEffect(() => {
    const c = ownedCopy.current
    if (!c || authLoading) return
    const decide = () => {
      ownedCopy.current = null
      setOwnedPending(false)
      if (uid && c.stored.owner === uid) { if (tRef.current === EMPTY_TEACHER) applyStoredRef.current(c.stored, c.returnedFromSignIn) }
      else if (readStoredDraft()?.owner === c.stored.owner) clearStored()
    }
    // Signed out for now: a session that lands a moment late (the sign-in callback's cookie) gets a few seconds first,
    // as the sign-in mark does — the copy and the form wait (commit gate, opus round 15).
    if (!uid) {
      const wait = setTimeout(decide, 5_000)
      return () => clearTimeout(wait)
    }
    decide()
  }, [authLoading, uid])

  // Signed in (in place, or back from Google): on to where the teacher was going — ⛔ only past a valid pre-sign-in step.
  useEffect(() => {
    if (!resumeTo || authLoading || !uid) return
    const bad = firstStepWithError(checkSteps(tRef.current, PRE_SIGNIN_STEPS), PRE_SIGNIN_STEPS)
    // …and never past the first step that fails since (an edit to step 1 can un-answer a later one — commit gate).
    setStepKey(bad ?? draftResumeStep(tRef.current, resumeTo).step)
    setResumeTo(null)
  }, [resumeTo, uid, authLoading])
  // A step after sign-in, with no account (a session that ended): the step "Sign in" sits on, and resume after.
  useEffect(() => {
    if (mode !== 'join' || draftHost || authLoading || uid || PRE_SIGNIN_STEPS.includes(stepKey)) return
    setResumeTo(stepKey)
    setStepKey(LAST_PRE_SIGNIN)
  }, [mode, draftHost, authLoading, uid, stepKey])
  const signInNote = () => tr('Sign in to continue — your answers are kept, and saved to your account at every step, so you can finish any time.', 'Đăng nhập để tiếp tục — câu trả lời được giữ lại và lưu vào tài khoản ở mỗi bước, để bạn hoàn tất bất cứ lúc nào.')
  // ── The account's saved draft: load and save (see draftRev above) ─────────────────────────────────────────────────
  // ⛔ ONE CONTRACT BOUNDS THE RACES (commit gate, codex + opus, 2026-10-11): signed in, the form is not editable until
  // the saved draft has answered (a spinner; a failed or slow load shows the form and keeps asking), and the draft is
  // saved on every STEP CHANGE — Next, Back, the rail — one save at a time. No typing debounce and no page-exit save: the
  // line under the title says the answers on a step are saved when the teacher moves on, and this tab's own copy holds
  // them for a reload meanwhile.
  const draftStep = resumeTo ?? stepKey
  const draftStepRef = useRef(draftStep)
  draftStepRef.current = draftStep
  const draftOn = mode === 'join' && !draftHost && !!uid && !existing && !done && draftLoaded && draftState !== 'stale' && draftState !== 'gone'
  // The answers on the page when the saved draft replaced them — one tap brings them back (`useMine`).
  const [pageAnswers, setPageAnswers] = useState<{ t: TeacherInput; step: TeacherStep } | null>(null)
  // A load that failed: retried, and said on the page — never a silent switch-off of the saving.
  const [loadTry, setLoadTry] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const loadFailedRef = useRef(false)
  loadFailedRef.current = loadFailed
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveAbort = useRef<AbortController | null>(null)
  const timedOut = useRef<{ base: number; gen: string; t: TeacherInput; step: TeacherStep } | null>(null)
  // The session the server refused (401): a NEW one for this account — "Sign in again" — tries again at once.
  const sessionLostFor = useRef<unknown>(null)
  const userRef = useRef<unknown>(user)
  userRef.current = user
  const mounted = useRef(true)
  // The answers on the page when a load first failed — what the teacher changes before it answers is saved on recovery.
  const loadFailedT = useRef<TeacherInput | null>(null)
  const loadFailedStep = useRef<TeacherStep | null>(null)
  // A step change happened while a save was on its way: the save that follows it is due whatever step it lands on.
  const movedDuringSave = useRef(false)
  const lastSeenStep = useRef<TeacherStep | null>(null)
  // The step of the last save SENT, landed or not: only a step not yet attempted saves at once — a failed one waits for
  // the retry, so an outage never becomes a request loop (commit gate, 2026-10-11).
  const sentStep = useRef<TeacherStep | null>(null)
  const saveDraftRef = useRef<() => Promise<void>>(async () => {})
  /**
   * ⛔ ANSWERS ON THE PAGE THE ACCOUNT HAS NOT TAKEN YET — the load found answers this form did not sign in for (a tab copy
   * left signed out, a hand-off opened signed in) and holds them back until the teacher moves on from a step with them on
   * screen. Set there, cleared by the first save that lands. A CV reading must not carry them into the account unseen
   * (review, 2026-10-16: the panel replaces the form, so step 1 was never on screen before the reading saved it).
   */
  const heldBack = useRef(false)
  /**
   * A save cut off by our own timeout (or answered without a revision) may have committed all the same: if the account
   * now holds exactly it — same generation, one revision on — that revision is ours, and the next save builds on it
   * instead of meeting a false conflict (commit gate, 2026-10-11). Runs INSIDE the queue (below and before Start over).
   */
  const reconcileLost = async (): Promise<boolean | 'session'> => {
    const lost = timedOut.current
    if (!lost) return true
    try {
      const r = await draftFetch(DRAFT_URL, { cache: 'no-store' })
      // An ended session: said as such, and tried again with the next one (sessionLostFor) — never a poll (round 16).
      if (r.status === 401) return 'session'
      // Not known yet: the save waits — never one on a revision that may be stale (commit gate, opus round 13).
      if (!r.ok) return false
      timedOut.current = null
      const row = ((await r.json()) as { draft?: { t: unknown; step: unknown; rev: number; gen: string } | null }).draft
      // Its generation too — a first save proposed its own (newDraftGen): never a draft made since by someone else.
      if (row && row.rev === lost.base + 1 && row.gen === lost.gen && row.step === lost.step
        && sameDraftAnswers(row.t, lost.t)) {
        draftRev.current = row.rev
        draftGen.current = row.gen
        savedT.current = lost.t
        savedStep.current = lost.step
      }
      return true
    } catch { return false }
  }
  saveDraftRef.current = async () => {
    const q = saveQ.current
    if (!mounted.current || draftRev.current === null || halted.current || refused.current || nothingToSave(tRef.current)) return
    // One at a time: the one on its way re-checks what changed when it lands (below).
    if (q.inFlight) return
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null }
    const gen = q.gen
    setDraftState('saving')
    const run = (async () => {
      let retry = false
      let unchecked = false
      let sentGen = ''
      // What this run sends — read after the reconciliation, which may move the revision it builds on.
      let base = 0
      let snapshot = tRef.current
      let step = draftStepRef.current
      try {
        // Attempted, whatever the check below finds: a failing check never turns every keystroke into a request.
        sentStep.current = draftStepRef.current
        movedDuringSave.current = false
        const known = await reconcileLost()
        if (known === 'session') {
          if (gen === q.gen) { failedWhy.current = 'session'; sessionLostFor.current = userRef.current; setDraftState('failed'); unchecked = true }
          return
        }
        if (!known) {
          // The check of a cut-off save could not be made: tried again later, never at once.
          if (gen === q.gen) { setDraftState('error'); retry = true; unchecked = true }
          return
        }
        if (gen !== q.gen || !mounted.current || draftRev.current === null) return
        base = draftRev.current
        snapshot = tRef.current
        step = draftStepRef.current
        sentStep.current = step
        movedDuringSave.current = false
        // A stalled save never blocks the queue (or a Publish waiting on it) for long: cut off after SAVE_TIMEOUT.
        const ctl = new AbortController()
        saveAbort.current = ctl
        const slow = setTimeout(() => ctl.abort(), DRAFT_SAVE_TIMEOUT_MS)
        const sendGen = base === 0 ? newDraftGen() : draftGen.current
        sentGen = sendGen ?? ''
        const r = await fetch(DRAFT_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: draftBody(snapshot, step, base, sendGen), signal: ctl.signal })
          .finally(() => clearTimeout(slow))
        const d = await r.json().catch(() => ({}))
        // Start over (or another choice of answers) since: this answer is not for the form on screen.
        if (gen !== q.gen) return
        if (r.ok && typeof d.rev === 'number' && typeof d.gen === 'string') {
          saveBackoff.current = 0
          draftRev.current = d.rev
          draftGen.current = d.gen
          savedT.current = snapshot
          savedStep.current = step
          setDraftState('saved')
          setSaveLanded((n) => n + 1)
          heldBack.current = false
          // The teacher carried on with what is on the page: the answers the saved draft replaced are no longer offered.
          setPageAnswers(null)
          // The first save made the dashboard's "Teacher profile — Continue" row.
          if (base === 0 && uid) revalidateDashboard(uid)
        } else if (r.ok) {
          // Answered 2xx but unreadable: it may have committed — checked like a timed-out save, then tried again.
          setDraftState('error')
          retry = true
          if (sentGen) timedOut.current = { base, gen: sentGen, t: snapshot, step }
        } else if (d.error === 'draft_stale') { refused.current = true; setStaleWhy('elsewhere'); setDraftState('stale') }
        else if (d.error === 'draft_gone') { refused.current = true; setDraftState('gone') }
        else if (d.error === 'teacher_exists') { refused.current = true; setExisting(true) }
        // Worth trying again: the server or the network failing (5xx, 429). A refusal of the request itself (400, 401,
        // 413) would only fail again — said, not retried (commit gate, opus 2026-10-11).
        else {
          retry = r.status >= 500 || r.status === 429
          failedWhy.current = r.status === 401 ? 'session' : 'refused'
          if (r.status === 401) sessionLostFor.current = userRef.current
          setDraftState(retry ? 'error' : 'failed')
        }
      } catch (e) {
        if (gen === q.gen) {
          setDraftState('error')
          retry = true
          // Cut off by our own timeout: it may still have committed — checked before the retry (reconcileLost).
          if ((e as Error | undefined)?.name === 'AbortError' && mounted.current && sentGen) timedOut.current = { base, gen: sentGen, t: snapshot, step }
        }
      } finally {
        q.inFlight = null
        if (gen === q.gen && !halted.current && !refused.current && mounted.current) {
          // A step change made while it was on its way (Back and Next again included): saved now. A failure is tried
          // again later — never at once.
          if (!unchecked && (movedDuringSave.current || draftStepRef.current !== sentStep.current)) void saveDraftRef.current()
          else if (retry) {
            // Less often each time (30s, 1, 2, 4… up to 10 minutes) while it keeps failing: an outage never polls.
            retryTimer.current = setTimeout(() => { retryTimer.current = null; void saveDraftRef.current() }, Math.min(DRAFT_RETRY_MS * 2 ** saveBackoff.current, 10 * 60_000))
            saveBackoff.current++
          }
        }
      }
    })()
    q.inFlight = run
    await run
  }
  // Signed in again after the server refused the session: the load — or the save — is tried again at once.
  useEffect(() => {
    if (!sessionLostFor.current || !user || user === sessionLostFor.current) return
    sessionLostFor.current = null
    if (loadFailedRef.current) setLoadTry((n) => n + 1)
    else void saveDraftRef.current()
  }, [user])
  // Load, once the account is known — and again after a failure, every DRAFT_RETRY_MS.
  useEffect(() => {
    if (mode !== 'join' || draftHost || !uid || authLoading || draftLoaded) return
    let alive = true
    let again: ReturnType<typeof setTimeout> | null = null
    const ctl = new AbortController()
    const slow = setTimeout(() => ctl.abort(), DRAFT_LOAD_TIMEOUT_MS)
    // The page loaded signed in: a sign-in mark restored with this tab's copy belongs to it (the Google round trip).
    if (restoredSignIn.current) { adoptAt.current = restoredSignIn.current; restoredSignIn.current = null }
    fetch(DRAFT_URL, { cache: 'no-store', signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(Object.assign(new Error(String(r.status)), { status: r.status }))))
      .then((d: { draft?: { t: unknown; step: unknown; rev: unknown; gen: unknown } | null }) => {
        if (!alive) return
        const row = d?.draft
        draftGen.current = row && typeof row.gen === 'string' ? row.gen : null
        // Loaded after "You are signed out" (a 401 before): that line goes; the branches below say what is saved now.
        setDraftState((s) => (s === 'failed' ? '' : s))
        loadBackoff.current = 0
        const shown = tRef.current
        const shownStep = draftStepRef.current
        const tabBase = restoredBase.current
        restoredBase.current = null
        const tabOwner = restoredOwner.current
        restoredOwner.current = null
        if (!row && tabBase && tabBase.uid === uid && shown !== EMPTY_TEACHER) {
          // This tab's copy built on a saved draft that is gone now (started over or published elsewhere, expired): said,
          // never brought back unasked (commit gate, opus 2026-10-11) — "Save the answers on this page" is one tap.
          draftRev.current = 0
          refused.current = true
          setDraftState('gone')
        } else if (row && typeof row.rev === 'number' && tabBase && tabBase.uid === uid && tabBase.rev === row.rev && tabBase.gen === row.gen && shown !== EMPTY_TEACHER) {
          // This tab's copy builds on the account's CURRENT revision (a reload mid-step): it is the newer one — kept, and
          // saved as the next revision. A later save from anywhere else would have moved the revision, and win (below).
          draftRev.current = row.rev
          if (sameDraftAnswers(shown, row.t) && shownStep === row.step) {
            // …unless nothing changed since it (a reload, no edit): saved already — never a new revision that another
            // device would then meet as a conflict (commit gate, opus round 13).
            savedT.current = shown
            savedStep.current = shownStep
            sentStep.current = shownStep
          } else {
            savedT.current = null
            savedStep.current = null
            sentStep.current = null
          }
          setDraftState('saved')
        } else if (row && typeof row.rev === 'number' && loadFailedRef.current && shown !== EMPTY_TEACHER
          && !sameDraftAnswers(shown, row.t)) {
          // A RETRY after a failed load, with answers typed meanwhile: nothing is replaced mid-typing — the choice
          // ("Open the latest" / "Keep the answers on this page") is asked, in its own words (commit gate).
          draftRev.current = row.rev
          refused.current = true
          setStaleWhy('reconnect')
          setDraftState('stale')
        } else if (row && typeof row.rev === 'number' && loadFailedRef.current && shown !== EMPTY_TEACHER) {
          // A retry whose saved answers ARE the page's: nothing to choose, and the teacher stays on their step — which is
          // saved now, so the account reopens where the teacher is (commit gate, codex 2026-10-11).
          draftRev.current = row.rev
          savedT.current = tRef.current
          savedStep.current = null
          sentStep.current = null
          setDraftState('saved')
        } else if (row && typeof row.rev === 'number') {
          draftRev.current = row.rev
          // ⛔ THE SAVED DRAFT WINS over a hand-off and this tab's copy (plan review: a stale or crafted link must never
          // replace a five-step draft with step 1) — and the answers it replaced stay one tap away (`useMine`), never
          // lost. The phone, which a saved draft never holds, stays this tab's own.
          // ⛔ …only from this account's own copy (its owner): never one a signed-out visitor left (round 10-11).
          const mine = tabOwner === uid
          const loaded: TeacherInput = { ...fromDraft(row.t), phone: mine ? shown.phone : '' }
          setT(loaded)
          savedT.current = loaded
          const back = draftResumeStep(loaded, row.step).step
          savedStep.current = back
          sentStep.current = back
          setResumeTo(null)
          setStepKey(back)
          setArrived(true)
          setDraftState('saved')
          if (shown !== EMPTY_TEACHER && !sameDraftAnswers(shown, loaded)) setPageAnswers({ t: mine ? shown : { ...shown, phone: '' }, step: shownStep })
        } else {
          draftRev.current = 0
          // The mark this form set for a sign-in counts for as long as the stored one would (DRAFT_TTL_MS).
          if (adoptAt.current && Date.now() - adoptAt.current < DRAFT_TTL_MS) {
            // The sign-in this form opened for these answers landed: they are this account's now — saved at once, so the
            // dashboard row is there even if the teacher stops here.
            savedT.current = null
            savedStep.current = null
            sentStep.current = null
          } else if (loadFailedRef.current && loadFailedT.current !== null && (shown !== loadFailedT.current || shownStep !== loadFailedStep.current)) {
            // Recovered after a failed load: what the teacher changed meanwhile is theirs — saved now, never left behind.
            savedT.current = null
            savedStep.current = null
            sentStep.current = null
          } else {
            // Answers on the page that this form did not sign in for: saved only once the teacher moves to another step.
            savedT.current = shown
            savedStep.current = shownStep
            sentStep.current = shownStep
            heldBack.current = shown !== EMPTY_TEACHER
          }
        }
        // Decided, once: the mark goes either way (a later sign-in in this tab adopts nothing).
        adoptAt.current = null
        clearStoredSignIn()
        setSignInReturn(false)
        setLoadFailed(false)
        setDraftLoaded(true)
      })
      .catch((e: { status?: number }) => {
        if (!alive) return
        if (loadFailedT.current === null) { loadFailedT.current = tRef.current; loadFailedStep.current = draftStepRef.current }
        setLoadFailed(true)
        // Offline, slow, the server failing: nothing is saved from this tab yet — it says so, and asks again. An ended
        // session says "You are signed out" with "Sign in again" (commit gate, round 9-10); a sign-in — there or in
        // another tab — is picked up by the next try, or at once when this tab sees it (sessionLostFor, below).
        if (e?.status === 401) {
          failedWhy.current = 'session'
          sessionLostFor.current = userRef.current
          setDraftState('failed')
          setSignInReturn(false)
        }
        // Asked again — less often each time (30s, 1, 2, 4… up to 10 minutes): an abandoned tab never polls (round 13).
        again = setTimeout(() => setLoadTry((n) => n + 1), Math.min(DRAFT_RETRY_MS * 2 ** loadBackoff.current, 10 * 60_000))
        loadBackoff.current++
      })
      .finally(() => clearTimeout(slow))
    return () => { alive = false; clearTimeout(slow); ctl.abort(); if (again) clearTimeout(again) }
  }, [mode, draftHost, uid, authLoading, draftLoaded, loadTry, setT])
  // Signed out with a restored mark: an abandoned sign-in (Google left half-way) — the mark goes, the answers stay. A
  // session that lands a moment late (the callback's cookie) gets a few seconds first (commit gate, opus 2026-10-11).
  useEffect(() => {
    if (authLoading || uid || !restoredSignIn.current) return
    if (signInAsked.current) return // this page opened a sign-in itself: its own mark (adoptAt) decides
    const drop = setTimeout(() => {
      // Signed in meanwhile, or a new sign-in opened here (its own mark): nothing to drop (commit gate, opus round 11).
      if (uidRef.current || signInAsked.current) return
      restoredSignIn.current = null
      clearStoredSignIn()
      setSignInReturn(false)
    }, 5_000)
    return () => clearTimeout(drop)
  }, [authLoading, uid])
  // Save on every step change not yet attempted (and the adoption or "use these" save, which clears `sentStep`).
  useEffect(() => {
    if (lastSeenStep.current !== draftStep) {
      lastSeenStep.current = draftStep
      if (saveQ.current.inFlight) movedDuringSave.current = true
    }
    if (!draftOn || t === EMPTY_TEACHER) return
    if (draftStep !== sentStep.current) void saveDraftRef.current()
  }, [t, draftStep, draftOn])
  // A tab sent to the background (an app switch on a phone — often the last moment before it is closed): what is unsaved
  // goes once, through the same one-at-a-time queue — no keepalive, nothing sent beside a save already on its way.
  useEffect(() => {
    if (!draftOn) return
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden' || saveQ.current.inFlight || nothingToSave(tRef.current)) return
      if (tRef.current !== savedT.current || draftStepRef.current !== savedStep.current) void saveDraftRef.current()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [draftOn])
  // ⛔ UNMOUNTED (a sign-out or another account remounts the form — TeacherForm): nothing of this form fires afterwards.
  // A save on its way is cut off and can schedule no retry, which would otherwise send the previous teacher's answers
  // under whoever is signed in next (commit gate, codex 2026-10-11).
  // (A `mounted` flag, not `halted`: development's StrictMode runs this cleanup once and mounts again.)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      saveQ.current.gen++
      saveAbort.current?.abort()
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [])
  /**
   * The saved draft replaced different answers on the page: bring those back — and where they were (never past their own
   * first failing step) — saved over it now. A save already on its way is let finish (its revision counts).
   */
  const useMine = () => {
    if (!pageAnswers) return
    // ⛔ Over the saved draft, as "Review these answers" does (reviewPart): step 1 as a whole, the later steps only where
    // these answers hold one — a hand-off is step 1 only, and set whole it would empty the saved name, headline and
    // bio, and save that (commit gate, opus round 15).
    const mine = mergeReview(tRef.current, pageAnswers.t)
    setT(mine)
    savedT.current = null
    savedStep.current = null
    sentStep.current = null
    setResumeTo(null)
    setStepKey(draftResumeStep(mine, pageAnswers.step).step)
    setPageAnswers(null)
  }
  /** Another tab or device saved since: take the saved answers, or keep these (saving them over it). */
  const resolveStale = async (keep: boolean) => {
    let row: { t: unknown; step: unknown; rev: number; gen: string } | null
    try {
      const r = await draftFetch(DRAFT_URL, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      row = ((await r.json()) as { draft?: { t: unknown; step: unknown; rev: number; gen: string } | null })?.draft ?? null
    } catch {
      // Nothing known: the choice stays on the screen — never a silent "keep" (commit gate, 2026-10-11).
      setFormError(tr('Could not reach your saved profile — please try again.', 'Không thể tải hồ sơ đã lưu — vui lòng thử lại.'))
      return
    }
    const q = saveQ.current
    q.gen++
    refused.current = false
    setFormError('')
    setPageAnswers(null)
    setResumeTo(null)
    if (!keep && !row) {
      // Deleted elsewhere since (started over, published, expired): said — never brought back unasked (commit gate).
      refused.current = true
      setDraftState('gone')
      return
    }
    draftRev.current = row?.rev ?? 0
    draftGen.current = row?.gen ?? null
    if (!keep && row) {
      const loaded: TeacherInput = { ...fromDraft(row.t), phone: tRef.current.phone }
      setT(loaded)
      savedT.current = loaded
      const back = draftResumeStep(loaded, row.step).step
      savedStep.current = back
      sentStep.current = back
      setStepKey(back)
      setDraftState('saved')
      return
    }
    // Keep these: saved over it now (the teacher's own choice).
    savedT.current = null
    savedStep.current = null
    sentStep.current = null
    setDraftState('')
  }
  /** Saved elsewhere then deleted (published, started over, expired): keep what is on screen as a new draft. */
  const saveAgain = () => { refused.current = false; draftRev.current = 0; draftGen.current = null; savedT.current = null; savedStep.current = null; sentStep.current = null; setDraftState('') }
  /** "Start over": the saved draft and this tab's copy go, and the form opens empty. */
  const startOver = async () => {
    setConfirmStartOver(false)
    if (busy) return // a publish on its way decides first
    // Busy while it runs: no Publish (and no second Start over) beside it (commit gate, opus 2026-10-11).
    setBusy('saving')
    try { await startOverNow() } finally { setBusy('') }
  }
  const startOverNow = async (failLine = tr('Could not start over — please try again.', 'Không thể bắt đầu lại — vui lòng thử lại.')) => {
    const q = saveQ.current
    // A save on its way LANDS first (its revision counts — commit gate, 2026-10-11) and so never after the delete; no
    // other save starts while the delete is on its way. A delete that fails leaves everything as it was, retry included.
    halted.current = true
    if (q.inFlight) await q.inFlight.catch(() => {})
    // A save cut off earlier may have landed: the delete names the revision the account really holds (reconcileLost) —
    // and when that cannot be known, nothing is deleted (below: "Could not start over").
    const known = (await reconcileLost()) === true
    let gone = false
    if (known) try {
      const rev = draftRev.current ?? 0
      const gen = draftGen.current
      // A saved revision with no generation to name it by: it cannot be deleted safely — "Could not start over".
      if (rev > 0 && !gen) throw new Error('no generation')
      // Nothing saved yet: nothing to delete on the server.
      const r = rev > 0 && gen
        ? await draftFetch(`${DRAFT_URL}?rev=${rev}&gen=${encodeURIComponent(gen)}`, { method: 'DELETE' }, DRAFT_SAVE_TIMEOUT_MS)
        : new Response('{}', { status: 200 })
      if (r.status === 409) {
        // A newer revision was saved elsewhere since this tab loaded: not deleted unseen — the choice is asked.
        halted.current = false
        refused.current = true
        setStaleWhy('elsewhere')
        setDraftState('stale')
        return
      }
      gone = r.ok
    } catch { /* below */ }
    if (!gone) {
      halted.current = false
      setFormError(failLine)
      // Nothing changed — and saving goes on: what a retry or a save waiting on the pause would have sent goes now.
      if (!refused.current && (tRef.current !== savedT.current || draftStepRef.current !== savedStep.current)) void saveDraftRef.current()
      return
    }
    q.gen++
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null }
    halted.current = false
    refused.current = false
    clearStored()
    adoptAt.current = null
    draftRev.current = 0
    draftGen.current = null
    savedT.current = EMPTY_TEACHER
    savedStep.current = null
    // The empty form is saved when the teacher moves on from its first step — never on the first answer typed.
    sentStep.current = PRE_SIGNIN_STEPS[0]
    setT(EMPTY_TEACHER)
    setErrors({})
    setFormError('')
    setDistrictNotSaying(false)
    setResumeTo(null)
    setStepKey(PRE_SIGNIN_STEPS[0])
    setDraftState('')
    setPageAnswers(null)
    // A reading started over from is gone with its answers: its phone and file are no longer offered.
    setLastImport(null)
    heldBack.current = false
    if (uid) revalidateDashboard(uid)
  }

  // ── "Fill it in from my CV" (2026-10-15): apply, undo, carry on ──────────────────────────────────────────────────────
  /**
   * A reading arrived: ⛔ ONLY EMPTY ANSWERS ARE FILLED (mergeImport) — whatever the teacher gave, now or in their saved
   * draft, stays — and what it filled is saved at once (the reading was the teacher's act; the line under the title and
   * the summary say whether the save landed).
   * ⛔ THE PHONE AND THE FILE ARE FILLED TOO, NOT OFFERED (owner, 2026-10-16: "the cv info like number and cv itself
   * stays as default they dont have to click again to use it just autofill as much as possible"): the CV's number into
   * an EMPTY phone field (never over the account's own, or one typed), and the PDF as the profile's private CV when none
   * is attached or saved — the reading notice says both, the summary names them, and the last step changes or removes
   * either. The phone never reaches the draft (draft.ts); the file is uploaded only by Publish.
   */
  /** A PDF, by type or — an empty type from some pickers — by name: the only CV the upload takes. */
  const isPdfFile = (f: File) => f.type === 'application/pdf' || (!f.type && /\.pdf$/i.test(f.name))
  const applyImport = (r: ImportResult, file: File | null) => {
    const before = tRef.current
    const merged = mergeImport(before, r.fields)
    const filled = merged.filled
    // Only a number the form itself would accept (gate review: a malformed one would stop Publish on a field the teacher
    // never typed in), and only a PDF as the CV — the CV upload takes PDFs alone. (The panel hands over a file only for a
    // PDF already — prepareImport's `keep`; this holds whatever a later caller passes.)
    const phoneAdded = !!r.phone && isTeacherPhone(r.phone) && !before.phone.trim()
    const cvAttached = !!file && isPdfFile(file) && !cvFile && !cvName
    setLastImport({ ...r, filled, before: Object.fromEntries(filled.map((k) => [k, before[k]])) as Partial<TeacherInput>, file, phoneAdded, cvAttached })
    if (cvAttached) setCvFile(file)
    const next = phoneAdded ? { ...merged.next, phone: r.phone ?? '' } : merged.next
    if (!filled.length) { if (phoneAdded) setT(next); return }
    setT(next)
    clearErrorsFor(filled)
    // Saved now — unless answers the account has not taken are on the page (heldBack): then, as for any answers, when the
    // teacher moves on from a step with them on screen.
    if (heldBack.current) return
    savedT.current = null
    savedStep.current = null
    sentStep.current = null
  }
  /**
   * Undo: each imported answer the teacher has not changed goes back to what it was. ⛔ When that leaves nothing to save
   * (a first reading, undone), the account's saved draft is DELETED — Start over's own path, which first lets a save on
   * its way land — never left holding the answers the teacher just took back (a wrong file can be someone else's CV).
   */
  const undoLastImport = async () => {
    const li = lastImport
    if (!li || busy) return
    let back = undoImport(tRef.current, li.fields, li.filled, li.before)
    // The phone and the CV the reading added go back with it — unless the teacher changed them since.
    if (li.phoneAdded && back.phone === li.phone) back = { ...back, phone: '' }
    if (li.cvAttached && cvFile === li.file) setCvFile(null)
    if (nothingToSave(back)) {
      setBusy('saving')
      setUndoing(true)
      setFormError('')
      try { await startOverNow(tr('Could not undo — please try again.', 'Không hoàn tác được — vui lòng thử lại.')) } finally { setBusy(''); setUndoing(false) }
      // Not deleted: a failure says so on the panel; a newer save elsewhere (409) leaves the choice on the summary.
      if (tRef.current !== EMPTY_TEACHER) return
      screenSwitched.current = true
      setLastImport(null)
      return
    }
    screenSwitched.current = true
    setLastImport(null)
    if (back === tRef.current) return
    setT(back)
    // ⛔ Not forced into the account while answers it has not taken are on the page (heldBack) — the reading never
    // carried them, and neither does taking it back (gate review, 2026-10-16).
    if (heldBack.current) return
    savedT.current = null
    savedStep.current = null
    sentStep.current = null
  }

  // ── "Improve with AI" under the About text (owner, 2026-10-21: "once they write about them use ai … it should read all
  // teacher info that was inputed and description they have and enhance it in short concise but very effective form") ──
  /**
   * POST /api/teachers/me/bio-rewrite — Gemini on Vertex rewrites the teacher's own About text from their answers
   * (bio-context.ts, bio-ai.ts). It saves nothing: the answer only replaces the text on the page through set(), exactly
   * like typing — so it reaches the draft on the next step change (join) or the profile on "Save changes" (edit).
   *   · BUSY FIRST, THEN THE QUESTION (the post wizard's rule — codex, review): a double tap never sends twice, and in the
   *     apps the Google AI question (family `teacher_bio`) comes before anything leaves; "Not now" sends nothing.
   *   · ⛔ THE TEXT SENT IS THE TEXT REPLACED: the field is read-only and the bar's primary waits while it runs, and the
   *     answer lands only for the current tap, on this mounted form, with About on screen and the text still the one
   *     sent — anything else (another writer, Start over, another account) drops it unseen. Leaving About lets it go.
   *   · The notice's words go as the page SHOWED them (`shown`, the CV reader's hash) with the version it showed: the
   *     server records the consent before anything reaches Google, and refuses another version (409 notice_changed).
   */
  const improveBio = async () => {
    if (!bioAiOn || bioBusy.current || busy !== '') return
    // Signed out since About rendered (the session dropped mid-form): said, never a dead tap (gate review, 2026-10-22).
    if (!uid) { setBioError('session'); return }
    const sentT = tRef.current
    const sent = sentT.bio
    if (sent.trim().length < BIO_OWN_TEXT_MIN) return
    const answers = bioRewriteAnswers(sentT)
    const sentKey = JSON.stringify(answers)
    bioBusy.current = true
    setBioWorking(true)
    setBioError('')
    // The ticket comes with the busy flag, before the question: a tap let go while it waits (leaving About) stays let go.
    const ticket = ++bioSeq.current
    const mine = () => ticket === bioSeq.current && mounted.current
    try {
      if (aiConsentNeeded('teacher_bio', uid) && !(await askAiConsent('teacher_bio', { userId: uid }))) return
      // The words beside the button, in the order shown (bio-notice.ts BIO_NOTICE_PARTS), in the page's language.
      const shown = await shownHash([BIO_ACTION_LABEL, ...BIO_NOTICE].map((p) => tr(p.en, p.vi)).join('\n'))
      if (!mine()) return
      const ctl = new AbortController()
      bioAbort.current = ctl
      const slow = setTimeout(() => ctl.abort(), BIO_GIVE_UP_MS)
      try {
        const res = await fetch(BIO_REWRITE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ t: answers, lang, notice: TEACHER_BIO_NOTICE_VERSION, ...(shown ? { shown } : {}) }),
          signal: ctl.signal,
        })
        const d = (await res.json().catch(() => ({}))) as { bio?: unknown; error?: unknown }
        if (!mine() || !aboutShown.current || tRef.current.bio !== sent) return
        // …and only the bio is read-only while it runs: an answer written from a headline, a nationality or a language
        // changed meanwhile would state the old one (gate review, codex 2026-10-22) — said, and the next tap sends the new.
        if (JSON.stringify(bioRewriteAnswers(tRef.current)) !== sentKey) { setBioError('changed'); return }
        // ⛔ Never the teacher's own text handed back as a rewrite (the rephrase route's fake success — bio-context.ts):
        // an answer identical to what was sent is said as "couldn't improve", never as "Rewritten with AI".
        if (res.ok && typeof d.bio === 'string' && d.bio.trim() && d.bio !== sent) {
          const after = d.bio
          set('bio', after)
          // A rewrite of the AI's own text keeps the teacher's words as Undo's target — never the first AI answer.
          setBioUndo((prev) => ({ before: prev && prev.after === sent ? prev.before : sent, after }))
          return
        }
        setBioError(bioErrorOf(res.status, d.error))
      } catch {
        // Offline or cut off — or no answer within BIO_GIVE_UP_MS (the abort above): the connection was fine and the AI was
        // not, so that one is said as "not available right now" (gate review, opus 2026-10-22).
        if (mine()) setBioError(ctl.signal.aborted ? 'unavailable' : 'network')
      } finally {
        clearTimeout(slow)
        if (bioAbort.current === ctl) bioAbort.current = null
      }
    } finally {
      // Released when THIS request settles — one at a time (bioBusy), so a tap let go by leaving About is released here
      // too, never earlier: the server holds its own lock until the model has answered.
      bioBusy.current = false
      if (mounted.current) { setBioWorking(false); setBioSettling(false) }
    }
  }
  /** Undo: the teacher's own text back — only while the text is still the AI's (an edit since is their newer word). */
  const undoBio = () => {
    const u = bioUndo
    if (!u) return
    if (tRef.current.bio === u.after) set('bio', u.before)
    setBioUndo(null)
  }
  // The About text changed some other way (typed, pasted, a reloaded draft, Start over): the rewrite's Undo and a refusal's
  // line were about a text that is no longer there — both go (gate review, codex 2026-10-22: a stale Undo came back once
  // the text matched the AI's again; "Write a little more first" stayed after the teacher had). A rewrite landing keeps
  // its Undo (`after` is the text) and clears the line, as a tap does.
  useEffect(() => {
    setBioUndo((u) => (u && t.bio !== u.after ? null : u))
    setBioError('')
  }, [t.bio])
  // Leaving About (another step, or the CV reader in its place) with a rewrite on its way lets its ANSWER go — it lands on
  // About alone — and frees the bar's primary, which must not stay disabled on another step. ⛔ The request itself is NOT
  // aborted and the tap stays held until it settles (bioSettling): the server is still working under its one-at-a-time
  // lock, and a tap meanwhile would only spend the teacher's hourly rewrites on a 429 (gate review, 2026-10-21).
  useEffect(() => {
    if (aboutOnScreen) return
    setBioError('')
    if (!bioBusy.current) return
    bioSeq.current++
    setBioWorking(false)
    setBioSettling(true)
  }, [aboutOnScreen])
  // Unmounted (a sign-out or another account — TeacherForm): a rewrite on its way is cut off, and its answer dropped.
  useEffect(() => () => { bioSeq.current++; bioAbort.current?.abort() }, [])

  // The teacher.eno.vn hand-off arrived complete and signed out: the sign-in opens, ONCE (closing it leaves "Sign in" on
  // the step it sits on).
  useEffect(() => {
    if (!handoffArrived || authLoading || uid || signInAsked.current) return
    signInAsked.current = true
    // ⛔ A hand-off is adopted at sign-in only when it carries no words of its own — what teacher.eno.vn sends now (step
    // 1: choices, no text). One with a name, headline or bio (an older tab's four steps, or a crafted link) is saved only
    // once the teacher moves on with it (commit gate, opus 2026-10-11).
    adoptAt.current = teacherFreeTextFields(tRef.current).some(([, text]) => text.trim()) ? null : Date.now()
    writeStoredDraft(tRef.current, draftStepRef.current, { signIn: adoptAt.current })
    if (adoptAt.current) setSignInReturn(true)
    openSignIn({ note: signInNote(), onDismiss: dropAdoption })
  }, [handoffArrived, authLoading, uid, openSignIn]) // once per arrival (signInNote is copy; dropAdoption reads refs)

  // ── Edit: load the saved profile ───────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'edit' || authLoading) return
    if (!uid) { setLoaded(true); return }
    let alive = true
    const ticket = ++markSeq.current
    fetch('/api/teachers/me')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        if (d?.publishGate) setPublishGate(d.publishGate)
        setBioAiOn(d?.bioAi === true)
        // The "Identity verified" switch as stored — ON unless the teacher hid it (markFromMe: the server's own flag).
        if (ticket === markSeq.current) setMark(markFromMe(d))
        const tp = d?.teacher
        if (!tp) {
          setNoProfile(true)
          setLoaded(true)
          // An unfinished one is saved to this account: the screen offers it back rather than a fresh start (2026-10-11).
          fetch('/api/teachers/me/draft', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
            .then((x: { draft?: unknown } | null) => { if (alive && x?.draft) setNoProfileDraft(true) }).catch(() => {})
          return
        }
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
          // ⛔ A copy written under another account is never reviewed into this one (commit gate, round 15).
          if (stored && (!stored.owner || stored.owner === uid)) {
            const before = next
            next = mergeReview(next, fromDraft(stored.t))
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
        setSavedHadCv(!!tp.cvFileName)
        setPrivateVideo(tp.hasPrivateVideo === true)
        setVideoBase(typeof tp.videoVersion === 'number' ? tp.videoVersion : null)
        setSavedPublicUrl(tp.videoUrl ?? null)
        setSavedPhotoUrl(typeof tp.photoUrl === 'string' ? tp.photoUrl : null)
        setProfileCreatedAt(typeof tp.createdAt === 'string' ? tp.createdAt : null)
        setSavedHadVideo(!!tp.videoUrl || tp.hasPrivateVideo === true)
        setPhotoAsk(d?.photoAsk && typeof d.photoAsk.reason === 'string' ? d.photoAsk : null)
        setTeacherProfileId(typeof tp.id === 'string' ? tp.id : null)
        setStatus(tp.status === 'hidden' ? 'hidden' : 'live')
        setListingLive(tp.listingLive !== false)
        setSearchHidden(tp.hideFromSearch === true)
        setProfileListingId(typeof tp.listingId === 'string' ? tp.listingId : null)
        setPublicAs({ fullName: typeof tp.fullName === 'string' ? tp.fullName : '', headline: typeof tp.headline === 'string' ? tp.headline : '' })
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
    if (mode === 'join' && hydrated.current && !done && t !== EMPTY_TEACHER) {
      // No base while a conflict is open: a reload must never "win" a choice the teacher has not made (commit gate).
      writeStoredDraft(t, resumeTo ?? stepKey, {
        // A mark restored from the round trip stays in the copy until it is decided (adopted, or dropped after the grace):
        // a second reload meanwhile still adopts (commit gate, opus round 16).
        districtNotSaying, signIn: adoptAt.current ?? restoredSignIn.current, owner: uid,
        base: uid && draftRev.current && draftGen.current && !refused.current ? { uid, rev: draftRev.current, gen: draftGen.current } : null,
      })
    }
    // draftState / draftLoaded: a save or the load that moved the revision re-stamps this copy's base (commit gate).
  }, [t, stepKey, resumeTo, mode, done, districtNotSaying, uid, draftState, draftLoaded])

  // /join with a profile already: saving here would overwrite it, so it is offered Edit instead. With no profile: what
  // the account can offer the form, and whether it may publish now.
  useEffect(() => {
    if (mode !== 'join' || !uid) return
    let alive = true
    const ticket = ++markSeq.current
    // The doors wait for this answer (doorWaits) — never for long: a slow one lets them show (the answer still lands).
    const slow = setTimeout(() => { if (alive) setMeKnown(true) }, DRAFT_LOAD_TIMEOUT_MS)
    let answered = false
    fetch('/api/teachers/me').then((r) => { answered = r.ok; return r.json() }).then((d) => {
      if (!alive) return
      if (d?.publishGate) setPublishGate(d.publishGate)
      setBioAiOn(d?.bioAi === true)
      // No profile yet: the switch is held on this page (joinMarkHidden — its endpoint needs a profile), and the line says
      // what would hold the mark back.
      if (ticket === markSeq.current) setMark(markFromMe(d))
      if (d?.teacher) setExisting(true)
      else if (d?.prefill) setPrefill(d.prefill)
      setMeKnown(true)
      if (answered) setMeReadFor(uid)
    }).catch(() => { if (alive) setMeKnown(true) })
    // A new read (a sign-out, a sign-in — even back into the same account) forgets the last answer: only THIS one counts.
    return () => { alive = false; clearTimeout(slow); setMeReadFor(null) }
  }, [mode, uid])

  // ── Join: the account's own name, phone and photo fill EMPTY answers (owner, 2026-10-16: "autofill as much as possible
  // … make teacher onboarding with less clicks") ─────────────────────────────────────────────────────────────────────
  // Once, when the form itself is on screen (after a CV reading, whose answers come first) and the saved draft is in:
  // only what is still empty, never over an answer. The name only when it reads as a person's name (an account named by
  // its email or a handle is left to the teacher); the photo only when it is stored on eno (prefill) — and it then goes
  // through the photo check like any photo. All three stay the teacher's to change on their step.
  const prefillApplied = useRef(false)
  /** The account photo this autofill put in — never sent for the early check (it is checked by Publish, the teacher's act). */
  const prefilledPhoto = useRef<string | null>(null)
  useEffect(() => {
    // After the saved draft has loaded (or failed to — the tab's own copy then stands): a draft arriving later would
    // replace the answers this fills.
    if (mode !== 'join' || !prefill || prefillApplied.current || door !== 'self' || (!!uid && !draftLoaded && !loadFailed)) return
    prefillApplied.current = true
    const cur = tRef.current
    const patch: Partial<TeacherInput> = {}
    const name = (prefill.displayName ?? '').replace(/\s+/g, ' ').trim()
    if (!cur.fullName.trim() && /^[\p{L}\p{M}][\p{L}\p{M}'’.-]*(?: [\p{L}\p{M}][\p{L}\p{M}'’.-]*)+$/u.test(name)) patch.fullName = name.slice(0, LIMITS.name)
    // Only a number the form itself accepts — an old stored one in another shape would stop Publish on a field the teacher
    // never typed in (gate review, 2026-10-16).
    if (!cur.phone.trim() && prefill.phone && isTeacherPhone(prefill.phone)) patch.phone = prefill.phone
    if (!cur.photoUrl && prefill.avatarUrl) { patch.photoUrl = prefill.avatarUrl; prefilledPhoto.current = prefill.avatarUrl }
    if (Object.keys(patch).length) setT({ ...cur, ...patch })
  }, [mode, prefill, door, uid, draftLoaded, loadFailed, setT])

  /** The texts of one screened field as the server read them (what a save keeps) — to find the teacher's own refused words. */
  const fieldTexts = (key: string): string[] => teacherFreeTextFields(normalizeForSave(t)).filter(([f]) => f === key).map(([, text]) => text)
  const publishErrText = (code: string, texts?: readonly string[]): string => {
    if (code === 'contact_in_text' || code === 'contact_in_name') return tr('Please remove phone numbers, emails and links from your profile text — the person you are chatting with gets your contact only when you share it in that chat.', 'Vui lòng xoá số điện thoại, email và liên kết khỏi hồ sơ — người đang trò chuyện với bạn chỉ nhận được liên hệ khi bạn chia sẻ trong tin nhắn với họ.')
    // "Shown under the field" only when they are (review, 2026-10-21): an older tab or a reading the browser cannot
    // reproduce finds no words, and then the line is the one it always was.
    if (code === 'banned_words') {
      return texts && teacherRefusedWords(code, texts).length
        ? tr('Some words in your profile can’t be published — they’re shown under the field. Please rephrase them.', 'Một số từ trong hồ sơ không thể đăng — xem ngay dưới mục đó. Vui lòng viết lại.')
        : tr('Your profile contains a word we do not allow. Please rephrase.', 'Hồ sơ có từ không được phép. Vui lòng viết lại.')
    }
    if (code === 'account_restricted') return tr('Your account cannot publish right now.', 'Tài khoản của bạn hiện chưa thể đăng.')
    if (code.startsWith('identity_')) return tr('Please verify your identity in Account settings before publishing.', 'Vui lòng xác minh danh tính trong Cài đặt tài khoản trước khi đăng.')
    if (code === 'rate_limited') return tr('Too many saves — please wait a few minutes.', 'Lưu quá nhiều lần — vui lòng đợi vài phút.')
    // A step of the account's own setup is still open (the phone, once required — api/teachers/me PUT).
    if (code === 'onboarding_required') return tr('Please finish setting up your account in Account settings, then publish.', 'Vui lòng hoàn tất thiết lập tài khoản trong Cài đặt tài khoản, rồi đăng.')
    // A notice beside a consent changed while this page was open: its words must be read again (409 notice_changed).
    if (code === 'notice_changed') return tr('Some of the wording on this page has changed since you opened it. Reload the page to read it, then save again.', 'Một số nội dung trên trang đã thay đổi kể từ khi bạn mở. Hãy tải lại trang để đọc, rồi lưu lại.')
    // Join mode loaded no saved video either: the server refuses a change over a stored one (video.ts, no base).
    if (code === 'video_changed' && mode === 'join') return tr('You already have a teacher profile. Open it from your account (Teacher profile) to make changes.', 'Bạn đã có hồ sơ giáo viên. Hãy mở hồ sơ trong tài khoản (Hồ sơ giáo viên) để chỉnh sửa.')
    if (code === 'video_store_failed') return tr('Your intro video could not be saved just now. Please try again.', 'Chưa lưu được video giới thiệu. Vui lòng thử lại.')
    // The profile photo check could not run just now (2026-10-16): never the photo's fault — the answers stay.
    if (code === 'photo_check_unavailable') return tr('We couldn’t check your photo just now. Please try again in a minute.', 'Chưa kiểm tra được ảnh của bạn. Vui lòng thử lại sau một phút.')
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
    if (busy !== '') return // one upload at a time — see uploadVideo
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
  const videoPrepText = (e: TeacherVideoPrepError): string => {
    switch (e) {
      case 'type': return tr('Choose an MP4, MOV or WebM video.', 'Hãy chọn video MP4, MOV hoặc WebM.')
      // A phone's default 1080p minute is 60–100 MB (src/lib/video-compress.ts), so 150 MB holds 1½–2½ minutes of it; 720p
      // roughly doubles that. A full five minutes from a phone's camera is over the limit either way (owner, 2026-10-18: the
      // size limit stays) — it fits once an app has made it smaller.
      case 'too_big': return tr('That video is over 150 MB. Make it shorter, or record it in 720p.', 'Video trên 150 MB. Hãy làm video ngắn hơn, hoặc quay ở 720p.')
      case 'too_long': return tr('Your intro video must be 5 minutes or less.', 'Video giới thiệu phải dài tối đa 5 phút.')
      case 'unreadable': return tr('We couldn’t read that video — try another one.', 'Không đọc được video này — hãy thử video khác.')
      case 'cannot_compress': return tr('That video is over 50 MB and this browser can’t make it smaller. Record it in 720p, or open eno.vn in Chrome or Safari.', 'Video trên 50 MB và trình duyệt này không thu nhỏ được. Hãy quay ở 720p, hoặc mở eno.vn bằng Chrome hoặc Safari.')
      case 'no_picture': return tr('This browser can’t read the picture in that video, so it can’t make it smaller. Record it in 720p, or try another browser.', 'Trình duyệt này không đọc được hình ảnh trong video nên không thể thu nhỏ. Hãy quay ở 720p, hoặc thử trình duyệt khác.')
      case 'interrupted': return tr('Making the video smaller stopped because the page was left. Keep this page open on screen until it’s done — it takes about as long as the video.', 'Việc thu nhỏ video đã dừng vì bạn rời khỏi trang. Hãy giữ trang này mở trên màn hình cho đến khi xong — mất khoảng bằng độ dài video.')
      default: return tr('We couldn’t make that video smaller — try a shorter or lower-quality one.', 'Không thu nhỏ được video — hãy thử video ngắn hơn hoặc chất lượng thấp hơn.')
    }
  }
  /**
   * The intro video (required for a new profile since 2026-10-16): read its length, make a clip over the 50 MB storage
   * ceiling smaller in the browser, flag an iPhone (HEVC) clip so its transcode fails closed — video-prep.ts, the post
   * wizard's rules — then upload.
   */
  const uploadVideo = async (file: File) => {
    // One upload at a time (gate review, 2026-10-16): a second pick while a video — or the photo — is compressing or
    // uploading would race it (one `busy` for both) and leave an upload nobody chose. The pickers are disabled meanwhile.
    if (busy !== '') return
    // The new profile's way to Publish, counted (signup-prompt.ts video_*): chosen → turned down here / failed / uploaded —
    // only once /api/teachers/me has said this account has no profile yet (meRead).
    const counting = mode === 'join' && !existing && meRead
    if (counting) countTeacherFormEvent('video_picked')
    setBusy('video'); setFormError('')
    try {
      const prepared = await prepareTeacherVideo(file, { onCompress: (f) => setVideoProgress(f) })
      if ('error' in prepared) { if (counting) countTeacherFormEvent('video_refused'); setFormError(videoPrepText(prepared.error)); return }
      setVideoProgress(null)
      const url = await uploadListingVideo(prepared.file, { hevc: prepared.hevc, kind: 'teacher_intro' })
      if (!url) throw new Error('video')
      setConfirmVideoRemove(false)
      set('videoUrl', url)
      if (counting) countTeacherFormEvent('video_uploaded')
    } catch (e) {
      // A clip whose length this browser could not read, found over five minutes by the server (video-upload-client.ts).
      if (e instanceof Error && e.message === 'video_too_long') {
        if (counting) countTeacherFormEvent('video_refused')
        setFormError(videoPrepText('too_long'))
        return
      }
      // Too many tries this hour, or the server asked to try again (video-upload-client.ts) — "later", not "in a few minutes":
      // the hour's limit can hold for up to an hour (gate review, 2026-10-18).
      if (e instanceof Error && e.message === 'video_busy') {
        if (counting) countTeacherFormEvent('video_failed')
        setFormError(tr('Video uploads are busy right now — please try again later.', 'Hệ thống tải video đang bận — vui lòng thử lại sau.'))
        return
      }
      if (counting) countTeacherFormEvent('video_failed')
      setFormError(tr('Video upload failed. Please try again — keep it under 5 minutes.', 'Tải video thất bại. Vui lòng thử lại — giữ dưới 5 phút.'))
    } finally { setBusy(''); setVideoProgress(null) }
  }
  /**
   * An EDIT's picked CV, uploaded AFTER its save (the route attaches it at once, replacing the saved one). ⛔ Never throws
   * (2026-10-21): a network error here used to land in publish()'s catch — "Something went wrong" over a save that had gone
   * through. A failure is the form's line, on the done screen.
   */
  const uploadCv = async (file: File): Promise<boolean> => {
    try {
      const form = new FormData(); form.append('file', file)
      const res = await fetch('/api/teachers/me/cv', { method: 'POST', body: form })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(d.error === 'cv_type' ? tr('Your CV must be a PDF.', 'CV phải là tệp PDF.') : d.error === 'cv_size' ? tr('Your CV must be 10 MB or smaller.', 'CV phải có dung lượng tối đa 10 MB.') : tr('CV upload failed.', 'Tải CV thất bại.'))
        return false
      }
      setCvName(d.cvFileName ?? file.name); setCvFile(null); setSavedHadCv(true)
      return true
    } catch {
      setFormError(tr('CV upload failed.', 'Tải CV thất bại.'))
      return false
    }
  }
  /**
   * ⛔ A NEW PROFILE'S CV GOES UP BEFORE ITS PUBLISH (owner, 2026-10-21: "they should include cv") — POST
   * /api/teachers/me/cv?pending=1: stored and tombstoned by the server, answered with a token the Publish names, and attached
   * by the save that creates the profile (publish.ts) — so a profile is never created without it. The SAME File within
   * CV_PENDING_REUSE_MS reuses its token: a Publish refused for something else (the photo check, a word) and tapped again
   * uploads nothing twice, well inside the hour the server keeps an unclaimed upload (TOMBSTONE_GRACE_MS). Never throws.
   */
  const pendingCv = useRef<{ file: File; token: string; fileName: string; at: number } | null>(null)
  const uploadPendingCv = async (file: File): Promise<{ token: string; fileName: string } | { error: 'type' | 'size' | 'rate' | 'busy' | 'upload_failed' }> => {
    const kept = pendingCv.current
    if (kept && kept.file === file && Date.now() - kept.at < CV_PENDING_REUSE_MS) return kept
    pendingCv.current = null
    // Its age counts from BEFORE the request: the server's clock started when it wrote the tombstone, before the upload.
    const at = Date.now()
    try {
      const form = new FormData(); form.append('file', file)
      const res = await fetch('/api/teachers/me/cv?pending=1', { method: 'POST', body: form })
      const d = await res.json().catch(() => ({})) as { cvUpload?: unknown; cvFileName?: unknown; error?: unknown }
      if (res.ok && isCvUploadToken(d.cvUpload)) {
        const up = { file, token: d.cvUpload, fileName: typeof d.cvFileName === 'string' && d.cvFileName ? d.cvFileName : file.name, at }
        pendingCv.current = up
        return up
      }
      // A 429 is the ACCOUNT's upload limit (the route's own and its pending mode's), said as such — "try again" would only
      // spend more of it; cv_capacity is the connection's day cap, said as "busy on this network" (commit gate, 2026-10-22).
      return { error: d.error === 'cv_type' ? 'type' : d.error === 'cv_size' ? 'size' : d.error === 'cv_capacity' ? 'busy' : res.status === 429 ? 'rate' : 'upload_failed' }
    } catch {
      return { error: 'upload_failed' }
    }
  }
  /**
   * A CV pick, checked as the upload checks it (teacher-form-rules.ts cvPickError — owner, 2026-10-21: the CV is required,
   * so a file that can never go up is said when it is picked, not at Publish). A refused pick is said on the CV section and
   * not kept; a good one clears that line (a pick never goes through set()).
   */
  const pickCv = (file: File) => {
    const why = cvPickError(file)
    if (why) { setErrors((prev) => ({ ...prev, cv: why })); return }
    setCvFile(file)
    clearErrorsFor(['cv'])
  }

  // ── Hand-off, sign-in, publish ──────────────────────────────────────────────────────────────────────────────────
  /** The pre-sign-in step must hold before the account half: what a hand-off or "Sign in" checks first. */
  const preSignInOk = (): boolean => {
    const e = checkSteps(t, PRE_SIGNIN_STEPS)
    // The form's own funnel (signup-prompt.ts TEACHER_FORM_EVENTS): step 1's Continue / Sign in, given or stopped — by a
    // visitor doing step 1 HERE (one who arrived with the hand-off's answers was counted on teacher.eno.vn).
    // …and, with it, the coarse source of the link that brought this page (continue_<source>, from its own address).
    if (!Object.keys(e).length) {
      if (!viaHandoff.current) { countTeacherFormEvent('step1_continue'); countTeacherFormEvent(continueSourceEvent(window.location.search)) }
      return true
    }
    if (!viaHandoff.current) countTeacherFormEvent('step1_blocked')
    refuse(e)
    return false
  }
  const handOff = () => {
    if (!preSignInOk()) return
    // teacher.eno.vn → eno.vn: the fragment carries the draft steps' answers (v2), never a consent; no server sees it.
    // The query: a teacher who came for cover keeps that intent (`goal=cover`), and the campaign tags this address holds
    // (source, medium, campaign) cross with it — the first-visit record is per host.
    const query = [coverIntent ? 'goal=cover' : '', campaignQuery(window.location.search).slice(1)].filter(Boolean).join('&')
    window.location.assign(`${apexOrigin}/teachers/join${query ? `?${query}` : ''}#${TEACHER_DRAFT_HASH_KEY}=${encodeHandoff(t)}`)
  }
  const signInToContinue = () => {
    if (!preSignInOk()) return
    // Where the teacher was (a restored draft's step), else the step after this one — kept in the draft, so a Google round
    // trip lands on it; a code sign-in moves on by itself (the resume effect above). This sign-in is the form's own: these
    // answers may become the account's draft.
    const next = resumeTo && steps.includes(resumeTo) ? resumeTo : afterSignIn(t)
    setResumeTo(next)
    // This page's own sign-in: it supersedes a mark restored from an earlier round trip.
    signInAsked.current = true
    restoredSignIn.current = null
    adoptAt.current = Date.now()
    writeStoredDraft(t, next, { districtNotSaying, signIn: adoptAt.current })
    setSignInReturn(true)
    openSignIn({ note: signInNote(), onDismiss: dropAdoption })
  }

  /** ⚠️ Called with no argument (or `{ hideConfirmed: true }` from the hide dialog) — never handed a click event. */
  const publish = async (opts?: { hideConfirmed?: boolean }) => {
    if (busy) return
    // ⛔ SIGN-IN FIRST: photo, video and CV can only be uploaded signed in, so validating the whole form before this would
    // stop a signed-out teacher on "photo required" with no way forward (agy, commit gate 09-30).
    if (!user) { signInToContinue(); return }
    // A NEW profile's Publish, counted (signup-prompt.ts publish_*): the tap, what the form refused it for, one that did not
    // go through — only once /api/teachers/me has said this account has no profile yet (meRead).
    const counting = mode === 'join' && !existing && meRead
    if (counting) countTeacherFormEvent('publish_tap')
    // Validated as the server will validate it: what a save keeps, every step (profile.ts). ⛔ On an EDIT the goal rule
    // (no work wanted and cover off) never blocks: the save goes through and HIDES the profile — a withdrawal never
    // requires inventing a goal (plan review D6). A new profile with no goal is refused, as the server refuses it.
    const checked = checkSteps(t, TEACHER_STEPS)
    const all = mode === 'edit' ? splitGoalErrors(checked).other : checked
    // …and the texts the server would refuse, refused HERE so the field can show the teacher's own words (2026-10-21).
    for (const [k, v] of Object.entries(textRefusals(t)) as [keyof TeacherErrors, string][]) if (!all[k]) all[k] = v
    // ⛔ THE INTRO VIDEO "FROM NOW ON" (owner, 2026-10-16): a new profile, or one created since the cutoff, has one — a
    // public or a private video — as the server requires (publish.ts). Older profiles keep the old rule.
    if (videoRequired && !t.videoUrl && !privateVideo) all.videoUrl = 'required'
    // ⛔ THE CV "FROM NOW ON" (owner, 2026-10-21): a new profile, or one created since the cutoff that has one, has a CV —
    // picked, or saved — as the server requires (publish.ts). Older profiles keep the old rule.
    if (cvRequired && !cvFile && !cvName) all.cv = 'required'
    // A photo the check already refused is said there, never sent (the server would refuse it the same way).
    if (photoCheck && photoCheck.url === t.photoUrl && photoCheck.state === 'fail' && photoCheck.reason) all.photoUrl = photoCheck.reason
    if (Object.keys(all).length) {
      if (counting) for (const ev of refusalEvents(all)) countTeacherFormEvent(ev)
      refuse(all)
      return
    }
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
    // No draft save while this publish is on its way (the publish deletes the draft); resumed if it does not go through.
    let published = false
    // The server took the profile (res.ok): whatever throws after it — the CV upload — is not a Publish that failed.
    let saved = false
    if (mode === 'join') {
      // Paused first, so a draft save on its way lands BEFORE the publish (which deletes the draft) and starts nothing
      // after it (commit gate, opus 2026-10-11).
      halted.current = true
      const inFlight = saveQ.current.inFlight
      if (inFlight) await inFlight.catch(() => {})
    }
    try {
      // `cv`: the new profile's CV, uploaded before this PUT (below) — named by its token, create-only like the hide.
      const bodyWith = (cv: { token: string; fileName: string } | null) => ({
        ...t,
        // ⛔ THE PUBLISH TAP IS THE CONSENT — under the notice beside it (the action bar's line and "What's public?").
        publishNotice: PUBLISH_NOTICE_VERSION,
        // The cover switch is its own consent, under the notice beside it on the Cover step.
        ...(t.coverOpen ? { coverNotice: COVER_CONSENT_VERSION } : {}),
        // Each opt-in is its own consent, under the AI note beside them (it names Anthropic and the transfer abroad).
        ...(t.matchEmailOptIn || t.staffContactOptIn ? { aiNotice: AI_NOTICE_VERSION } : {}),
        // The Terms line was on screen beside this Publish (`needsTerms`): the server records the one-time account step.
        ...(needsTerms ? { acceptTerms: true } : {}),
        // ⛔ "IDENTITY VERIFIED" HIDDEN BEFORE THE PROFILE EXISTED (owner, 2026-10-16): a NEW profile's Publish carries the
        // teacher's hide as the CREATE-ONLY `identityMarkHidden: true` — recorded with the profile, in the same transaction,
        // before its card is derived (publish.ts saveTeacherProfile), so the mark never shows for a moment first. Only
        // `true`, only from join: once a profile exists the switch's own endpoint owns the hide, and the server ignores the
        // field on an edit.
        ...(mode === 'join' && !teacherProfileId && joinMarkHidden ? { identityMarkHidden: true } : {}),
        // `coverBase`: the cover state this form loaded — the server refuses (409 cover_changed) if another window changed it.
        coverBase: mode === 'edit' && savedCover ? coverStamp(savedCover) : null,
        videoBase: mode === 'edit' ? videoBase : null,
        // ⛔ A save names the profile it edits, or claims there is none — never neither (api/teachers/me PUT).
        teacherProfileId: mode === 'edit' ? teacherProfileId : null,
        // ⛔ THE CV A NEW PROFILE PUBLISHES WITH (owner, 2026-10-21): its pending upload's token and name (cvFirst, below) —
        // CREATE-ONLY (the server ignores both on an edit, whose picked CV goes up after the save), never a path (publish.ts
        // cvUploadOf). The KEY rides every join Publish, null when there is no upload: a create without it is a tab from
        // before the CV was required, which the server answers "reload" (publish.ts) — this form is not one. An edit form
        // whose profile never loaded (it claims a create too) sends a token only with a picked CV: without one, "reload"
        // is the right answer for it as well (commit gate, opus 2026-10-22 — never "add your CV" to a teacher who has one).
        ...(cv ? { cvUpload: cv.token, cvFileName: cv.fileName } : mode === 'join' ? { cvUpload: null } : {}),
      })
      // ⛔ A NEW PROFILE'S CV GOES UP FIRST (uploadPendingCv): a failed upload refuses this Publish on the CV, with nothing
      // sent — counted as one that did not go through. A file the server will never take (renamed, too big) is let go, so the
      // section asks for another; one that only failed to arrive stays, for the next tap. "New" is what this PUT claims: the
      // join form always, and an edit form whose profile never loaded (it saves with no teacherProfileId, so it may only
      // create — and the create needs the CV it names, or every Save there would be refused for it).
      const cvFirst = async (): Promise<{ token: string; fileName: string } | null | 'refused'> => {
        if ((mode === 'edit' && teacherProfileId) || !cvFile) return null
        const up = await uploadPendingCv(cvFile)
        if (!('error' in up)) return up
        if (counting) countTeacherFormEvent('publish_failed')
        if (up.error === 'type' || up.error === 'size') setCvFile(null)
        refuse({ cv: up.error })
        return 'refused'
      }
      const put = (cv: { token: string; fileName: string } | null) =>
        fetch('/api/teachers/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyWith(cv)) })
      let cvSent = await cvFirst()
      if (cvSent === 'refused') return
      let res = await put(cvSent)
      let d = await res.json().catch(() => ({}))
      // The server no longer holds that upload (swept after its hour, or never this account's — publish.ts 'expired'): a
      // fresh one, and this Publish sent once more — ONCE; a second refusal is said like any other.
      if (!res.ok && cvSent && d.error === 'invalid_teacher_profile' && d.fields?.cv === 'expired') {
        pendingCv.current = null
        cvSent = await cvFirst()
        if (cvSent === 'refused') return
        res = await put(cvSent)
        d = await res.json().catch(() => ({}))
        // Refused again: that token is no good either — the next tap uploads afresh instead of naming it once more
        // (commit gate, opus 2026-10-22: each such cycle spent two of the hour's uploads).
        if (!res.ok && d.error === 'invalid_teacher_profile' && d.fields?.cv === 'expired') pendingCv.current = null
      }
      saved = res.ok
      if (!res.ok) {
        if (counting) countTeacherFormEvent('publish_failed')
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
        // An untyped account published without the Terms line on screen (the identity was still loading): nothing was
        // written. The line is shown now, and the next Publish under it is the assent.
        if (d.error === 'terms_required') {
          setTermsAsked(true)
          setFormError(tr('Please read the line below, then tap Publish again.', 'Vui lòng đọc dòng bên dưới, rồi bấm Đăng lần nữa.'))
          revealFirstError({ formLineFirst: true })
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
        // A screened text: the server names the FIELD it refused (never the word) — the form goes to it, and the field
        // shows the teacher's own refused words, found in the text it holds (steps/shared.tsx, text-screen.ts).
        if (typeof d.detail === 'string' && d.detail && typeof d.error === 'string' && !d.error.startsWith('identity_')) {
          setFormError(publishErrText(String(d.error), fieldTexts(d.detail)))
          refuse({ [d.detail]: d.error } as TeacherErrors)
          return
        }
        setFormError(publishErrText(String(d.error || '')))
        revealFirstError({ formLineFirst: !d.fields })
        return
      }
      // The profile is saved either way; a failed CV upload is reported on the done screen and can be
      // retried from Edit — never leave the teacher on the form thinking nothing was published.
      // The server recorded the one-time account step with this Publish: the session knows it at once — before the CV
      // upload, which can fail or be cut short — so the onboarding gate never sends this account to /onboard afterwards.
      if (d.onboarded === true) markOnboarded('individual')
      // A new profile's CV went in WITH it (the create attached its pending upload): saved now, its token spent. An edit's
      // picked CV still goes up AFTER its save — its own call, which replaces the saved one and never throws (uploadCv).
      if (cvSent) { setCvName(cvSent.fileName); setCvFile(null); setSavedHadCv(true); pendingCv.current = null }
      else if (mode === 'edit' && cvFile) await uploadCv(cvFile)
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
      // ⚖️ THE NAME IS WHAT "IDENTITY VERIFIED" VOUCHES FOR: a save that renamed the teacher had the mark re-judged on the
      // server (saveTeacherProfile), so the switch's line is re-read — never left saying what was true of the old name.
      // ⚠️ AND A FIRST PUBLISH ALWAYS RE-READS (commit gate, 2026-10-16): the state was read before the profile existed
      // (no name to judge), and since the mark is AUTOMATIC this Publish is what made it public for a verified teacher —
      // the done screen says so ("now shows on your profile", with the way to hide it) only from this read, never guessed.
      if (mode !== 'edit' || (publicAs?.fullName ?? null) !== t.fullName) void refreshMark()
      setPublicAs({ fullName: t.fullName, headline: t.headline })
      // What schools can see NOW, as the save left it (a moderation or identity hold, the profile hidden): "Share my
      // profile" follows it on a return to the form (commit gate, codex + opus 2026-10-12).
      setListingLive(d.live === true)
      published = true
      if (mode === 'join') countTeacherFormEvent('published')
      // The publish deleted the saved draft in its own transaction: the dashboard row now leads to the profile.
      if (mode === 'join' && uid) revalidateDashboard(uid)
    } catch {
      if (counting && !saved) countTeacherFormEvent('publish_failed')
      setFormError(publishErrText(''))
      revealFirstError()
    } finally {
      setBusy('')
      // Not published: the queue is as it was (a stale or gone halt stays), and what is unsaved is saved now — a retry the
      // publish waited out, or a save that failed while it waited, never goes missing (commit gate, codex + opus).
      if (mode === 'join' && !published) {
        halted.current = false
        if (!refused.current && (tRef.current !== savedT.current || draftStepRef.current !== savedStep.current)) void saveDraftRef.current()
      }
    }
  }

  /**
   * A fresh read of the "Identity verified" switch (GET /api/teachers/me — only its mark fields are taken). `then` speaks
   * for a toggle waiting on this read (toggleMark): it gets the fresh switch, and only while no later toggle or read has
   * superseded it; if the read fails, that toggle's line becomes 'unknown' — "could not check, reload" — instead.
   */
  const refreshMark = async (then?: (fresh: MarkSwitch) => void) => {
    if (markBusyRef.current) { markRefreshDue.current = true; return }
    const ticket = ++markSeq.current
    // ⚠️ A READ THAT FAILS LEAVES THE STATE UNKNOWN, NEVER STALE (commit gate, 2026-10-16): after a rename or a hide the
    // old line could be false — "adds 10 points" for an identity revoked meanwhile, no mismatch line for a new name —
    // so a failed read clears it (no state line, no trust line). The switch position and the base stay: they are the
    // server's last answer, and a stale base is refused by the server (409) rather than trusted.
    const unknown = () => {
      if (ticket !== markSeq.current) return
      setMark((m) => ({ ...m, state: null }))
      if (then) setMarkMessage('unknown')
    }
    try {
      const r = await fetch('/api/teachers/me')
      const d = await r.json().catch(() => null)
      if (!r.ok || !d) return unknown()
      if (ticket !== markSeq.current) return
      const fresh = markFromMe(d)
      setMark(fresh)
      then?.(fresh)
    } catch { unknown() }
  }
  /**
   * ⛔ THE "IDENTITY VERIFIED" SWITCH SAVES ON TOGGLE, THROUGH ITS OWN ENDPOINT (plan review R2) — never with the profile,
   * so a hide is never held up by anything else the profile save could refuse. Edit only: the endpoint needs a profile
   * (before one exists the choice is held on the page — joinMarkHidden — and rides the first Publish).
   *   · OFF = HIDE: sends nothing else and is never refused. ON = SHOW AGAIN: sends the stamps this form loaded as the
   *     compare-and-set base, and no notice (identity-mark-switch.ts markRequest).
   *   · The switch moves only on the server's answer (never optimistic, either way); the answer's stamps are the next base.
   *   · 409 identity_mark_changed (another window moved the switch): a calm line and a fresh read — never a retry over a
   *     state the teacher has not seen. 429 (a show only — a hide is never rate-limited): said.
   * ⛔ A LINE ABOUT WHAT THE SWITCH SHOWS COMES FROM A FRESH READ, NEVER AHEAD OF ONE (commit gate, 2026-10-16). After
   *   anything but a clean answer — a 409, a failure, an answer that is not the endpoint's — the form re-reads the server
   *   and the line is said from THAT read: the 409's line once the switch shows what is saved; "could not save" only when
   *   the server really differs from the request (a response lost after the save committed is no failure — the switch
   *   simply shows it); and if the read fails too, "could not check — reload", never a claim about a switch nobody read.
   */
  const toggleMark = async (on: boolean) => {
    if (markBusyRef.current || mode !== 'edit') return
    markBusyRef.current = true
    const ticket = ++markSeq.current
    setMarkBusy(true); setMarkMessage('')
    let reread = false
    let then: ((fresh: MarkSwitch) => void) | undefined
    // Not saved — or not KNOWN to be: the fresh read decides whether the server holds what was asked.
    const unsure = () => { reread = true; then = (fresh) => setMarkMessage(fresh.on === on ? '' : 'failed') }
    try {
      const res = await fetch('/api/teachers/me/identity-mark', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(markRequest(on, mark.base)) })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        const next = markAfterSave(mark, on, d)
        if (!next) return unsure() // an answer that is not the endpoint's: read the truth, and say what it shows
        if (ticket === markSeq.current) setMark(next)
        // ⚠️ A HIDE'S ANSWER CANNOT SPEAK FOR THE IDENTITY (it reads none — publish.ts), so the lines it keeps are only a
        // placeholder until a fresh read lands (commit gate): the identity may have changed while this page was open.
        if (!on) reread = true
        return
      }
      if (res.status === 409 && d.error === 'identity_mark_changed') {
        reread = true
        then = () => setMarkMessage('changed')
        return
      }
      // Refused before anything was written (a show only): the switch still shows the server's last answer.
      if (res.status === 429) return setMarkMessage('rate_limited')
      unsure()
    } catch {
      unsure()
    } finally {
      markBusyRef.current = false
      setMarkBusy(false)
      if (reread || markRefreshDue.current) { markRefreshDue.current = false; void refreshMark(then) }
    }
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
  /**
   * "Hide my profile from search engines" (owner decision 14, 2026-10-20): saved at once (PUT /api/teachers/me/search —
   * src/lib/teachers/search-visibility.ts). The switch moves only on the server's answer; a tap while one is on its way
   * is dropped. A hide is never refused by the server's limiter, so a 429 can only answer a show.
   */
  const toggleSearchHidden = async (hide: boolean) => {
    if (searchBusy) return
    setSearchBusy(true)
    setSearchMessage('')
    try {
      const res = await fetch('/api/teachers/me/search', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: hide }) })
      const d = await res.json().catch(() => null) as { hidden?: unknown } | null
      if (res.ok && typeof d?.hidden === 'boolean') { setSearchHidden(d.hidden); return }
      setSearchMessage(res.status === 429 ? 'rate_limited' : 'failed')
    } catch {
      setSearchMessage('failed')
    } finally {
      setSearchBusy(false)
    }
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
  /** The saved CV's own Remove (edit). ⛔ Every outcome is said (2026-10-21 — it used to fail silently). */
  const removeCv = async () => {
    // ⛔ ONE CV CHANGE AT A TIME (commit gate, codex 2026-10-22): while this DELETE is on its way the form is busy, so no new
    // pick and no Save can start — a Save's new upload committing first would otherwise be the CV this late DELETE finds
    // under the server's lock, and removes.
    if (busy) return
    setBusy('saving')
    setFormError('')
    try {
      const res = await fetch('/api/teachers/me/cv', { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      // Removed — or already gone (another window): the section shows none either way.
      if (res.ok || d.error === 'cv_missing') { setCvName(null); setSavedHadCv(false); return }
      // A profile created since the cutoff keeps its CV (2026-10-21): replace it instead.
      if (d.error === 'cv_required') setFormError(tr('Your profile needs a CV — upload a new one to replace it.', 'Hồ sơ của bạn cần có CV — hãy tải CV mới lên để thay.'))
      else setFormError(tr('Could not remove your CV. Please try again.', 'Không xoá được CV. Vui lòng thử lại.'))
    } catch {
      setFormError(tr('Could not remove your CV. Please try again.', 'Không xoá được CV. Vui lòng thử lại.'))
    } finally {
      setBusy('')
    }
    // Said where it can be seen: the form's line sits under the whole step, far below the CV on a phone.
    revealFirstError({ formLineFirst: true })
  }

  // ── Intro video (2026-10-07) ─────────────────────────────────────────────────────────────────────
  // ⚠️ `setT` here and below is the form's latest-value setter (it writes tRef first — see its definition above), never the
  // raw React one: a save after a 409 reload sends the reloaded video, not the stale window's.
  const applySavedVideo = (v: { onRequest?: boolean; version?: number; hasPrivate?: boolean; url?: string | null }) => {
    setPrivateVideo(v.hasPrivate === true)
    // A video saved now counts as the profile's at once (the required-video rule for a profile made since the cutoff),
    // not only after a reload (gate review, 2026-10-16).
    if (v.url || v.hasPrivate === true) setSavedHadVideo(true)
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
    ? tr('Your intro video was changed in another window — this form now shows the saved video. If you still want your change, make it again, then save.', 'Video giới thiệu đã được thay đổi ở cửa sổ khác — biểu mẫu này đang hiển thị video đã lưu. Hãy thay đổi lại video nếu bạn vẫn muốn, rồi lưu.')
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
      // A profile created since the cutoff keeps its intro video (2026-10-16): replace it instead.
      else if (d.error === 'video_required') { setConfirmVideoRemove(false); setFormError(tr('Your profile needs an intro video — upload a new one to replace it.', 'Hồ sơ của bạn cần có video giới thiệu — hãy tải video mới lên để thay.')) }
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
    // Step 1's Next for a teacher already signed in on eno.vn — the same funnel step as Continue / Sign in (preSignInOk).
    if (mode === 'join' && !existing && !viaHandoff.current && step === LAST_PRE_SIGNIN) {
      if (Object.keys(e).length) countTeacherFormEvent('step1_blocked')
      else { countTeacherFormEvent('step1_continue'); countTeacherFormEvent(continueSourceEvent(window.location.search)) }
    }
    if (Object.keys(e).length) {
      setErrors(e)
      revealFirstError()
      // The teacher asked to move on: what they gave so far is saved even though the step is not complete — a partial
      // step 1 too ("as long as they have inputted something in 1st stage", owner 2026-10-11).
      if (draftOn && tRef.current !== savedT.current) void saveDraftRef.current()
      return
    }
    setErrors({})
    setStepKey(steps[stepIdx + 1])
  }
  const savingLabel = tr('Saving…', 'Đang lưu…')
  // `() => publish()`, never `publish` itself: the bar hands its onClick the click event, which must not reach `opts`.
  // ⛔ Next, Save changes and Publish WAIT while "Improve with AI" runs (bioWorking — About only): moving on or saving then
  // would carry the text the answer is about to replace (the answer is dropped once the teacher has left About).
  const primary = mode === 'edit'
    ? { label: busy === 'saving' ? savingLabel : tr('Save changes', 'Lưu thay đổi'), onClick: () => { void publish() }, disabled: busy !== '' || bioWorking }
    : draftHost && step === LAST_PRE_SIGNIN
      // "Continue", not "Continue on eno.vn" (2026-10-16 — 85% of these visitors are in Facebook's in-app browser, and a
      // button that announces leaving reads as leaving): the line above it says where the next step happens.
      ? { label: tr('Continue', 'Tiếp tục'), onClick: handOff }
      : !user && step === LAST_PRE_SIGNIN
        // "Sign in", not "Sign in": the longer label wrapped to two lines in the 375px action bar (and the
        // Vietnamese is longer still) — the line above the bar already says sign-in comes next (browser run, 2026-10-09).
        ? { label: tr('Sign in', 'Đăng nhập'), onClick: signInToContinue, disabled: authLoading }
        : isLast
          ? { label: busy === 'saving' ? savingLabel : tr('Publish profile', 'Đăng hồ sơ'), onClick: () => { void publish() }, disabled: busy !== '' || bioWorking }
          : { label: tr('Next', 'Tiếp'), onClick: next, disabled: bioWorking }
  const secondary = mode === 'edit'
    ? (!isLast ? { label: tr('Next step', 'Bước tiếp'), onClick: () => setStepKey(steps[stepIdx + 1]) } : stepIdx > 0 ? { label: tr('Back', 'Quay lại'), onClick: () => setStepKey(steps[stepIdx - 1]) } : undefined)
    : stepIdx > 0 ? { label: tr('Back', 'Quay lại'), onClick: () => setStepKey(steps[stepIdx - 1]) } : undefined
  // ⛔ THE PUBLISH NOTICE, beside the tap that is the consent: on the last step of a new profile, on every step of an
  // edit (Save changes publishes too). Its meaning is PUBLISH_NOTICE_VERSION (profile.ts) — sent as `publishNotice`.
  // ── SHARING THE PROFILE (owner, 2026-10-11: "make it easy to share on facebook and zalo or whatsapp") ─────────────────
  // Its public page on this edition's own host — the link the page's Open Graph tags (photo, name, headline; never a
  // price) describe when Facebook or Zalo build the card. Only a profile schools can see is offered for sharing.
  const profileUrl = (listingId: string) => `${(process.env.NEXT_PUBLIC_APP_URL || apexOrigin).replace(/\/+$/, '')}/listings/${listingId}`
  const named = (p: { fullName: string; headline: string }) => (p.headline ? `${p.fullName} — ${p.headline}` : p.fullName)
  // ⛔ WHAT THE ACCOUNT HAS SAVED, SAID WHERE THE TEACHER LOOKS (owner, 2026-10-11; plan review: a save that failed must
  // never look saved). Join mode on eno.vn, signed in, once the saved draft is known.
  const draftLine = mode === 'join' && !draftHost && !!user && (draftLoaded || loadFailed) && !existing ? (
    <div className="mt-1 space-y-2" data-testid="draft-line">
      {pageAnswers && (
        <div role="status" className="space-y-1 rounded-xl bg-tint px-3.5 py-2.5 text-sm text-body">
          <p>{tr('You had already started a teacher profile — it is open where you left off.', 'Bạn đã bắt đầu một hồ sơ giáo viên — hồ sơ được mở ở chỗ bạn dừng lại.')}</p>
          <Button variant="link" size="none" type="button" className="text-sm font-semibold" onClick={useMine}>{tr('Use the answers I just gave instead', 'Dùng các câu trả lời tôi vừa nhập')}</Button>
        </div>
      )}
      {draftState === 'stale' ? (
        <div role="alert" className="space-y-2 rounded-xl bg-tint px-3.5 py-2.5 text-sm text-body">
          <p>{staleWhy === 'reconnect'
            ? tr('Your saved profile has just loaded, and it differs from the answers on this page.', 'Hồ sơ đã lưu vừa được tải, và khác với các câu trả lời trên trang này.')
            : tr('Your profile was changed in another window or on another device.', 'Hồ sơ của bạn đã được thay đổi ở cửa sổ hoặc thiết bị khác.')}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Button variant="link" size="none" type="button" className="text-sm font-semibold" onClick={() => { void resolveStale(false) }}>{tr('Open the latest version', 'Mở bản mới nhất')}</Button>
            <Button variant="link" size="none" type="button" className="text-sm font-semibold" onClick={() => { void resolveStale(true) }}>{tr('Keep the answers on this page', 'Giữ câu trả lời trên trang này')}</Button>
          </div>
        </div>
      ) : draftState === 'gone' ? (
        <div role="alert" className="space-y-2 rounded-xl bg-tint px-3.5 py-2.5 text-sm text-body">
          <p>{tr('Your saved answers were deleted — published, started over, or not changed for 90 days.', 'Các câu trả lời đã lưu đã bị xoá — do đã đăng, bắt đầu lại, hoặc không thay đổi trong 90 ngày.')}</p>
          <Button variant="link" size="none" type="button" className="text-sm font-semibold" onClick={saveAgain}>{tr('Save the answers on this page', 'Lưu câu trả lời trên trang này')}</Button>
        </div>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          {/* ⛔ NEVER "SAVED" FOR ANSWERS THAT ARE NOT (commit gate, codex 2026-10-11): a step's answers are saved when the
              teacher moves to another step — until then the line says so. */}
          {draftState === 'saving' ? tr('Saving…', 'Đang lưu…')
            : draftState === 'failed' && failedWhy.current === 'session' ? (
              <>
                {tr('You are signed out — sign in again to keep saving.', 'Bạn đã đăng xuất — hãy đăng nhập lại để tiếp tục lưu.')}{' '}
                <Button variant="link" size="none" type="button" className="text-xs font-semibold" onClick={() => openSignIn({ note: signInNote() })}>{tr('Sign in again', 'Đăng nhập lại')}</Button>
              </>
            )
            : draftState === 'failed' ? tr('Could not save your answers — we will try again when you move to another step. They stay on this page.', 'Không lưu được câu trả lời — chúng tôi sẽ thử lại khi bạn chuyển sang bước khác. Câu trả lời vẫn ở trên trang này.')
            : draftState === 'error' || !draftLoaded ? tr('Not saved yet — we will try again. Your answers stay on this page.', 'Chưa lưu được — chúng tôi sẽ thử lại. Câu trả lời vẫn ở trên trang này.')
            : draftState === 'saved' && t === savedT.current && draftStep === savedStep.current ? tr('Saved to your account — finish any time, on any device.', 'Đã lưu vào tài khoản — hoàn tất bất cứ lúc nào, trên mọi thiết bị.')
            : draftState === 'saved' ? tr('Saved up to your last step — this step is saved when you move on.', 'Đã lưu đến bước trước — bước này được lưu khi bạn chuyển tiếp.')
            : tr('Your answers are saved to your account each time you move to another step.', 'Câu trả lời được lưu vào tài khoản mỗi khi bạn chuyển sang bước khác.')}
          {/* ⛔ What a saved draft never keeps is given again where it is given (forDraft) — said where that is. */}
          {(step === 'cover' || step === 'finish') && draftLoaded && draftState !== 'error' ? (
            <>{' '}{tr('The draft does not keep your photo, video, CV, phone or the switches on this step — you set them again when you come back.', 'Bản nháp không lưu ảnh, video, CV, số điện thoại và các công tắc ở bước này — bạn sẽ đặt lại khi quay lại.')}</>
          ) : null}
          {draftRev.current ? (
            <>
              {' · '}
              <Button variant="link" size="none" type="button" className="text-xs font-semibold" disabled={busy !== ''} onClick={() => setConfirmStartOver(true)}>{tr('Start over', 'Bắt đầu lại')}</Button>
            </>
          ) : null}
        </p>
      )}
    </div>
  ) : null

  const publishNote = showPublishNote ? (
    <p className="text-xs text-body" data-testid="publish-notice">
      {mode === 'edit'
        ? tr('Saving updates your public profile: schools, other members and search engines see everything except your phone, email, CV and a private video. Any signed-in account can message you, within a daily limit that rises with its verification.', 'Khi lưu, hồ sơ công khai của bạn được cập nhật: các trường, các thành viên khác và công cụ tìm kiếm thấy mọi thứ trừ số điện thoại, email, CV và video riêng tư. Mọi tài khoản đã đăng nhập đều có thể nhắn tin cho bạn, trong giới hạn hằng ngày tăng theo mức xác minh của tài khoản đó.')
        : tr('Publishing shows your profile publicly — to schools, other members and search engines — everything except your phone, email, CV and a private video. Any signed-in account can message you, within a daily limit that rises with its verification.', 'Khi đăng, hồ sơ của bạn hiển thị công khai — với các trường, các thành viên khác và công cụ tìm kiếm — mọi thứ trừ số điện thoại, email, CV và video riêng tư. Mọi tài khoản đã đăng nhập đều có thể nhắn tin cho bạn, trong giới hạn hằng ngày tăng theo mức xác minh của tài khoản đó.')}{' '}
      <Button variant="link" size="none" type="button" className="text-xs font-semibold" onClick={() => setWhatsPublic(true)}>{tr('What’s public?', 'Những gì được công khai?')}</Button>
      {/* ⚠️ THIS LINE IS THE ASSENT ITSELF for an account still untyped — this Publish sends `acceptTerms` and the server
          records the Terms acceptance with it (api/teachers/me PUT), and that record must never assert an assent the
          screen did not ask for (onboard-client.tsx says why). Rendered exactly when `needsTerms` is true. */}
      {needsTerms && (
        <span className="mt-1 block" data-testid="publish-terms">
          {tr('By publishing you agree to our ', 'Bằng việc đăng, bạn đồng ý với ')}
          {/* A NEW tab (the app hands it to Safari): following one must never navigate this page away — the answers
              would survive in the tab draft, but a picked CV lives only here (commit gate, opus 2026-10-11). */}
          <a href="/terms" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">{tr('Terms of Service', 'Điều khoản dịch vụ')}</a>
          {', '}
          <a href="/regulations" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">{tr('Operating regulations', 'Quy chế hoạt động')}</a>
          {tr(' and ', ' và ')}
          <a href="/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">{tr('Privacy Policy', 'Chính sách bảo vệ dữ liệu cá nhân')}</a>
          .
        </span>
      )}
    </p>
  ) : null

  // ── Screens other than the wizard ───────────────────────────────────────────────────────────────
  // Signed in on the join form: the saved draft answers first (a fraction of a second) — nothing is typed against an
  // unknown revision (the bounding contract above). A failed load shows the form, says so and keeps asking.
  // ⚠️ Not while auth is still deciding: the server-rendered first paint (and every signed-out visitor) keeps the form;
  // a signed-in teacher may glimpse step 1 for a moment before the spinner (commit gate, opus 2026-10-11).
  // …and while this tab's own copy waits for the session to say whose it is (the restore, above): nothing typed over it.
  // After an in-place switch (screenSwitched), the new screen's heading takes the focus — a door, Continue or Undo unmounts
  // the control that had it, and focus would fall to <body> with nothing announced (review, 2026-10-16).
  // ⚠️ Shown as focused only to a KEYBOARD (gate review, 2026-10-16): after a tap, WebKit would ring the new title of every
  // screen; after a key press — an iPad with a keyboard included — the ring is how the person sees where they are.
  const lastPointerAt = useRef(0)
  useEffect(() => {
    const onPointer = () => { lastPointerAt.current = Date.now() }
    window.addEventListener('pointerdown', onPointer, { capture: true, passive: true })
    return () => window.removeEventListener('pointerdown', onPointer, { capture: true })
  }, [])
  useEffect(() => {
    if (!screenSwitched.current) return
    screenSwitched.current = false
    const byPointer = Date.now() - lastPointerAt.current < 2_000
    requestAnimationFrame(() => document.querySelector<HTMLElement>('main [data-screen-heading]')
      ?.focus({ preventScroll: true, focusVisible: !byPointer } as FocusOptions & { focusVisible?: boolean }))
  })
  const draftPending = ownedPending || (mode === 'join' && !draftHost && !!uid && !authLoading && !existing && !draftLoaded && !loadFailed)
  // ⛔ NO PANEL AND NO STEP 1 FOR A SESSION STILL BEING READ (2026-10-15; with no start screen since 2026-10-16, gate
  // review): a request that came with a session cookie waits for the account — never the signed-out step 1 ("Sign in")
  // for someone signed in, then something else under the finger — and a signed-in account waits for /api/teachers/me (it
  // may already have a profile). Never long: that request's own timer lets the form show (meKnown).
  const doorWaits = mode === 'join' && !draftHost && ((!!start?.sessionHint && authLoading) || (!!uid && !meKnown))
  // The form's own funnel (signup-prompt.ts TEACHER_FORM_EVENTS): step 1 of a new profile on screen AND working — this
  // runs only once the page has hydrated, which is the point (half of Facebook's Android visitors never got that far,
  // 10-13 → 10-16). Once per page, and never for a visitor who arrived with the hand-off's answers (counted on
  // teacher.eno.vn already — gate review, 2026-10-16: one visitor, two "ready"s).
  const step1Working = mode === 'join' && !existing && !done && step === 'plans' && door === 'self' && loaded && !draftPending && !doorWaits
  // The ref is read INSIDE the effect: the hand-off's restore effect (declared above) has run by then, on the same mount.
  useEffect(() => { if (step1Working && !viaHandoff.current) countTeacherFormEvent('step1_ready') }, [step1Working])
  // …and every later step of a NEW profile as it comes on screen (step_<step>), so a stop between sign-in and Publish shows
  // WHERE (2026-10-17: 81% of starters published before 10-16, 31% after, and nothing said at which step the rest stopped).
  // ⛔ On screen, as step 1 is (review, 2026-10-17): never behind the spinner a restored later-step draft waits under, and
  // only once /api/teachers/me has said this account has no profile yet (meRead) — its slow timer is not an answer, and
  // every later step is a signed-in step, so no account means nothing to count.
  const stepShown = mode === 'join' && !existing && !done && door === 'self' && loaded && !draftPending && !doorWaits && meRead
  useEffect(() => {
    if (!stepShown) return
    const ev = STEP_REACHED[step]
    if (ev) countTeacherFormEvent(ev)
  }, [step, stepShown])
  if (!loaded || draftPending || doorWaits) {
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
        <Button variant="cta" className="mt-4" asChild>
          <Link href="/teachers/join">{noProfileDraft ? tr('Continue my teacher profile', 'Tiếp tục hồ sơ giáo viên') : tr('Create my teacher profile', 'Tạo hồ sơ giáo viên')}</Link>
        </Button>
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
    // "Add more to stand out", most useful first — each opens the step that asks it. The CV first when none is saved (an
    // older profile, or an edit whose upload after the save failed): schools ask for it first (owner, 2026-10-21).
    const more: { step: TeacherStep; label: string }[] = [
      ...(!cvName ? [{ step: 'finish' as const, label: tr('Add your CV', 'Thêm CV của bạn') }] : []),
      ...(!t.videoUrl && !privateVideo ? [{ step: 'finish' as const, label: tr('Add an intro video', 'Thêm video giới thiệu') }] : []),
      ...(!t.bio ? [{ step: 'about' as const, label: tr('Say more about yourself', 'Giới thiệu thêm về bạn') }] : []),
      ...(!t.certificates.length ? [{ step: 'teaching' as const, label: tr('Add your certificates', 'Thêm chứng chỉ') }] : []),
      ...(!t.experience.length ? [{ step: 'teaching' as const, label: tr('Add your teaching jobs', 'Thêm công việc giảng dạy') }] : []),
      // (No "Identity verified" pointer any more — owner, 2026-10-16: the mark is automatic, so there is nothing to switch
      // on; the line below says when it went public, with the way to hide it.)
    ]
    // ⛔ "IDENTITY VERIFIED" WENT PUBLIC WITH THIS PUBLISH (owner, 2026-10-16 — automatic): a verified teacher's first
    // Publish is when the mark first shows, and no earlier message told them (an approval before the profile existed has
    // nothing to say it on), so the done screen does — with the way to hide it. From the re-read after the save (publish),
    // never guessed: unknown, hidden or held back says nothing. A new profile only (an edit has the switch on its own step),
    // and only while schools can see the profile at all.
    const markWentPublic = mode === 'join' && done.live && mark.state?.shown === true
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
            {tr('Schools can now find you. When someone messages you, reply — and tap', 'Các trường giờ có thể tìm thấy bạn. Khi có người nhắn tin, hãy trả lời — và bấm')} “{shareWords}” {tr('if you want them to have your contact details and CV.', 'nếu bạn muốn gửi thông tin liên hệ và CV.')}
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
        {markWentPublic && (
          <p className="mt-3 text-sm text-body" data-testid="identity-mark-done">
            {tr('“Identity verified” now shows on your profile.', 'Nhãn “Đã xác minh danh tính” đã hiển thị trên hồ sơ của bạn.')}{' '}
            <Link href="/teachers/edit?step=finish" className="font-semibold text-brand underline">{tr('You can hide it in Photo & publish.', 'Bạn có thể ẩn nhãn trong bước Ảnh & đăng.')}</Link>
          </p>
        )}
        {formError && <p role="alert" data-form-error className="mt-3 text-sm text-destructive">{formError}</p>}
        {done.live && !done.noGoal && (
          <section aria-labelledby="share-profile" className="mt-5 space-y-2 rounded-2xl bg-tint p-4">
            <h2 id="share-profile" className="text-sm font-semibold text-foreground">{tr('Share your profile', 'Chia sẻ hồ sơ của bạn')}</h2>
            <p className="text-xs text-muted-foreground">{tr('Send it to friends, colleagues and schools you know — or post it in your teaching groups.', 'Gửi cho bạn bè, đồng nghiệp và các trường bạn biết — hoặc đăng trong các nhóm giáo viên của bạn.')}</p>
            <ShareChannels url={profileUrl(done.listingId)} text={named(publicAs ?? t)} />
          </section>
        )}
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

  // ── The reading panel, in the form's place (the CV — offered on "Your teaching" and "About you", or `?import=cv`) ──
  if (mode === 'join' && !draftHost && door === 'cv') {
    // Answers the account has not taken (heldBack — left in this tab signed out) are not the teacher's yet: their step
    // is still to answer, and Continue opens on it.
    const stillToAnswer = steps.filter((s) => Object.keys(checkSteps(t, [s])).length > 0 || (heldBack.current && PRE_SIGNIN_STEPS.includes(s)))
    return (
      <>
        <TeacherImportPanel
          userId={uid}
          ready={draftOn}
          // Why reading cannot start yet, when waiting is not the answer (the form's draft line, said here).
          blocked={!uid || draftOn ? null
            : draftState === 'stale' || draftState === 'gone' ? 'conflict'
            : draftState === 'failed' && failedWhy.current === 'session' ? 'signed_out'
            : loadFailed ? 'retrying' : 'loading'}
          undoing={undoing}
          lastImport={lastImport}
          saveState={draftState === 'saved' && t === savedT.current ? 'saved'
            : draftState === 'stale' || draftState === 'gone' ? 'conflict'
            : draftState === 'failed' && failedWhy.current === 'session' ? 'signed_out'
            : !draftOn || draftState === 'error' || draftState === 'failed' ? 'not_saved'
            : draftState === 'saving' || sentStep.current === null ? 'saving' : 'later'}
          stillToAnswer={stillToAnswer}
          stepLabel={stepLabel}
          canGoBack
          onBack={() => setDoor('self')}
          onSignIn={() => openSignIn({ note: tr('Sign in to read your file — it takes a few seconds, and your answers are then saved to your account as you go.', 'Đăng nhập để đọc tệp — chỉ mất vài giây, sau đó câu trả lời được lưu vào tài khoản khi bạn điền.') })}
          onImported={applyImport}
          onUndo={() => { void undoLastImport() }}
          onContinue={() => setDoor('self')}
          onSelf={() => setDoor('self')}
          onOpenForm={() => setDoor('self')}
          onExisting={() => setExisting(true)}
        />
        {formError && <p role="alert" data-form-error className="mx-auto mt-4 max-w-xl text-sm text-destructive">{formError}</p>}
      </>
    )
  }

  const stepProps: StepProps = { t, set, patch, update, errors, errText, mode }
  // Step 1's own answers count once as "answered" (signup-prompt.ts TEACHER_FORM_EVENTS) — only the visitor's choices
  // there, never a restored draft or an autofill (those go through setT, not these), and never after the hand-off.
  const countAnswer = () => { if (mode === 'join' && !viaHandoff.current) countTeacherFormEvent('step1_answered') }
  const plansProps: StepProps = {
    ...stepProps,
    set: (k, v) => { countAnswer(); set(k, v) },
    patch: (p) => { countAnswer(); patch(p) },
    update: (n, touched, direct) => { countAnswer(); update(n, touched, direct) },
  }
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
  // ⛔ WHAT A FILE FILLED IS SAID WHERE IT IS (2026-10-15): on a step holding imported answers the teacher has not changed
  // yet, the line asks them to check those; before those steps, it says they are coming.
  const importedLeft = lastImport && mode === 'join' ? untouchedImport(t, lastImport.fields, lastImport.filled) : []
  const importedHere = importedLeft.filter((k) => (TEACHER_STEP_FIELDS[step] as readonly string[]).includes(k))
  const importLine = importedHere.length > 0 ? (
    <p role="status" className="rounded-xl bg-tint px-3.5 py-2.5 text-sm text-body" data-testid="import-line">
      {tr('Some answers on this step came from your CV — check each one, and change anything that isn’t right.', 'Một số câu trả lời ở bước này lấy từ CV của bạn — hãy kiểm tra từng câu và sửa nếu chưa đúng.')}
    </p>
  ) : importedLeft.length > 0 && (step === 'plans' || step === 'where') ? (
    <p role="status" className="rounded-xl bg-tint px-3.5 py-2.5 text-sm text-body" data-testid="import-line">
      {tr('Your CV filled in later steps — answer these questions first, then check those answers.', 'CV của bạn đã điền các bước sau — hãy trả lời các câu hỏi này trước, rồi kiểm tra những câu trả lời đó.')}
    </p>
  ) : null
  // The reader offered again where a CV helps most — for a teacher who chose "myself" first.
  const cvHandy = mode === 'join' && !draftHost && !!start?.cvImport && !lastImport && !!uid && draftOn && (step === 'teaching' || step === 'about')

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
        // The tab bar's 4.5rem, or nothing where it is hidden — the teacher host (globals.css, the same `:has()` rule, so a
        // browser without `:has()` keeps both the bar and the clearance: never a bar over the buttons).
        offsetBottom="var(--teacher-tabbar-offset, 4.5rem)"
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
            {/* Inside Facebook's, Messenger's or Instagram's built-in browser, before any answer: the way out to the real
                browser, where sign-in works (owner, 2026-10-17; open-in-browser.tsx). The browser is judged on the server, so
                a signed-out first paint already has it; behind a session it shows with the form, after the draft is read.
                ⛔ Gone with the first answer (review, 2026-10-17): the real browser opens the bare address, so step 1's
                answers would not follow — a restored draft hides it too. */}
            {escape && mode === 'join' && step === 'plans' && !step1Answered(t) && <OpenInBrowser offer={escape} />}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <h1 data-screen-heading tabIndex={-1} className="h-title text-foreground outline-none">{mode === 'edit' ? tr('Your teacher profile', 'Hồ sơ giáo viên của bạn') : tr('Create your teacher profile', 'Tạo hồ sơ giáo viên')}</h1>
                {mode === 'edit' && status === 'live' && listingLive && profileListingId && (
                  <ShareButton url={profileUrl(profileListingId)} title={named(publicAs ?? t)} subject="my-teacher-profile" className="shrink-0" />
                )}
              </div>
              {draftLine}
              <p className="mt-1 text-sm text-muted-foreground">{tr('Free. Schools across Vietnam see your profile; your phone, email and CV stay private until you share them.', 'Miễn phí. Các trường trên toàn Việt Nam xem được hồ sơ; số điện thoại, email và CV được giữ kín đến khi bạn chia sẻ.')}</p>
              {/* What Publish will ask for, said before the first answer (2026-10-17 — the bounce study's "say the video up
                  front": since the video became required on 10-16, half of those who reached the last step stopped there).
                  The CV too since it is required (owner, 2026-10-21) — a PDF, which a teacher may first have to make. */}
              {mode === 'join' && !existing && step === 'plans' && (
                <p className="mt-1 text-sm text-muted-foreground">{tr('You will add a clear photo of yourself, a short intro video (20–30 seconds is enough) and your CV as a PDF. Once you sign in, your answers are saved, so you can finish on a laptop.', 'Bạn sẽ thêm một ảnh rõ mặt, một video giới thiệu ngắn (20–30 giây là đủ) và CV dạng PDF. Sau khi đăng nhập, câu trả lời được lưu, nên bạn có thể hoàn tất trên máy tính.')}</p>
              )}
            </div>
            {importLine}
            {cvHandy && (
              // Where a CV helps (owner, 2026-10-16: "move cv read for later pages before its needed"): a card, not a door
              // in front of step 1 — one tap opens the reading panel, which comes back to this step.
              <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-tint p-3.5" data-testid="cv-handy">
                <FileText aria-hidden className="size-5 shrink-0 text-body" />
                <p className="min-w-0 flex-1 text-sm text-body">{tr('Have your CV? We can fill in this step and the next ones from it — you check every answer.', 'Có CV? Chúng tôi điền giúp bước này và các bước tiếp theo từ CV — bạn kiểm tra từng câu trả lời.')}</p>
                <Button variant="secondary" size="sm" type="button" onClick={() => setDoor('cv')}>{tr('Use my CV', 'Dùng CV của tôi')}</Button>
              </div>
            )}
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
          {step === 'plans' && <PlansStep {...plansProps} coverIntent={coverIntent} signedIn={!!user} draftHost={draftHost} districtNotSaying={districtNotSaying} onDistrictNotSaying={setDistrictNotSaying} />}
          {step === 'where' && <WhereStep {...stepProps} coverIntent={coverIntent} onGoTo={goTo} />}
          {step === 'teaching' && <TeachingStep {...stepProps} />}
          {step === 'about' && (
            <AboutStep
              {...stepProps}
              prefillName={prefill?.displayName ?? null}
              bioAi={{
                available: bioAiOn, working: bioWorking, settling: bioSettling, blocked: busy !== '', error: bioError,
                canUndo: !!bioUndo && t.bio === bioUndo.after, onImprove: () => { void improveBio() }, onUndo: undoBio,
              }}
            />
          )}
          {step === 'cover' && <CoverStep t={t} errors={errors} errText={errText} onCover={setCover} onGoTo={goTo} reconsentLine={reconfirm.cover} hidesProfile={mode === 'edit' && !t.coverOpen && !t.jobTypes.length} />}
          {step === 'finish' && (
            <FinishStep
              {...stepProps}
              signedIn={!!user}
              publishGate={publishGate}
              prefillAvatar={mode === 'join' ? prefill?.avatarUrl ?? null : null}
              prefillPhone={mode === 'join' ? prefill?.phone ?? null : null}
              imported={mode === 'join' && lastImport ? { phone: lastImport.phone, file: lastImport.file } : null}
              optInsNoticeChanged={reconfirm.optIns}
              // A new profile: the switch is the choice held on this page (ON unless hidden here), still blocked while the
              // Publish that carries it is on its way (a tap then could never reach the profile). Once a profile EXISTS — an
              // edit, or a join form after its first Publish (still mounted, teacherProfileId now set) — the server's word,
              // saved on toggle through its own endpoint (commit gate, opus round 4: a join form past its Publish must never
              // hold a hide on the page that no save could deliver — its next save names no profile and is refused).
              identityMark={mode === 'join' && !teacherProfileId
                ? { ...mark, on: !joinMarkHidden, canSave: true, local: true, busy: busy === 'saving', message: '', onToggle: (on) => setJoinMarkHidden(!on) }
                : { ...mark, canSave: !!teacherProfileId, local: false, busy: markBusy, message: markMessage, onToggle: (on) => { void toggleMark(on) } }}
              photoCheck={photoCheck && photoCheck.url === t.photoUrl ? photoCheck : null}
              photoAsk={mode === 'edit' && photoAsk && t.photoUrl === savedPhotoUrl ? photoAsk : null}
              videoRequired={videoRequired}
              cvRequired={cvRequired}
              videoProgress={videoProgress}
              media={{
                busy, onPhoto: uploadPhoto, onVideo: uploadVideo, privateVideo, savedPublicUrl, ownVideoUrl, ownVideoBusy, videoRemoving,
                confirmVideoRemove, setConfirmVideoRemove, onWatchOwnVideo: watchOwnVideo, onCloseOwnVideo: () => setOwnVideoUrl(null),
                onOwnVideoError: () => { setOwnVideoUrl(null); setFormError(tr('Your video could not be played. Tap Watch to try again.', 'Không phát được video của bạn. Bấm Xem để thử lại.')) },
                // A pick is checked as it is made (pickCv); letting it go takes its line with it.
                onRemovePrivateVideo: removePrivateVideo, cvName, cvFile, onCvPick: pickCv, onCvDiscard: () => { setCvFile(null); clearErrorsFor(['cv']) },
                onCvRemove: mode === 'edit' ? removeCv : null,
              }}
              edit={mode === 'edit' ? {
                live: status === 'live', listingLive, onToggleLive: toggleStatus, onDelete: deleteProfile,
                searchHidden, searchBusy, searchMessage, onToggleSearchHidden: (hide) => { void toggleSearchHidden(hide) },
              } : null}
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
            <AlertDialogDescription>{tr('When you save, these are removed from your profile:', 'Khi bạn lưu, những mục này sẽ bị xoá khỏi hồ sơ:')}</AlertDialogDescription>
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

      {/* "Start over": the saved answers are deleted from the account — confirmed first. */}
      <AlertDialog open={confirmStartOver} onOpenChange={setConfirmStartOver}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('Start your teacher profile over?', 'Bắt đầu lại hồ sơ giáo viên?')}</AlertDialogTitle>
            <AlertDialogDescription>{tr('Your saved answers are deleted from your account and this page opens empty.', 'Các câu trả lời đã lưu bị xoá khỏi tài khoản và trang này mở trống.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Keep my answers', 'Giữ câu trả lời')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { void startOver() }}>{tr('Start over', 'Bắt đầu lại')}</AlertDialogAction>
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
            <DrawerDescription className="text-left">{tr('Your profile is a public page: anyone, including schools and search engines, can see it.', 'Hồ sơ của bạn là một trang công khai: bất kỳ ai, kể cả các trường và công cụ tìm kiếm, đều có thể xem.')}</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 pt-4 text-sm text-body">
            <div className="space-y-2">
              <p className="font-semibold text-foreground">{tr('Shown on your profile', 'Hiển thị trên hồ sơ')}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{tr('Your name, photo, headline and about text', 'Tên, ảnh, tiêu đề và phần giới thiệu')}</li>
                <li>{tr('Your nationality, your English level and the languages you speak', 'Quốc tịch, trình độ tiếng Anh và các ngôn ngữ bạn nói')}</li>
                <li>{tr('Where you live — your city or province, and your HCMC district if you gave one — or “Not in Vietnam yet”', 'Nơi bạn sống — thành phố hoặc tỉnh, và quận ở TP.HCM nếu bạn cho biết — hoặc “Chưa ở Việt Nam”')}</li>
                <li>{tr('The places you can teach, online included', 'Những nơi bạn có thể dạy, kể cả trực tuyến')}</li>
                <li>{tr('What you teach, who you teach and how long you have taught; your teaching jobs, degree and certificates', 'Môn dạy, đối tượng và thời gian giảng dạy; công việc giảng dạy, bằng cấp và chứng chỉ')}</li>
                <li>{tr('The work you want, when you can start and your expected salary', 'Công việc bạn muốn, thời gian có thể bắt đầu và mức lương mong muốn')}</li>
                <li>{tr('Your intro video — only if you choose to show it', 'Video giới thiệu — chỉ khi bạn chọn hiển thị')}</li>
                <li>{tr('Cover lessons — your free periods, hourly rate and where schools find you — only while cover is on', 'Dạy thay — các buổi rảnh, mức phí theo giờ và nơi các trường tìm bạn — chỉ khi đang bật dạy thay')}</li>
                {/* ⛔ "IDENTITY VERIFIED" IS PUBLISHED WITH THE PROFILE SINCE 2026-10-16 (owner: automatic once verified), so it
                    is on this list — the text PUBLISH_NOTICE_VERSION stands for, bumped with it (profile.ts). Its meaning
                    must stay the switch's notice (finish-step.tsx IdentityMarkNote) and the identity declaration's clause. */}
                <li>{tr('“Identity verified” — while your identity check is current and the name on your profile matches your ID (never your document); you can hide it', 'Nhãn “Đã xác minh danh tính” — khi việc xác minh còn hiệu lực và họ tên trên hồ sơ khớp với giấy tờ (không bao giờ hiển thị giấy tờ); bạn có thể ẩn nhãn')}</li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="font-semibold text-foreground">{tr('Never public', 'Không bao giờ công khai')}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{tr('Your phone number, email and CV — the person you are chatting with gets them only when you tap Share in that chat', 'Số điện thoại, email và CV — người đang trò chuyện với bạn chỉ nhận được khi bạn bấm Chia sẻ trong tin nhắn với họ')}</li>
                <li>{tr('An intro video you keep private — you send it to the people you choose', 'Video giới thiệu bạn giữ riêng tư — bạn gửi cho những người bạn chọn')}</li>
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
