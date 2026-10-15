import 'server-only'
import Link from 'next/link'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { deskSellerIds } from '@/lib/edition-scope'
import { NOT_REMOVED } from '@/lib/listing-removed'
import { logError } from '@/lib/log'
import { safeParse } from '@/lib/serialize'
import { LICENCE_CHECK_SUBCATEGORIES, VISA_CATEGORY_SLUG, attributeBag, subcategoriesFor } from '@/lib/taxonomy'
import {
  PROVIDER_LEGAL_NAME, isEnterpriseCodeForm, providerLicenceFromInput, providerLicenceOf, providerLicenceProblems,
  type ProviderLicence, type ProviderLicenceProblem, type ProviderLicenceReason,
} from '@/lib/provider-licence'
import { licenceGrandfatherEndsAt, licenceStampFor, licenceStateOf, type LicenceState } from '@/lib/licence-stamp'
import { licenceGrandfatherProblem } from '@/lib/core/licence-check'
import { LicenceActionButton } from '@/components/admin/licence-action-button'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { TriangleAlert } from '@/components/ui/icons'

// ── ADMIN › CATALOGUE › LICENCE CHECKS (owner, 2026-10-14) ──────────────────────────────────────────────────────────
//
// ⛔ THE ONE PLACE A LICENCE-AISLE LISTING IS APPROVED. e-Visa (services/visa-legal) is open to anyone and goes live after
// eno's licence check ("Anyone posts, live after check"); Legal & permits (services/legal-permits) is held the same way
// ("Check them too"). A listing there from anyone but eno's own desk carries the provider's registered business name and
// licence number, typed by the seller (src/lib/provider-licence.ts); an admin compares both with the copies the provider
// emailed (Quy chế Article 5) and approves them HERE — POST /api/admin/listings 'licence-approve', the one stamp writer
// (src/lib/licence-stamp.ts). Server-rendered, and it IS the preview: the listing page 404s until the row is published,
// so the values, the seller, the photos and the description excerpt are all on this page.
//
// The sections, by licenceStateOf and by whether the row is live (verified):
//   1. Waiting for a check — values present and acceptable, not live. GROUPED BY STAMP: the stamp binds the seller, the
//      aisle and both values, so one provider's identical listings (VietKite's 14) are one group and one Approve. The
//      button sends the stamp the admin is LOOKING AT, per id (`seen`), and the route refuses a row whose values changed
//      since as stale — an approval is of what was on screen, never of what the seller typed a second later.
//   2. Values missing or invalid — nothing to approve; the seller adds or fixes them in the post form.
//   3. Approved, still unpublished — with the reason under each listing (status, an open or confirmed report, the owner's
//      enforcement state, an identity hold). Approve publishes only pure holds, so these stay down until that is settled.
//   4. Approved and live.  3 and 4 carry Revoke (Article 5: expired, revoked or changed — unpublishes until re-checked).
//   5. Grandfathered — VietKite's existing e-Visa rows, live WITHOUT values until 00:00 ICT on LICENCE_GRANDFATHER.until.
//   6. Live without a checked licence — EXPECTED EMPTY. A row here breaks the rule (a lost-update race between two edits
//      and an approval, a publish path the tripwire cannot see, or the grandfather's end): the 00:00 ICT sweep
//      (/api/cron/licence-holds) unpublishes it, and Unpublish here ('licence-revoke') does the same thing now — or
//      Approve, where both values are there and match the copies. "Live" is the sweep's own test: verified, in ANY
//      status, since a verified hidden row is one relist away from public.
// ⚠️ THE VALUES ARE PRINTED VERBATIM, IN translate="no" SPANS: the admin approves the exact string that is stamped and
// printed on the listing page, so a browser translation must never rewrite it on its way to their eyes.
// ⚠️ eno's DESK IS LEFT OUT BY ID (deskSellerIds), because it is exempt, not hidden. Both editions share one database, so
// both admin consoles show the same queue. An unresolved desk lists the desk's own rows as anyone's — which is exactly
// how every write path treats them while it is unresolved (fail closed) — and the page says so at the top.
// Admin chrome: English only, by repo convention.

/** The most rows one render reads. Both aisles together hold a few dozen; the page says so if this is ever reached. */
const LIMIT = 500

/** Every non-desk listing in either licence aisle that is not a tombstone — what the tab sections and the tile counts. */
function aisleRowsWhere(desk: readonly string[]): Prisma.ListingWhereInput {
  return {
    ...NOT_REMOVED,
    category: { slug: VISA_CATEGORY_SLUG },
    subcategorySlug: { in: [...LICENCE_CHECK_SUBCATEGORIES] },
    ...(desk.length ? { sellerId: { notIn: [...desk] } } : {}),
  }
}

type LicenceFields = {
  sellerId: string
  subcategorySlug: string | null
  attributes: string | null
  verificationMethod: string | null
  verified: boolean
  category: { slug: string }
}

/** What licence-stamp.ts reads off a row (LicenceRow + verified). */
const licenceRowOf = (r: LicenceFields) => ({
  categorySlug: r.category.slug,
  subcategorySlug: r.subcategorySlug,
  sellerId: r.sellerId,
  attributes: r.attributes,
  verificationMethod: r.verificationMethod,
  verified: r.verified,
})

export type LicenceSection = 'pending' | 'missing' | 'unpublished' | 'live' | 'grandfathered' | 'breach'

/**
 * The section a row is listed in — null for a row this tab never lists (outside the aisles, or eno's desk). A row that is
 * live (verified) and neither approved nor grandfathered is a BREACH whatever its values: that is the sweep's own test.
 */
export function licenceSectionOf(state: LicenceState, row: { verified: boolean; status: string }): LicenceSection | null {
  switch (state) {
    case 'pending':
    case 'missing':
      return row.verified ? 'breach' : state
    case 'approved':
      return row.verified && row.status === 'active' ? 'live' : 'unpublished'
    case 'grandfathered':
      return 'grandfathered'
    default:
      return null
  }
}

/** The overview tile's numbers. `waiting` is what the tile shows: pending + missing + grandfathered, live or not.
 *  `deskUnresolved`: eno's desk named no account here, so its own rows are counted as anyone's (the tab says so too). */
export type LicenceQueueCounts = { waiting: number; pending: number; missing: number; grandfathered: number; breach: number; deskUnresolved: boolean }

/**
 * The counts behind Admin › Overview's "Licence checks waiting" tile — the same rows and the same classification as the
 * tab below, so the tile and the tab cannot disagree. Every row, uncapped: it reads only the licence fields.
 */
export async function licenceQueueCounts(now: number = Date.now()): Promise<LicenceQueueCounts> {
  const desk = await deskSellerIds()
  // edition-lint-allow: an admin-only count (admin/page.tsx re-checks getAdmin()); it returns numbers, never a row. The
  // desk's rows are EXCLUDED by id (deskSellerIds) because they are exempt from the check, not because they are hidden.
  const rows = await db.listing.findMany({
    where: aisleRowsWhere(desk),
    select: { sellerId: true, subcategorySlug: true, attributes: true, verificationMethod: true, verified: true, status: true, category: { select: { slug: true } } },
  })
  const counts: LicenceQueueCounts = { waiting: 0, pending: 0, missing: 0, grandfathered: 0, breach: 0, deskUnresolved: !desk.length }
  for (const r of rows) {
    const state = licenceStateOf(licenceRowOf(r), { desk: false, now })
    if (state === 'pending' || state === 'missing' || state === 'grandfathered') {
      counts.waiting++
      counts[state]++
    }
    if (licenceSectionOf(state, r) === 'breach') counts.breach++
  }
  return counts
}

const ICT = 'Asia/Ho_Chi_Minh'
const UNTIL_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: ICT, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: ICT, day: 'numeric', month: 'short', year: 'numeric' })

/**
 * "21 Oct 2026, 00:00 ICT" — the instant VietKite's grandfather ends (licence-stamp.ts LICENCE_GRANDFATHER.until, 00:00 in
 * Vietnam). The tab, the overview tile and the listings console's badge all print this one string; the console is a
 * client component and cannot import licence-stamp.ts (node:crypto), so the catalogue page hands it down.
 */
export function licenceGrandfatherUntilLabel(): string {
  const t = licenceGrandfatherEndsAt()
  const part = (type: Intl.DateTimeFormatPartTypes) => UNTIL_FORMAT.formatToParts(t).find((p) => p.type === type)?.value ?? ''
  // Assembled from parts, not format() (commit gate): the separator between the date and the time is CLDR's to change
  // (", " or " at "), and a Node upgrade must not change what the admin console prints.
  return `${DAY_FORMAT.format(t)}, ${part('hour')}:${part('minute')} ICT`
}

async function readAisleRows(desk: readonly string[]) {
  // edition-lint-allow: the admin Licence checks tab (catalogue/page.tsx re-checks getAdmin(), and both POST actions are
  // route({auth:'admin'})). The desk's rows are EXCLUDED by id (deskSellerIds) — exempt, not hidden — and both editions
  // share the one database, so both admin consoles see the same queue. Unverified rows first, so the cap drops LIVE rows
  // first — breaches included, which is why the tab then takes its breach count from the uncapped licenceQueueCounts
  // (commit gate) — and waiting ones only past LIMIT unverified rows. The banner says which.
  return db.listing.findMany({
    where: aisleRowsWhere(desk),
    select: {
      id: true, title: true, status: true, verified: true, identityHold: true, images: true, description: true,
      attributes: true, verificationMethod: true, verifiedAt: true, subcategorySlug: true, sellerId: true,
      category: { select: { slug: true } },
      seller: { select: { name: true, officialPartner: true, owner: { select: { id: true, email: true, accountType: true, enforcementState: true } } } },
      // Both open and confirmed (an upheld report): 'licence-approve' publishes neither, so the admin sees both counts.
      reports: { where: { status: { in: ['open', 'confirmed'] } }, select: { status: true } },
    },
    orderBy: [{ verified: 'asc' }, { createdAt: 'desc' }],
    // One past the cap, so "capped" means something WAS cut off — not merely that there were exactly LIMIT (gate).
    take: LIMIT + 1,
  })
}

type AisleRow = Awaited<ReturnType<typeof readAisleRows>>[number]

export type LicenceGroup<R> = {
  key: string
  section: LicenceSection
  /** The values as stored (normalised; '' where absent) — printed verbatim. */
  values: ProviderLicence
  /** Waiting or approved: the stamp of these values on this seller's listing in this aisle. Null otherwise. */
  stamp: string | null
  /** 'missing' only: what is wrong with the values, field by field. */
  problems: ProviderLicenceProblem[]
  rows: R[]
}

/**
 * Sorts rows into the six sections and, within each, into groups an admin decides on together:
 *   · waiting and approved rows BY STAMP (one seller, one aisle, the same two values);
 *   · everything else by seller, aisle and the values as stored — there is no stamp to bind them.
 * Group order follows the rows' order; a row the tab does not list (desk, outside the aisles) is skipped.
 */
export function groupLicenceRows<R extends LicenceFields & { status: string }>(rows: readonly R[], now: number): Record<LicenceSection, LicenceGroup<R>[]> {
  const sections: Record<LicenceSection, Map<string, LicenceGroup<R>>> = {
    pending: new Map(), missing: new Map(), unpublished: new Map(), live: new Map(), grandfathered: new Map(), breach: new Map(),
  }
  for (const r of rows) {
    const state = licenceStateOf(licenceRowOf(r), { desk: false, now })
    const section = licenceSectionOf(state, r)
    if (!section) continue
    const full = state === 'pending' || state === 'approved' ? providerLicenceOf(r.attributes) : null
    const values = full ?? providerLicenceFromInput(attributeBag(r.attributes)) ?? { legalName: '', licenceNo: '' }
    // An approved row's stamp IS its verificationMethod (that is what 'approved' means); a waiting row's is computed.
    const stamp = state === 'approved' ? r.verificationMethod : full ? licenceStampFor(r, full) : null
    const key = stamp ?? ['values', r.sellerId, r.subcategorySlug ?? '', values.legalName, values.licenceNo].join('\u0000')
    let g = sections[section].get(key)
    if (!g) {
      g = { key, section, values, stamp, problems: state === 'missing' ? providerLicenceProblems(values, r.subcategorySlug) : [], rows: [] }
      sections[section].set(key, g)
    }
    g.rows.push(r)
  }
  return {
    pending: [...sections.pending.values()],
    missing: [...sections.missing.values()],
    unpublished: [...sections.unpublished.values()],
    live: [...sections.live.values()],
    grandfathered: [...sections.grandfathered.values()],
    breach: [...sections.breach.values()],
  }
}

/** "e-Visa" / "Legal & permits" — the taxonomy's own names for the two aisles. */
const aisleName = (sub: string | null) => subcategoriesFor(VISA_CATEGORY_SLUG).find((s) => s.slug === sub)?.name ?? sub ?? '—'
/** The number's label, as the listing page prints it. */
const numberLabel = (sub: string | null) => (sub === 'legal-permits' ? 'Licence / registration no.' : 'Licence no.')
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const REASON: Record<ProviderLicenceReason, string> = {
  missing: 'not entered',
  too_long: 'too long',
  no_letter: 'has no letter',
  no_digit: 'has no digit',
  format: 'not in a form a licence number takes',
  personal_id: 'looks like a personal ID number',
  contact: 'contains a phone number or other contact',
  banned: 'contains a banned word',
}
/** "Licence no.: looks like a personal ID number" — the field named as the values above name it, in this aisle. */
const problemText = (p: ProviderLicenceProblem, sub: string | null) => `${p.field === PROVIDER_LEGAL_NAME ? 'Registered name' : numberLabel(sub)}: ${REASON[p.reason]}`

const firstImage = (json: string): string | null => {
  const images = safeParse<unknown>(json, [])
  return Array.isArray(images) && typeof images[0] === 'string' ? images[0] : null
}
/** The first 400 characters (code points, so an emoji is never cut in half). */
const excerpt = (text: string) => {
  const chars = Array.from(text.trim())
  return chars.length > 400 ? `${chars.slice(0, 400).join('').trimEnd()}…` : chars.join('')
}

/** Why an APPROVED row is not live — what 'licence-approve' would not publish, or what happened to it since. */
function unpublishedReasons(r: AisleRow, reports: number): string[] {
  const out: string[] = []
  if (r.status !== 'active') {
    // "Live again once relisted" only for a row that is otherwise public (commit gate): beside a hold it would say the opposite.
    out.push(r.status === 'sold' ? 'Marked sold.' : r.verified ? `Status ${r.status}: it is live again once it is relisted.` : `Status ${r.status}.`)
  }
  if (!r.verified) {
    const enforcement = r.seller.owner?.enforcementState
    const ownerBlocked = enforcement === 'held' || enforcement === 'suspended'
    if (r.identityHold) out.push('Parked until the seller verifies their identity — it publishes on its own once they do.')
    if (reports > 0) out.push('An open or confirmed report: approving does not publish it. Settle the case under Moderation, then Publish.')
    if (ownerBlocked) out.push(`The owner's account is ${enforcement}: nothing of theirs publishes until that is lifted.`)
    if (!r.identityHold && !reports && !ownerBlocked) out.push('Taken down, or not published yet: Publish (Listings tab) makes it live.')
  }
  return out
}

function LicenceValues({ values, sub }: { values: ProviderLicence; sub: string | null }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
      <dt className="text-muted-foreground">Registered name</dt>
      <dd className="break-words font-semibold text-foreground">
        {values.legalName ? <span translate="no">{values.legalName}</span> : <span className="font-normal text-ink-4">not entered</span>}
      </dd>
      <dt className="text-muted-foreground">{numberLabel(sub)}</dt>
      <dd className="break-all text-foreground">
        {values.licenceNo ? <span translate="no" className="font-mono">{values.licenceNo}</span> : <span className="text-ink-4">not entered</span>}
      </dd>
    </dl>
  )
}

const ENFORCEMENT_VARIANT: Record<string, 'warning' | 'destructive'> = { warned: 'warning', throttled: 'warning', held: 'destructive', suspended: 'destructive' }

function SellerLine({ seller }: { seller: AisleRow['seller'] }) {
  const owner = seller.owner
  const type = owner?.accountType
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">{seller.name}</span>
      {owner ? (
        <Link href={`/admin/users/${owner.id}`} className="hover:text-foreground hover:underline">{owner.email ?? 'owner without an email'}</Link>
      ) : (
        <span>no owner account</span>
      )}
      {/* /prohibited bars individuals from both aisles; the account type is the first thing to compare. */}
      <Badge variant={type === 'business' ? 'neutral' : 'warning'}>
        {type === 'business' ? 'Business account' : type === 'individual' ? 'Individual account' : 'Account type not set'}
      </Badge>
      {seller.officialPartner && <Badge variant="neutral">Official partner</Badge>}
      {owner && owner.enforcementState !== 'good_standing' && (
        <Badge variant={ENFORCEMENT_VARIANT[owner.enforcementState] ?? 'warning'}>Owner {owner.enforcementState}</Badge>
      )}
    </div>
  )
}

function ListingLine({ r, section }: { r: AisleRow; section: LicenceSection }) {
  const image = firstImage(r.images)
  const open = r.reports.filter((x) => x.status === 'open').length
  const confirmed = r.reports.length - open
  const reasons = section === 'unpublished' ? unpublishedReasons(r, r.reports.length) : []
  const text = excerpt(r.description)
  return (
    <li className="flex gap-3 py-3">
      {image ? <img src={image} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-lg object-cover" /> : <div className="h-16 w-16 shrink-0 rounded-lg bg-tint" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Only a live row has a page to open — every other one 404s, which is why this tab shows its content. */}
          {r.verified && r.status === 'active' ? (
            <Link href={`/listings/${r.id}`} className="font-semibold text-foreground hover:underline">{r.title}</Link>
          ) : (
            <span className="font-semibold text-foreground">{r.title}</span>
          )}
          <Badge variant={r.status === 'active' ? 'success' : 'neutral'} className="capitalize">{r.status}</Badge>
          <Badge variant={r.verified ? 'success' : 'warning'}>{r.verified ? 'Verified' : 'Held'}</Badge>
          {r.identityHold && <Badge variant="warning">Identity hold</Badge>}
          {open > 0 && <Badge variant="destructive">{plural(open, 'open report')}</Badge>}
          {confirmed > 0 && <Badge variant="destructive">{plural(confirmed, 'confirmed report')}</Badge>}
        </div>
        {text && <p className="mt-1 whitespace-pre-line break-words text-xs text-muted-foreground">{text}</p>}
        {reasons.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-xs text-warning">
            {reasons.map((x) => <li key={x}>{x}</li>)}
          </ul>
        )}
      </div>
    </li>
  )
}

const latest = (dates: (Date | null)[]): Date | null =>
  dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null)

function GroupCard({ g, grandfatherUnresolved = false }: { g: LicenceGroup<AisleRow>; grandfatherUnresolved?: boolean }) {
  const first = g.rows[0]
  const sub = first.subcategorySlug
  const ids = g.rows.map((r) => r.id)
  const enterpriseCode = isEnterpriseCodeForm(g.values.licenceNo)
  const summary = { legalName: g.values.legalName, licenceNo: g.values.licenceNo, seller: first.seller.name, aisle: aisleName(sub), enterpriseCode }
  const approvedAt = g.section === 'unpublished' || g.section === 'live' ? latest(g.rows.map((r) => r.verifiedAt)) : null
  // Approve wherever the values are acceptable and not yet approved (a waiting group, or a live one that breaks the rule);
  // Revoke on an approval; Unpublish on a live row that never had one.
  const canApprove = g.stamp !== null && (g.section === 'pending' || g.section === 'breach')
  const seen = canApprove ? Object.fromEntries(ids.map((id) => [id, g.stamp as string])) : undefined
  // A value that is simply absent already reads "not entered" above; the list is for what is WRONG with one.
  const problems = g.problems.filter((p) => p.reason !== 'missing')
  return (
    <li>
      <Card className="gap-3 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* basis-64, not a zero basis: the buttons must WRAP below the values on a phone. With flex-1 the column
              shrank to fit beside them instead, and the name and number broke one character per line (measured). */}
          <div className="min-w-0 grow basis-64">
            <p className="mb-1.5 text-xs font-semibold text-ink-4">{aisleName(sub)} · {plural(g.rows.length, 'listing')}{approvedAt ? ` · approved ${DAY_FORMAT.format(approvedAt)}` : ''}</p>
            <LicenceValues values={g.values} sub={sub} />
            {enterpriseCode && (
              <p className="mt-1 text-xs text-warning">Same shape as a phone number: compare it with the registration certificate.</p>
            )}
            {problems.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-destructive">
                {problems.map((p) => <li key={p.field}>{problemText(p, sub)}</li>)}
              </ul>
            )}
            <SellerLine seller={first.seller} />
          </div>
          <div className="flex flex-wrap gap-2">
            {canApprove && <LicenceActionButton action="licence-approve" ids={ids} seen={seen} summary={summary} />}
            {(g.section === 'unpublished' || g.section === 'live') && <LicenceActionButton action="licence-revoke" ids={ids} summary={summary} />}
            {g.section === 'breach' && <LicenceActionButton action="licence-revoke" ids={ids} summary={summary} unapproved />}
            {/* The grandfathered get Unpublish ONLY when the grandfather does not resolve (commit gate): the sweep then
                leaves them alone, and the admin must be able to act. Otherwise they are allowed live until the end, and a
                misclick could not be undone in the window — no Publish of an aisle row, no Approve without values. */}
            {g.section === 'grandfathered' && grandfatherUnresolved && <LicenceActionButton action="licence-revoke" ids={ids} summary={summary} unapproved grandfatherUnresolved />}
          </div>
        </div>
        <ul className="divide-y divide-border border-t border-border">
          {g.rows.map((r) => <ListingLine key={r.id} r={r} section={g.section} />)}
        </ul>
      </Card>
    </li>
  )
}

function SectionBlock({ id, title, hint, groups, empty, grandfatherUnresolved }: { id: string; title: string; hint: React.ReactNode; groups: LicenceGroup<AisleRow>[]; empty: string; grandfatherUnresolved?: boolean }) {
  const count = groups.reduce((n, g) => n + g.rows.length, 0)
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-8 scroll-mt-20">
      <h3 id={`${id}-title`} className="text-base font-bold text-foreground">
        {title} <span className="font-semibold text-ink-4">· {count}</span>
      </h3>
      <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{hint}</p>
      {groups.length ? (
        <ul className="mt-3 space-y-3">
          {groups.map((g) => <GroupCard key={g.key} g={g} grandfatherUnresolved={grandfatherUnresolved} />)}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-4">{empty}</p>
      )}
    </section>
  )
}

/**
 * The Licence checks tab. `now` is for tests; the page renders it with the request's clock.
 */
export async function LicenceChecks({ now = Date.now() }: { now?: number } = {}) {
  // A failed read degrades to one alert rather than failing the Catalogue page (commit gate) — as the overview's tile does.
  try {
    return await renderLicenceChecks(now)
  } catch (e) {
    logError(e, { op: 'admin.licenceChecks' })
    return (
      <section aria-labelledby="licence-checks-title">
        <h2 id="licence-checks-title" className="sr-only">Licence checks</h2>
        <Alert tone="destructive" icon={<TriangleAlert className="h-4 w-4" />} title="The licence checks could not be read">
          The database read failed — reload. The daily sweep runs on its own regardless.
        </Alert>
      </section>
    )
  }
}

async function renderLicenceChecks(now: number) {
  const windowOpen = now < licenceGrandfatherEndsAt()
  const [desk, grandfather] = await Promise.all([
    deskSellerIds(),
    // R7 (plan review, 2026-10-14): while the window is open the sweep honours the grandfather only if its seller id,
    // handle and owner still name ONE storefront — and refuses to run otherwise. The admin should see that before 00:00.
    windowOpen
      ? licenceGrandfatherProblem().then(
          (problem) => ({ problem, failed: false }),
          (e) => {
            logError(e, { op: 'admin.licenceChecks.grandfather' })
            return { problem: null, failed: true }
          },
        )
      : Promise.resolve({ problem: null, failed: false }),
  ])
  const read = await readAisleRows(desk)
  const capped = read.length > LIMIT
  const rows = capped ? read.slice(0, LIMIT) : read
  const s = groupLicenceRows(rows, now)
  const until = licenceGrandfatherUntilLabel()
  // Past the cap the list can miss live rows, so the alert counts every breach from the uncapped, light read (gate).
  const breach = capped ? (await licenceQueueCounts(now)).breach : s.breach.reduce((n, g) => n + g.rows.length, 0)
  return (
    <section aria-labelledby="licence-checks-title">
      <h2 id="licence-checks-title" className="sr-only">Licence checks</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">
        e-Visa and Legal &amp; permits listings from anyone but eno&apos;s own desk go live only after an admin has compared the
        provider&apos;s registered business name and licence number with the licence and business registration the provider
        emailed to the support mailbox (Quy chế Article 5). Approve binds the approval to exactly the values shown: any change
        by the seller, or a move between the two aisles, sends the listing back here. A daily sweep at 00:00 ICT unpublishes
        anything live without a checked licence.
      </p>

      <div className="mt-4 space-y-2">
        {!desk.length && (
          <Alert tone="warning" icon={<TriangleAlert className="h-4 w-4" />} title="eno's desk did not resolve on this server">
            HIDDEN_DESK_OWNER_EMAILS names no account here, so the desk&apos;s own e-Visa listings are listed below as anyone&apos;s.
            Every write path holds them as unchecked until it resolves, and the daily sweep refuses to run.
          </Alert>
        )}
        {grandfather.problem && (
          <Alert tone="warning" icon={<TriangleAlert className="h-4 w-4" />} title="VietKite's grandfather does not resolve">
            {grandfather.problem}. Until the seller id, handle and owner name one storefront again, the daily sweep refuses to
            run (grandfather_unresolved) and unpublishes nothing.
          </Alert>
        )}
        {grandfather.failed && (
          <Alert tone="warning" icon={<TriangleAlert className="h-4 w-4" />} title="VietKite's grandfather could not be checked">
            The database read failed — reload. The daily sweep checks it again before it runs.
          </Alert>
        )}
        {breach > 0 && (
          <Alert tone="destructive" icon={<TriangleAlert className="h-4 w-4" />} title={`${plural(breach, 'listing is', 'listings are')} live without a checked licence`}>
            <Link href="#licence-breach" className="underline">See the last section</Link>: unpublish them now, or the 00:00 ICT sweep will.
          </Alert>
        )}
        {capped && (
          <Alert tone="warning" icon={<TriangleAlert className="h-4 w-4" />} title={`Showing the first ${LIMIT} listings`}>
            Unpublished listings are read first, then live ones: some live listings — breaches among them — are not listed
            below, though the count above includes them all.
          </Alert>
        )}
      </div>

      <SectionBlock
        id="licence-pending"
        title="Waiting for a check"
        hint="Compare both values, character for character, with the copies in the support mailbox. Approve publishes every listing in the group that nothing else holds (an open report, a held or suspended owner, an identity hold)."
        groups={s.pending}
        empty="Nothing is waiting."
      />
      <SectionBlock
        id="licence-missing"
        title="Values missing or invalid"
        hint="Nothing to approve yet: the seller adds them in the post form (editing the listing), and it then moves to “Waiting for a check”."
        groups={s.missing}
        empty="None."
      />
      <SectionBlock
        id="licence-unpublished"
        title="Approved, still unpublished"
        hint="The licence is approved; something else keeps the listing off the site — the reason is under each one."
        groups={s.unpublished}
        empty="None."
      />
      <SectionBlock
        id="licence-live"
        title="Approved and live"
        hint="Revoke when a licence has expired, been revoked or changed (Article 5): the listings are unpublished until checked again."
        groups={s.live}
        empty="None yet."
      />
      {(windowOpen || s.grandfathered.length > 0) && (
        <SectionBlock
          id="licence-grandfathered"
          title="Grandfathered"
          hint={`VietKite, live without a checked licence until ${until}. The sweep at that very minute unpublishes any not approved by then; each one VietKite edits to add its values comes back to “Waiting for a check” first.`}
          groups={s.grandfathered}
          empty="None."
          // A real problem only — a failed CHECK is one database read gone wrong, not a grandfather that does not resolve:
          // its alert says reload, and the irreversible button stays away (commit gate).
          grandfatherUnresolved={!!grandfather.problem}
        />
      )}
      <SectionBlock
        id="licence-breach"
        title="Live without a checked licence"
        hint="Expected to be empty. Anything here is verified without a checked licence — live, or one relist away — against the rule, and the 00:00 ICT sweep unpublishes it. Unpublish does the same now; where both values are there and match the copies, Approve instead."
        groups={s.breach}
        empty="None, as expected."
      />
    </section>
  )
}
