import type { Metadata } from 'next'
import Link from 'next/link'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { Button } from '@/components/ui/button'
import { Search, MessageCircle, Tag, MapPin, Plus, BadgeCheck, Bell, Heart, Globe, ShieldCheck, ChevronRight } from 'lucide-react'

export const metadata: Metadata = {
  title: 'How eno.vn works — Guide | eno.vn',
  description: 'A quick guide to eno.vn: how to buy, sell, build trust, message, make offers and trade safely on Vietnam’s marketplace for the international community.',
}

const BUYER_STEPS: { Icon: typeof Search; title: string; body: string }[] = [
  { Icon: Search, title: 'Search & filter', body: 'Browse by category, area and price. Every seller has a public trust score, so you can see who’s reliable at a glance.' },
  { Icon: MessageCircle, title: 'Message or make an offer', body: 'Tap Message to chat in-app, or Make an offer to send a price. The seller can accept or counter.' },
  { Icon: MapPin, title: 'Meet & inspect', body: 'Agree a public meeting spot, check the item in person, and only pay once you’re happy.' },
]

const SELLER_STEPS: { Icon: typeof Search; title: string; body: string }[] = [
  { Icon: Plus, title: 'Post your listing', body: 'Pick a category, add details, price and photos. The VND price field has quick chips so big numbers are fast to type.' },
  { Icon: BadgeCheck, title: 'Build trust', body: 'Your listing goes live right away. Build a public trust score with good service to earn a Trusted badge.' },
  { Icon: MessageCircle, title: 'Reply & sell', body: 'Buyers message you in-app; you get a notification for every reply and offer. Share your number in chat when ready.' },
]

const FEATURES: { Icon: typeof Search; id?: string; title: string; body: string }[] = [
  { Icon: BadgeCheck, id: 'verification', title: 'Trust & reputation', body: 'Listings publish instantly and run automated checks (phone verified, no contact details in the text, at least one real photo). Every seller has a public trust score that rises with good service and falls when buyers report problems — the blue Trusted and gold Exceptional badges are earned, not given. A score is a signal, not a guarantee; always inspect before you pay.' },
  { Icon: Tag, title: 'Messaging & offers', body: 'All contact happens in-app: tap Message to chat, or Make an offer to send a price the seller can accept or counter. Phone/Zalo is exchanged inside the chat, never published on the listing — which keeps spam out.' },
  { Icon: Bell, title: 'Notifications', body: 'The bell at the top-right alerts you to new messages and offers in real time, on desktop and mobile. Each notification links straight to the conversation.' },
  { Icon: Heart, title: 'Saving listings', body: 'Tap the heart on any card or listing to save it. Your saved items live in the Saved tab — handy for comparing places or items before you decide.' },
  { Icon: Globe, title: 'Languages', body: 'The whole app and every listing auto-translate into 11 languages. We default to your device language; change it anytime in Account → Language.' },
  { Icon: ShieldCheck, title: 'Safe trading', body: 'Meet in public, inspect before paying, and never send a deposit through a link — eno.vn never asks for one. Report anything suspicious with the Report button.' },
]

export default function GuidePage() {
  return (
    <ContentPage
      eyebrow="Guide"
      title="How eno.vn works"
      intro={<Tr text="eno.vn is the trusted marketplace for Vietnam’s international community. Here’s everything you need in a couple of minutes." />}
      sections={[
        { id: 'buyers', label: 'For buyers' },
        { id: 'sellers', label: 'For sellers' },
        { id: 'features', label: 'Features' },
      ]}
    >
      <ContentSection id="buyers" title="For buyers" wide>
          <div className="mt-1 grid gap-x-8 gap-y-4 sm:grid-cols-3">
            {BUYER_STEPS.map(({ Icon, title, body }, i) => (
              <div key={title}>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-accent-foreground">{i + 1}</span>
                  <Icon className="h-4 w-4 text-accent-foreground" />
                </div>
                <h3 className="mt-3 text-sm font-bold text-foreground"><Tr text={title} /></h3>
                <p className="mt-1 text-xs leading-relaxed text-body"><Tr text={body} /></p>
              </div>
            ))}
          </div>
      </ContentSection>

      <ContentSection id="sellers" title="For sellers" wide>
          <div className="mt-1 grid gap-x-8 gap-y-4 sm:grid-cols-3">
            {SELLER_STEPS.map(({ Icon, title, body }, i) => (
              <div key={title}>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-accent-foreground">{i + 1}</span>
                  <Icon className="h-4 w-4 text-accent-foreground" />
                </div>
                <h3 className="mt-3 text-sm font-bold text-foreground"><Tr text={title} /></h3>
                <p className="mt-1 text-xs leading-relaxed text-body"><Tr text={body} /></p>
              </div>
            ))}
          </div>
      </ContentSection>

      <ContentSection id="features" title="Features & how they work" wide>
          <div className="mt-1 grid gap-x-10 gap-y-5 lg:grid-cols-2">
            {FEATURES.map(({ Icon, id, title, body }) => (
              <div key={title} id={id} className="scroll-mt-24 flex gap-3.5">
                <span className="mt-0.5 shrink-0 text-accent-foreground"><Icon className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-foreground"><Tr text={title} /></h3>
                  <p className="mt-1 text-sm leading-relaxed text-body"><Tr text={body} /></p>
                </div>
              </div>
            ))}
          </div>
      </ContentSection>

      <ContentSection>
        <div className="flex flex-wrap gap-2.5">
          <Button asChild variant="cta" size="none">
            <Link href="/post" className="px-5 py-2.5">
              <Plus className="h-4 w-4" /> <Tr text="Post a listing" />
            </Link>
          </Button>
          <Link href="/" className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted hover:text-accent-foreground">
            <Search className="h-4 w-4" /> <Tr text="Browse listings" />
          </Link>
        </div>
        <p className="mt-6 text-sm text-body">
          <Tr text="Looking for something specific?" />{' '}
          <Link href="/help" className="inline-flex items-center gap-0.5 font-semibold text-accent-foreground hover:underline">
            <Tr text="Visit the Help center" /> <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </p>
      </ContentSection>
    </ContentPage>
  )
}
