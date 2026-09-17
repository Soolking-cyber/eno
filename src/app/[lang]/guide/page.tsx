import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { Button } from '@/components/ui/button'
import { Search, Tag, Plus, BadgeCheck, Bell, Heart, Globe, ChevronRight, ShieldCheck } from "@/components/ui/icons"

export const metadata: Metadata = {
  title: `How ${SITE_NAME} works — Guide | ${SITE_NAME}`,
  description: 'A quick guide to eno.vn: how to buy, sell, build trust, message, make offers and trade safely on Vietnam’s marketplace for the international community.',
  alternates: { canonical: '/guide' },
}

// Ordered steps carry their sequence in a tint number chip — the same treatment as
// /safety's "If something goes wrong" list and /about's trust steps, so the whole
// content family speaks one visual language for "do this, then this".
const BUYER_STEPS: { title: string; body: string }[] = [
  { title: 'Search & filter', body: 'Browse by category, area and price. Every seller has a public trust score, so you can see who’s reliable at a glance.' },
  { title: 'Message or make an offer', body: 'Tap Message to chat in-app, or Make an offer to send a price. The seller can accept or counter.' },
  { title: 'Meet & inspect', body: 'Agree a public meeting spot, check the item in person, and only pay once you’re happy.' },
]

const SELLER_STEPS: { title: string; body: string }[] = [
  { title: 'Post your listing', body: 'Pick a category, add details, price and photos. The VND price field has quick chips so big numbers are fast to type.' },
  { title: 'Build trust', body: 'Your listing goes live right away. Build a public trust score with good service to earn a Trusted badge.' },
  { title: 'Reply & sell', body: 'Buyers message you in-app; you get a notification for every reply and offer. Share your number in chat when ready.' },
]

// `Icon` is any glyph from the shared icon set. `strokeWidth` is threaded even though the grid
// does not pass one today: if the grid ever starts re-tiering its stroke, a glyph that cannot take
// the prop must fail tsc rather than silently render at a different weight than its neighbours.
// Same shape as safety/page's.
type FeatureGlyph = (props: { className?: string; strokeWidth?: number }) => React.ReactNode
// ⚠️ THIS WRAPPER IS NOW A PASS-THROUGH AND COULD GO. It existed to render <EnoSeal variant="line">
// — the hand-drawn eno seal, forced to its line weight so its brand-100 chief was not the single
// filled thing in a six-bullet grid. The seal was replaced app-wide with Solar's shield-check
// (owner, 2026-08-13: "use solar"), which has no chief and no variants, so there is nothing left to
// adapt. It stays only because FeatureGlyph is the type the grid accepts alongside a plain icon;
// inline `ShieldCheck` directly if that union is ever simplified.
const SealGlyph: FeatureGlyph = ({ className, strokeWidth }) => (
  <ShieldCheck className={className} strokeWidth={strokeWidth} />
)
const FEATURES: { Icon: typeof Search | FeatureGlyph; id?: string; title: string; body: string }[] = [
  { Icon: BadgeCheck, id: 'verification', title: 'Trust & reputation', body: 'Listings publish instantly and run automated checks (phone verified, no contact details in the text, at least one real photo). Every seller has a public trust score that rises with good service and falls when buyers report problems — the blue Trusted and gold Exceptional badges are earned, not given. A score is a signal, not a guarantee; always inspect before you pay.' },
  { Icon: Tag, title: 'Messaging & offers', body: 'All contact happens in-app: tap Message to chat, or Make an offer to send a price the seller can accept or counter. Phone/Zalo is exchanged inside the chat, never published on the listing — which keeps spam out.' },
  { Icon: Bell, title: 'Notifications', body: 'The bell at the top-right alerts you to new messages and offers in real time, on desktop and mobile. Each notification links straight to the conversation.' },
  { Icon: Heart, title: 'Saving listings', body: 'Tap the heart on any card or listing to save it. Your saved items live in the Saved tab — handy for comparing places or items before you decide.' },
  { Icon: Globe, title: 'Languages', body: 'The whole app and every listing auto-translate into 11 languages. We default to your device language; change it anytime in Account → Language.' },
  // The shield-check: this bullet is eno telling a visitor how eno keeps them safe.
  { Icon: SealGlyph, title: 'Safe trading', body: 'Meet in public, inspect before paying, and never send a deposit through a link — eno.vn never asks for one. Report anything suspicious with the Report button.' },
]

export default function GuidePage() {
  return (
    <ContentPage
      title="How eno.vn works"
      intro={<Tr text="eno.vn is the trusted marketplace for Vietnam’s international community. Here’s everything you need in a couple of minutes." />}
      sections={[
        { id: 'buyers', label: 'For buyers' },
        { id: 'sellers', label: 'For sellers' },
        { id: 'features', label: 'Features' },
      ]}
    >
      <ContentSection id="buyers" title="For buyers" wide>
          <div className="mt-1 grid gap-x-8 gap-y-6 sm:grid-cols-3">
            {BUYER_STEPS.map(({ title, body }, i) => (
              <div key={title} className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-sm font-bold text-accent-foreground tabular-nums">{i + 1}</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-foreground"><Tr text={title} /></h3>
                  <p className="mt-1 text-sm leading-relaxed text-body"><Tr text={body} /></p>
                </div>
              </div>
            ))}
          </div>
      </ContentSection>

      <ContentSection id="sellers" title="For sellers" wide>
          <div className="mt-1 grid gap-x-8 gap-y-6 sm:grid-cols-3">
            {SELLER_STEPS.map(({ title, body }, i) => (
              <div key={title} className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-sm font-bold text-accent-foreground tabular-nums">{i + 1}</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-foreground"><Tr text={title} /></h3>
                  <p className="mt-1 text-sm leading-relaxed text-body"><Tr text={body} /></p>
                </div>
              </div>
            ))}
          </div>
      </ContentSection>

      <ContentSection id="features" title="Features & how they work" wide>
          <div className="mt-1 grid gap-x-8 gap-y-6 lg:grid-cols-2">
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
          {/* font-semibold on the BUTTON (see CLAUDE.md): on the asChild child it would be
              settled by stylesheet order rather than intent. gap-2 is the base already. */}
          <Button asChild variant="ghost" size="none" className="font-semibold">
            <Link href="/" className="flex cursor-pointer items-center rounded-xl px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-muted hover:text-accent-foreground">
              <Search className="h-4 w-4" /> <Tr text="Browse listings" />
            </Link>
          </Button>
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
