#!/usr/bin/env node
/**
 * Edition lint — keeps eno.vn (the licensed sàn TMĐT marketplace) from leaking the visa, itinerary
 * and PayPal surfaces that only eno.forum may serve. See the edition split in CLAUDE.md and the
 * mechanism in src/lib/edition.ts.
 *
 * ⚠️ THIS IS A BUILD GATE. Exit 1 on any violation, wired into `npm run lint` AND the head of
 * `npm run build`, exactly like design-lint.mjs. It began life report-only so it could MEASURE the
 * work (87 unguarded reads) instead of blocking every build with work that had not been done; that
 * work is done, so it now enforces.
 *
 * RULE A — unguarded listing/seller reads.
 *   Visa services are ORDINARY `Listing` rows and the trip desk shares the same `Seller`, so any
 *   query that returns listings will surface them on the licensed marketplace unless it excludes the
 *   desk. This is the leak that has nothing to do with the /visa pages, and it is the one most
 *   likely to be reintroduced: someone adds a rail next month with a perfectly ordinary
 *   `db.listing.findMany({ where: { status: 'active' } })` and the e-Visa SKUs are back in the feed.
 *   A path denylist cannot catch that. Requiring the shared predicate can.
 *
 * RULE B — services files must carry the `.svc.` extension.
 *   Next resolves special files as `${name}.${ext}`, and next.config.ts sets `pageExtensions` per
 *   edition, so a `page.svc.tsx` matches nothing on a marketplace build: never compiled, never
 *   prerendered into the image, never in the manifest, no client chunk. That is what makes the split
 *   default-deny — route 31 is excluded by where it lives and what it is called, not by a list
 *   anyone has to maintain. This rule is what stops the convention rotting.
 *
 * RULE C — shared files may not import an unaliased module out of a services tree.
 *   Rule B gates ROUTES, and it does that by checking Next SPECIAL files (page/layout/route/…).
 *   A services tree also holds ordinary modules — `src/app/vietnam-evisa/links.ts` — and those are
 *   NOT excluded by `pageExtensions`, because `pageExtensions` only decides what counts as a route.
 *   So a shared file importing one compiles every literal in it straight into the licensed image.
 *   Measured 2026-08-01: the sitemap route imported `VIETNAM_EVISA_PATHS` from that module, putting
 *   "Urgent Vietnam visa in 1 hour" and "evisa.gov.vn" in eno.vn's server bundle. Its `IS_SERVICES`
 *   gate was correct and irrelevant — a gate stops the URLs being EMITTED, it cannot unbundle a
 *   string. Fixing that one import is not enough, because the next person writes the same import
 *   for the same good reason; this rule is what makes the mistake unavailable.
 *
 *   The fix is always one of two things, and both are in the tree as worked examples:
 *     · route the import through a module `next.config.ts` already aliases — what the sitemap now
 *       does via `SERVICES_SITEMAP_PATHS` in src/lib/edition-services-copy.ts; or
 *     · keep the shared module's VALUES free of services vocabulary so it is safe to import
 *       directly — what src/lib/expat-guides.ts does, and says so in its header.
 *
 * Escape hatch, same shape as design-lint: add an entry to ALLOW with a reason. An exemption then
 * shows up in a diff as a decision somebody made, rather than as an omission nobody noticed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const SRC = join(ROOT, 'src')

/**
 * Reads that legitimately do NOT need the marketplace scope, each with the reason it is safe.
 * Keep this list short and specific; a growing allowlist means the rule is wrong or the code is.
 */
const ALLOW = new Map([
  // The three that predate the sweep — the desk resolvers themselves and the predicate module.
  // Regenerating this list from "what the lint still reports" silently dropped them once,
  // because an allowlisted file is not reported. They go first so that cannot recur.
  ["src/lib/edition-scope.ts", "defines the predicate itself"],
  ["src/lib/visa-shop.ts", "resolves the desk BY owner email — it must see the desk to exclude it; services-side by definition"],
  ["src/lib/trips/dm-thread.ts", "resolves the trip desk — services-side by definition"],
  // ⚠️ EVERY ENTRY CARRIES THE CONSTRAINT THAT MAKES IT SAFE, not the word "internal". This list
  // is permanent and nobody re-derives it, so a vague reason here is a future leak. Each was
  // classified by reading the file and then attacked by three independent passes whose only job
  // was to prove a "safe" verdict reachable by an outsider; three verdicts were overturned and
  // are NOT in this list.
  //
  // Adding a line here is a decision that shows up in a diff. Deleting a scope call is not.
  ["src/app/api/account/delete/route.ts", "Seller/listing reads are `where: { ownerId: profile.id }` from getCurrentProfile() (401 guard, no target param); the two counts at 51-52 are storag\u2026"],
  ["src/app/api/account/export/route.ts", "PDPL self-export: seller is `where: { ownerId: profile.id }` and listings are `where: { sellerId: seller.id }` derived from it; scoping would strip\u2026"],
  ["src/app/api/account/route.ts", "Dashboard payload keyed to `where: { ownerId: profile.id }` from getCurrentProfile(); listings read is `sellerId: seller.id` from that same session\u2026"],
  ["src/app/api/cron/daily-reminders/route.ts", "CRON_SECRET bearer + timingSafeEqual (lines 36-39); selects only seller.ownerId and notifies each listing's OWN owner \u2014 no listing field reaches a\u2026"],
  ["src/app/api/cron/video-gc/route.ts", "Builds a platform-wide DO-NOT-DELETE set; excluding the desk would make its videos look orphaned and the nightly job would delete objects eno.forum\u2026"],
  ["src/app/api/cron/warm-translations/route.ts", "CRON_SECRET-gated; selects title/description/location into sha1-keyed Translation rows that surface only when the same text is rendered, which a sc\u2026"],
  ["src/app/api/dashboard/analytics/route.ts", "Seller resolved as `where: { ownerId: profile.id }` (401 guard at 21-22); listing read pinned to `sellerId: seller.id`, response Cache-Control: pri\u2026"],
  ["src/app/api/disputes/[id]/route.ts", "Gated by loadDisputeForParty(id, meId) \u2192 partyRoleFor, which returns null unless meId is the reporter, the target, or the target seller's ownerId (\u2026"],
  ["src/app/api/disputes/route.ts", "Seller is `where: { ownerId: meId }` from getCurrentProfileId(); the report list's OR is reporterProfileId/targetProfileId/targetSellerId, all sess\u2026"],
  ["src/app/api/handle/check/route.ts", "`db.seller.count({ where: { id: row.sellerId, ownerId: meId } }) > 0` \u2014 a boolean 'is this handle mine' guard; the response is only { handle, valid\u2026"],
  ["src/app/api/handle/route.ts", "Seller is `where: { ownerId: profile.id }` after a 401; no target id is ever accepted from the client (only the handle string)."],
  ["src/app/api/keys/[id]/route.ts", "Seller is `where: { ownerId: profile.id }` behind a business-tier 403; used only to authorize an ApiKey revoke. No listing reads."],
  ["src/app/api/keys/route.ts", "callerShop() resolves `where: { ownerId: profile.id }` behind a business-tier null-return; every downstream query filters on that sellerId. No list\u2026"],
  ["src/app/api/listings/[id]/save/route.ts", "findUnique selects only id/verified/status as a liveness guard; the response is exactly { ok, counted } \u2014 no listing field is serialized."],
  ["src/app/api/listings/[id]/view/route.ts", "Guard read: verified/status decide whether to count and seller.ownerId only suppresses self-views; response is { ok, counted }."],
  ["src/app/api/listings/availability/route.ts", "Seller is `where: { ownerId: profile.id }`; the listing read intersects client ids with `sellerId: seller.id`, which exists precisely to stop reval\u2026"],
  ["src/app/api/listings/bulk/route.ts", "Only read is the caller's own `where: { ownerId: profile.id }` seller behind a business-tier 403; the rest is a write path into that same storefront."],
  ["src/app/api/listings/resolve-seller.ts", "Owned branch is `where: { ownerId: meId }` from getCurrentProfileId(); the two phone lookups are unowned-storefront claim checks whose rows never r\u2026"],
  ["src/app/api/listings/route.ts", "Every where clause (histogram, feed, total, facet counts, subcategory groupBy) is derived from `await buildFeedFilters()`, which pushes marketplace\u2026"],
  ["src/app/api/listings/semantic-rank.ts", "Vertex id resolution is scoped; the sibling read is the structural filter already carried by feed-query andFilters"],
  ["src/app/api/me/route.ts", "Seller is `where: { ownerId: profile.id }` from getCurrentProfile() (returns { user: null } when unauthenticated)."],
  ["src/app/api/profile/account-type/route.ts", "All three seller reads are `where: { ownerId: profile.id }` after a 401; the phone lookup is an unowned-storefront claim check gated on `if (byPhon\u2026"],
  ["src/app/api/report/route.ts", "Attribution lookups for a write behind getCurrentProfile(); success responses are only { ok } / { ok, id } \u2014 scoping would merely make desk listing\u2026"],
  ["src/app/api/seller/route.ts", "Seller is `where: { ownerId: profile.id }` after a 401, selecting only id for a self-edit via updateSellerCore."],
  ["src/app/api/seller/verification/documents/route.ts", "Seller is `where: { ownerId: userId }` from getCurrentProfileId() (401 at 22-23); used only as the draft key for the uploader's own case."],
  ["src/app/api/seller/verification/route.ts", "ownSellerId(userId) is `where: { ownerId: userId }` with userId from getCurrentProfileId() and a 401 in both GET and POST."],
  ["src/app/api/sellers/[id]/reviews/route.ts", "The id is not free input \u2014 line 53 rejects unless `convo.listing.sellerId === id` and line 51 requires `convo.buyerProfileId === me.id`; the seller\u2026"],
  ["src/app/api/upload/video/transcode/route.ts", "`db.listing.count({ where: { video: rawUrl } })` is the ownership gate returning 409 already_in_use; scoping it would let a marketplace caller dest\u2026"],
  ["src/app/api/v1/analytics/summary/route.ts", "All three reads share `where = { sellerId: r.auth.sellerId }`, where sellerId comes from the ApiKey row looked up by sha256 of the Bearer secret (s\u2026"],
  ["src/app/api/v1/listings/[id]/route.ts", "Line 22 returns 404 with no body unless `listing.sellerId === r.auth.sellerId`; PATCH/DELETE go through listingOwnedBy(id, r.auth.sellerId), a bool\u2026"],
  ["src/app/api/v1/listings/bulk/route.ts", "Only read is `where: { id: r.auth.sellerId }`, the key's own shop, passed to bulkImportCore as the write target."],
  ["src/app/api/v1/listings/route.ts", "GET is `where: { sellerId: r.auth.sellerId }`; POST reads only `where: { id: r.auth.sellerId }` \u2014 a key can never read another shop's inventory."],
  ["src/app/api/v1/listings/sync/route.ts", "Only read is `where: { id: r.auth.sellerId }` after resolveApiKey(req, 'listings:write'); the row is the write target, not a response."],
  ["src/app/api/v1/shop/route.ts", "`where: { id: r.auth.sellerId }`; the nested listings _count is therefore confined to the key's own shop."],
  ["src/app/api/webhooks/[id]/route.ts", "ownedHook() resolves `where: { ownerId: profile.id }` from the session; the endpoint lookup is a WebhookEndpoint selected down to sellerId purely a\u2026"],
  ["src/app/api/webhooks/route.ts", "callerShop() is `where: { ownerId: profile.id }` behind a business-tier check; the endpoint list is WebhookEndpoint keyed on that sellerId, not Lis\u2026"],
  ["src/app/listings/[id]/edit/page.tsx", "Seller is `where: { ownerId: profile.id }` (redirect to /signin otherwise) and line 44 does `if (!seller || listing.sellerId !== seller.id) notFoun\u2026"],
  ["src/lib/admin-reports.ts", "Every call site is getAdmin()-gated (admin/page.tsx:29, admin/disputes/page.tsx:28, admin/disputes/[id]/page.tsx:18, api/admin/ai-review/route.ts:9\u2026"],
  ["src/lib/ai-moderation.ts", "moderateListingById returns Promise<void>: the row feeds Gemini and a hide+Report+Notification write; scoping would silently disable illegal-conten\u2026"],
  ["src/lib/api/auth.ts", "listingOwnedBy() selects only sellerId and returns a boolean; scoping would turn an ownership check into an edition check and break the desk's own\u2026"],
  ["src/lib/core/business-verification-service.ts", "Owner paths take a sellerId resolved from `where: { ownerId: getCurrentProfileId() }`; the review/approve paths are getAdmin()-gated in admin/busin\u2026"],
  ["src/lib/core/dashboard.ts", "`where: { ownerId: profile.id }` with profile from getCurrentProfile() in api/dashboard/route.ts:73-78; included listings and the conversation aggr\u2026"],
  ["src/lib/core/listings.ts", "Module contract (lines 41-46): every core takes an already-authorized listingId/sellerId checked by the caller (checkListingOwner / resolveApiKey);\u2026"],
  ["src/lib/core/seller.ts", "updateSellerCore reads `where: { id: sellerId }` for a sellerId already authorized by its two callers (session PATCH /api/seller and key-authed PAT\u2026"],
  ["src/lib/core/sync.ts", "Both reads pin `sellerId: seller.id` where seller came from `where: { id: r.auth.sellerId }` in the key-authed sync route; rows are ids fed into up\u2026"],
  ["src/lib/dispute.ts", "partyRoleFor selects only seller.ownerId for an id comparison, and counterpartyName is reachable only after loadDisputeForParty returns a role \u2014 a\u2026"],
  ["src/lib/enforcement.ts", "Seller/listing reads are `ownerId: profileId` / `sellerId: { in: owned }` for the account being enforced (admin- or cron-supplied per the header at\u2026"],
  ["src/lib/image-provenance.ts", "Returns Promise<void>; the cross-seller dHash $queryRaw is deliberately platform-wide \u2014 excluding the desk would stop detection of scammers stealin\u2026"],
  ["src/lib/listing-analytics.ts", "getListingAnalytics's `where: { sellerId }` is passed r.auth.sellerId by both callers (api/v1/analytics/listings and mcp/tools.ts:233), resolved fr\u2026"],
  // THE REASON THIS LINE USED TO CARRY WAS THE BUG, AND IT ARGUED ITSELF INTO IT. It read "MUST
  // NOT be scoped - desk documents are WRITTEN by the services build, where the scope is {}, so a
  // guard here never runs for them", which is a true observation about the marketplace scope and
  // the wrong conclusion drawn from it: the answer was never "no guard", it was "not THAT guard".
  // The file now uses isServicesDeskListing() from edition-scope.ts, which is edition-INDEPENDENT
  // because both builds write into one Vertex datastore that eno.vn's concierge reads. It stays
  // exempt from Rule A because the correct predicate here is that one, not the scope this rule
  // counts - the same reason api/admin/vertex-backfill sits under ALLOW_DIRS while carrying a real
  // exclusion of its own.
  ["src/lib/listing-index.ts", "Its listing read feeds a Vertex upsert/delete decision, guarded by the edition-INDEPENDENT isServicesDeskListing() \u2014 scopedListingWhere would be a no-op on the build that owns the desk"],
  ["src/lib/listing-owner.ts", "Seller is `where: { ownerId: profile.id }`; the listing read selects only sellerId to return a 403/404 boolean."],
  ["src/lib/mcp/tools.ts", "Every read keys on auth.sellerId from resolveApiKey(req) in api/mcp/route.ts:80 \u2014 the API key is never a tool argument, so a model-supplied id cann\u2026"],
  ["src/lib/phone-unique.ts", "Return type is Promise<boolean>; the only disclosure is 'this number is already registered', which callers turn into a 409."],
  ["src/lib/profile.ts", "Every predicate is the authenticated Supabase user's own id (`where: { ownerId: profile.id }` where profile was upserted from user.id) or their ver\u2026"],
  ["src/lib/trust.ts", "Seller is `where: { ownerId: profileId }` and all listing reads key on that seller.id; the public caller passes the session profile (api/dashboard/\u2026"],
  ["src/lib/urgent.ts", "`db.listing.count({ where: { sellerId, ... } })` returns a boolean quota gate for the seller's own post/edit."],
  ["src/lib/webhooks.ts", "Selects only listing.sellerId to pick which shop's registered endpoints to notify; every caller is an after() hook on that shop's own mutation."],
])

/** Directories whose reads are services-only or operator-only and are never public marketplace feeds. */
const ALLOW_DIRS = [
  'src/app/api/visa/',
  'src/app/api/itineraries/',
  'src/app/api/trips/',
  'src/app/api/admin/',
  'src/app/admin/',
  'src/lib/visa/',
  'src/lib/trips/',
]

/**
 * The route trees that belong to the SERVICES edition only. Every Next special file inside them must
 * be named `.svc.` so a marketplace build cannot compile it.
 *
 * ⚠️ api/admin/trips IS IN HERE AND SITS OUTSIDE ALL THREE OBVIOUS PREFIXES — the proof that a typed
 * prefix list is a maintenance hazard, and the reason Rule B reports rather than assumes.
 */
const SERVICES_TREES = [
  'src/app/vietnam-evisa/',
  'src/app/itinerary/',
  'src/app/services-for-expats-vietnam/',
  // ⚠️ THE TWO ARRIVAL GUIDES LOOK HARMLESS AND ARE NOT. "Moving to Vietnam" and "first month in
  // Vietnam" read like ordinary marketplace content — which is exactly why they belong in this list:
  // both name the e-visa, evisa.gov.vn and the licensed partner in their prose, so a future edit
  // that renamed page.svc.tsx to page.tsx would ship that vocabulary in the licensed image while
  // looking like a tidy-up in the diff. A route tree whose services-ness is not obvious from its
  // name is the one that most needs the rule.
  'src/app/moving-to-vietnam/',
  'src/app/first-month-in-vietnam/',
  'src/app/dashboard/visa/',
  'src/app/dashboard/trips/',
  'src/app/admin/visas/',
  'src/app/admin/trips/',
  'src/app/api/visa/',
  'src/app/api/trips/',
  'src/app/api/itineraries/',
  'src/app/api/admin/trips/',
  // ⚠️ THE PAYMENTS TREE WAS NEVER IN THIS LIST, so Rule B never once looked at it — and the Stripe
  // webhook sat there as `route.svc.ts` where a rename to `route.ts` would have passed lint and put
  // a payments endpoint in the licensed image. Taking money for the service is the one thing eno.vn
  // genuinely cannot do (owner, 2026-08-13), so its routes are the LAST place the naming rule should
  // have been unenforced. Both PayPal routes and the Stripe webhook now carry `.forum.svc.`.
  'src/app/api/payments/',
]

/**
 * The Prisma reads that can return listings to a user or a crawler.
 *
 * ⚠️ `tx.` AND `client.` ARE IN HERE because a read inside `db.$transaction(async (tx) => …)` is
 * every bit as public as one on `db`, and the first version of this pattern only matched `db.` —
 * caught by review. KNOWN GAP, stated rather than hidden: raw SQL (`$queryRaw`) and a client aliased
 * to some other local name still evade this. Rule A is a net, not a proof; the proof is the image
 * grep in the Docker build.
 */
const READ_RE = /\b(?:db|tx|client)\.(listing|seller)\.(findMany|findFirst|findUnique|count|groupBy|aggregate)\s*\(/g

/**
 * ⚠️ SEARCHED IN THE DECOMMENTED SOURCE, NOT THE RAW FILE. Searching `raw` meant a file could
 * silence this rule with a COMMENT that happened to mention the helper — including a comment saying
 * "this deliberately does not use marketplaceListingScope". Found by review; it made the rule
 * trivially and accidentally defeatable.
 */
// ⚠️ `editionHiddenSellerIds` COUNTS AS A GUARD, and omitting it turned a correct refactor red.
// It is the per-edition seller-level hide-list added 2026-08-17 so eno.forum can hide the
// partner storefronts it does not promote; the six call sites that used to read
// `IS_MARKETPLACE && deskSellerIds()` now read it instead. Rule A counts MENTIONS of these
// names against listing/seller reads, so renaming a guard without adding it here reads as a
// file that lost its scope.
// ⚠️ EVERY GUARD NAME BELONGS HERE, and adding one without updating this list turns a correct
// refactor red. Rule A counts MENTIONS of these against listing/seller reads, so a file that
// swapped one guard for a better one reads as a file that lost its scope. `isSellerHiddenHere`
// and `editionSellerScope` (2026-08-17) are the seller-level pair that also carries the
// marketplace ALLOW-list — the rule that keeps a brand-new seller off eno.vn until MOIT.
const SCOPE_HINTS = ['marketplaceListingScope', 'scopedListingWhere', 'deskSellerIds', 'editionHiddenSellerIds', 'isSellerHiddenHere', 'editionSellerScope']

/** The one-off escape hatch, which IS meant to be a comment — same shape as design-lint's. */
const INLINE_ALLOW = 'edition-lint-allow'

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/** Strip comments so a rule name mentioned in prose does not count as a guard (or a violation). */
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/**
 * The module specifiers `next.config.ts` swaps for a stub on a MARKETPLACE build.
 *
 * ⚠️ PARSED OUT OF next.config.ts, NEVER RETYPED HERE. A second hand-maintained copy of this list
 * would drift, and it would drift in the direction that passes: a stale entry here marks an import
 * "aliased" when the alias has been removed, which is the exact leak Rule C exists to catch.
 */
function aliasedSpecifiers() {
  const cfg = readFileSync(join(ROOT, 'next.config.ts'), 'utf8')
  const at = cfg.indexOf('resolveAlias: {')
  if (at === -1) return null // config restructured — Rule C reports that rather than passing silently
  const all = new Set([...cfg.slice(at).matchAll(/"(@\/[^"]+)"\s*:/g)].map((m) => m[1]))
  /**
   * ⛔ THE FLAG CHANGES WHICH ALIASES APPLY, AND THIS FUNCTION USED TO BE BLIND TO IT — SO RULE C
   * WOULD HAVE REPORTED CLEAN WHILE THE EXEMPTION IT RELIES ON NO LONGER EXISTED.
   *
   * `resolveAlias` is not one flat map any more (next.config.ts): three specifiers — the visa cards,
   * the PDP start button and the services error vocabulary — are stubbed ONLY while
   * MARKETPLACE_HOSTS_SERVICES is off, because a deployment hosting a partner's visa chat needs the
   * real modules. This function reads the config as TEXT, so it saw all of them regardless, and
   * `ALIASED_REAL_FILES` below would have kept exempting files that a flag-on build genuinely
   * compiles. That is precisely the failure this file's own header warns about: "a stale entry here
   * marks an import 'aliased' when the alias has been removed".
   *
   * Reading the same env the config reads keeps the two halves honest with each other.
   */
  if (process.env.MARKETPLACE_HOSTS_SERVICES === 'true') {
    for (const spec of FLAG_UNSTUBBED) all.delete(spec)
  }
  return all
}
/**
 * The specifiers whose stubs are skipped when the marketplace hosts a partner's services.
 * ⚠️ KEEP IN SYNC WITH THE CONDITIONAL BLOCK IN next.config.ts.
 *
 * ⚠️ IT IS FOUR NOW, NOT THREE, AND THE COMMENT THAT SAID "the visa chat and nothing else" WAS
 * ASKING TO BE RE-READ ON EXACTLY THIS CHANGE. `trip-cards` joined on 2026-08-15: the itinerary
 * desk moved to a licensed partner (GMBR) and the trip UI had been left in the always-stubbed
 * group, so every trip surface on eno.vn rendered `() => null` while its APIs and routes shipped.
 * The list growing is the signal the old comment wanted flagged — so, flagged: eno.vn now hosts
 * TWO partner desks, visa and trips, and this list is the record of what that costs in bundle.
 * If it grows again, ask whether the edition split is still buying anything.
 */
const FLAG_UNSTUBBED = [
  '@/components/marketplace/trip-cards',
  '@/components/marketplace/visa-cards',
  '@/components/marketplace/visa-start',
  '@/lib/api/errors-services',
]
const ALIASED = aliasedSpecifiers()

/**
 * The REAL files those specifiers resolve to — the modules a marketplace build never compiles,
 * because the bundler hands it the stub instead.
 *
 * ⚠️ THEY MUST BE EXEMPT FROM RULE C, and for the same reason `.svc.` files are: what a module
 * imports only matters if that module is in the build. src/lib/edition-services-copy.ts imports
 * @/app/vietnam-evisa/links ON PURPOSE — that indirection is how the shared sitemap stops importing
 * it directly — and flagging the bridge would leave the rule with no fix available except deleting
 * the mechanism it is recommending.
 */
const ALIASED_REAL_FILES = new Set(
  [...(ALIASED ?? [])].flatMap((spec) => {
    const base = spec.replace('@/', 'src/')
    return [`${base}.ts`, `${base}.tsx`]
  }),
)

const files = walk(SRC)
const unguarded = []
const badExt = []
const crossImports = []

for (const full of files) {
  const rel = relative(ROOT, full).split('\\').join('/')
  const raw = readFileSync(full, 'utf8')
  const src = decomment(raw)

  // RULE B — every Next special file in a services tree carries `.svc.`
  //
  // ⚠️ IT CHECKS KNOWN TREES, NOT A (services) ROUTE GROUP, because the group turned out to be the
  // wrong home. /dashboard/visa and /dashboard/trips inherit src/app/dashboard/layout.tsx, and Next
  // resolves layouts by FILESYSTEM nesting — relocating them under src/app/(services)/ would have
  // silently stripped the dashboard chrome from both. The `.svc.` extension is what actually gates
  // the route (next.config.ts sets pageExtensions per edition); the directory was only ever
  // organisational. So the files stay where they are and this rule guards the naming instead.
  if (SERVICES_TREES.some((t) => rel.startsWith(t))) {
    const base = rel.split('/').pop()
    if (/^(page|layout|route|loading|error|template|default|not-found)\.(ts|tsx)$/.test(base)) {
      badExt.push(rel)
    }
  }

  /**
   * RULE C — a marketplace-compiled file importing an unaliased module out of a services tree.
   *
   * Skipped for files that are themselves services-only: a `.svc.` file is never compiled on a
   * marketplace build, and a module already inside a services tree importing its own siblings is
   * the normal case, not a leak.
   */
  if (!rel.includes('.svc.') && !SERVICES_TREES.some((t) => rel.startsWith(t)) && !ALIASED_REAL_FILES.has(rel)) {
    for (const m of src.matchAll(/\bfrom\s+'(@\/[^']+)'/g)) {
      const spec = m[1]
      const asPath = spec.replace('@/', 'src/')
      if (!SERVICES_TREES.some((t) => asPath.startsWith(t))) continue
      if (ALIASED && ALIASED.has(spec)) continue
      const line = src.slice(0, m.index).split('\n').length
      crossImports.push(`${rel}:${line}  imports ${spec}`)
    }
  }

  if (ALLOW.has(rel) || ALLOW_DIRS.some((d) => rel.startsWith(d))) continue

  /**
   * RULE A — listing/seller reads that outnumber the guards in the same file.
   *
   * File-level rather than line-local on purpose: predicates are composed far from the call
   * (feed-query.ts assembles its `where` across ~200 lines), so a line-local check would be all
   * false negatives. But "does the file mention the helper anywhere" was too weak — review pointed
   * out that ONE guarded query then excuses every other query in the file. Counting closes the
   * common case: five reads and one guard is now four reported, not zero.
   *
   * Still not a proof — two reads and two guard mentions passes even if they are not paired. The
   * inline `edition-lint-allow` comment is the escape hatch for a read that genuinely needs none.
   */
  READ_RE.lastIndex = 0
  const reads = [...src.matchAll(READ_RE)]
  const guards = SCOPE_HINTS.reduce((n, h) => n + src.split(h).length - 1, 0)
  const exempt = raw.split('\n').filter((l) => l.includes(INLINE_ALLOW)).length
  if (reads.length > guards + exempt) {
    const line = src.slice(0, reads[0].index).split('\n').length
    const extra = reads.length - guards - exempt
    unguarded.push(`${rel}:${line}${reads.length > 1 ? `  (${extra} of ${reads.length} reads unguarded)` : ''}`)
  }
}

// ⚠️ A closed pipe is not a lint failure. Once this runs inside `npm run lint`, anyone doing
// `npm run lint | head` closes stdout mid-write and an unhandled EPIPE exits non-zero — a red build
// caused by the reader, not by the code. Found exactly that way while writing this script.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0) })
const say = (s) => process.stdout.write(`${s}\n`)

if (!unguarded.length && !badExt.length && !crossImports.length) {
  say('edition-lint: clean')
} else {
  say('')
  say('edition-lint FAILED — eno.vn is a licensed sàn TMĐT and may not surface visa, itinerary or')
  say('PayPal services. See the edition split in CLAUDE.md and src/lib/edition-scope.ts.')
  if (unguarded.length) {
    say('')
    say(`  Rule A — ${unguarded.length} file(s) with listing/seller reads lacking the marketplace scope:`)
    say('  The e-visa SKUs are ORDINARY Listing rows owned by one desk seller, so an unscoped read')
    say('  puts them in eno.vn\'s feed, search, sitemap and Google/Meta product feeds.')
    say('')
    say('  Fix:  where: await scopedListingWhere({ ...your predicate })')
    say('  ⚠️ NOT by spreading marketplaceListingScope() beside your own sellerId — object spread')
    say('     overwrites on key collision and the exclusion is silently lost.')
    say('  If the read is genuinely owner-scoped, add it to ALLOW with the constraint that makes it')
    say('  safe — not the word "internal".')
    say('')
    for (const f of unguarded) say(`    ${f}`)
  }
  if (badExt.length) {
    say('')
    say(`  Rule B — ${badExt.length} services file(s) missing the .svc. extension:`)
    say('  A marketplace build compiles these, so the route ships in the licensed image.')
    say('')
    for (const f of badExt) say(`    ${f}`)
  }
  if (crossImports.length) {
    say('')
    say(`  Rule C — ${crossImports.length} shared file(s) importing an unaliased services-tree module:`)
    say('  pageExtensions excludes services ROUTES, not ordinary modules beside them, so a marketplace')
    say('  build compiles every literal in the imported file. An IS_SERVICES gate at the call site')
    say('  stops it RENDERING; it cannot remove the strings from the artifact.')
    say('')
    say('  Fix: either re-export what you need from a module already aliased in next.config.ts')
    say('       (see SERVICES_SITEMAP_PATHS in src/lib/edition-services-copy.ts), or keep the')
    say('       imported module\'s VALUES free of services vocabulary (see src/lib/expat-guides.ts).')
    say('')
    for (const f of crossImports) say(`    ${f}`)
  }
  say('')
  process.exitCode = 1
}
