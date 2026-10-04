/**
 * Native push, per platform — read by src/components/native/native-push.tsx.
 *
 * ⛔ ONE FLAG FOR BOTH PLATFORMS WAS A TRAP (plan R12, 2026-10-04). iOS push needs the paid Apple team's
 * APNs key + aps-environment entitlement; Android push needs a google-services.json the app does not
 * have. They become ready on different days, and a single `NEXT_PUBLIC_NATIVE_PUSH=1` flipped for iOS
 * would have prompted every Android user for a permission whose register() then fails. So each platform
 * has its own switch, flipped LAST in its own activation (NATIVE_PUSH_SETUP.md). The old shared
 * `NEXT_PUBLIC_NATIVE_PUSH` is no longer read — measured unset on both box env files the day it was
 * retired, so nothing that was on turns off.
 */
export function nativePushEnabled(platform: string | undefined): boolean {
  if (platform === 'ios') return process.env.NEXT_PUBLIC_NATIVE_PUSH_IOS === '1'
  if (platform === 'android') return process.env.NEXT_PUBLIC_NATIVE_PUSH_ANDROID === '1'
  return false
}
