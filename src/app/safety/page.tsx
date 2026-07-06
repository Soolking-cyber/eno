import type { Metadata } from 'next'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'

export const metadata: Metadata = { title: 'Safe trading | eno.vn' }

const tips = [
  ['Meet in public', 'Always meet in a busy, public place during daylight to inspect items and complete trades.'],
  ['Inspect before paying', 'Check the item matches the photos and description. Test electronics, start the motorbike, view the room.'],
  ['Never pay a deposit via links', 'eno.vn never asks for deposits through chat links. Treat any such request as a scam.'],
  ['Prefer trusted sellers', 'Trust badges are earned from real activity — verified accounts, good reviews, clean track records. Higher-trust sellers rank first.'],
  ['Keep chats on the record', 'Use messaging so there’s a record of what was agreed. Be wary of pressure to move off-platform.'],
  ['Report anything suspicious', 'See a too-good-to-be-true price or a fake-looking post? Report it and we’ll review. Every report is acknowledged within 3 working days, and confirmed violations carry real trust penalties.'],
]

export default function SafetyPage() {
  return (
    <ContentPage
      eyebrow="Safe trading"
      title="Trade with confidence."
      intro={<Tr text="Verification removes most of the risk — but a few simple habits keep every trade safe." />}
    >
      <ContentSection wide>
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {tips.map(([title, text], i) => (
            <div key={i}>
              <h3 className="text-sm font-bold text-foreground"><Tr text={title} /></h3>
              <p className="mt-1 text-sm leading-relaxed text-body"><Tr text={text} /></p>
            </div>
          ))}
        </div>
      </ContentSection>
    </ContentPage>
  )
}
