import type { Metadata } from 'next'
import { OwnVoiceFlow } from '@/components/classroom/own-voice-flow'

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return { title: lang === 'vi' ? 'Giọng nói của bạn' : 'Your own voice' }
}

// /classroom/voice — the teacher's own voice for their tutors (own-voice.ts). A static shell; the flow loads /api/classroom/own-voice.
export default function OwnVoicePage() {
  return <OwnVoiceFlow />
}
