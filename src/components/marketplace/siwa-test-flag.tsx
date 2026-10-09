'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { SIWA_TEST_PARAM, syncSiwaTestCookie } from '@/lib/apple-signin'

/**
 * `?siwa_test=1` on ANY page sets the Sign in with Apple tester cookie for 7 days; `?siwa_test=0` clears it
 * (plan §7.1, D15 — the prod tester pass behind `web-test`).
 *
 * ⚠️ GLOBAL, NOT IN THE SIGN-IN FORM, because both apps refuse deep links to /signin and /auth* (MainActivity,
 * AppDelegate): the Android tester arrives through `enovn://open?path=%2F%3Fsiwa_test%3D1`, which native-bootstrap
 * turns into a CLIENT-SIDE navigation — so this follows the search params instead of reading them once at load.
 * Renders nothing. providers.tsx mounts it only while `web-test` is in NEXT_PUBLIC_APPLE_SIGNIN, and
 * syncSiwaTestCookie checks the flag again, so the dark deploy carries neither the component nor a cookie.
 * ⚠️ useSearchParams needs the Suspense boundary providers.tsx gives it, or every route renders dynamically.
 */
export function SiwaTestFlag() {
  const value = useSearchParams()?.get(SIWA_TEST_PARAM) ?? null
  useEffect(() => {
    if (value !== null) syncSiwaTestCookie(`?${SIWA_TEST_PARAM}=${encodeURIComponent(value)}`)
  }, [value])
  return null
}
