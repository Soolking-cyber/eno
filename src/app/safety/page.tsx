import type { Metadata } from 'next'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Tr } from '@/context/language-context'

export const metadata: Metadata = { title: 'Safe trading | eno.vn' }

const tips = [
  ['Meet in public', 'Always meet in a busy, public place during daylight to inspect items and complete trades.'],
  ['Inspect before paying', 'Check the item matches the photos and description. Test electronics, start the motorbike, view the room.'],
  ['Never pay a deposit via links', 'eno.vn never asks for deposits through chat links. Treat any such request as a scam.'],
  ['Prefer verified listings', 'The “Verified by eno.vn” badge means an agent checked the listing in person — no fakes, no bait prices.'],
  ['Keep chats on the record', 'Use messaging so there’s a record of what was agreed. Be wary of pressure to move off-platform.'],
  ['Report anything suspicious', 'See a too-good-to-be-true price or a fake-looking post? Report it and we’ll review.'],
]

export default function SafetyPage() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-3xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        <p className="eyebrow text-accent-foreground mb-2"><Tr text="Safe trading" /></p>
        <h1 className="h-display text-foreground"><Tr text="Trade with confidence." /></h1>
        <p className="mt-4 text-[15px] leading-relaxed text-body">
          <Tr text="Verification removes most of the risk — but a few simple habits keep every trade safe." />
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {tips.map(([title, text], i) => (
            <div key={i} className="rounded-2xl bg-card p-5 shadow-pop">
              <h3 className="text-sm font-bold text-foreground"><Tr text={title} /></h3>
              <p className="mt-1 text-sm leading-relaxed text-body"><Tr text={text} /></p>
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
