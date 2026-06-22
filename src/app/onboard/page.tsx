import { Suspense } from 'react'
import type { Metadata } from 'next'
import { OnboardClient } from './onboard-client'

// Noindex — this is a private, post-sign-in interstitial, not a content page.
export const metadata: Metadata = {
  title: 'Welcome to eno.vn',
  robots: { index: false, follow: false },
}

export default function OnboardPage() {
  // OnboardClient reads ?next via useSearchParams, which requires a Suspense
  // boundary in the App Router.
  return (
    <Suspense>
      <OnboardClient />
    </Suspense>
  )
}
