import type { Metadata } from 'next'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { TrustScore } from '@/components/marketplace/trust-score'
import { Tr } from '@/context/language-context'

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

// Clear action → points table. Green for rewards, red for penalties.
function Points({ rows }: { rows: [string, number, string][] }) {
  return (
    <div>
      {rows.map(([action, pts, sub], i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-2">
          <div className="min-w-0">
            <div className="text-sm text-foreground"><Tr text={action} /></div>
            {sub && <div className="text-xs text-ink-4"><Tr text={sub} /></div>}
          </div>
          <span className={`shrink-0 text-sm font-bold tabular-nums ${pts > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{pts > 0 ? `+${pts}` : pts}</span>
        </div>
      ))}
    </div>
  )
}

export default function TrustPage() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-3xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-16">
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

        <section className="mt-10 space-y-3">
          <h2 className="h-section text-foreground"><Tr text="Verify to reach 100" /></h2>
          <p className="text-sm text-body"><Tr text="A new account starts at 60. These one-time steps lift it to full standing — phone + Zalo is enough for individuals; businesses add KYC." /></p>
          <div className="mt-1">
            <Points rows={[
              ['Verify your phone', 15, 'Everyone — the baseline trust step'],
              ['Link your Zalo', 10, 'A trusted contact channel; great for tourists & individuals'],
              ['Complete KYC (identity)', 15, 'The key step for businesses → full standing'],
              ['Complete your profile', 5, 'Photo, bio, location, contact'],
            ]} />
          </div>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="h-section text-foreground"><Tr text="Grow your score" /></h2>
          <p className="text-sm text-body"><Tr text="Ongoing rewards. Only completed sales are uncapped — and they need real money + a real buyer, so trust can't be faked." /></p>
          <div className="mt-1">
            <Points rows={[
              ['Complete a sale on eno.vn', 5, 'No limit — the more real deals you close, the higher you climb & rank'],
              ['Get a review from a verified buyer', 3, 'Only real buyers who transacted can review'],
              ['Keep listings fresh (confirm availability)', 2, 'Max once per day'],
              ['Reply quickly to buyers', 1, 'Max once per day'],
            ]} />
          </div>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="h-section text-foreground"><Tr text="What costs you trust" /></h2>
          <p className="text-sm text-body"><Tr text="Penalties are heavier than rewards by design — trust is hard to earn and easy to lose — but they heal over time for clean accounts." /></p>
          <div className="mt-1">
            <Points rows={[
              ['Confirmed scam or counterfeit', -25, 'Erases ~5 sales. Two of these → Restricted.'],
              ['Confirmed misrepresentation', -10, 'Wrong info, bait pricing, misleading photos'],
              ['Filing a false report', -10, 'Applied to the reporter — keeps reporting honest'],
              ['Confirmed minor issue (spam/duplicate)', -3, ''],
              ['Letting active listings go stale (7+ days)', -3, 'Per week, and only if you have active listings'],
            ]} />
          </div>
          <p className="text-xs text-muted-foreground"><Tr text="Clean accounts recover about +1/day back toward their pre-penalty score, so an honest mistake never marks you forever — but recent or repeated bad acts pause recovery." /></p>
        </section>

        <section className="mt-10 space-y-2">
          <h2 className="h-section text-foreground"><Tr text="Why this is fair to everyone" /></h2>
          <p className="text-sm leading-relaxed text-body">
            <Tr text="The numbers are tuned with game theory so honest sellers always come out ahead and bad actors fall behind: the only uncapped reward (completing real sales) requires real money and a real counterparty, so it can't be farmed — while a single confirmed scam wipes five sales. Higher trust ranks higher in search and the feed, so being reliable directly earns more views, chats, and sales. Newcomers can verify their way up, and one slip is recoverable — but repeat offenders sink and get their listings held." />
          </p>
        </section>
      </main>
      <Footer />
    </div>
  )
}
