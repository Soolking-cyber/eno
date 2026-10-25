/**
 * eno CLASSROOM (owner, 2026-10-25) — a teacher's AI talking avatar that their students talk to at home to practise
 * speaking English; after every session the teacher sees what went wrong and edits what the next session works on.
 * Plan + the reviews that reshaped it: ~/.claude/plans/we-need-to-create-scalable-cocoa.md.
 *
 * Client-safe: no server imports. ⛔ Every enum here is ALSO a CHECK constraint in scripts/classroom-ddl.mjs — change
 * both, or the database refuses the row the API just accepted (src/lib/classroom/ddl.test.ts reads both files).
 */

/** classroom.<base> — the app's ADDRESS, which 302s to /classroom on the app origin (./host.ts says why). */
export const CLASSROOM_SUBDOMAIN = 'classroom'
/** Where the app's pages live on the app origin (src/app/[lang]/classroom). */
export const CLASSROOM_PATH = '/classroom'

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
export type Level = (typeof LEVELS)[number]

/** Minutes per session a teacher may set for a seat. */
export const SESSION_MINUTES = [5, 10, 15, 20] as const
export type SessionMinutes = (typeof SESSION_MINUTES)[number]

/** How hard the tutor corrects: soft = only what blocks meaning, strict = every error it hears. */
export const STRICTNESS = ['soft', 'balanced', 'strict'] as const
export type Strictness = (typeof STRICTNESS)[number]

/** A seat: made by the teacher (invited), claimed by an account holder (active), paused or removed by the teacher. */
export const SEAT_STATUSES = ['invited', 'active', 'paused', 'removed'] as const
export type SeatStatus = (typeof SEAT_STATUSES)[number]

/**
 * Who practises: the account holder themselves (18+, eno's Terms), or a CHILD the account holder is parent or legal guardian
 * of (owner, 2026-10-25: "Kids too, through parents"). A child has no login of their own.
 */
export const LEARNER_KINDS = ['self', 'child'] as const
export type LearnerKind = (typeof LEARNER_KINDS)[number]

export const SESSION_STATUSES = ['live', 'ended'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]
/** Why a session ended — the learner, the clock, the sweep (an abandoned session), or the kill switch. */
export const END_REASONS = ['learner', 'time', 'abandoned', 'kill_switch'] as const
export type EndReason = (typeof END_REASONS)[number]

/** avatar = Spatius animates the face; voice = the teacher's photo with a speaking ring (no Spatius at all). */
export const SESSION_MODES = ['avatar', 'voice'] as const
export type SessionMode = (typeof SESSION_MODES)[number]

export const PLAN_SOURCES = ['ai', 'teacher'] as const
export type PlanSource = (typeof PLAN_SOURCES)[number]
/** draft = the AI's, untouched · approved = a teacher saved or approved it · used = a session ran on it. */
export const PLAN_STATUSES = ['draft', 'approved', 'used'] as const
export type PlanStatus = (typeof PLAN_STATUSES)[number]

/** Pronunciation scoring of one learner turn (Azure, in after()); skipped = nothing to score (no speech, no service). */
export const ASSESS_STATUSES = ['pending', 'done', 'failed', 'skipped'] as const
/** A turn: reserved (processing — the reply on its way), answered (ok), or given up (failed). */
export const TURN_STATUSES = ['processing', 'ok', 'failed'] as const
/** The one turn flag: the learner mentioned harm (teacher-only, and eno admin). */
export const TURN_FLAGS = ['harm'] as const
export type AssessStatus = (typeof ASSESS_STATUSES)[number]

export const FEEDBACK_STATUSES = ['pending', 'ready', 'failed'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

/**
 * photo = the teacher's own profile photo with a speaking ring (voice-only — no Spatius at all; works before Spatius is
 * set up, and is every learner's fallback) · library = a ready-made 3D Spatius avatar · custom = a 3D likeness of the
 * teacher made from their profile photo (by hand, in Spatius Studio, after their consent).
 */
export const AVATAR_LOOKS = ['photo', 'library', 'custom'] as const
export type AvatarLook = (typeof AVATAR_LOOKS)[number]
export const CUSTOM_STATUSES = ['none', 'requested', 'ready', 'removed'] as const
export type CustomStatus = (typeof CUSTOM_STATUSES)[number]

/** The hard numbers the server enforces — one place, so the UI shows the limits the API applies. */
export const LIMITS = {
  /** Exchanges (one learner turn + the avatar's reply) per session. */
  turnsPerSession: 80,
  /** Longest learner turn the recorder sends, and the server accepts. */
  turnSeconds: 45,
  /** 45 s of 16 kHz mono PCM16 is 1.44 MB; the WAV header and a margin round it up. */
  turnBytes: 1_500_000,
  /** A turn may still land this long after the session's end (a reply in flight when the clock ran out). */
  deadlineGraceSeconds: 30,
  /** The tutor starts wrapping up with this much time left. */
  wrapUpSeconds: 60,
  /** At most one session a day per learner, whatever the week allows. Only a session the learner SPOKE in counts. */
  sessionsPerDay: 1,
  /** Starts a day, spoken in or not — a start that died (the mic refused) may be retried, but not without end. */
  startsPerDay: 3,
  sessionsPerWeekMax: 7,
  /** Under-13s: never longer than this, whatever the seat says. */
  childUnder13Minutes: 10,
  teacherTestsPerDay: 3,
  teacherTestMinutes: 3,
  inviteDays: 14,
  /** One Spatius token per session, plus this many re-mints (a reload) while it is live. */
  tokenMintsPerSession: 3,
  /** A Spatius token outlives the session's end by this much — never more. */
  tokenGraceSeconds: 120,
  /** A seat the teacher removed (or the learner left): its sessions are erased this many days later. */
  removedRetentionDays: 90,
  seatsPerTeacher: 30,
} as const

/** From this age a child also agrees, in their own words, before practising (Vietnam's PDP law). */
export const CHILD_ASSENT_AGE = 7
/** Spatius's Terms §11: no animated avatar for an under-13 until Spatius confirms parental consent suffices, in writing. */
export const SPATIUS_CHILD_AGE = 13
/** The oldest a CHILD learner can be: 18+ practise as themselves (eno's Terms: account holders are adults). */
export const ADULT_AGE = 18
