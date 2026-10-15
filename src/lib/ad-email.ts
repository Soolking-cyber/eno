import { isAppleLinked } from './apple-signin'
import { isLinkedInLinked } from './linkedin-signin'

/**
 * ⛔ D14, WIDENED (2026-10-15): an email address a sign-in provider shared under terms that bar advertising use never
 * reaches an ad platform — Apple's (DPLA 3.3.5(C), the original D14) and LinkedIn's (API Terms 1.4 / 3.1: no use of
 * Content "for the purposes of advertising" or "to generate mass messages, promotions or offers"). A LinkedIn sign-up's
 * account email IS LinkedIn Content (ensureProfile copies it). Meta's `em` and TikTok's email are hashed only when this
 * answers false; the phone and the account id are nobody's provider data and stay.
 */
export function adEmailWithheld(appMetadata: unknown): boolean {
  return isAppleLinked(appMetadata) || isLinkedInLinked(appMetadata)
}
