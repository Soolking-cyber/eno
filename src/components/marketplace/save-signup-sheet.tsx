'use client'

import { useEffect } from 'react'
import { useAuth } from '@/context/auth-context'

/**
 * First-save sign-in prompt — a guest's first "save" tap is the moment an account explains itself,
 * so that is when auth is asked. `favorites-context` dispatches `eno:first-save`; the flag lives in
 * localStorage so it never nags twice.
 *
 * ⛔ IT OPENS THE ONE POPUP, AND THE SHEET IT REPLACED IS THE REASON THIS COMMENT IS LONG. There was
 * a bottom sheet here — "Saved! Now keep it.", a Google button and an email button — and NEITHER
 * button signed anyone in. Both called `openSignIn()`, so the visitor read a pitch, chose a method,
 * and was then shown the real popup asking the same question again. A second surface that only
 * forwards to the first is worse than no surface: it costs a tap, teaches a wrong mental model of
 * where accounts are made, and is one more place for the auth design to drift.
 * ⚠️ The framing is what was lost, and that is the accepted trade (owner, 2026-08-28: "only 1 popup
 * dont use other than this anywhere"). If the "you just saved something" context is wanted back, it
 * belongs INSIDE the card as a variant — `SignInCard` already takes listing context for exactly
 * this reason — never as another sheet in front of it.
 *
 * ⚠️ THE COMPONENT RENDERS NOTHING and is still mounted in providers.tsx on purpose: it is a
 * listener, not a UI. Deleting it would silently drop the first-save prompt altogether.
 */
export function SaveSignupSheet() {
  const { user, openSignIn } = useAuth()

  useEffect(() => {
    const onFirstSave = () => {
      if (user) return
      try {
        if (localStorage.getItem('eno:save-sheet-done')) return
        localStorage.setItem('eno:save-sheet-done', '1')
      } catch { /* private mode — show it anyway, once per session */ }
      openSignIn()
    }
    window.addEventListener('eno:first-save', onFirstSave)
    return () => window.removeEventListener('eno:first-save', onFirstSave)
  }, [user, openSignIn])

  return null
}
