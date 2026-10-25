import type { Metadata } from 'next'
import { JoinFlow } from '@/components/classroom/join-flow'

// The tab's title in the reader's language (C3b review: these were English on the Vietnamese pages too).
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return { title: lang === 'vi' ? 'Tham gia lớp học' : 'Join a class' }
}

// /classroom/join/<code> — a seat's one-use invite (classroom.<base>/join/<code> 302s here). It keeps its place across
// sign-in (onboarding-gate.ts resumesInPlace) and records the account step itself (src/lib/classroom/join.ts).
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <JoinFlow code={code} />
}
