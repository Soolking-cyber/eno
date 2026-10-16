'use client'

// ── HOW A NEW TEACHER PROFILE OPENS (owner, 2026-10-16: "start with this page and move cv read for later pages before its
// needed") ──
// No start screen any more: the form opens on step 1 ("Your plans") — on teacher.eno.vn and on eno.vn/teachers/join —
// and the CV reader is offered where a CV helps, on "Your teaching" and "About you" once signed in (teacher-form.tsx
// cvHandy). `?import=cv` (a link from a guide or an ad) still opens the reading panel directly on eno.vn.
// (2026-10-15 to -16 there were doors first: LinkedIn, the CV, "myself" — measured: 85% of the visitors are in
// Facebook's in-app browser, and a screen of choices before the first question was one more step to leave from.)
// Decided on the server, for the first paint (teachers/join/page.tsx).

export type TeacherStartProps = {
  /** `?import=cv` — the reading panel (eno.vn only: the teacher host has no session to read under). */
  importIntent: 'cv' | null
  /** A session cookie (or the app) came with the request: the account is awaited before the panel shows. */
  sessionHint: boolean
  /** Gemini on Vertex is configured (getGeminiVertex): the CV reader exists. */
  cvImport: boolean
  /** The campaign tags of this address (campaignQuery, without the `?`). */
  campaign: string
}

/** 'cv' — the reading panel; 'self' — the form. */
export type Door = 'self' | 'cv'

/** The reading panel for `?import=cv` on eno.vn with a reader configured; otherwise the form, on step 1. */
export function initialDoor(start: TeacherStartProps | undefined, draftHost: boolean): Door {
  return start && start.importIntent === 'cv' && start.cvImport && !draftHost ? 'cv' : 'self'
}
