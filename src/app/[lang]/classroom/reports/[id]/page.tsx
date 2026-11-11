import type { Metadata } from 'next'
import { ReportView } from '@/components/classroom/report-view'

// The tab's title in the reader's language (C3b review: these were English on the Vietnamese pages too).
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return { title: lang === 'vi' ? 'Nhận xét' : 'Report' }
}

// /classroom/reports/<sessionId> — the report after a session, for the learner (or their parent) and their teacher.
// `?done=1`: the lesson that just ended asks for the celebration (session-screen.tsx); the server decides whether it shows.
export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string | string[] }> }) {
  const { id } = await params
  const { done } = await searchParams
  // ⛔ NO WEB BAR ON A REPORT, FROM THE FIRST PAINT (gap 10; commit review, opus: a marker the client rendered after its fetch
  // showed the bar over the skeleton, then dropped it and the page jumped). Every reader's report — the family's and the
  // teacher's — is a full-screen page with its own back arrow (report-view.tsx); globals.css hides the header on it.
  return <><span data-classroom-bare hidden /><ReportView sessionId={id} justEnded={done === '1'} /></>
}
