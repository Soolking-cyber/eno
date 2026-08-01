import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { CROSS_SITE_REL } from '@/lib/cross-site-links'
import { PROHIBITED_SERVICES_CROSSLINK, PROHIBITED_SERVICES_SECTION } from '@/lib/prohibited-services-copy'

export const metadata: Metadata = {
  title: `Prohibited items & services | Hàng hóa & dịch vụ cấm | ${SITE_NAME}`,
  description: `Goods and services that must not be listed on ${SITE_NAME}, per Vietnamese law and platform policy.`,
  alternates: { canonical: '/prohibited' },
}

// ── Prohibited goods & services (part of the Operating Regulations) ─────────────
// Legal basis: Investment Law banned lines (as amended by Law 143/2025), Decree
// 98/2020, Weapons Law 42/2024, Pharmacy Law, Alcohol Law 44/2019, Resolution
// 173/2024 (vapes = banned goods), Advertising Law Art 7, CITES decrees, PDP Law
// 91/2025 Art 7. Mirrors market practice (Chợ Tốt/Shopee prohibited lists).
// Enforcement: automated banned-word screening at posting + reports + removal.
//
// ⚠️ THE FOUR SHARED GROUPS BELOW ARE COLLISION-CHECKED AGAINST A LIVE FILTER. They mirror
// BANNED_WORDS in src/lib/publish-guard.ts, whose terms were each tested against real listings
// ("bang gia" hits price lists, "ruou vang" hits wine fridges — deliberately EXCLUDED). Rewording
// an item here is free; adding a category because it "should" be screened is not, and the filter is
// not this page's to change. Prose only.
//
// ⚠️ THIS PAGE RENDERS ON BOTH EDITIONS. eno.vn (the licensed sàn TMĐT) and eno.forum share this one
// file, so every shared string has to be true on both — which is why the site names itself through
// SITE_NAME rather than saying "eno.vn". The services-only visa addendum lives in
// @/lib/prohibited-services-copy, aliased to an empty stub on a marketplace build: the IS_SERVICES
// gate stops it RENDERING, the alias stops the vocabulary reaching eno.vn's artifact, and both are
// required (src/lib/edition.ts has the measurement).
//
// ⚠️ NEITHER THE GROUP ITEMS NOR THE RAIL LABELS ARE HARVESTED INTO src/generated/ui-strings.ts.
// scripts/gen-ui-strings.mjs only sees `<Tr text="literal">` and `tr('literal')`; these render as
// `<Tr text={variable}>` from array data, so they translate lazily via /api/translate. That is the
// pre-existing behaviour of this page and it is also what keeps services copy out of the shared
// catalogue — do not "fix" it by inlining the visa strings as literals, which would ship them to
// every marketplace client inside ui-strings.ts.

const GROUPS: { id: string; title: string; items: string[] }[] = [
  {
    id: 'illegal',
    title: 'Illegal under Vietnamese law — never allowed',
    items: [
      'Drugs, drug precursors, laughing gas (bong cuoi)',
      'Weapons of any kind: firearms, ammunition, explosives, fireworks (all, including genuine Z121 resale), crude weapons (machetes, swords, crossbows, knuckledusters), stun guns, pepper spray, batons, handcuffs',
      'Military and police uniforms, insignia and equipment',
      'E-cigarettes, vapes and heated tobacco products (banned goods since 1 Jan 2025)',
      'Wildlife and wildlife products: ivory, rhino horn, tiger and pangolin products, bear bile, live wild animals (CITES)',
      'Counterfeit or fake goods of any kind; fake documents, diplomas, seals, invoices (VAT invoices)',
      'Currency, counterfeit money, unlicensed foreign exchange, gold bars',
      'Pre-activated or pre-registered SIM cards; phone numbers sold separately',
      'Personal data, customer lists or databases (prohibited by the Personal Data Protection Law)',
      'Human organs and tissue; pornographic or anti-state material; gambling machines and lottery tickets',
      'Hidden cameras, eavesdropping devices, speed-camera jammers',
      'Vehicles without legal papers; license plates or vehicle documents sold separately; stolen goods',
    ],
  },
  {
    id: 'regulated',
    title: 'Legal to own, but cannot be sold person-to-person online',
    items: [
      `Medicines of every kind — prescription, over-the-counter and herbal (online sale is restricted to licensed pharmacies with ordering functions, which ${SITE_NAME} does not provide)`,
      'Alcohol of any strength, including beer (online sale requires a trader license, buyer age gates and non-cash payment — impossible in a P2P classifieds format)',
      'Tobacco, cigars and shisha (licensed fixed-premises trade only; advertising is banned entirely)',
      'Prescription medical devices, contact lenses, hearing aids',
      'Breast-milk substitutes (formula) for children under 24 months, feeding bottles and teats (advertising is banned by law)',
      'Agro-chemicals and pesticides; industrial explosives and precursors',
    ],
  },
  {
    id: 'policy',
    title: 'Additional platform policy bans',
    items: [
      'Used underwear and intimates; ingestible cosmetics and supplements without a valid declaration number',
      'Recalled or expired products; food past its safe life',
      'Dog and cat meat; placenta and human-derived products',
      'Superstition items marketed with health or fortune claims',
      'Game accounts and in-game currency; like-farming and follower services',
      'Ride-hailing and delivery uniforms and account kits',
      'Maps or publications misrepresenting Vietnam’s sovereignty; heritage artifacts',
    ],
  },
  {
    id: 'services',
    title: 'Services that must not be offered',
    items: [
      'Lending, debt rollover (dao han), debt collection, currency exchange or remittance services',
      'Multi-level marketing (MLM) recruitment; investment schemes',
      'Matchmaking, dating or escort services; jobs at adult venues',
      'Any job employing children under 15; unlicensed labor-export services',
      'Sale or preparation of fake diplomas, documents or seals; private investigation and tracking services',
      'Insurance products (licensed distribution only)',
    ],
  },
]

// Both the section and its rail entry hang off this one boolean. The `items.length` half is not
// belt-and-braces theatre: on a marketplace build the module resolves to the stub, so without it the
// rail would render an anchor to `#` above an empty, untitled section.
const HAS_SERVICES_ADDENDUM = IS_SERVICES && PROHIBITED_SERVICES_SECTION.items.length > 0

const sections = [
  { id: 'illegal', label: 'Illegal — never allowed' },
  { id: 'regulated', label: 'Regulated — cannot be sold P2P' },
  { id: 'policy', label: 'Platform policy bans' },
  { id: 'services', label: 'Banned services' },
  ...(HAS_SERVICES_ADDENDUM ? [{ id: PROHIBITED_SERVICES_SECTION.id, label: PROHIBITED_SERVICES_SECTION.label }] : []),
  { id: 'enforcement', label: 'Enforcement' },
]

export default function ProhibitedPage() {
  return (
    <ContentPage
      eyebrow="Legal"
      title="Prohibited items & services"
      meta={<p className="mt-2 text-xs text-ink-4"><Tr text="Part of the Operating Regulations · Last updated: August 2026" /></p>}
      intro={<Tr text={`These goods and services must never be listed on ${SITE_NAME} — because Vietnamese law bans trading or advertising them, or because platform policy does. Listings are screened automatically when posted and removed when reported. Posting them leads to removal, trust penalties and, for serious or repeated violations, account bans — and may be reported to authorities where the law requires.`} />}
      sections={sections}
    >
      {GROUPS.map((g) => (
        <ContentSection key={g.id} id={g.id} title={g.title}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-body">
            {g.items.map((it) => (
              <li key={it}><Tr text={it} /></li>
            ))}
          </ul>
        </ContentSection>
      ))}
      {HAS_SERVICES_ADDENDUM && (
        <ContentSection id={PROHIBITED_SERVICES_SECTION.id} title={PROHIBITED_SERVICES_SECTION.title}>
          <p className="text-sm leading-relaxed text-body"><Tr text={PROHIBITED_SERVICES_SECTION.intro} /></p>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-body">
            {PROHIBITED_SERVICES_SECTION.items.map((it) => (
              <li key={it}><Tr text={it} /></li>
            ))}
          </ul>
        </ContentSection>
      )}
      <ContentSection id="enforcement" title="Enforcement">
        <p className="text-sm leading-relaxed text-body"><Tr text="Every new listing passes an automated screen (banned-keyword filter, photo requirement, contact-in-text scan) before going live, and every listing can be reported by any user. Confirmed violations are removed, the seller's trust score is docked per the published penalty table, and repeat or severe violations escalate through restriction to a permanent ban. Content identified by a competent state authority is removed within 24 hours of the request. If you spot something that should not be here, use the Report button — it genuinely helps." /></p>
        {IS_SERVICES && !!PROHIBITED_SERVICES_CROSSLINK.href && (
          <p className="text-sm leading-relaxed text-body">
            <Tr text={PROHIBITED_SERVICES_CROSSLINK.lead} />{' '}
            <a href={PROHIBITED_SERVICES_CROSSLINK.href} rel={CROSS_SITE_REL} className="font-semibold text-accent-foreground hover:underline">
              {PROHIBITED_SERVICES_CROSSLINK.label}
            </a>
            {'.'}
          </p>
        )}
      </ContentSection>
    </ContentPage>
  )
}
