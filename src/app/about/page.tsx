import type { Metadata } from 'next'
import { ShieldCheck, Eye, BadgeCheck } from 'lucide-react'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Tr } from '@/context/language-context'

export const metadata: Metadata = { title: 'About | eno.vn' }

export default function AboutPage() {
  const steps = [
    { icon: <Eye className="h-5 w-5" />, title: 'Listing submitted', text: 'A seller posts an item with photos, price and location.' },
    { icon: <ShieldCheck className="h-5 w-5" />, title: 'Automated checks', text: 'Every post runs automated checks — phone verified, no contact details in the text, and at least one real photo.' },
    { icon: <BadgeCheck className="h-5 w-5" />, title: 'It goes live instantly', text: 'Listings publish right away. Sellers build a public trust score and buyers can report problems — so fakes and bait prices don’t last.' },
  ]
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-3xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        <p className="eyebrow text-accent-foreground mb-2"><Tr text="About eno.vn" /></p>
        <h1 className="h-display text-foreground"><Tr text="The trusted marketplace for Vietnam." /></h1>
        <p className="mt-4 text-[15px] leading-relaxed text-body">
          <Tr text="eno.vn is a classifieds marketplace built around trust: every seller has a public trust score, automated checks run on each post, and the community can report bad listings. Motorbikes, rentals, electronics, jobs and services — with fakes and bait prices caught fast." />
        </p>

        <h2 className="h-section text-foreground mt-10 mb-4"><Tr text="How trust works" /></h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <div key={i} className="rounded-2xl bg-card p-5 shadow-pop">
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
