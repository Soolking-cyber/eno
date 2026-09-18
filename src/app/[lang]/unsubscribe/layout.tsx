import type { Metadata } from 'next'

// Private surface — tokenized email-unsubscribe links must never be indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function UnsubscribeLayout({ children }: { children: React.ReactNode }) {
  return children
}
