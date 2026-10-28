/**
 * BLOCKING ANOTHER USER — App Store Guideline 1.2 (plan R3), behind the `ugc-safety` review gate.
 *
 * With the gate OFF (the default) every helper here answers "nothing is blocked" WITHOUT touching the
 * database, so the messaging hot paths that call them pay nothing and behave exactly as before.
 *
 * STORAGE: `ForumUserBlock` — already a generic Profile↔Profile table (composite primary key, cascade
 * delete on either profile), so no DDL. Its rows predate this file only through the dormant forum API
 * (`/api/forum/blocks`, which nothing in the root app calls); a block is a block wherever it was made.
 *
 * WHAT A BLOCK DOES, both directions (Apple asks that a blocked user can no longer reach the blocker):
 *   · no NEW conversation between the two (POST /api/conversations),
 *   · no message and no offer in an EXISTING one (POST …/[id]/messages, …/[id]/offer),
 *   · no phone/Zalo reveal and no teacher contact share or read (the side doors around the chat),
 *   · the blocker's inbox stops listing threads with the blocked user,
 *   · the thread itself says it is closed (GET /api/conversations/[id] → `closed`), on both sides.
 * The thread itself is not deleted — it is evidence if either side reports the other.
 *
 * ⛔ AND THE BLOCKED SIDE'S CONTENT LEAVES THE BLOCKER'S FEEDS AT ONCE (App Store 1.2 rejection of 1.0.3 (4),
 * 2026-10-28: "blocking should … remove it from the user's feed instantly"). The feeds are cached HTML and JSON shared
 * by every visitor, so the server cannot filter them per user; instead GET /api/blocks hands the blocker the SHOP ids
 * their blocks hide (hiddenSellerIdsFor) and src/lib/hidden-sellers.ts hides every card, the listing page and the
 * storefront of those shops with one stylesheet — before first paint on a reload, the instant the block answers on a tap.
 * ⚠️ A shop id is public (every card carries it), never a profile id — and ONLY A SHOP THE BLOCKER ALREADY KNOWS IS ON
 * THAT LIST (review, codex + opus): one blocked from its own storefront or listing (a SellerBlock row, written beside
 * the person block), or the shop of a person the blocker bought from (the seller side of a thread with them). Blocking a
 * BUYER from a chat hides nothing of theirs: the list would otherwise hand the blocker the shop that buyer runs — an
 * identity the chat API is careful never to expose.
 *
 * ⛔ A SHOP NO BLOCKABLE PERSON RUNS IS BLOCKED AS A SHOP (SellerBlock). Apple's reviewer stood on an imported "Linked
 * shop" storefront (no owner account) and found Report with no Block beside it: "an imported, ownerless shop has
 * nobody to block" was true of the person, not of the content. Such a shop — no owner, or one the eno team owns (the
 * team itself cannot be blocked, see isStaffProfile) — is now blocked as a shop: its listings leave the blocker's feeds
 * and moderators are told, exactly as for a person; there is no thread to close, because nobody is on the other side.
 *
 * ⛔ IT NOTIFIES MODERATORS THROUGH THE FEEDBACK QUEUE, NOT A REPORT. The plan said "open a moderation
 * report on every block". A `Report` row against the blocked profile is not neutral here: an OPEN report
 * makes `eraseAccount` refuse that user's own deletion ('under_review', src/app/api/account/delete), so
 * merely being blocked would cost someone their deletion right until an admin acted. The `Feedback` row
 * lands in /admin/feedback for a human, with no trust, enforcement or deletion effect. Reporting stays a
 * separate, deliberate act (the Report button beside Block).
 */
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { appReviewGate } from '@/lib/app-review-gates'
import { isAdminEmail } from '@/lib/admin'
import { logError } from '@/lib/log'

/** Is blocking switched on for this build? (`ugc-safety` in NEXT_PUBLIC_APP_REVIEW_GATES.) */
export const blockingOn = (): boolean => appReviewGate('ugc-safety')

/**
 * Has either of these two profiles blocked the other? False — with no query — when the gate is off,
 * when either side is unknown (an ownerless storefront, a support thread), or for the same profile.
 */
export async function isBlockedBetween(a: string | null | undefined, b: string | null | undefined): Promise<boolean> {
  if (!blockingOn() || !a || !b || a === b) return false
  const row = await db.forumUserBlock.findFirst({
    where: { OR: [{ blockerProfileId: a, blockedProfileId: b }, { blockerProfileId: b, blockedProfileId: a }] },
    select: { blockerProfileId: true },
  })
  if (!row) return false
  // ⛔ A BLOCK WITH THE ENO TEAM ON EITHER SIDE IS VOID FOR ENFORCEMENT. The API refuses to create one
  // (cannot_block_staff), but rows from the dormant forum API predate that rule, and an admin's own
  // block would close the very desk threads where cases are settled (opus, review). Costs a query only
  // when a block row actually exists.
  if ((await isStaffProfile(a)) || (await isStaffProfile(b))) return false
  return true
}

/**
 * Which way a block between `me` and `other` runs, for the thread's "conversation closed" banner:
 * 'mine' (I blocked them — including a mutual block, so the blocker always sees the way back),
 * 'theirs' (they blocked me), or 'none'. Same rules as isBlockedBetween: no query while the gate is
 * off or a side is missing, and a block with the eno team on either side is void.
 * ⚠️ GET /api/conversations/[id] calls this on every poll while the gate is ON — one primary-key read
 * (the staff lookups run only when a row exists), never a scan.
 */
export async function blockStateBetween(me: string | null | undefined, other: string | null | undefined): Promise<'none' | 'mine' | 'theirs'> {
  if (!blockingOn() || !me || !other || me === other) return 'none'
  const rows = await db.forumUserBlock.findMany({
    where: { OR: [{ blockerProfileId: me, blockedProfileId: other }, { blockerProfileId: other, blockedProfileId: me }] },
    select: { blockerProfileId: true },
  })
  if (!rows.length) return 'none'
  if ((await isStaffProfile(me)) || (await isStaffProfile(other))) return 'none'
  return rows.some((r) => r.blockerProfileId === me) ? 'mine' : 'theirs'
}

/**
 * The profiles THIS user has blocked (empty, with no query, while the gate is off) — the eno team
 * excluded, by the same rule that voids such a block in isBlockedBetween, so the inbox and badge can
 * never hide a thread the send path still treats as open (codex + opus, review). A staffer blocking
 * someone is refused by the API, so a staff `me` normally has no rows; if one exists it is void too.
 */
export async function profilesBlockedBy(me: string): Promise<Set<string>> {
  if (!blockingOn()) return new Set()
  const rows = await db.forumUserBlock.findMany({ where: { blockerProfileId: me }, select: { blockedProfileId: true } })
  if (!rows.length) return new Set()
  // ONE query for the staff test of me and every blocked profile — this runs on every badge poll while
  // the gate is on, so a per-row lookup would cost N+2 queries per poll (opus, review).
  const people = await db.profile.findMany({ where: { id: { in: [me, ...rows.map((r) => r.blockedProfileId)] } }, select: { id: true, email: true } })
  const staff = new Set(people.filter((p) => isAdminEmail(p.email)).map((p) => p.id))
  if (staff.has(me)) return new Set()
  return new Set(rows.map((r) => r.blockedProfileId).filter((id) => !staff.has(id)))
}

/**
 * The conversations this user's inbox and unread badge must leave out: threads with someone they
 * blocked. Ids, so the caller can exclude them with `id: { notIn }` in the WHERE — filtering after
 * the inbox's `take` would shrink the page and hide older threads, and a `NOT IN` on the nullable
 * `sellerProfileId` would drop every support-desk thread (NULL) along with them (codex, review).
 */
export async function blockedConversationIds(me: string): Promise<string[]> {
  const blocked = [...(await profilesBlockedBy(me))]
  if (!blocked.length) return []
  const rows = await db.conversation.findMany({
    where: { OR: [{ buyerProfileId: me, sellerProfileId: { in: blocked } }, { sellerProfileId: me, buyerProfileId: { in: blocked } }] },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/**
 * Is this profile the eno team (ADMIN_EMAILS)? ⛔ THE TEAM CANNOT BE BLOCKED. It owns the e-Visa / trip
 * desk and imported shops, so one applicant's block would 403 every admin reply in the thread where
 * their own case is being settled, and silence the admin across every other shop it owns (opus,
 * review). Report stays available for the team's conduct.
 */
export async function isStaffProfile(profileId: string): Promise<boolean> {
  const p = await db.profile.findUnique({ where: { id: profileId }, select: { email: true } })
  return isAdminEmail(p?.email)
}

// ── THE SETTINGS LIST NAMES A BLOCK BY AN OPAQUE HANDLE, NEVER BY A PROFILE ID ─────────────────────────
//
// GET /api/blocks used to hand the blocker the blocked profiles' raw ids (follow-up 3 of 0a470ed98) —
// an identifier the chat API is careful never to expose. The list now carries a HANDLE:
// HMAC-SHA256(key, "<blocker>:<blocked>"), base64url, cut to 22 characters (132 bits). Unblock sends the
// handle back; the server recomputes it over the CALLER's OWN rows and deletes the one that matches.
//   · Bound to the blocker: the same blocked person has a different handle in every blocker's list, so
//     a handle is inert in anyone else's hands and says nothing about who it points at.
//   · Not an oracle: a miss answers 404 (route.ts), but the only handles that can ever match are ones
//     GET already showed this same caller — a miss says "not one of your blocks (any more)", nothing
//     about any other profile.
//   · Same key construction as src/lib/unsubscribe-token.ts — HKDF-SHA256 over SUPABASE_SECRET_KEY (or
//     CRON_SECRET) with its own info string, so this handle can never be confused with, or forged
//     from, any other token the app signs. ⛔ FAIL CLOSED: no base secret → no handle is minted and none
//     verifies (a constant key would make every handle guessable).
//   · The derived key is cached for the life of the process, like unsubscribe-token.ts's: process.env
//     does not change under a running server, so rotating the base secret means a restart — after which
//     an open settings page's handles stop matching (its Unblock answers 404 and the list reloads with
//     fresh ones). Nothing is stored.

export const BLOCK_HANDLE_RE = /^[A-Za-z0-9_-]{22}$/

let cachedHandleKey: Buffer | null = null
function handleKey(): Buffer | null {
  if (cachedHandleKey) return cachedHandleKey
  const ikm = process.env.SUPABASE_SECRET_KEY || process.env.CRON_SECRET
  if (!ikm) return null
  cachedHandleKey = Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(ikm), Buffer.from('eno-user-block-v1'), Buffer.from('block-list-handle'), 32),
  )
  return cachedHandleKey
}

/** The opaque handle for one (blocker → blocked) row, or null when no secret is configured. */
export function blockHandle(blocker: string, blocked: string): string | null {
  const key = handleKey()
  if (!key) return null
  return crypto.createHmac('sha256', key).update(`${blocker}:${blocked}`).digest('base64url').slice(0, 22)
}

/** No signing secret is configured, so no handle can be verified (see handleKey). The route answers 503. */
export class BlockHandleKeyMissing extends Error {
  constructor() { super('block handle key is not configured'); this.name = 'BlockHandleKeyMissing' }
}

/**
 * Unblock the row behind `handle` — among THIS blocker's rows only. Resolves to whether a row matched (the
 * route answers 404 on a miss, so a stale handle never reads as "unblocked"). Throws when no secret is
 * configured, so the caller can say "unavailable" instead of claiming an unblock that never happened.
 */
export async function unblockByHandle(blocker: string, handle: string): Promise<boolean> {
  const key = handleKey()
  if (!key) throw new BlockHandleKeyMissing()
  if (!BLOCK_HANDLE_RE.test(handle)) return false
  // The same 1000 rows, in the same order, that GET /api/blocks lists — a handle the list showed is
  // always among them.
  const rows = await db.forumUserBlock.findMany({ where: { blockerProfileId: blocker }, orderBy: { createdAt: 'desc' }, select: { blockedProfileId: true }, take: 1000 })
  const want = Buffer.from(handle)
  const matches = (h: string | null) => {
    const got = Buffer.from(h ?? '')
    return got.length === want.length && crypto.timingSafeEqual(got, want)
  }
  const hit = rows.find((r) => matches(blockHandle(blocker, r.blockedProfileId)))
  if (hit) {
    await deletePersonBlock(blocker, hit.blockedProfileId)
    return true
  }
  // A SHOP block's handle signs `shop:<sellerId>` (shopBlockHandle) — never a profile id's shape (a uuid), so the two
  // kinds can never answer for each other. Before the SellerBlock DDL there are no shop rows to match.
  const shops = await db.sellerBlock
    .findMany({ where: { blockerProfileId: blocker }, orderBy: { createdAt: 'desc' }, select: { sellerId: true }, take: 1000 })
    .catch((e: unknown) => { if (isMissingTable(e)) return []; throw e })
  const shop = shops.find((r) => matches(shopBlockHandle(blocker, r.sellerId)))
  if (!shop) return false
  await db.sellerBlock.deleteMany({ where: { blockerProfileId: blocker, sellerId: shop.sellerId } })
  return true
}

/** The opaque handle for one (blocker → shop) SellerBlock row — the same key and cut as blockHandle, over `shop:<id>`. */
export function shopBlockHandle(blocker: string, sellerId: string): string | null {
  return blockHandle(blocker, `shop:${sellerId}`)
}

/**
 * ONE MODERATOR NOTE PER (blocker → blocked) PER DAY (follow-up 4 of 0a470ed98). A block → unblock →
 * block loop inserts a fresh row each time, and each insert used to file a fresh note (bounded only by
 * the 30/h bucket). An atomic kv NX claim with a 24h TTL decides: the request that wins it files the
 * note, every other block of the same pair that day does not. Directional on purpose — A blocking B
 * and B blocking A are two different things for a moderator to read.
 * ⚠️ FAILS OPEN: if the claim itself errors the note is filed anyway — a duplicate note costs a click,
 * a missing one costs the moderator the signal. (kv_store is UNLOGGED: after a crash recovery the next
 * block of a pair may file one more note. Same direction, same reason.)
 */
export const BLOCK_NOTE_DEDUPE_SEC = 24 * 60 * 60

/**
 * Block or unblock. Idempotent both ways, including two taps racing each other: the insert skips a
 * duplicate instead of throwing on the composite key, and the moderation note (see the header) is filed
 * only by the request that actually inserted — and at most once per pair per day — best-effort, the
 * block must not fail because of it.
 */
export async function setUserBlock(
  blocker: string,
  blocked: string,
  on: boolean,
  context: BlockContext,
): Promise<void> {
  if (!on) {
    await deletePersonBlock(blocker, blocked)
    return
  }
  const { count } = await db.forumUserBlock.createMany({ data: [{ blockerProfileId: blocker, blockedProfileId: blocked }], skipDuplicates: true })
  if (count === 0) return
  const where = context.conversationId
    ? ` in conversation ${context.conversationId}`
    : context.listingId ? ` from listing ${context.listingId} (shop ${context.sellerId})` : context.sellerId ? ` from storefront ${context.sellerId}` : ''
  // ⚠️ The note names the block that won the day's claim. A re-block of the same pair in another thread
  // the same day files nothing new — accepted: the note links both accounts' admin pages, which list
  // every thread and report between them (codex + opus, gate round 1).
  await fileBlockNote(`user-block-note:${blocker}:${blocked}`, {
    profileId: blocker,
    message: `[user block] Profile ${blocker} blocked profile ${blocked} (${context.surface})${where}. Review the exchange and their content; a block alone is not a report. Accounts: /admin/users/${blocker} · /admin/users/${blocked}`,
    // ⚠️ THE ADMIN VIEWS, NOT THE USER ONES (follow-up 5 of 0a470ed98). `/messages/<id>` is the
    // participants' thread page — it 403s an admin who is not a party, which is every moderator.
    // `/admin/conversation/<id>` is the read-only thread viewer the moderation cards, the dispute
    // room and the enforcement console all link; a storefront block points at the blocked
    // account's admin record (/admin/users/<id>), which lists their shop, reports and actions.
    url: context.conversationId ? `/admin/conversation/${context.conversationId}` : `/admin/users/${blocked}`,
  })
}

/** Where a block was made — for the moderator note. `listingId` only when the server checked it belongs to `sellerId`. */
export type BlockContext = {
  surface: 'chat' | 'storefront' | 'listing' | 'settings'
  conversationId?: string | null
  sellerId?: string | null
  listingId?: string | null
}

/**
 * File the moderator note for a NEW block — at most once per `claimKey` per day (BLOCK_NOTE_DEDUPE_SEC), best-effort:
 * the block must not fail because of it.
 */
async function fileBlockNote(claimKey: string, note: { profileId: string; message: string; url: string }): Promise<void> {
  let claimed = false
  try {
    let first = true
    try {
      first = (await kv.set(claimKey, 1, { nx: true, ex: BLOCK_NOTE_DEDUPE_SEC })) === 'OK'
      claimed = first
    } catch (e) {
      logError(e, { op: 'user-blocks.noteDedupe' })
    }
    if (!first) return
    await db.feedback.create({ data: { kind: 'other', ...note } })
  } catch (e) {
    logError(e, { op: 'user-blocks.notify' })
    // ⛔ A CLAIM WITH NO NOTE BEHIND IT WOULD SILENCE THE PAIR FOR A DAY (codex + opus, gate round 1): the
    // claim was taken, the note was not written. Release it, so the next block of this pair files the note.
    if (claimed) await kv.del(claimKey).catch((err) => logError(err, { op: 'user-blocks.noteRelease' }))
  }
}

// ── SHOP BLOCKS (SellerBlock) ─────────────────────────────────────────────────────────────────────────────────────
//
// For a shop no blockable person runs (see the header). The table arrives with scripts/seller-blocks-ddl.mjs, run on
// production BEFORE the deploy; until then every read here answers "no shop blocks" and a shop block answers
// SellerBlocksMissing (the route says "unavailable"), so the person blocks keep working either way.

/** The SellerBlock table is not there yet (scripts/seller-blocks-ddl.mjs has not run on this database). */
export class SellerBlocksMissing extends Error {
  constructor() { super('the SellerBlock table does not exist yet — run scripts/seller-blocks-ddl.mjs'); this.name = 'SellerBlocksMissing' }
}

/** Postgres 42P01 behind Prisma: P2021 typed, or the driver's code inside a P2010 (the same test as apple-siwa.ts's). */
export function isMissingTable(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const x = e as { code?: unknown; meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } }; message?: unknown }
  if (x.code === 'P2021' || x.code === '42P01') return true
  if (x.meta?.code === '42P01' || x.meta?.driverAdapterError?.cause?.originalCode === '42P01') return true
  return typeof x.message === 'string' && x.message.includes('42P01')
}

/**
 * Is this shop blocked as a SHOP — nobody blockable runs it? No owner, or an owner on the eno team. A shop a person
 * runs is blocked through that person (setUserBlock), which also closes their threads.
 */
export async function isShopOnlyBlock(ownerId: string | null): Promise<boolean> {
  return !ownerId || (await isStaffProfile(ownerId))
}

/**
 * Block or unblock a SHOP. Idempotent both ways, like setUserBlock; a new block files one moderator note per
 * (blocker → shop) per day. Throws SellerBlocksMissing before the DDL has run.
 * ALSO WRITTEN FOR A PERSON-RUN SHOP blocked from its storefront or listing (the route, `note: false`): that row is what
 * puts the shop on the blocker's hidden list (hiddenSellerIdsFor), and unblocking the person removes it
 * (deletePersonBlock).
 */
export async function setSellerBlock(blocker: string, sellerId: string, on: boolean, context: BlockContext, opts: { note?: boolean } = {}): Promise<void> {
  try {
    if (!on) {
      await db.sellerBlock.deleteMany({ where: { blockerProfileId: blocker, sellerId } })
      return
    }
    const { count } = await db.sellerBlock.createMany({ data: [{ blockerProfileId: blocker, sellerId }], skipDuplicates: true })
    // `note: false` — a person-run shop's row, written beside the person block, whose own note setUserBlock files.
    if (count === 0 || opts.note === false) return
  } catch (e) {
    if (isMissingTable(e)) throw new SellerBlocksMissing()
    throw e
  }
  const where = context.listingId ? ` from listing ${context.listingId}` : ''
  await fileBlockNote(`seller-block-note:${blocker}:${sellerId}`, {
    profileId: blocker,
    message: `[shop block] Profile ${blocker} blocked shop ${sellerId} (${context.surface})${where} — a shop no member runs (imported, partner or eno's own). Its listings are hidden from this user. Review the shop's content; a block alone is not a report. Account: /admin/users/${blocker}`,
    url: context.listingId ? `/listings/${context.listingId}` : `/sellers/${sellerId}`,
  })
}

/**
 * The shop ids whose cards, listing pages and storefronts must be hidden from `me` (src/lib/hidden-sellers.ts): every
 * shop `me` blocked as a shop, and the shop of every PERSON `me` blocked (profilesBlockedBy — so a void block with the
 * eno team hides nothing, as it enforces nothing). Empty, with no query, while the gate is off. Before the SellerBlock
 * DDL has run, the person half alone.
 */
export async function hiddenSellerIdsFor(me: string): Promise<string[]> {
  if (!blockingOn()) return []
  const people = [...(await profilesBlockedBy(me))]
  const [boughtFrom, shops] = await Promise.all([
    // The shops of threads `me` opened as the BUYER with a person `me` blocked — the very shop each thread is about, so
    // `me` knows it (the thread's own sellerId, never a lookup by owner). Never a shop of a person `me` only SOLD to.
    people.length
      ? db.conversation.findMany({
          where: { buyerProfileId: me, sellerProfileId: { in: people } },
          select: { sellerId: true },
          distinct: ['sellerId'],
        })
      : Promise.resolve([]),
    // Newest first, so a cap can never drop the block just made (codex, review).
    db.sellerBlock.findMany({ where: { blockerProfileId: me }, orderBy: { createdAt: 'desc' }, select: { sellerId: true }, take: 1000 }).catch((e: unknown) => {
      if (isMissingTable(e)) return []
      throw e
    }),
  ])
  return [...new Set([...shops.map((s) => s.sellerId), ...boughtFrom.map((c) => c.sellerId)])]
}

/**
 * Unblock a PERSON — and, in the SAME transaction (codex, review: never "they can message you again" while their shop
 * stays hidden, or the reverse), the SellerBlock row their shop got when they were blocked from its storefront or listing
 * (setSellerBlock's note), so the shop comes back with them. Before the DDL, the person row alone.
 * ⚠️ By the shop's CURRENT owner: a shop that changed hands since (claim-once, so only ownerless → claimed) keeps or
 * loses its row with the new owner — accepted, the row then reads as that person's.
 */
export async function deletePersonBlock(blocker: string, blockedProfileId: string): Promise<void> {
  try {
    await db.$transaction([
      db.forumUserBlock.deleteMany({ where: { blockerProfileId: blocker, blockedProfileId } }),
      db.sellerBlock.deleteMany({ where: { blockerProfileId: blocker, seller: { ownerId: blockedProfileId } } }),
    ])
  } catch (e) {
    if (!isMissingTable(e)) throw e
    await db.forumUserBlock.deleteMany({ where: { blockerProfileId: blocker, blockedProfileId } })
  }
}
