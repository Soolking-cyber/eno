import type { Metadata } from 'next'
import { TutorDetail } from '@/components/classroom/tutor-detail'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return { title: lang === 'vi' ? 'Gia sư' : 'Tutor' }
}

// /classroom/tutors/<id> — one tutor: try it, give it to students, edit or archive it.
export default async function TutorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TutorDetail key={id} tutorId={id} />
}
