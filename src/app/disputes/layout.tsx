import type { Metadata } from 'next'

// Private surface — dispute case rooms must never be crawled or indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function DisputesLayout({ children }: { children: React.ReactNode }) {
  return children
}
