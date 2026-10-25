import type { Metadata } from 'next'
import { StudentDetail } from '@/components/classroom/student-detail'

// The tab's title in the reader's language (C3b review: these were English on the Vietnamese pages too).
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return { title: lang === 'vi' ? 'Học viên' : 'Student' }
}

// /classroom/students/<seatId> — the teacher's page for one student: settings, "Working on", the next session, the reports.
export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Keyed by the seat: one student's page never carries another's state (C3b review, codex).
  return <StudentDetail key={id} seatId={id} />
}
