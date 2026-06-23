import type { Metadata } from 'next'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { TrustScore } from '@/components/marketplace/trust-score'
import { Tr } from '@/context/language-context'
import { CalendarCheck, MessageSquareText, ShieldCheck, UserCheck, TriangleAlert, Clock, Phone } from 'lucide-react'

export const metadata: Metadata = {
  title: 'How trust works — eno.vn',
  description: 'eno.vn uses a single Trust Score, shown in color, instead of stars. Learn how accounts earn and lose trust.',
}

// Flat, single-canvas content page (matches Guide/About) — no boxes, separation by spacing.
function Band({ score, name, range, note }: { score: number; name: string; range: string; note: string }) {
  return (
    <div className="flex items-start gap-3">
      <TrustScore score={score} size="lg" />
      <div className="min-w-0">
        <div className="text-sm font-bold text-foreground"><Tr text={name} /> <span className="font-normal text-ink-4">· {range}</span></div>
        <p className="text-sm text-body"><Tr text={note} /></p>
      </div>
    </div>
  )
}

function Rule({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-accent-foreground">{icon}</span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground"><Tr text={title} /></div>
        <p className="text-sm text-body"><Tr text={body} /></p>
      </div>
    </div>
  )
}

export default function TrustPage() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-3xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-16">
        <h1 className="h-display text-foreground"><Tr text="How trust works on eno.vn" /></h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-body">
          <Tr text="Every account has one Trust Score — a single number, shown in color — instead of stars and badges. It reflects a real track record earned on eno.vn, so you can tell reliable people and businesses apart at a glance." />
        </p>

        <section className="mt-10 space-y-4">
          <h2 className="h-section text-foreground"><Tr text="What the colors mean" /></h2>
          <p className="text-sm text-body"><Tr text="New accounts start below 100 and earn up to it by verifying — a phone number and Zalo for individuals and tourists, plus identity verification (KYC) for businesses — so unverified strangers carry less trust up front. From there you rise or fall on your behavior." /></p>
          <div className="mt-2 space-y-4">
            <Band score={175} name="Elite" range="160 and up" note="The top tier — a long, high-volume, spotless track record. The most trusted businesses on eno.vn." />
            <Band score={130} name="Exceptional" range="110–159" note="A strong, clean track record with many completed deals." />
            <Band score={95} name="Good standing" range="85–109" note="Verified and reliable. Individuals reach this with phone + Zalo; businesses by adding KYC." />
            <Band score={70} name="Building" range="60–84" note="Where new accounts begin. Verify your phone, link Zalo (and KYC for businesses) to climb." />
            <Band score={45} name="Restricted" range="below 60" note="A serious or repeated problem, or an unverified account that's been reported. New listings may be held for review." />
          </div>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="h-section text-foreground"><Tr text="How you earn trust" /></h2>
          <div className="space-y-4">
            <Rule icon={<CalendarCheck className="h-5 w-5" />} title="Keep your listings fresh" body="Confirm your listings are still available regularly. Active, up-to-date sellers gain trust (and rise back to the top of the feed)." />
            <Rule icon={<ShieldCheck className="h-5 w-5" />} title="Complete sales through eno.vn" body="Every transaction closed on-platform earns trust — with no upper limit. The more deals you successfully complete, the higher you climb and the higher you rank. A small safety fee applies (10,000₫ under 1,000,000₫, or 1% above) that covers mediation and buyer protection." />
            <Rule icon={<MessageSquareText className="h-5 w-5" />} title="Earn reviews from verified buyers" body="Only people who actually completed a transaction with you through eno.vn can leave a review — so feedback is real, not farmed." />
            <Rule icon={<Clock className="h-5 w-5" />} title="Respond quickly" body="Fast, helpful replies to buyers build trust over time." />
            <Rule icon={<Phone className="h-5 w-5" />} title="Verify your phone + link Zalo" body="A verified phone (+15) and a linked Zalo account (+10) are the quickest trust steps — enough for tourists and individuals to reach good standing. Anyone can do these." />
            <Rule icon={<UserCheck className="h-5 w-5" />} title="Businesses: complete KYC" body="Passing identity verification (+15) is the key trust step for businesses — it takes a verified account all the way to full standing (100) and signals you're a real, accountable seller." />
          </div>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="h-section text-foreground"><Tr text="How you lose trust" /></h2>
          <div className="space-y-4">
            <Rule icon={<Clock className="h-5 w-5" />} title="Letting listings go stale" body="If you have active listings and don't confirm they're still available for several days, your score dips. Accounts with no active listings are never penalized for inactivity." />
            <Rule icon={<TriangleAlert className="h-5 w-5" />} title="Confirmed reports" body="Scams, counterfeits, and misrepresentation cut your score — heavier for more serious issues, and repeats compound." />
            <Rule icon={<TriangleAlert className="h-5 w-5" />} title="False reports" body="Filing reports that turn out to be false hurts the reporter's own score — keeping the system fair." />
          </div>
        </section>

        <section className="mt-10 space-y-2">
          <h2 className="h-section text-foreground"><Tr text="Why it matters" /></h2>
          <p className="text-sm leading-relaxed text-body">
            <Tr text="Trust drives ranking: higher-trust sellers appear higher in search and the feed, so reliable businesses get more views, more chats, and more sales. Buyers also see who's reliable at a glance from the color. Trust is earned, losable, and always reflects your real, recent track record on eno.vn — fair to newcomers (everyone starts at 100) and recoverable after a slip." />
          </p>
        </section>
      </main>
      <Footer />
    </div>
  )
}
