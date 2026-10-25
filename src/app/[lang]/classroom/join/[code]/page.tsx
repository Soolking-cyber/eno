import type { Metadata } from 'next'
import { JoinFlow } from '@/components/classroom/join-flow'

export const metadata: Metadata = { title: 'Join a class' }

// /classroom/join/<code> — a seat's one-use invite (classroom.<base>/join/<code> 302s here). It keeps its place across
// sign-in (onboarding-gate.ts resumesInPlace) and records the account step itself (src/lib/classroom/join.ts).
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <JoinFlow code={code} />
}
