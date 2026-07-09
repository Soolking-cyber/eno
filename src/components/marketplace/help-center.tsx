'use client'

import Link from 'next/link'
import { Tr } from '@/context/language-context'
import { HelpFeedback } from '@/components/marketplace/help-feedback'
import { Button } from '@/components/ui/button'
import { Rocket, BadgeCheck, ShieldCheck, Mail, ChevronRight } from 'lucide-react'

// The Help Center body — shared by the standalone /help page AND the dashboard "Help"
// tab (so the tab opens inline, no redirect). Fills the caller's container (the /help
// page + dashboard both provide the canonical max-w-7xl); FAQ sections flow as
// borderless chunks in a 2-col grid at lg so the width is actually used.

const TOPICS: { Icon: typeof Rocket; label: string; href: string }[] = [
  { Icon: Rocket, label: 'How eno.vn works', href: '/guide' },
  { Icon: BadgeCheck, label: 'Trust & reputation', href: '/guide#verification' },
  { Icon: ShieldCheck, label: 'Safe trading', href: '/safety' },
  { Icon: Mail, label: 'Contact support', href: 'mailto:support@eno.vn' },
]

const MORE_LINKS: { label: string; href: string }[] = [
  { label: 'About eno.vn', href: '/about' },
  { label: 'How it works', href: '/guide' },
  { label: 'How trust works', href: '/trust' },
  { label: 'Safe trading', href: '/safety' },
  { label: 'Report a listing', href: '/safety' },
  { label: 'Post a listing', href: '/post' },
  { label: 'Saved listings', href: '/saved' },
  { label: 'Browse by brand', href: '/brands' },
  { label: 'Contact us', href: '/about#contact' },
  { label: 'Terms of use', href: '/terms' },
  { label: 'Privacy policy', href: '/privacy' },
]

const SECTIONS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Getting started',
    items: [
      ['What is eno.vn?', 'eno.vn is a trusted classifieds marketplace for Vietnam’s international community — housing, motorbikes, furniture, jobs and services. Every seller has a public trust score and buyers can report bad listings, so the feed stays free of fakes and bait prices.'],
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
      ['How do I post a listing?', 'Tap “Post”, choose a category, then add title, description, price, area and up to 6 photos. Submit and it goes live right away after automated checks.'],
      ['Why isn’t my listing visible yet?', 'Most listings go live instantly. A few are held briefly by an automated safety check (for example, missing photos or contact details in the text) — fix the issue and it appears.'],
      ['Can I edit or remove my listing?', 'Yes — manage your listings from your account. Mark items sold or remove them anytime.'],
      ['Why can’t I put my phone number in the listing?', 'Contact details aren’t allowed in the public fields — buyers reach you in-app, which protects you from spam and keeps every conversation in one place. You can share your number inside the chat.'],
    ],
  },
  {
    title: 'Trust & reputation',
    items: [
      ['What do the trust badges mean?', 'Every seller has a public trust score. A blue Trusted badge and a gold Exceptional badge are earned through a clean track record and good service; a low score flags a risky seller.'],
      ['Does a trust badge guarantee the item?', 'No — it reflects a seller’s track record, not a guarantee. Always inspect the item yourself before paying — see our Safe trading guide.'],
      ['How fast does my listing go live?', 'Right away — automated checks run instantly. Only a small number of posts are held for a quick safety review.'],
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

export function HelpCenter() {
  return (
    <div className="w-full">
      <p className="eyebrow text-accent-foreground mb-2"><Tr text="Help center" /></p>
      <h1 className="h-display text-foreground"><Tr text="How can we help?" /></h1>
      <p className="mt-3 text-sm leading-relaxed text-body">
        <Tr text="Answers to common questions about buying, selling, verification and staying safe on eno.vn." />
      </p>

      {/* Quick-link topic cards */}
      <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TOPICS.map(({ Icon, label, href }) => (
          <Link key={label} href={href} className="group flex flex-col gap-2 rounded-2xl p-4 transition-colors hover:bg-muted">
            <span className="flex h-9 w-9 items-center justify-center text-accent-foreground"><Icon className="h-5 w-5" /></span>
            <span className="text-xs font-bold leading-snug text-foreground group-hover:text-accent-foreground"><Tr text={label} /></span>
          </Link>
        ))}
      </div>

      {/* Categorized FAQ — chunked, two columns at lg */}
      <div className="mt-10 grid gap-x-14 gap-y-10 lg:grid-cols-2">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="h-section text-foreground"><Tr text={section.title} /></h2>
            <div className="mt-3 space-y-5">
              {section.items.map(([q, a]) => (
                <div key={q}>
                  <h3 className="text-[15px] font-bold text-foreground"><Tr text={q} /></h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-body"><Tr text={a} /></p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* More from eno.vn */}
      <section className="mt-12 border-t border-border pt-8">
        <h2 className="h-section text-foreground"><Tr text="More from eno.vn" /></h2>
        <div className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {MORE_LINKS.map(({ label, href }) => (
            <Link key={label} href={href} className="group flex items-center justify-between border-b border-border/60 py-3 text-sm font-semibold text-foreground transition-colors hover:text-accent-foreground">
              <Tr text={label} />
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-accent-foreground" />
            </Link>
          ))}
        </div>
      </section>

      {/* Send feedback / report a problem */}
      <section className="mt-12 border-t border-border pt-8">
        <h2 className="h-section text-foreground"><Tr text="Send us a message" /></h2>
        <p className="mt-1.5 mb-4 text-sm text-body">
          <Tr text="Share feedback or report a technical problem — it goes straight to our team." />
        </p>
        <HelpFeedback />
      </section>

      {/* Footer CTA */}
      <div className="mt-12 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold text-foreground"><Tr text="Still need help?" /></p>
          <p className="text-sm text-body"><Tr text="Our team replies within one business day." /></p>
        </div>
        <Button asChild variant="cta" size="none">
          <a href="mailto:support@eno.vn" className="shrink-0 px-5 py-2.5">
            <Mail className="h-4 w-4" /> support@eno.vn
          </a>
        </Button>
      </div>

      <p className="mt-6 text-sm text-body">
        <Tr text="New to eno.vn?" />{' '}
        <Link href="/guide" className="inline-flex items-center gap-0.5 font-semibold text-accent-foreground hover:underline">
          <Tr text="Read the quick guide" /> <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </p>
    </div>
  )
}
