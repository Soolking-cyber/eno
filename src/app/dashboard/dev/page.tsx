import type { Metadata } from 'next'
import { Suspense } from 'react'
import { DevClient } from './dev-client'

export const metadata: Metadata = {
  title: 'Developers | eno.vn',
  robots: { index: false, follow: false },
}

export default function Page() {
  return (
    <Suspense>
      <DevClient />
    </Suspense>
  )
}
