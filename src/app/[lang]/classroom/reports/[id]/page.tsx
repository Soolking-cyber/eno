import type { Metadata } from 'next'
import { ReportView } from '@/components/classroom/report-view'

// The tab's title in the reader's language (C3b review: these were English on the Vietnamese pages too).
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return { title: lang === 'vi' ? 'Nhận xét' : 'Report' }
}

// /classroom/reports/<sessionId> — the report after a session, for the learner (or their parent) and their teacher.
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ReportView sessionId={id} />
}
