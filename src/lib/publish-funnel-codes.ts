// The outcome codes the POST WIZARD reports for a Publish tap that never reached the server.
//
// ⚠️ ITS OWN MODULE BECAUSE publish-funnel.ts IS `import 'server-only'`. That import makes the
// module a build error inside a 'use client' file, so post-wizard.tsx could not share the
// allowlist and the five strings were duplicated as bare literals on the client. A typo there
// would compile, ship, and silently drop every event from that branch — the funnel would show a
// zero and nobody would know whether it meant "nobody hit this" or "the string is wrong". Both
// the wizard and the API route now import from here, so a mismatch is a TYPE ERROR.
//
// Keep this file free of server-only imports for exactly that reason.

/**
 * The five early returns in post-wizard.tsx's `submit()`, in the order they can occur.
 *
 * ⚠️ `client_signin_required` IS THE MOST VALUABLE OF THEM. It fires only when the form was
 * complete and VALID and the account was the last thing missing — so it separates "could not fill
 * the form" from "would not make an account", which are opposite problems with opposite fixes.
 * It is also the exact point where the onboarding bounce used to destroy uploaded photos (fixed
 * in 1298c088), and nothing else can tell us whether that fix helped.
 */
export const CLIENT_PUBLISH_OUTCOMES = [
  'client_missing_fields',
  'client_contact_in_name',
  'client_contact_in_text',
  'client_banned_words',
  'client_signin_required',
] as const

export type ClientPublishOutcome = (typeof CLIENT_PUBLISH_OUTCOMES)[number]

const CLIENT_SET: ReadonlySet<string> = new Set(CLIENT_PUBLISH_OUTCOMES)

/**
 * True only for one of the five codes above.
 *
 * ⚠️ THIS IS THE ENTIRE INPUT VALIDATION of a PUBLIC, UNAUTHENTICATED endpoint. Guests can post
 * listings, so the reporting route cannot require a session without blinding the funnel to the
 * first-time sellers it exists to measure. An allowlist of five constants is what stops the
 * counter table becoming a sink for attacker-chosen strings.
 */
export function isClientPublishOutcome(value: unknown): value is ClientPublishOutcome {
  return typeof value === 'string' && CLIENT_SET.has(value)
}
