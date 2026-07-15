import type { Metadata } from 'next'
import { ForumClient } from '@/components/forum/forum-client'

const title = 'eno.forum — Vietnam, figured out together'
const description = 'A practical community forum for expats and locals in Vietnam to share firsthand help about visas, housing, work, daily life, and meetups.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/forum' },
  openGraph: {
    title,
    description,
    siteName: 'eno.forum',
    type: 'website',
    url: '/forum',
  },
  twitter: {
    card: 'summary',
    title,
    description,
  },
}

export default function ForumPage() {
  return <ForumClient />
}
