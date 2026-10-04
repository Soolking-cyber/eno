import type { Metadata } from 'next'
import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { AFFILIATION, COMPANY, OPERATOR_REGISTERED } from '@/lib/site-legal'
import { PROVIDER_LICENCE_ON_FILE, PROVIDER_OF_RECORD } from '@/lib/visa-provider'
import { Bilingual } from '@/components/marketplace/bilingual'
import { LANGUAGES } from '@/lib/i18n/langs'
import { POSTING_IS_FREE, aboutPageJsonLd, siteOrigin, withShare } from '@/lib/site-identity'
import { inCity, loadSiteFacts, shareOf, type SiteFacts } from '@/lib/site-facts'

/**
 * ABOUT — ONE FILE, TWO EDITIONS, AND THE PAGE WHERE THE AFFILIATION IS DISCLOSED.
 *
 * This route exists on BOTH deployments (src/lib/edition.ts): eno.vn, the licensed sàn TMĐT
 * marketplace, and eno.forum, which additionally lists services sold by a licensed third-party
 * partner. Everything below is written twice on purpose. Read all three rules before editing.
 *
 * ⚠️ 1. NO SERVICES VOCABULARY MAY BE A LITERAL IN THIS FILE. Not because of what renders — the
 * IS_SERVICES gates handle that — but because of where the strings go. `scripts/gen-ui-strings.mjs`
 * harvests every `<Tr text="literal">` and `tr('literal')` in `src/**` into a catalogue that is
 * SHIPPED TO THE BROWSER to pre-warm translations, and it classifies a string as services-only from
 * the PATH it was found in. `src/app/[lang]/about/` is not in that list and must not be (the marketplace
 * half of this page belongs in the core catalogue), so a literal written here lands in
 * `src/generated/ui-strings.ts` and is downloaded by every eno.vn visitor even though nothing on
 * eno.vn renders it. That is the exact leak class the edition split exists to prevent.
 *
 * So the services-only wording arrives from `@/lib/visa-provider`, which next.config.ts ALIASES to
 * a stub of empty strings on a marketplace build, and the edition-specific prose written inline
 * here is passed through VARIABLES (the arrays below) rather than literals — the harvester only
 * matches literals, so none of it reaches the catalogue either way. The result is checkable with
 * grep: no partner name, and no word describing what the partner is licensed to do, anywhere in
 * what eno.vn serves.
 *
 * ⚠️ 2. THREE CLAIMS THIS PAGE MAY NEVER MAKE.
 *   · that eno performs or guarantees the partner's service — the partner is the provider of
 *     record, under its own licence, and PROVIDER_OF_RECORD is the only sentence that says who;
 *   · that a company exists which has not been registered yet — hence OPERATOR_REGISTERED gating
 *     the operator paragraph, and hence no company name, registration number or licence number
 *     typed into this file. They live in src/lib/site-legal.ts and src/lib/visa-provider.ts;
 *   · that eno.vn and eno.forum are unrelated. They are related, and this page is the single best
 *     natural home for saying so — see AFFILIATION.
 *
 * ⚠️ 3. THE OUTBOUND LINKS ARE DELIBERATELY ONE-WAY. The services edition links INTO eno.vn's
 * marketplace landing pages (that is the point of the section: someone who has just arrived needs
 * housing, furniture and work). The marketplace edition names eno.forum in the affiliation paragraph
 * but does NOT link to it: eno.vn is registering as a licensed marketplace and may not advertise a
 * service it is not licensed for, and a hyperlink is a referral rather than a disclosure. Naming
 * the sister site is the honest disclosure; sending traffic to it is a different act. Do not
 * "balance" the links.
 */

// The services description says what the service is by INTERPOLATING the aliased constant rather
// than by naming it — on a marketplace build PROVIDER_OF_RECORD.shortEn is an empty string and this
// branch is dead code anyway. `canonical: '/about'` is relative on purpose: it resolves against
// each build's metadataBase, so eno.forum's About page canonicalises to eno.forum.
const SERVICES_DESCRIPTION = `About eno.forum — services for travellers and newcomers to Vietnam. ${PROVIDER_OF_RECORD.shortEn} eno.vn, our sister marketplace, covers housing, jobs, furniture and electronics once you are here.`

/**
 * ⚠️ THE TITLE SAYS WHAT THE SITE IS, FOR WHOM AND WHERE — it used to be "About | eno.vn", which
 * answers none of the three on the one page an assistant fetches to find out (ChatGPT-User was
 * measured reading /about at answer time, 2026-09-26). "Free" rides on POSTING_IS_FREE, which cites
 * the Terms and Regulations clauses it depends on; it disappears from here the day that flag flips.
 * No motorbikes and no moving sales in either line: both were 0 live listings on 2026-09-27, and a
 * description is a claim about the shelf.
 */
const MARKETPLACE_TITLE = `About ${SITE_NAME} — ${POSTING_IS_FREE ? 'free ' : ''}classifieds for expats and locals in Vietnam`
const MARKETPLACE_DESCRIPTION = `What ${SITE_NAME} is: a ${POSTING_IS_FREE ? 'free ' : ''}classifieds marketplace for expats, internationals and locals in Vietnam — rentals, jobs, furniture, electronics and more — with a public trust score or partner badge on every seller who posts here, and no payments on the platform.`
const SERVICES_TITLE = `About ${SITE_NAME} — services for travellers and newcomers to Vietnam`

const TITLE = IS_SERVICES ? SERVICES_TITLE : MARKETPLACE_TITLE
const DESCRIPTION = IS_SERVICES ? SERVICES_DESCRIPTION : MARKETPLACE_DESCRIPTION

// Hourly, for the live "At a glance" facts below; the rest of the page is static copy.
export const revalidate = 3600

/**
 * ⚠️ THE <title> FOLLOWS THE `[lang]` VARIANT; NOTHING ELSE HERE DOES (L-CONTENT-VI, 2026-09-29). A
 * Vietnamese reader got the English <title>. Only the marketplace's has a Vietnamese one — the services
 * title stays exactly as is (rule 1 above) — and openGraph/twitter stay English on both variants: a
 * share scraper sends no language, so the card must not depend on which variant it happened to hit.
 */
const MARKETPLACE_TITLE_VI = `Về ${SITE_NAME} — ${POSTING_IS_FREE ? 'rao vặt miễn phí' : 'rao vặt'} cho người nước ngoài và người Việt tại Việt Nam`

/**
 * ⚠️ `openGraph` AND `twitter` ARE SET, IMAGE INCLUDED — through withShare(), which builds both whole.
 * Next replaces the layout's objects with a page's rather than merging them, so without these the
 * About link previewed with the HOMEPAGE's title (measured: og:title "eno.vn - Trusted Expat
 * Marketplace in Vietnam" on /about), and an override of title/description alone would have dropped
 * the share card. generateMetadata below swaps only the <title> for the Vietnamese variant; both
 * cards keep the English TITLE, per the note above MARKETPLACE_TITLE_VI.
 */
const BASE_METADATA: Metadata = withShare({
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/about' },
})

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  return { ...BASE_METADATA, title: !IS_SERVICES && lang === 'vi' ? MARKETPLACE_TITLE_VI : TITLE }
}

const LINK = 'font-semibold text-accent-foreground hover:underline'

/** eno.vn destinations linked from the services edition. Absolute: they are cross-domain there. */
const MARKETPLACE_URL = 'https://eno.vn'

// ── Copy ────────────────────────────────────────────────────────────────────────────────────────
// Held in arrays rather than written inline as JSX literals — see rule 1 in the header. The prose
// is plain on purpose: a reader deciding whether to trust a site should not have to parse a
// contract, and every sentence here still has to be true.

// ⚠️ NO MOTORBIKES AND NO "CHANGE HANDS EVERY TIME SOMEBODY MOVES" in the two lines below (2026-09-27):
// motorbikes were 0 live listings, and the used furniture here is dealer-supplied — framing it as
// expats' moving sales is the claim the guides were already corrected for.
// ⚠️ "A SELLER WHO POSTS FROM AN ACCOUNT", NOT "EVERY SELLER": almost every live listing is linked from a
// source site (the At a glance block below counts it), and a trust score says nothing about those —
// the same scoping the layout's Organization description uses. ⛔ NOR "EVERY SELLER WHO POSTS HERE"
// (2026-10-04): a signed-out guest posts too while IDENTITY_GATE_ENFORCED is unset, and a guest's
// ownerless storefront is unrated (src/lib/linked-seller.ts isUnratedStorefront) — "from an account" IS
// that rule, so it cannot drift from what the card shows.
// ⛔ "SOURCE SITE", NEVER "PARTNER SITE" (2026-10-01): Chợ Tốt/Nhatot, Muaban, Batdongsan, VietnamWorks
// and the other boards and portals we import from are not partners — no code or contract records one; "partner" is reserved
// for the Official partner badge (a signed agreement — /partners).
const MARKETPLACE_INTRO =
  'eno.vn is a classifieds marketplace for expats, internationals and locals in Vietnam — housing, jobs, everyday services, furniture and electronics. Automated checks run on every post, a seller who posts from an account shows a public trust score or, for an official partner, a partner badge, and anyone can report a listing that is not what it claims to be.'

const MARKETPLACE_WHAT = [
  'People and businesses post what they are renting out, selling or hiring for: apartments and rooms, jobs, services, furniture, appliances and electronics.',
  // ⚠️ "MESSAGE A SELLER IN THE APP" IS SCOPED TO LISTINGS POSTED HERE. Most live listings are linked
  // from source sites, with no chat on this site (see src/lib/site-facts.ts); the unscoped sentence
  // was true of the product as designed and false of the shelf as measured.
  // ⛔ AND IT SAYS WHERE A LINKED LISTING POINTS, NOT WHO HANDLES THE ENQUIRY: "you deal with the
  // advertiser there" is the claim the owner removed from the importers on 2026-09-25
  // (src/lib/import-viewing-disclaimer.ts) — the eno team checks availability on any rental, linked
  // or not. A linked listing also has its own page here; only its button opens the source.
  'Listings posted here belong to the people who post them, and linked listings to the sites they come from. eno.vn does not own or supply what you see, and it is not a party to the deal you make — there is no checkout, no escrow and no payment on the platform. For a listing posted here, you message the seller in the app, agree between yourselves, and settle directly; a linked listing names the source site it comes from and links to the original posting.',
  'Prices are set in Vietnamese đồng, and the site reads in your own language: listings, chat and the interface are translated as you go.',
]

// ⚠️ "EACH SERVICE", SINGULAR AND SCOPED, ON PURPOSE. "our licensed partners" would imply a roster
// (there is one partner today), and an unscoped "everything here comes from a licensed company"
// would be false — eno.forum also carries ordinary marketplace listings from ordinary people.
const SERVICES_INTRO =
  'eno.forum is for people on their way to Vietnam — visitors, newcomers, and people moving here for work or study. Each service listed here is provided by a licensed third-party company, not by eno.forum: we publish the listing and pass your request on, and the partner does the work.'

const SERVICES_WHAT = [
  'eno.forum is a platform, not a service provider. It publishes what a partner offers, hands your request to that partner, and gives you one place to talk to them. The partner does the work under its own licence, sets its own prices and terms, and answers for the result. eno.forum receives a commission when a service is booked through the platform.',
  'Alongside that, eno.forum runs the same classifieds marketplace you will find on eno.vn: third-party listings, public seller trust scores, no checkout, and deals agreed directly between the two people involved.',
]

/**
 * Follows the provider-of-record disclosure.
 *
 * ⚠️ IT PROMISES NOTHING THE CODE DOES NOT DO. No retention period, no "we never store it": it says
 * what an upload is used for and who it goes to, and sends the reader to the policy for the rest.
 * A number invented here would be a commitment nobody implemented.
 */
const SERVICES_PROVIDER_DATA =
  'Anything you upload for a service — documents, photos and the details a request needs — is used to prepare and submit that request, and is shared with the partner performing it. What is stored, for how long, and how to ask for it to be deleted is set out in our'

/**
 * Only rendered once verified copies of the partner's paperwork are actually held (Advertising Law
 * 75/2025 puts that duty on the party publishing the advertisement, not on the partner). While
 * PROVIDER_LICENCE_ON_FILE is false this sentence must not appear — saying it early would be the
 * one claim on this page nobody could check.
 */
const SERVICES_PROVIDER_LICENCE =
  'We hold copies of that partner’s company registration and operating licence on file.'

const SERVICES_MARKETPLACE_LEAD =
  'is our sister marketplace: a classifieds site for people already living in Vietnam. It is where the practical side of arriving gets solved — somewhere to live, work, and what to furnish a flat with.'

/**
 * The cross-domain links, as data.
 *
 * ⚠️ THE SENTENCE FRAGMENTS ARE VARIABLES FOR THE SAME REASON THE PROSE ABOVE IS — see rule 1. They
 * are also split so each fragment is a clause that survives translation on its own; a link dropped
 * into the middle of one translated string cannot be, because the layer translates strings, not
 * trees.
 *
 * `path` is appended to MARKETPLACE_URL, so these are absolute cross-domain links from eno.forum.
 * Each target is a real marketplace landing route (src/app/<path>/page.tsx) — a plain page.tsx, so
 * it exists on both editions and cannot 404 the way a `.svc.` route would.
 */
const SERVICES_MARKETPLACE_LINKS = [
  {
    path: '/housing-vietnam-expats',
    lead: 'Somewhere to live usually comes first:',
    label: 'housing and apartment rentals for expats',
    tail: '— studios in Thao Dien, apartments in Phu My Hung, family houses in District 2.',
  },
  /* ⛔ NOT /motorbikes-for-sale-vietnam ANY MORE (2026-09-27): eno.vn held 0 motorbikes and that
     landing is noindex, so the link promised a monthly rental nobody could find. The lead and the
     description above dropped "something to ride" / "motorbikes" and "everything a departing expat is
     selling off" (the used stock is dealer-supplied) for the same reason. */
  {
    path: '/furnishing-a-home-in-vietnam',
    lead: 'Then something to put in it:',
    label: 'furnishing a home in Vietnam',
    tail: '— what the landlord supplies, what is worth buying new, and what is better bought secondhand.',
  },
  {
    path: '/jobs-vietnam-expats',
    lead: 'Staying on to work?',
    label: 'jobs for expats and internationals in Vietnam',
    tail: '— teaching, hospitality, marketing, design and tech roles where English is required.',
  },
]

const SERVICES_MARKETPLACE_TAIL =
  'The same rules apply there: the listings belong to the people who post them, there is no checkout, and you settle directly with the seller.'

const AFFILIATION_PLAIN =
  'In plain terms: one brand family, two websites, and each one answers for what happens on its own domain. Whichever site you are on, its own terms and privacy policy are the ones that apply to you.'

/**
 * ⚠️ NO COMPANY NAME OR NUMBER IS TYPED HERE, and the unregistered branch is not a formality. Until
 * the certificate is issued there is nothing to assert, and "đang cập nhật" printed in a field
 * labelled "registration no." does not tell a reader that no company exists yet. Flipping
 * `registered` in src/lib/site-legal.ts is what turns this into a statement of fact.
 */
const OPERATOR_LINE = OPERATOR_REGISTERED
  ? `${SITE_NAME} is operated by ${COMPANY.name} (${COMPANY.nameEn}), head office ${COMPANY.address}. Business registration no. ${COMPANY.erc}, issued ${COMPANY.ercIssued}.`
  : `${SITE_NAME} is run by a Vietnamese company that is still completing its business registration. Until the certificate is issued there is no registration number to publish: the operator block on our Operating Regulations page shows what is confirmed so far, and is filled in the day the certificate arrives.`

// Ordered steps use the family's one step treatment — a tint number chip beside the
// heading (see /guide and /safety's recovery list). The sequence is the information.
// `text` is one <Tr> per sentence, so a sentence with curated Vietnamese (vi-overrides.ts) renders it
// whatever its neighbours have.
const STEPS: { title: string; text: string[] }[] = [
  {
    title: 'Listing submitted',
    text: ['A seller posts an item with photos, price and location.'],
  },
  {
    title: 'Automated checks',
    // ⛔ NOT "PHONE VERIFIED" (2026-10-01): no phone check runs on a post. What does run is
    // assertPublishable (src/lib/publish-guard.ts): banned words, contact details in the text, the
    // per-category photo minimum and a location.
    text: ['Every post runs automated checks — no banned items, no contact details hidden in the text, and enough real photos to show what is being offered.'],
  },
  {
    title: 'It goes live instantly',
    // ⛔ NOT "Sellers build a public trust score and buyers can report problems — so fakes and bait prices
    // do not last" (owner 2026-10-04): official partners show a partner badge instead of a score, and
    // "do not last" is an outcome no code measures. The second sentence is the owner's approved report
    // sentence, verbatim (category-copy.ts REPORT_SENTENCE): every listing page carries the Report
    // button, and a signed-in member's report reaches the admin queue (api/report/route.ts).
    text: ['Listings publish right away.', 'Members can report any listing that breaks the rules.'],
  },
]

/**
 * The left rail. ⚠️ Every id here must match a rendered ContentSection on the SAME edition — a rail
 * entry pointing at a section that only the other edition renders is a link that scrolls nowhere,
 * and nothing type-checks the pair. Keep the two lists side by side in a diff.
 */
const RAIL = IS_SERVICES
  ? [
      { id: 'what', label: 'What eno.forum is' },
      { id: 'provider', label: 'Who provides the services' },
      { id: 'trust', label: 'How trust works' },
      { id: 'marketplace', label: 'The eno.vn marketplace' },
      { id: 'affiliation', label: 'How the two sites relate' },
      { id: 'operator', label: 'Who runs this site' },
      { id: 'contact', label: 'Contact' },
    ]
  : // `labelVi` is AUTHORED Vietnamese (L-CONTENT-VI): rail labels are data, which the ui-strings
    // harvester never sees, so these reached a Vietnamese reader in English. Marketplace branch only
    // — the services list above stays untouched, per rule 1.
    [
      { id: 'glance', label: 'At a glance' },
      { id: 'what', label: 'What eno.vn is', labelVi: 'eno.vn là gì' },
      { id: 'trust', label: 'How trust works' },
      { id: 'affiliation', label: 'How the two sites relate', labelVi: 'Hai website liên quan thế nào' },
      { id: 'operator', label: 'Who runs this site', labelVi: 'Ai vận hành website này' },
      { id: 'contact', label: 'Contact' },
    ]

/**
 * AT A GLANCE — the facts an assistant or a first-time visitor needs in one place, before the prose.
 *
 * ⚠️ MARKETPLACE EDITION ONLY. Every row is a statement about eno.vn: free posting, no checkout, the
 * operator's registration. On eno.forum at least two of those are false (services there are paid and
 * its operator is not yet registered), so the block does not render there at all rather than
 * rendering a variant.
 *
 * ⛔ NOTHING HERE IS TYPED THAT CAN GO STALE:
 *   · Cost — POSTING_IS_FREE (src/lib/site-identity.ts), which cites Regulations Art. 8 and the Terms'
 *     Fees section; the row disappears if the flag does.
 *   · Where / Listings — computed from live counts at render (src/lib/site-facts.ts, hourly ISR). Each
 *     sentence is one of a few FIXED strings chosen by `shareOf`, never a number inside a <Tr>: a
 *     number in translatable text is a new string to machine-translate every hour. With no facts the
 *     rows fall back to wording that is true whatever the shelf holds.
 *   · Languages — the roster in src/lib/i18n/langs.ts, by native name (proper nouns, not translated).
 *   · Operator — COMPANY, behind OPERATOR_REGISTERED; no name or number is typed in this file.
 *
 * ⚠️ THE COPY IS LITERAL `<Tr text="…">`, UNLIKE THE ARRAYS ABOVE, AND THAT IS RULE 1 APPLIED, NOT
 * BROKEN: none of it is services copy, it renders on eno.vn, and literals are what the harvester
 * collects into the core catalogue so the Vietnamese can be curated instead of machine-translated.
 */
const LANG_SEP = ', '
const OPERATOR_NAMES = `${COMPANY.nameEn} (${COMPANY.name})`

function GlanceRow({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6">
      <dt className="text-sm font-bold text-foreground">{term}</dt>
      <dd className="text-base leading-relaxed text-body">{children}</dd>
    </div>
  )
}

function WhereRow({ facts }: { facts: SiteFacts }) {
  const overall = shareOf(inCity(facts, 'hcmc'), facts.live)
  const rentals = facts.byCategory.rentals ?? 0
  const rentalsShare = shareOf(inCity(facts, 'hcmc', 'rentals'), rentals)
  const overallLine =
    overall === 'all' ? <Tr text="Everything listed right now is in Ho Chi Minh City." />
    : overall === 'almost' ? <Tr text="Almost everything listed is in Ho Chi Minh City." />
    : overall === 'most' ? <Tr text="Most listings are in Ho Chi Minh City." />
    : null
  // Redundant once "everything" is in the city; otherwise the rental split is the fact renters want.
  const rentalsLine =
    overall === 'all' ? null
    : rentalsShare === 'all' ? <Tr text="Every rental listed right now is in Ho Chi Minh City." />
    : rentalsShare === 'almost' || rentalsShare === 'most' ? <Tr text="Most rental listings are in Ho Chi Minh City." />
    : null
  if (!overallLine && !rentalsLine) return null
  return (
    <GlanceRow term={<Tr text="Where" />}>
      {overallLine}
      {overallLine && rentalsLine && ' '}
      {rentalsLine}
      {rentals > 0 && (
        <>
          {' '}
          <Link href="/c/rentals" className={LINK}>
            <Tr text="Browse rentals" />
          </Link>
        </>
      )}
    </GlanceRow>
  )
}

/**
 * ⛔ WHERE A LINKED LISTING POINTS, NEVER WHO HANDLES IT. These rows used to end "…and you contact the
 * advertiser there" — the "handled there, not by eno" claim the owner removed from the importers on
 * 2026-09-25 (src/lib/import-viewing-disclaimer.ts), because the eno team checks availability on any
 * rental, linked or not. They also said a linked listing "opens on the site it came from", which it
 * does not: it has its own page here, and only its button opens the source.
 * ⚠️ "POSTED HERE" IS NOT "SHOWS A TRUST SCORE": an official partner shows its partner badge instead
 * (seller-card.tsx), and official partners post here too.
 */
function LinkedRow({ facts }: { facts: SiteFacts | null }) {
  const share = facts ? shareOf(facts.linked, facts.live) : null
  const posted = <Tr text="Listings posted directly on this site show the seller’s public trust score, or an official partner’s partner badge, and are answered in the in-app chat." />
  /**
   * ⛔ "SOURCE SITE", NOT "PARTNER SITE" (2026-10-01) — see the note above MARKETPLACE_INTRO: "partner"
   * now means a company with a signed agreement (partner-badge.tsx), and the sites this stock is linked
   * from — shops, portals, job boards — hold none. Authored pairs (the curated dictionary is keyed on the
   * old English and cannot follow a rewording), as literal `tr()` calls so gen-ui-strings harvests the
   * English; rendered through <Bilingual> (this is a server file).
   */
  const tr = (en: string, vi: string) => <Bilingual en={en} vi={vi} />
  return (
    <GlanceRow term={<Tr text="Listings" />}>
      {share === 'all' ? (
        tr('Every listing right now is linked from a source site: each says where it is listed and links to the original posting.', 'Hiện tại, mọi tin đều là tin liên kết từ trang nguồn: mỗi tin ghi rõ nơi đăng và dẫn tới tin gốc.')
      ) : share === 'almost' ? (
        <>
          {tr('Almost every listing is linked from a source site: those say where they are listed and link to the original posting.', 'Gần như mọi tin đều là tin liên kết từ trang nguồn: các tin này ghi rõ nơi đăng và dẫn tới tin gốc.')} {posted}
        </>
      ) : share === 'most' ? (
        <>
          {tr('Most listings are linked from source sites: those say where they are listed and link to the original posting.', 'Phần lớn tin là tin liên kết từ các trang nguồn: các tin này ghi rõ nơi đăng và dẫn tới tin gốc.')} {posted}
        </>
      ) : share === 'some' ? (
        <>
          {tr('Some listings are linked from source sites: those say where they are listed and link to the original posting.', 'Một số tin là tin liên kết từ các trang nguồn: các tin này ghi rõ nơi đăng và dẫn tới tin gốc.')} {posted}
        </>
      ) : share === 'none' ? (
        posted
      ) : (
        // No facts: say what is true of either kind of listing, and nothing about how many.
        tr('A listing linked from a source site says where it is listed and links to the original posting; a listing posted directly here shows the seller’s public trust score, or an official partner’s partner badge, and is answered in the in-app chat.', 'Tin liên kết từ trang nguồn ghi rõ nơi đăng và dẫn tới tin gốc; tin đăng trực tiếp tại đây hiển thị điểm uy tín công khai của người bán, hoặc huy hiệu đối tác nếu đó là đối tác chính thức, và được trả lời qua chat trong ứng dụng.')
      )}
    </GlanceRow>
  )
}

function AtAGlance({ facts }: { facts: SiteFacts | null }) {
  // Authored pair builder, as in LinkedRow: a literal `tr()` so gen-ui-strings harvests the English.
  const tr = (en: string, vi: string) => <Bilingual en={en} vi={vi} />
  return (
    <dl className="space-y-4">
      {POSTING_IS_FREE && (
        <GlanceRow term={<Tr text="Cost" />}>
          {/* 20 days, matching Regulations Art. 8 and the Terms (Decree 248/2026 Art 8.2). */}
          <Bilingual
            en="Browsing, posting and contacting sellers are currently free. If that changes, prices will be published in Vietnamese đồng at least 20 days before they apply."
            vi="Hiện tại, việc xem tin, đăng tin và liên hệ người bán đều miễn phí. Nếu có thay đổi, mức phí sẽ được công bố bằng đồng Việt Nam ít nhất 20 ngày trước khi áp dụng."
          />
        </GlanceRow>
      )}
      {facts && facts.live > 0 && <WhereRow facts={facts} />}
      <LinkedRow facts={facts} />
      <GlanceRow term={<Tr text="Payments" />}>
        {/* "the source site", not "the partner site" (2026-10-01) — LinkedRow has the reason. */}
        {tr('There is no checkout, no escrow and no buyer protection. The site holds no money: you pay the seller, or the source site, directly.', 'Trang không có bước thanh toán, không có ký quỹ trung gian và không có chương trình bảo vệ người mua. Trang không giữ tiền: bạn trả tiền trực tiếp cho người bán hoặc cho trang nguồn.')}
      </GlanceRow>
      <GlanceRow term={<Tr text="Languages" />}>
        {LANGUAGES.map((l, i) => (
          <span key={l.code} lang={l.code}>
            {i > 0 && LANG_SEP}
            {l.native}
          </span>
        ))}
        {'. '}
        <Tr text="Listings and chat are translated automatically." />
      </GlanceRow>
      <GlanceRow term={<Tr text="Operator" />}>
        {OPERATOR_REGISTERED ? (
          <>
            {OPERATOR_NAMES}
            <span className="block">
              <Tr text="Business registration no." /> {COMPANY.erc}
            </span>
          </>
        ) : (
          <Tr text="A Vietnamese company still completing its business registration." />
        )}
      </GlanceRow>
    </dl>
  )
}

function Para({ text }: { text: string }) {
  return (
    <p className="text-base leading-relaxed text-body">
      <Tr text={text} />
    </p>
  )
}

export default async function AboutPage() {
  // Marketplace only: the services edition renders no facts block, so it reads no counts.
  const facts = IS_SERVICES ? null : await loadSiteFacts()
  return (
    <>
      {/* AboutPage → the layout's Organization @id. Marketplace only, like the @id itself: eno.forum's
          Organization node carries none, and a second inline Organization here would be the
          one-entity signal the layout refuses to send. */}
      {!IS_SERVICES && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(aboutPageJsonLd(siteOrigin(), { name: TITLE, description: DESCRIPTION })).replace(/</g, '\\u003c'),
          }}
        />
      )}
      <ContentPage
        title={IS_SERVICES ? 'Before you arrive, and after you land.' : 'The trusted marketplace for Vietnam.'}
        titleVi={IS_SERVICES ? undefined : 'Chợ mua bán uy tín tại Việt Nam.'}
        intro={<Tr text={IS_SERVICES ? SERVICES_INTRO : MARKETPLACE_INTRO} />}
        sections={RAIL}
      >
        {!IS_SERVICES && (
          <ContentSection id="glance" title="At a glance">
            <AtAGlance facts={facts} />
          </ContentSection>
        )}

        <ContentSection id="what" title={IS_SERVICES ? 'What eno.forum is' : 'What eno.vn is'} titleVi={IS_SERVICES ? undefined : 'eno.vn là gì'}>
          {(IS_SERVICES ? SERVICES_WHAT : MARKETPLACE_WHAT).map((p, i) => (
            <Para key={i} text={p} />
          ))}
        </ContentSection>

        {IS_SERVICES && (
          <ContentSection id="provider" title="Who provides the services listed here">
            {/* The disclosure itself: authored in both languages, so it is rendered rather than
                machine-translated. It names the partner, says the partner is the provider of record,
                and says what eno.forum is and is not. */}
            <p className="text-base leading-relaxed text-body">
              <Bilingual en={PROVIDER_OF_RECORD.en} vi={PROVIDER_OF_RECORD.vi} />
            </p>
            {PROVIDER_LICENCE_ON_FILE && <Para text={SERVICES_PROVIDER_LICENCE} />}
            <p className="text-base leading-relaxed text-body">
              <Tr text={SERVICES_PROVIDER_DATA} />{' '}
              <Link href="/privacy" className={LINK}>
                <Tr text="Privacy Policy" />
              </Link>
              .
            </p>
          </ContentSection>
        )}

        <ContentSection id="trust" title="How trust works" wide>
          <div className="grid gap-x-8 gap-y-6 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={i} className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-sm font-bold text-accent-foreground tabular-nums">{i + 1}</span>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-foreground">
                    <Tr text={s.title} />
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-body">
                    {s.text.map((t, j) => (
                      <Fragment key={j}>
                        {j > 0 && ' '}
                        <Tr text={t} />
                      </Fragment>
                    ))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ContentSection>

        {IS_SERVICES && (
          // The cross-domain section. Plain <a>, no rel="nofollow" and no target: these are ordinary
          // editorial links to the sister site, and they are the reason this section exists.
          <ContentSection id="marketplace" title="eno.vn — for once you are here">
            <p className="text-base leading-relaxed text-body">
              <a href={MARKETPLACE_URL} className={LINK}>
                eno.vn
              </a>{' '}
              <Tr text={SERVICES_MARKETPLACE_LEAD} />
            </p>
            {SERVICES_MARKETPLACE_LINKS.map((l) => (
              <p key={l.path} className="text-base leading-relaxed text-body">
                <Tr text={l.lead} />{' '}
                <a href={`${MARKETPLACE_URL}${l.path}`} className={LINK}>
                  <Tr text={l.label} />
                </a>{' '}
                <Tr text={l.tail} />
              </p>
            ))}
            <Para text={SERVICES_MARKETPLACE_TAIL} />
          </ContentSection>
        )}

        <ContentSection id="affiliation" title="How eno.vn and eno.forum relate" titleVi="eno.vn và eno.forum liên quan thế nào">
          {/* Disclosed affiliation, not independence — claiming the sites are unrelated would be
              false, and a false disclosure is worse than none. Authored in both languages. */}
          <p className="text-base leading-relaxed text-body">
            <Bilingual en={AFFILIATION.en} vi={AFFILIATION.vi} />
          </p>
          <Para text={AFFILIATION_PLAIN} />
        </ContentSection>

        <ContentSection id="operator" title="Who runs this site" titleVi="Ai vận hành website này">
          <Para text={OPERATOR_LINE} />
          <p className="text-base leading-relaxed text-body">
            <Tr text="The rules for using the site, the operator notice Vietnamese law requires, and how your personal data is handled are set out on three pages:" />{' '}
            <Link href="/terms" className={LINK}>
              <Tr text="Terms of Service" />
            </Link>
            ,{' '}
            <Link href="/regulations" className={LINK}>
              <Tr text="Operating Regulations" />
            </Link>{' '}
            <Tr text="and" />{' '}
            <Link href="/privacy" className={LINK}>
              <Tr text="Privacy Policy" />
            </Link>
            .
          </p>
        </ContentSection>

        <ContentSection id="contact" title="Contact">
          <p className="text-sm text-body">
            <Tr text="Questions, problems or press:" />{' '}
            <a href={`mailto:${COMPANY.email}`} className={LINK}>
              {COMPANY.email}
            </a>
          </p>
        </ContentSection>
      </ContentPage>
    </>
  )
}
