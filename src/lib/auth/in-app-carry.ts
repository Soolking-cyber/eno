/**
 * What "Continue with Google" carries out of an app's built-in browser (sign-in-form.tsx continueGoogleInBrowser).
 * The sign-in form is shared by every page and knows nothing of the teacher form, so the teacher join form, while it is
 * open and signed out, says here what to carry: its `#d=` value (encodeHandoff — step 1 only) and the address's own
 * query (the cover intent, the campaign tags). Nothing is registered anywhere else: every other page's sign-in carries
 * nothing (src/lib/auth/carry.ts).
 */
export type TeacherCarry = { answers: string; search: string }

/** The address parameter that carries the token to the phone's own browser (the join form takes it back). */
export const CARRY_PARAM = 'carry'

let provider: (() => TeacherCarry | null) | null = null

/** The teacher join form registers on mount (join mode, signed out) and clears on unmount. */
export function setTeacherCarry(fn: (() => TeacherCarry | null) | null): void {
  provider = fn
}

/** The registered form's answers right now — null when no teacher join form is open. */
export function teacherCarry(): TeacherCarry | null {
  try { return provider?.() ?? null } catch { return null }
}
