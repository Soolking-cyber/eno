import type { Metadata } from 'next'
import { ReportView } from '@/components/classroom/report-view'

export const metadata: Metadata = { title: 'Report' }

// /classroom/reports/<sessionId> — the report after a session, for the learner (or their parent) and their teacher.
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ReportView sessionId={id} />
}
