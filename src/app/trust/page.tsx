import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { TrustScore } from '@/components/marketplace/trust-score'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'

export const metadata: Metadata = {
  title: `How trust works — ${SITE_NAME}`,
  description: 'eno.vn uses a single Trust Score, shown in color, instead of stars. Learn how accounts earn and lose trust.',
  alternates: { canonical: '/trust' },
}

// Flat, single-canvas content page (matches Guide/About) — no boxes; the tier ladder
// and the points tables are rows separated by hairlines (divide-y), never panels.
function Band({ score, name, range, note }: { score: number; name: string; range: string; note: string }) {
  return (
    <div className="flex items-start gap-4 py-4">
      <TrustScore score={score} size="lg" />
      <div className="min-w-0">
        <div className="text-base font-bold text-foreground"><Tr text={name} /> <span className="text-sm font-normal text-ink-4">· <Tr text={range} /></span></div>
        <p className="mt-0.5 text-sm text-body"><Tr text={note} /></p>
      </div>
    </div>
  )
}

// Clear action → points table. Green for rewards, red for penalties.
function Points({ rows }: { rows: [string, number, string][] }) {
  return (
    <div className="divide-y divide-border">
      {rows.map(([action, pts, sub], i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground"><Tr text={action} /></div>
            {sub && <div className="mt-0.5 text-xs text-ink-4"><Tr text={sub} /></div>}
          </div>
          <span className={`shrink-0 text-sm font-bold tabular-nums ${pts > 0 ? 'text-success' : 'text-destructive'}`}>{pts > 0 ? `+${pts}` : pts}</span>
        </div>
      ))}
    </div>
  )
}

// Copy mirrors the v2 engine (src/lib/trust-math.ts): windowed + decayed composite,
// Bayesian reviews, Wilson responsiveness, frozen-scam rule, reviewer credibility,
// volume-gated tiers, dual-threshold demotion. Keep numbers in sync with TRUST.
export default function TrustPage() {
  return (
    <ContentPage
      title="How trust works on eno.vn"
      intro={<Tr text="Every account has one Trust Score — a single number, shown in color — instead of stars and badges. It is recomputed every day from what an account actually does on eno.vn, and recent behavior counts more than the past — so the score always reflects who a seller is now, not who they used to be." />}
      sections={[
        { id: 'colors', label: 'What the colors mean' },
        { id: 'built', label: 'How the score is built' },
        { id: 'reviews', label: 'Reviews' },
        { id: 'penalties', label: 'What costs you trust' },
        { id: 'fair', label: 'Fair by design' },
      ]}
    >
      <ContentSection id="colors" title="What the colors mean">
          <p className="text-sm text-body"><Tr text="Every account starts at 60 — a neutral 'Building' state, not a warning. The upper tiers are earned with real volume: a badge certifies a track record, never just a number." /></p>
          <div className="mt-1 divide-y divide-border">
            <Band score={175} name="Elite" range="160 and up" note="The top tier — a long, high-volume, spotless track record. The most trusted businesses on eno.vn." />
            <Band score={130} name="Exceptional" range="110–159" note="At least 10 completed deals in the last year, reviews from 5 different buyers, a proven fast-reply record, and 6 clean months." />
            <Band score={95} name="Trusted" range="85–109" note="A verified account with at least 3 completed deals and either 60 days on eno or reviews from 3 different buyers — plus a clean last 90 days." />
            <Band score={70} name="Building" range="60–84" note="Where every account starts, and where accounts with fewer than 3 completed deals stay. Not a penalty — just an unproven track record." />
            <Band score={45} name="Restricted" range="below 60" note="A serious or repeated confirmed problem — including any confirmed scam that hasn't been worked off. New listings may be held for review." />
          </div>
      </ContentSection>

      <ContentSection id="built" title="How the score is built">
          <p className="text-sm text-body"><Tr text="The score starts at 60 and adds four components, each with a hard ceiling — so no single tactic can be farmed to the top. Everything except verification is windowed: only recent behavior moves it." /></p>
          <div className="mt-1">
            <Points rows={[
              ['Verification', 25, 'One-time gates: verified phone +10, business identity (KYC) +10, account older than 90 days +5'],
              ['Quality', 40, 'Verified-buyer reviews (up to 25), proven reply speed (up to 10), fresh availability on your listings (up to 5)'],
              ['Track record', 25, 'Completed deals in the last 12 months — with diminishing returns, so volume alone can\'t buy the top'],
              ['Conduct', -90, 'Confirmed reports subtract, weighted by severity and by who reported — and fade only as described below'],
            ]} />
          </div>
      </ContentSection>

      <ContentSection id="reviews" title="Reviews that can't be gamed">
          <p className="text-sm text-body"><Tr text="Only verified buyers — people who actually completed a deal through eno chat — can review, and each buyer counts once per 90 days. Ratings are statistically smoothed toward the platform average, so two perfect ratings can never beat two hundred near-perfect ones. Reply speed is judged the same way: a proven rate over many conversations beats a lucky streak of three." /></p>
          <p className="text-sm text-body"><Tr text="Who says it matters too: reviews and reports from established, verified accounts carry full weight, while a day-old account carries very little — so burner accounts can neither inflate a friend nor sink a rival." /></p>
      </ContentSection>

      <ContentSection id="penalties" title="What costs you trust">
          <p className="text-sm text-body"><Tr text="Only reports confirmed by our moderators count, weighted by severity and by the reporter's credibility. Minor issues fade in about 3 months of clean trading; misrepresentation takes about a year." /></p>
          <div className="mt-1">
            <Points rows={[
              ['Confirmed scam or counterfeit', -45, 'Does NOT fade with time — see below'],
              ['Confirmed misrepresentation', -18, 'Wrong info, bait pricing, misleading photos — fades over ~1 year of clean trading'],
              ['Filing a false report', -10, 'Applied to the reporter — and every strike also halves the weight of their future reports'],
              ['Confirmed minor issue (spam/duplicate)', -5, 'Fades in ~3 months'],
            ]} />
          </div>
          <p className="text-xs text-muted-foreground"><Tr text="A confirmed scam is different: waiting does nothing. Its full penalty stays frozen until the seller completes 5 new clean deals — only then does it slowly start to fade, and it never drops below 40% of its weight. Time alone never launders fraud; reform requires behavior." /></p>
      </ContentSection>

      <ContentSection id="fair" title="Fair by design">
          <p className="text-sm leading-relaxed text-body">
            <Tr text="One hostile buyer can never sink a seller alone: reports only pull a tier down when they come from at least two different people AND exceed 2% of the seller's deals — or when a scam is confirmed. Penalties scale with your volume in practice, judgments are windowed so an old mistake doesn't mark you forever, and nothing heals by waiting: scores rise only through verification, real deals, real reviews, and fast replies. Daily gains are capped, so trust can only be built the slow, honest way — and higher trust ranks higher in search and the feed, so being reliable directly earns more views, chats, and sales." />
          </p>
      </ContentSection>
    </ContentPage>
  )
}
