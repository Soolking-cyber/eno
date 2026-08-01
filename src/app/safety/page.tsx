import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import type { LucideIcon } from 'lucide-react'
import {
  ShieldCheck, Images, MessageSquare, ClipboardCheck,
  Sun, Users, SearchCheck, Banknote, FileText,
  AlertTriangle, BadgeCheck, ScanLine, Lock, Scale, Flag, Info,
  Landmark, Globe, Receipt, Ban, Upload, Check, X,
} from 'lucide-react'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { COMPANY } from '@/lib/site-legal'
import { SERVICES_SAFETY } from '@/lib/edition-services-copy'
import { PROVIDER_OF_RECORD } from '@/lib/visa-provider'
import { CROSS_SITE_REL } from '@/lib/cross-site-links'

// ── /safety — ONE FILE, BOTH EDITIONS ───────────────────────────────────────────────
// Everything above the "visa services" section is marketplace guidance and renders on
// eno.vn AND eno.forum, because both are the same classifieds marketplace. The visa
// section renders ONLY on the services edition.
//
// ⚠️ THE VISA COPY IS NOT IN THIS FILE, AND THAT IS THE POINT. eno.vn is a licensed sàn
// TMĐT that may not so much as mention the service, and a runtime `IS_SERVICES &&` gate
// stops the RENDER while leaving the words in the artifact (measured — see
// src/lib/edition.ts). So the strings live in @/lib/edition-services-copy and
// @/lib/visa-provider, both of which next.config.ts aliases to empty stubs on a
// marketplace build. Keep BOTH: the gate controls behaviour, the alias controls the
// bundle. Adding a visa sentence directly to this file defeats the alias entirely.
//
// ⚠️ NAME THE SITE VIA `SITE_NAME`, NEVER "eno.vn". This page used to hardcode the
// marketplace domain in five places, which on eno.forum told visitors that a different
// website was the one protecting them and the one to email.

const DESCRIPTION =
  `How to trade safely on ${SITE_NAME}: vet the seller, meet in public, inspect before paying, spot the red flags, and what eno does to protect you — verification, screened listings, on-record chat and a real dispute process.`

export const metadata: Metadata = {
  title: `Safe trading | ${SITE_NAME}`,
  // The services build swaps the whole description rather than appending to it — an
  // appended clause pushes the useful half past the ~160 chars a result actually shows.
  description: IS_SERVICES && SERVICES_SAFETY.metaDescription ? SERVICES_SAFETY.metaDescription : DESCRIPTION,
  alternates: { canonical: '/safety' },
}

type Tip = [icon: LucideIcon, title: string, body: string]

// Vet the listing + seller before you spend time or travel.
const before: Tip[] = [
  [ShieldCheck, 'Prefer trusted sellers',
    'Trust badges are earned from real activity — a verified account, genuine reviews, and a clean track record — and they can be lost. A blue Trusted or gold Exceptional badge means real history; a brand-new account selling something valuable far below market deserves extra caution.'],
  [Images, 'Read the whole listing',
    'Check the photos actually match the item and description. Ask for extra photos or a short video of the things that matter — the serial number, the odometer, the room in daylight. Vague answers or recycled stock photos are a warning sign.'],
  [MessageSquare, 'Keep every chat on eno',
    'Message through eno so there’s a record of exactly what was agreed. If a seller rushes you onto Zalo, Messenger or Telegram before the basics are settled, slow down — off-platform there is no record and no way for us to help.'],
  [ClipboardCheck, 'Agree the details in writing',
    'Before you travel, confirm the final price, the condition, what’s included, and the exact time and public place to meet. A seller who won’t commit to specifics in writing may not be serious.'],
]

// The handover itself — where money and goods change hands.
const meeting: Tip[] = [
  [Sun, 'Meet in a busy public place, in daylight',
    'A crowded café, a shopping mall, or a bank lobby is ideal — somewhere with people and cameras. Avoid alleys, private homes, and late-night handovers. For a room or vehicle you must view on-site, don’t go alone.'],
  [Users, 'Tell someone where you’re going',
    'Share the meeting place and time with a friend or family member, and bring them along for higher-value items. There’s real safety in not arriving alone.'],
  [SearchCheck, 'Inspect fully before any money moves',
    'Test it properly: power on electronics and check every port, start the motorbike and read the papers and chassis number, view the room and the actual contract. Confirm serial numbers match the receipt or box.'],
  // Housing is the category where an expat loses the most money in one go, and the loss is
  // almost always a deposit paid to somebody who does not own the place.
  [FileText, 'Renting? Check the papers, not just the room',
    'Ask to see the owner’s ID and the ownership certificate (sổ đỏ / sổ hồng), and check the name on them matches the person signing. Insist on a written contract and a receipt for every payment. Confirm the landlord will register your stay with the local police — for a foreign tenant that is the landlord’s legal duty, and one who refuses is usually not the owner.'],
  [Banknote, 'Pay once, in person, at handover',
    'Hand over cash — or transfer — only when the item is in your hands and matches what was agreed. Never send money ahead to “hold” an item. If you transfer, confirm it truly landed in the seller’s account before you leave; screenshots can be faked.'],
]

// The patterns that mean: stop, don’t pay, walk away.
const redFlags: Tip[] = [
  [AlertTriangle, '“Send a deposit first”',
    `${SITE_NAME} never asks you to send a deposit to another user, and no honest seller needs one through a chat link. Any “pay to reserve”, “pay a shipping fee” or “pay a verification fee” request is a scam.`],
  [AlertTriangle, 'A price too good to be true',
    'If it’s dramatically cheaper than everything comparable, assume it’s bait — for a fake sale, a stolen item, or an account that vanishes the moment you pay.'],
  [AlertTriangle, 'Pressure and urgency',
    '“Lots of people are asking”, “transfer in 10 minutes or I’ll sell to someone else” — rushing you past a proper inspection is the oldest trick there is.'],
  [AlertTriangle, '“Ship it before you see it”',
    'A seller who refuses to meet in public and wants money up front for delivery is a risk you don’t need to take. Walk away.'],
  [AlertTriangle, '“I’m abroad — I’ll courier it to you”',
    'The standard rental and vehicle scam: the “owner” is overseas, the price is excellent, and all you have to do is transfer a deposit so the keys or the bike can be sent. Nothing ever arrives. If the person cannot meet you, there is no deal.'],
  [AlertTriangle, '“Read me the code”',
    'No legitimate trade ever needs an OTP, a bank password, a card number, or a code sent to your phone. Never read one out — that’s how accounts and money get taken.'],
  [AlertTriangle, 'A brand-new, empty account',
    'No listing history, no reviews, no trust — selling high-value goods cheap. On its own it’s a caution; combined with anything above, it’s your cue to stop.'],
]

// What the platform itself does — stated honestly, no promises we don’t keep.
const protection: Tip[] = [
  [BadgeCheck, 'Verified accounts, earned trust',
    'Sellers verify a real phone number, and the trust score is built from genuine activity and reviews — never bought. It’s losable: confirmed reports pull it down, and low-trust accounts get restricted.'],
  [ScanLine, 'Screened listings',
    'Every listing is scanned automatically — phone numbers are stripped from public text so deals stay on the record, images are checked, and banned content is blocked. Low-trust posts are held for review before they go live.'],
  [Lock, 'Contact stays on the record',
    'You must be signed in to message a seller, so there are no anonymous approaches — and the whole conversation is saved as evidence of exactly what was agreed.'],
  [Scale, 'A real dispute process',
    'Report a bad trade and it opens a private case room with a 72-hour window to submit evidence. We review both sides, and the reported seller never sees who reported them.'],
  [Flag, 'Reports that carry weight',
    'Every report is acknowledged within 3 working days. Confirmed violations carry real trust penalties, and repeat or serious offenders are restricted or removed.'],
  [Info, 'We don’t hold your money — so inspect first',
    `${SITE_NAME} is not an escrow service and does not hold payments between users: in a listing deal you pay the seller directly, in person. That’s exactly why the habits above matter — your inspection at handover is your protection.`],
]

// If it goes wrong — ordered, do-this-now steps.
const recovery: [title: string, body: string][] = [
  ['Stop contact and keep everything',
    'Don’t delete the conversation. Screenshots, receipts, and transfer records are your evidence — save them all.'],
  ['Report the seller or listing',
    'Use the Report button on the listing or inside the chat. It opens a case room where you can submit what happened and any proof.'],
  ['If money was lost, act fast',
    'Contact your bank immediately to try to reverse or freeze the transfer, and report the fraud to your local police (in Vietnam, the nearest công an phường).'],
  ['Reach eno support',
    `Email ${COMPANY.email} with your case details and we’ll help however we can.`],
]

// Icon NAMES come from the aliased services module (a module of copy may not import
// components), so they are resolved here. Unknown name → Info rather than a crash.
const SERVICES_ICONS: Record<string, LucideIcon> = { Landmark, Globe, Receipt, Ban, Upload, SearchCheck }
const servicesTips: Tip[] = SERVICES_SAFETY.tips.map((t) => [SERVICES_ICONS[t.icon] ?? Info, t.title, t.body])

function TipGrid({ tips, danger = false }: { tips: Tip[]; danger?: boolean }) {
  return (
    <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
      {tips.map(([Icon, title, body], i) => (
        <div key={i}>
          <Icon className={danger ? 'h-5 w-5 text-destructive' : 'h-5 w-5 text-accent-foreground'} strokeWidth={2} aria-hidden />
          <h3 className="mt-2 text-sm font-bold text-foreground"><Tr text={title} /></h3>
          <p className="mt-1 text-sm leading-relaxed text-body"><Tr text={body} /></p>
        </div>
      ))}
    </div>
  )
}

// The will-ask / will-never-ask pair. Two lists side by side, no boxes — the content-page
// design language separates chunks with spacing and headings only.
function AskList({ title, items, ok }: { title: string; items: string[]; ok: boolean }) {
  const Icon = ok ? Check : X
  return (
    <div>
      <h3 className="text-sm font-bold text-foreground"><Tr text={title} /></h3>
      <ul className="mt-3 space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <Icon
              className={ok ? 'mt-0.5 h-4 w-4 shrink-0 text-success' : 'mt-0.5 h-4 w-4 shrink-0 text-destructive'}
              strokeWidth={2.5}
              aria-hidden
            />
            <span className="text-sm leading-relaxed text-body"><Tr text={item} /></span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SafetyPage() {
  const sections = [
    { id: 'before', label: 'Before you meet' },
    { id: 'meeting', label: 'Meeting in person' },
    { id: 'red-flags', label: 'Red flags' },
    // Gated AND aliased: the anchor id and the label are both services-only copy, so neither
    // string exists in a marketplace build.
    ...(IS_SERVICES && SERVICES_SAFETY.navId ? [{ id: SERVICES_SAFETY.navId, label: SERVICES_SAFETY.navLabel }] : []),
    { id: 'protection', label: 'How eno protects you' },
    { id: 'help', label: 'If something goes wrong' },
  ]

  return (
    <ContentPage
      eyebrow="Safe trading"
      title="Trade with confidence."
      intro={
        <Tr text="Most trades on eno go smoothly — accounts are verified, listings are screened, and higher-trust sellers rank first. But the deal closes between you and the other person, so the last few metres are up to you. These habits keep every one of them safe." />
      }
      sections={sections}
    >
      <ContentSection id="before" title="Before you meet" wide>
        <TipGrid tips={before} />
      </ContentSection>

      <ContentSection id="meeting" title="Meeting in person" wide>
        <TipGrid tips={meeting} />
      </ContentSection>

      <ContentSection id="red-flags" title="Red flags — stop and walk away" wide>
        <p className="mb-6 max-w-3xl text-sm leading-relaxed text-body">
          <Tr text="Almost every scam shows one of these signs. If you see even one, don’t pay — pause, and report it." />
        </p>
        <TipGrid tips={redFlags} danger />
      </ContentSection>

      {IS_SERVICES && servicesTips.length > 0 && (
        <ContentSection id={SERVICES_SAFETY.navId} title={SERVICES_SAFETY.sectionTitle} wide>
          <p className="max-w-3xl text-sm leading-relaxed text-body">
            <Tr text={SERVICES_SAFETY.intro} />
          </p>
          {/* The provider-of-record disclosure, from the single source that owns it. Who does the
              work, who is answerable for it, and what this site is NOT — stated before the advice,
              because a visitor who reads nothing else must still leave with this. */}
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-foreground">
            <Tr text={PROVIDER_OF_RECORD.en} />
          </p>
          <div className="mt-8">
            <TipGrid tips={servicesTips} />
          </div>
          <div className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2">
            <AskList title={SERVICES_SAFETY.willTitle} items={SERVICES_SAFETY.will} ok />
            <AskList title={SERVICES_SAFETY.wontTitle} items={SERVICES_SAFETY.wont} ok={false} />
          </div>
          {/* The contextual cross-link. `rel` comes from cross-site-links.ts — noopener and
              deliberately NOT nofollow; read the constant before changing it. Plain text rather
              than an empty anchor if the href is ever missing. */}
          <p className="mt-10 max-w-3xl text-sm leading-relaxed text-body">
            <Tr text={SERVICES_SAFETY.crossLink.before} />{' '}
            {SERVICES_SAFETY.crossLink.href ? (
              <a
                href={SERVICES_SAFETY.crossLink.href}
                rel={CROSS_SITE_REL}
                className="font-semibold text-accent-foreground hover:underline"
              >
                {SERVICES_SAFETY.crossLink.label}
              </a>
            ) : (
              <span className="font-semibold text-accent-foreground">{SERVICES_SAFETY.crossLink.label}</span>
            )}{' '}
            <Tr text={SERVICES_SAFETY.crossLink.after} />
          </p>
        </ContentSection>
      )}

      <ContentSection id="protection" title={`How ${SITE_NAME} protects you`} wide>
        <TipGrid tips={protection} />
      </ContentSection>

      <ContentSection id="help" title="If something goes wrong">
        <ol className="space-y-5">
          {recovery.map(([title, body], i) => (
            <li key={i} className="flex gap-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-sm font-bold text-accent-foreground tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-foreground"><Tr text={title} /></h3>
                <p className="mt-1 text-sm leading-relaxed text-body"><Tr text={body} /></p>
              </div>
            </li>
          ))}
        </ol>
      </ContentSection>
    </ContentPage>
  )
}
