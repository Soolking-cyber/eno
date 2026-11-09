import type { Metadata } from 'next'
import { TutorWizard } from '@/components/classroom/tutor-wizard'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return { title: lang === 'vi' ? 'Sửa gia sư' : 'Edit tutor' }
}

// /classroom/tutors/<id>/edit — change one of the teacher's tutors. Keyed by the tutor: one tutor's draft never shows on another's.
export default async function EditTutorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TutorWizard key={id} tutorId={id} />
}
