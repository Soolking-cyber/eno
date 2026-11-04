import type { Metadata } from 'next'
import { LibraryHub, libraryHubMetadata } from '@/components/marketplace/library-guide'

/** The English guides (src/lib/guides). Pinned to its language by the proxy (src/lib/lang-pinned.ts). */
export const revalidate = 3600

export function generateMetadata(): Metadata {
  return libraryHubMetadata('en')
}

export default function Page() {
  return <LibraryHub lang="en" />
}
