import type { Metadata } from 'next'

// Private surface — moderation appeals must never be crawled or indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function AppealLayout({ children }: { children: React.ReactNode }) {
  return children
}
