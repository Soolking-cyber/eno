import type { Metadata } from 'next'
import { ShieldCheck, Eye, BadgeCheck } from 'lucide-react'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'

export const metadata: Metadata = {
  title: 'About | eno.vn',
  description: 'What eno.vn is and how it works: a trust-first classifieds marketplace for Vietnam, with verified sellers, public trust scores and screened listings.',
  alternates: { canonical: '/about' },
}

export default function AboutPage() {
  const steps = [
    { icon: <Eye className="h-5 w-5" />, title: 'Listing submitted', text: 'A seller posts an item with photos, price and location.' },
    { icon: <ShieldCheck className="h-5 w-5" />, title: 'Automated checks', text: 'Every post runs automated checks — phone verified, no contact details in the text, and at least one real photo.' },
    { icon: <BadgeCheck className="h-5 w-5" />, title: 'It goes live instantly', text: 'Listings publish right away. Sellers build a public trust score and buyers can report problems — so fakes and bait prices don’t last.' },
  ]
  return (
    <ContentPage
      eyebrow="About eno.vn"
      title="The trusted marketplace for Vietnam."
      intro={<Tr text="eno.vn is a classifieds marketplace built around trust: every seller has a public trust score, automated checks run on each post, and the community can report bad listings. Motorbikes, rentals, electronics, jobs and services — with fakes and bait prices caught fast." />}
    >
      <ContentSection title="How trust works" wide>
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-3">
          {steps.map((s, i) => (
            <div key={i}>
              <span className="flex h-8 w-8 items-center justify-center text-accent-foreground">{s.icon}</span>
              <h3 className="mt-3 text-sm font-bold text-foreground">{i + 1}. <Tr text={s.title} /></h3>
              <p className="mt-1 text-sm leading-relaxed text-body"><Tr text={s.text} /></p>
            </div>
          ))}
        </div>
      </ContentSection>

      <ContentSection id="contact" title="Contact">
        <p className="text-sm text-body">
          <Tr text="Questions or press:" /> <a href="mailto:support@eno.vn" className="font-semibold text-accent-foreground hover:underline">support@eno.vn</a>
        </p>
      </ContentSection>
    </ContentPage>
  )
}
