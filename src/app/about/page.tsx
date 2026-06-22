import type { Metadata } from 'next'
import { ShieldCheck, Eye, BadgeCheck } from 'lucide-react'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Tr } from '@/context/language-context'

export const metadata: Metadata = { title: 'About | eno.vn' }

export default function AboutPage() {
  const steps = [
    { icon: <Eye className="h-5 w-5" />, title: 'Listing submitted', text: 'A seller posts an item with photos, price and location.' },
    { icon: <ShieldCheck className="h-5 w-5" />, title: 'eno.vn verifies', text: 'Our agent checks the item in person, by video, or against documents — within 24 hours.' },
    { icon: <BadgeCheck className="h-5 w-5" />, title: 'It goes live', text: 'Only verified listings appear in the feed. No fakes, no bait prices, no wasted trips.' },
  ]
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-3xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        <p className="eyebrow text-accent-foreground mb-2"><Tr text="About eno.vn" /></p>
        <h1 className="h-display text-foreground"><Tr text="The verified marketplace for Vietnam." /></h1>
        <p className="mt-4 text-[15px] leading-relaxed text-body">
          <Tr text="eno.vn is a classifieds marketplace built around one promise: every listing is checked before it goes live. Motorbikes, rentals, electronics, jobs and services — without the fakes and bait prices that waste your time." />
        </p>

        <h2 className="h-section text-foreground mt-10 mb-4"><Tr text="How verification works" /></h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-pop">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-foreground">{s.icon}</span>
              <h3 className="mt-3 text-sm font-bold text-foreground">{i + 1}. <Tr text={s.title} /></h3>
              <p className="mt-1 text-sm leading-relaxed text-body"><Tr text={s.text} /></p>
            </div>
          ))}
        </div>

        <h2 id="contact" className="h-section text-foreground mt-10 mb-2"><Tr text="Contact" /></h2>
        <p className="text-sm text-body">
          <Tr text="Questions or press:" /> <a href="mailto:support@eno.forum" className="font-semibold text-accent-foreground hover:underline">support@eno.forum</a>
        </p>
      </main>
      <Footer />
    </div>
  )
}
