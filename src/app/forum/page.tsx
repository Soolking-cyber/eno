import type { Metadata } from 'next'
import { ForumClient } from '@/components/forum/forum-client'

export const metadata: Metadata = {
  title: 'eno.forum — Vietnam, figured out together',
  description: 'A practical community forum for expats and locals in Vietnam to share firsthand help about visas, housing, work, daily life, and meetups.',
  alternates: { canonical: '/forum' },
}

export default function ForumPage() {
  return <ForumClient />
}
