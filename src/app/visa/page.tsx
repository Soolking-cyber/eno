import type { Metadata } from 'next'
import { ForumHeader } from '@/components/forum/forum-header'
import { ForumFooter } from '@/components/forum/forum-footer'
import { VisaAssistant } from '@/components/visa/visa-assistant'

const title = 'Vietnam e-Visa assistance'
const description = 'Upload your passport and portrait, review every answer, and follow your assisted Vietnam e-Visa application from draft to final document.'

export const metadata: Metadata = {
  title, description, alternates: { canonical: '/visa' },
  robots: { index: true, follow: true },
  openGraph: { title, description, siteName: 'eno.forum', type: 'website', url: '/visa' },
}

export default function VisaPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <ForumHeader />
      <VisaAssistant />
      <ForumFooter />
    </div>
  )
}
