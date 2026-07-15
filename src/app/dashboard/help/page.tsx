import type { Metadata } from 'next'
import { Suspense } from 'react'
import { HelpClient } from './help-client'

export const metadata: Metadata = {
  title: 'Help | eno.vn',
  robots: { index: false, follow: false },
}

export default function HelpPage() {
  return (
    <Suspense>
      <HelpClient />
    </Suspense>
  )
}
