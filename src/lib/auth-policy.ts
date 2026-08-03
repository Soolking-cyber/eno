/**
 * What a new account must prove before it is a full account.
 *
 * ⚠️ ONE CONSTANT, READ IN THREE PLACES, AND THEY MUST NOT DRIFT: the post-sign-in redirect
 * (lib/auth-finish.ts), the /onboard server guard (app/onboard/page.tsx) and the /onboard client
 * (onboard-client.tsx). A gate enforced in only some of them is worse than no gate — it becomes a
 * step a user can skip by typing a URL, while everyone else is stopped by it.
 *
 * ── The target policy (owner, 2026-08-02) ───────────────────────────────────────────────────────
 * "in sign up the requirements are email or gmail verify and phone verify — 2 should be required to
 * sign up, but for now test mode email only is good enough."
 *
 * EMAIL IS ALREADY MANDATORY AND ALREADY VERIFIED, by construction rather than by a check: there is
 * no password anywhere in this app. Every route in creates a session only by proving control of an
 * identity — a magic link or emailed code we mint ourselves (api/auth/email-link → auth/confirm),
 * Google OAuth, or a phone OTP. An unverified email cannot produce a session, so there is nothing
 * to add for the first half of the requirement.
 *
 * PHONE IS THE HALF THAT IS NOT ENFORCED. `Profile.phone` is nullable and mirrors a VERIFIED auth
 * phone (schema.prisma), so its presence is already proof — nobody can self-type it. Today it is
 * merely rewarded: +10 trust (TRUST.V_PHONE in lib/trust-math.ts). Nothing blocks on it.
 *
 * ── Why this ships OFF ──────────────────────────────────────────────────────────────────────────
 * `false` is the owner's explicit "for now" and it is also the only honest setting today: turning it
 * on would demand an OTP that production currently cannot deliver to most numbers. Measured in
 * Secret Manager 2026-08-02 — ZALO_APP_ID/SECRET/TEMPLATE, WHATSAPP_TOKEN/PHONE_ID and
 * SPEEDSMS_TOKEN are all UNSET on both eno-root-env and eno-services-env; only
 * TELEGRAM_GATEWAY_TOKEN is live. So a Vietnamese user without Telegram would hit a wall they
 * cannot pass. Flip this only once Zalo (VN) and WhatsApp (foreign) keys are in place — see
 * preferredOtpChannel() in lib/otp-channels.ts.
 *
 * ⚠️ FLIPPING IT IS RETROACTIVE, WHICH IS THE POINT AND ALSO THE RISK. The gate asks "does this
 * profile have a phone?", not "did this profile sign up after the rule changed" — so every EXISTING
 * account without one is sent through the step on their next sign-in. That is the correct reading of
 * "required to sign up" for a marketplace where trust is the product, but it is not a silent change:
 * measure how many are affected first (`select count(*) from "Profile" where phone is null`).
 */
export const SIGNUP_REQUIRES_PHONE = false

/** Shape both the server guard and the client step branch on, so they cannot disagree. */
export type OnboardingState = { accountType: string | null; phone: string | null }

/**
 * The single predicate for "is this account still mid-signup?".
 *
 * Exported and pure so it can be tested directly and reused by every enforcement point. Returns the
 * step that is outstanding, or null when the account is complete.
 */
export function pendingOnboardingStep(p: OnboardingState | null | undefined): 'account-type' | 'phone' | null {
  if (!p) return null // unknown identity → never assert a step; callers fail open (see page.tsx)
  if (!p.accountType) return 'account-type'
  if (SIGNUP_REQUIRES_PHONE && !p.phone) return 'phone'
  return null
}
