import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Tr } from '@/context/language-context'
import { Rocket, BadgeCheck, ShieldCheck, Mail, ChevronRight } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Help center | eno.vn',
  description: 'Answers about buying, selling, verification, messaging, offers and safe trading on eno.vn — the verified marketplace for Vietnam.',
}

// Quick links to the deeper guides. (Labels are English source — <Tr> auto-translates.)
const TOPICS: { Icon: typeof Rocket; label: string; href: string }[] = [
  { Icon: Rocket, label: 'How eno.vn works', href: '/guide' },
  { Icon: BadgeCheck, label: 'Verification & trust', href: '/guide#verification' },
  { Icon: ShieldCheck, label: 'Safe trading', href: '/safety' },
  { Icon: Mail, label: 'Contact support', href: 'mailto:support@eno.forum' },
]

// Comprehensive, categorized FAQ. [question, answer] pairs (English source).
const SECTIONS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Getting started',
    items: [
      ['What is eno.vn?', 'eno.vn is a verified classifieds marketplace for Vietnam’s international community — housing, motorbikes, furniture, jobs and services. Every listing is checked by an eno.vn agent before it goes live, so the feed stays free of fakes and bait prices.'],
      ['Do I need an account to browse?', 'No. Browsing and searching are open to everyone. You only sign in to message a seller, save a listing, make an offer, or post your own.'],
      ['Is eno.vn free to use?', 'Yes. Browsing and saving are always free, and posting a listing is free during the launch period.'],
      ['What areas do you cover?', 'We’re live across Ho Chi Minh City, with Hanoi, Da Nang and more coming soon.'],
      ['Which languages does eno.vn support?', 'The whole app and every listing auto-translate into 11 languages. Set yours in Account → Language; by default we follow your device language.'],
    ],
  },
  {
    title: 'Buying, messaging & offers',
    items: [
      ['How do I contact a seller?', 'Open a listing and tap “Message”. You chat in-app — the seller’s phone or Zalo is shared inside the conversation once they reply, never published on the listing.'],
      ['How do offers work?', 'On a listing, tap “Make an offer”, type your price (the input has quick chips so VND is fast to enter), and send. Your offer lands in the chat for the seller to accept or counter.'],
      ['Where do I see replies?', 'In Messages (the chat tab in the bottom bar) and via the notification bell at the top-right — you’re notified the moment a seller replies or sends an offer.'],
      ['How do I save a listing for later?', 'Tap the heart on any card or on the listing page. Saved items live in the Saved tab and stay on your device.'],
    ],
  },
  {
    title: 'Selling & posting',
    items: [
      ['How do I post a listing?', 'Tap “Post”, choose a category, then add title, description, price, area and up to 6 photos. Submit and an eno.vn agent verifies it — usually within 24 hours — before it goes live.'],
      ['Why isn’t my listing visible yet?', 'New listings stay hidden until an eno.vn agent verifies them. That short wait is exactly what keeps scams and fake prices out of the marketplace.'],
      ['Can I edit or remove my listing?', 'Yes — manage your listings from your account. Mark items sold or remove them anytime.'],
      ['Why can’t I put my phone number in the listing?', 'Contact details aren’t allowed in the public fields — buyers reach you in-app, which protects you from spam and keeps every conversation in one place. You can share your number inside the chat.'],
    ],
  },
  {
    title: 'Verification & trust',
    items: [
      ['What does “Verified by eno.vn” mean?', 'An eno.vn agent confirmed the listing in person, by video call, or against documents — so the photos, price and location are accurate. Look for the blue badge.'],
      ['Does verification guarantee the item?', 'It confirms the listing is genuine and accurately described. Always still inspect the item yourself before paying — see our Safe trading guide.'],
      ['How long does verification take?', 'Most listings are reviewed within 24 hours.'],
    ],
  },
  {
    title: 'Account & notifications',
    items: [
      ['How do I sign in?', 'Tap the account icon and sign in with your phone number, Google, or email. If you posted before with a phone number, sign in with that number to claim those listings.'],
      ['How do notifications work?', 'The bell at the top-right shows new messages and offers in real time. Opening it marks them read; each one links straight to the conversation.'],
      ['How do I change my language?', 'Account → Language. Your choice is remembered on this device.'],
    ],
  },
  {
    title: 'Safety & payments',
    items: [
      ['How do I trade safely?', 'Meet in a public place, inspect before you pay, and never send a deposit through a link. eno.vn never asks for a deposit. Read the full Safe trading guide.'],
      ['Someone is asking for a deposit via a link — is that normal?', 'No — that’s a classic scam. Don’t pay, and report the listing so we can remove it.'],
      ['How do I report a listing or user?', 'Use the “Report” button on any listing. Our team reviews reports quickly.'],
    ],
  },
]

export default function HelpPage() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-3xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        <p className="eyebrow text-[#0a66c2] mb-2"><Tr text="Help center" /></p>
        <h1 className="h-display text-[#1a202c]"><Tr text="How can we help?" /></h1>
        <p className="mt-3 text-sm leading-relaxed text-[#475569]">
          <Tr text="Answers to common questions about buying, selling, verification and staying safe on eno.vn." />
        </p>

        {/* Quick-link topic cards */}
        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TOPICS.map(({ Icon, label, href }) => (
            <Link
              key={label}
              href={href}
              className="group flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-pop transition-colors hover:border-[#0a66c2]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e8f1fb] text-[#0a66c2]"><Icon className="h-5 w-5" /></span>
              <span className="text-xs font-bold leading-snug text-[#1a202c] group-hover:text-[#0a66c2]"><Tr text={label} /></span>
            </Link>
          ))}
        </div>

        {/* Categorized FAQ */}
        <div className="mt-10 space-y-10">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="h-section text-[#1a202c]"><Tr text={section.title} /></h2>
              <div className="mt-3 divide-y divide-slate-200">
                {section.items.map(([q, a]) => (
                  <div key={q} className="py-4">
                    <h3 className="text-[15px] font-bold text-[#1a202c]"><Tr text={q} /></h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#475569]"><Tr text={a} /></p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Footer CTA */}
        <div className="mt-12 flex flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-pop sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-[#1a202c]"><Tr text="Still need help?" /></p>
            <p className="text-sm text-[#475569]"><Tr text="Our team replies within one business day." /></p>
          </div>
          <a href="mailto:support@eno.forum" className="flex shrink-0 items-center gap-2 rounded-xl bg-[#0a66c2] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182]">
            <Mail className="h-4 w-4" /> support@eno.forum
          </a>
        </div>

        <p className="mt-6 text-sm text-[#475569]">
          <Tr text="New to eno.vn?" />{' '}
          <Link href="/guide" className="inline-flex items-center gap-0.5 font-semibold text-[#0a66c2] hover:underline">
            <Tr text="Read the quick guide" /> <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </p>
      </main>
      <Footer />
    </div>
  )
}
