import type { Metadata } from 'next'
import { TutorWizard } from '@/components/classroom/tutor-wizard'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return { title: lang === 'vi' ? 'Gia sư mới' : 'New tutor' }
}

// /classroom/tutors/new — make a tutor (face, room, voice, personality). A static shell; the wizard loads /api/classroom/tutors.
export default function NewTutorPage() {
  return <TutorWizard />
}
