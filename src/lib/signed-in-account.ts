/**
 * Which account this tab is signed in as — announced by AuthProvider for code that sits ABOVE it.
 *
 * LanguageProvider wraps AuthProvider (src/app/[lang]/providers.tsx), so it cannot `useAuth()`. It
 * needs the account for one thing: its "this language is already saved to the Profile" marker. That
 * marker used to hold only the language, per BROWSER, so after switching accounts in one browser the
 * second account matched the first account's marker and its own Profile.locale was never written —
 * measured 2026-10-20: an account used in English still had `vi` stored, so the chat partner's
 * translate strip read "same language" and never appeared. The marker now carries the account id,
 * which only AuthProvider knows.
 *
 * `undefined` = not known yet (auth still booting); `null` = signed out.
 */
export const SIGNED_IN_ACCOUNT_EVENT = 'eno:signed-in-account'

let current: string | null | undefined

export function announceSignedInAccount(userId: string | null): void {
  if (current === userId) return
  current = userId
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<{ userId: string | null }>(SIGNED_IN_ACCOUNT_EVENT, { detail: { userId } }))
  }
}

/** The last announced account. A listener attached after the announcement reads it here. */
export function signedInAccount(): string | null | undefined {
  return current
}
