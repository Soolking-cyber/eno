import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { tosAcceptanceStamp } from '@/lib/site-legal'
import { isCurrentUserAdEmailWithheldByClaims } from '@/lib/admin'
import { sendMetaCapiEvent, metaUserDataFromHeaders, metaCapiConfigured } from '@/lib/meta-capi'
import { parseAttributionCookie } from '@/lib/attribution'
import { serverConsent } from '@/lib/consent-value'
import { autoClaimHandle } from '@/lib/handle'
import { logError } from '@/lib/log'

/** The Profile fields a first onboarding reads. */
export type OnboardingProfile = { id: string; email: string | null; phone: string | null; displayName: string | null; tosVersion: string | null }

/**
 * WHAT A FIRST ONBOARDING SENDS BESIDES THE PROFILE ROW — one function for /api/profile/account-type (the /onboard chooser)
 * and recordIndividualOnboarding below, so the two can never send different things: the visitor's attribution (only with
 * analytics consent) and Meta's CompleteRegistration (its consent rules live in meta-capi.ts). Both run after the response.
 */
export async function firstOnboardingEffects(req: Request, profile: OnboardingProfile, accountType: string, phone: string | null): Promise<void> {
  const attr = serverConsent(req.headers).a ? parseAttributionCookie(req.headers.get('cookie')) : null
  // Persist the channel onto the Profile — AFTER the response flushes (never delays onboarding) and wrapped so a
  // not-yet-migrated DB (columns missing until the schema push runs) can't break signup. Exact + queryable once migrated.
  if (attr) {
    after(async () => {
      try {
        await db.profile.update({
          where: { id: profile.id },
          data: {
            attrSource: attr.source,
            attrMedium: attr.medium,
            attrCampaign: attr.campaign ?? null,
            attrReferrer: attr.referrer ?? null,
            attrLandingAt: attr.landingAt ? new Date(attr.landingAt) : new Date(),
          },
        })
      } catch (e) {
        console.error('[attr] persist failed (run the Profile schema push?)', e)
      }
    })
  }

  // Server-side conversion (CompleteRegistration) for Meta ad optimization. Fires AFTER the response flushes (zero added
  // latency) and no-ops until CAPI env is set.
  // ⛔ An Apple-linked account's email never becomes `em` (Sign in with Apple D14 — meta-capi.ts); asked only when CAPI is
  // configured, from the locally verified token — no auth-server round trip.
  // D14, widened to LinkedIn (src/lib/ad-email.ts): the field keeps its name; it means "this email is withheld".
  const appleLinked = metaCapiConfigured() ? await isCurrentUserAdEmailWithheldByClaims() : false
  after(() =>
    sendMetaCapiEvent('CompleteRegistration', {
      eventSourceUrl: req.headers.get('referer') || undefined,
      userData: metaUserDataFromHeaders(req.headers, { email: profile.email, phone, externalId: profile.id, appleLinked }),
      customData: {
        content_name: 'eno_account',
        status: accountType,
        ...(attr ? { source: attr.source, medium: attr.medium, campaign: attr.campaign } : {}),
      },
    }),
  )
}

/**
 * ⛔ THE ONE-TIME ACCOUNT STEP FOR A FLOW THAT KEEPS ITS PLACE (onboarding-gate.ts resumesInPlace — the teacher form, owner
 * 2026-10-11). A new account that signed in on such a form is never sent to /onboard, so the form's own action records
 * what /onboard's "Continue" records for an individual: the account type, the Terms acceptance (tosAcceptanceStamp — the
 * version in force) and a display name ONLY where the account has none. (The chooser's other individual work does not
 * apply: claimGuestStorefront is its business branch; revertToPersonalHandle frees a SHOP handle — see below.)
 *   · ⛔ WRITTEN IN THE ACTION'S OWN TRANSACTION, CONDITIONALLY: the caller applies `data` with
 *     `updateMany({ where: { id, accountType: null } })` beside its own writes (the teacher publish — publish.ts
 *     saveTeacherProfile `onboard`), so the profile and the account step commit together or not at all — never a live
 *     profile on an untyped account with no Terms record (commit gate, codex 2026-10-11) — and a type chosen meanwhile
 *     (another tab, a stale form) is never overwritten, nor ever switched from business.
 *   · The caller must have SHOWN the Terms line beside its action — that line is the assent (onboard-client.tsx says why).
 *     The age is confirmed at sign-in (sign-in-form.tsx's line), as for /onboard.
 */
export function individualOnboardingWrite(
  profile: Pick<OnboardingProfile, 'displayName' | 'tosVersion'>,
): { data: { accountType: 'individual'; tosAcceptedAt?: Date; tosVersion?: string }; nameIfNone: boolean } {
  // `nameIfNone`: the caller writes the display name from ITS OWN validated, screened answer (the teacher save: the
  // normalized fullName it publishes — never the raw body, commit gate opus 2026-10-11), only where the account has none.
  return { data: { accountType: 'individual', ...tosAcceptanceStamp(profile.tosVersion) }, nameIfNone: !profile.displayName }
}

/**
 * After that write COMMITTED: the personal handle (autoClaimHandle — ⚠️ NOT revertToPersonalHandle, the chooser's
 * individual branch: it frees the account's SHOP handle, and the teacher publish has just made a storefront), then
 * firstOnboardingEffects. Best-effort and logged, NEVER thrown: the account step is already recorded, and a failure here
 * must not turn a published profile into an error.
 */
export async function afterIndividualOnboarding(req: Request, profile: OnboardingProfile, name: string | null): Promise<void> {
  // autoClaimHandle never throws (its contract); the catch is for a future that breaks it.
  await autoClaimHandle({ profileId: profile.id }, name).catch((e) => logError(e, { op: 'onboarding.handle' }))
  await firstOnboardingEffects(req, profile, 'individual', profile.phone).catch((e) => logError(e, { op: 'onboarding.firstEffects' }))
}
