import type { Metadata } from 'next'
import { LibraryHub, libraryHubMetadata } from '@/components/marketplace/library-guide'

/** The Vietnamese guides (src/lib/guides). Pinned to its language by the proxy (src/lib/lang-pinned.ts). */
export const revalidate = 3600

export function generateMetadata(): Metadata {
  return libraryHubMetadata('vi')
}

export default function Page() {
  return <LibraryHub lang="vi" />
}
