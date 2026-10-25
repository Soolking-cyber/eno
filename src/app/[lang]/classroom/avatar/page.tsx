import type { Metadata } from 'next'
import { AvatarWizard } from '@/components/classroom/avatar-wizard'

// The tab's title in the reader's language (C3b review: these were English on the Vietnamese pages too).
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return { title: lang === 'vi' ? 'Avatar của bạn' : 'Your avatar' }
}

// /classroom/avatar — create or edit the teacher's AI avatar. A static shell; the wizard loads /api/classroom/avatar.
export default function ClassroomAvatarPage() {
  return <AvatarWizard />
}
