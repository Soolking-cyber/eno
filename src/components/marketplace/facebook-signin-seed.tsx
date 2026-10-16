'use client'

import { useEffect } from 'react'
import { seedFacebookSignIn } from '@/lib/facebook-flag'

/** A dynamic page's own answer to "is Facebook sign-in on?" (src/lib/facebook-flag.ts), from the server's probe. */
export function FacebookSignInSeed({ on }: { on: boolean }) {
  useEffect(() => { seedFacebookSignIn(on) }, [on])
  return null
}
