import type { Metadata } from 'next'

// Private surface — report threads must never be crawled or indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return children
}
