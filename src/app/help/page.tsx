import type { Metadata } from 'next'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Tr } from '@/context/language-context'

export const metadata: Metadata = { title: 'Help center | ENO' }

const faqs = [
  ['How do I post a listing?', 'Tap “Post a listing”, pick a category, add details, price, area and photos, then submit. An ENO agent verifies it within 24 hours before it goes live.'],
  ['What does “Verified by ENO” mean?', 'An ENO agent confirmed the listing in person, by video call, or against documents. Photos, price and location are accurate.'],
  ['Why can’t I see some listings?', 'Listings stay hidden until verified. That’s how we keep fakes and bait prices out of the feed.'],
  ['Is ENO free to use?', 'Browsing and saving are free. Posting a listing is free during the launch period.'],
  ['How do I contact a seller?', 'Open a listing and tap Message or Call. Keep deposits off chat links — see our Safe trading guide.'],
  ['What areas do you cover?', 'We’re live across Ho Chi Minh City, with Hanoi, Da Nang and more coming soon.'],
]

export default function HelpPage() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-10 pb-16">
        <p className="eyebrow text-[#0a66c2] mb-2"><Tr text="Help center" /></p>
        <h1 className="h-display text-[#1a202c]"><Tr text="Frequently asked questions" /></h1>
        <div className="mt-8 divide-y divide-slate-200">
          {faqs.map(([q, a], i) => (
            <div key={i} className="py-5">
              <h3 className="text-base font-bold text-[#1a202c]"><Tr text={q} /></h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#475569]"><Tr text={a} /></p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-[#475569]">
          <Tr text="Still stuck? Email" /> <a href="mailto:support@eno.forum" className="font-semibold text-[#0a66c2] hover:underline">support@eno.forum</a>.
        </p>
      </main>
      <Footer />
    </div>
  )
}
