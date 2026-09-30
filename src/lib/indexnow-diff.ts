/**
 * INDEXNOW'S PURE LOGIC: what changed between two sitemap snapshots, and what one cron run should do
 * about it (SEO wave B, I4). No I/O here — the route (src/app/api/cron/indexnow/route.ts) reads the
 * sitemaps and the stored state, calls `planRun`, and carries out the plan. The tests drive this file
 * directly, run by run, so the rules below are pinned where they are decided.
 *
 * ⛔ WHICH URLS CAN EVER BE PINGED: ONLY URLS A SITEMAP LISTED. Added and changed URLs come from the
 * current sitemaps; removed URLs come from the previous snapshot, which holds only earlier sitemap
 * locs. The sitemaps list our own stock only (`submittedListingWhere`: `affiliateUrl: null`), and
 * `parseUrlset` keeps only `https://eno.vn/…`, so no import, eno.forum or subdomain URL can reach a
 * `urlList`. A FROZEN URL (below) is never pinged at all.
 *
 * ⛔ THE GUARD, AND WHY IT HAS A HOLD THAT SURVIVES CHURN. A diff against a sitemap that silently lost
 * a part would turn that part into removal pings, so a run whose diff removes more than 50 URLs, or
 * drops the URL count by more than 30%, sends nothing and returns 409. But a LEGITIMATE mass removal
 * trips the same guard forever, so the guard keeps a HOLD: the original removed set O, a trip count
 * and the first trip's time. A later trip whose removed set R still covers O (|O ∩ R| ≥ 90% of |O|)
 * CONTINUES the hold, even though R has picked up normal churn since — the exact-set fingerprint of
 * the first design never matched twice and so never re-baselined (round-2 review, A2/O1). After 3
 * trips spanning 20 hours the removal is taken as real: the run RE-BASELINES, pinging added and
 * changed URLs but NO removals (decision I-f: removals are pinged except on a re-baseline).
 */

export const INDEXNOW_HOST = 'eno.vn'
/** IndexNow accepts up to 10,000 URLs per POST. */
export const BATCH_MAX = 10_000
/** The guard: more removals than this in one run… */
export const GUARD_MAX_REMOVALS = 50
/** …or the eligible URL count falling by more than this fraction. */
export const GUARD_MAX_DROP = 0.3
/**
 * A trip continues the current hold when it still removes at least this share of the hold's
 * ORIGINAL set. A judgement, not a measurement (plan assumption 19): revisit it from the `overlap`
 * the 409 bodies report after the first real hold.
 */
export const HOLD_OVERLAP = 0.9
/** The automatic re-baseline: the hold's trip count reaches this… */
export const REBASELINE_TRIPS = 3
/** …and at least this long has passed since its first trip (the timers run at 01:30 and 13:30 UTC). */
export const REBASELINE_AFTER_MS = 20 * 60 * 60 * 1000

/** What is stored under `indexnow:v1:eno.vn`: every eligible loc → its `<lastmod>` ('' when none). */
export type Snapshot = { v: 1; savedAt: string; urls: Record<string, string> }
/** What is stored under `indexnow:hold` while the guard is tripped. `removed` is O, sorted. */
export type Hold = { reason: string; removed: string[]; count: number; firstAt: string; lastAt: string; overlap: number }

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/** True only for `https://eno.vn/…` — never www, a subdomain, eno.forum, or plain http. */
export function isEligibleUrl(loc: string): boolean {
  try {
    const u = new URL(loc)
    return u.protocol === 'https:' && u.host === INDEXNOW_HOST
  } catch {
    return false
  }
}

/**
 * A `<urlset>`'s entries as loc → lastmod, host-filtered (`isEligibleUrl`). A `<url>` without a
 * `<lastmod>` maps to ''. `rawCount` counts every `<loc>`, eligible or not, so the collector can tell
 * "an empty child" (a source failure) from "a child of other hosts' URLs".
 */
export function parseUrlset(xml: string): { urls: Map<string, string>; rawCount: number } {
  const urls = new Map<string, string>()
  let rawCount = 0
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([\s\S]*?)<\/loc>/.exec(m[1])?.[1]
    if (!loc) continue
    rawCount++
    const url = decode(loc.trim())
    if (!isEligibleUrl(url)) continue
    urls.set(url, decode(/<lastmod>([\s\S]*?)<\/lastmod>/.exec(m[1])?.[1]?.trim() ?? ''))
  }
  return { urls, rawCount }
}

/** A `<sitemapindex>`'s child locs, in order. */
export function parseSitemapIndex(xml: string): string[] {
  return [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?<\/sitemap>/g)].map((m) => decode(m[1].trim()))
}

/** A frozen entry ending in `/` is a path prefix; any other is one exact path. */
export function isFrozen(loc: string, frozen: readonly string[]): boolean {
  if (!frozen.length) return false
  let path: string
  try {
    path = new URL(loc).pathname
  } catch {
    return false
  }
  return frozen.some((f) => (f.endsWith('/') ? path.startsWith(f) : path === f))
}

export type Diff = {
  added: string[]
  changed: string[]
  removed: string[]
  /** The snapshot to save if this run is accepted. */
  next: Record<string, string>
  /** Eligible, non-frozen URL counts, before and now — what the drop guard compares. */
  prevCount: number
  currCount: number
  /** Previous entries carried forward untouched because they are frozen. */
  frozenKept: number
}

/**
 * The diff. `changed` = both sides carry a lastmod and it moved. A URL without a lastmod is sent
 * only when it is added or removed; one that LOSES its lastmod keeps the stored one (so a date that
 * comes back unchanged is not a change, and one that comes back moved still is).
 *
 * FROZEN URLS (`frozen`, from the pages builder's `'optional'` mode when the rent snapshot is
 * unknown): the previous entry is carried into `next` unchanged and the current one is ignored, so a
 * frozen URL is never added, changed or removed, and does not count towards the guard.
 */
export function diffSnapshots(prev: Record<string, string>, curr: Map<string, string>, frozen: readonly string[] = []): Diff {
  const added: string[] = []
  const changed: string[] = []
  const removed: string[] = []
  const next: Record<string, string> = {}
  let prevCount = 0
  let currCount = 0
  let frozenKept = 0
  for (const [loc, lastmod] of Object.entries(prev)) {
    if (isFrozen(loc, frozen)) {
      next[loc] = lastmod
      frozenKept++
      continue
    }
    prevCount++
    if (!curr.has(loc)) removed.push(loc)
  }
  for (const [loc, lastmod] of curr) {
    if (isFrozen(loc, frozen)) continue
    currCount++
    const before = prev[loc]
    if (before === undefined) {
      added.push(loc)
      next[loc] = lastmod
    } else {
      if (before && lastmod && before !== lastmod) changed.push(loc)
      next[loc] = lastmod || before
    }
  }
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort(), next, prevCount, currCount, frozenKept }
}

/** Why the guard trips, or null when it does not. */
export function guardTrip(d: Pick<Diff, 'removed' | 'prevCount' | 'currCount'>): string | null {
  if (d.removed.length > GUARD_MAX_REMOVALS) return `removed ${d.removed.length} URLs (more than ${GUARD_MAX_REMOVALS})`
  if (d.prevCount > 0 && d.currCount < d.prevCount * (1 - GUARD_MAX_DROP)) {
    return `URL count fell from ${d.prevCount} to ${d.currCount} (more than ${GUARD_MAX_DROP * 100}%)`
  }
  return null
}

/** |O ∩ R| / |O|: how much of the hold's original removed set this run still removes. */
export function holdOverlap(original: readonly string[], removed: readonly string[]): number {
  if (!original.length) return 0
  const r = new Set(removed)
  let hit = 0
  for (const u of original) if (r.has(u)) hit++
  return hit / original.length
}

/**
 * The hold after a trip. It CONTINUES (count + 1, the same O, the same `firstAt`) while this run's
 * removed set still covers ≥ 90% of O — which includes O ⊆ R, a mass removal plus the churn since.
 * Otherwise (most of O came back, or it is a different mass removal) a new hold starts at count 1
 * with O = R. New URLs play no part: only removals are compared.
 */
export function nextHold(hold: Hold | null, removed: readonly string[], now: Date, reason: string): Hold {
  const at = now.toISOString()
  if (hold) {
    const overlap = holdOverlap(hold.removed, removed)
    if (overlap >= HOLD_OVERLAP) return { ...hold, reason, count: hold.count + 1, lastAt: at, overlap }
  }
  return { reason, removed: [...removed].sort(), count: 1, firstAt: at, lastAt: at, overlap: 1 }
}

/** 3 trips of one hold, the first at least 20 hours ago: the removal is real, so re-baseline. */
export function shouldRebaseline(hold: Hold, now: Date): boolean {
  return hold.count >= REBASELINE_TRIPS && now.getTime() - Date.parse(hold.firstAt) >= REBASELINE_AFTER_MS
}

export function batches<T>(items: readonly T[], size = BATCH_MAX): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export type RunPlan =
  /** No stored snapshot: save one, send nothing. */
  | { kind: 'baseline'; next: Snapshot; count: number }
  /** `?rebaseline=1`: accept now, send nothing. */
  | { kind: 'manual-rebaseline'; next: Snapshot; diff: Diff }
  /** Under the guard: send added + changed + removed (possibly nothing), then accept and drop the hold. */
  | { kind: 'send'; urlList: string[]; next: Snapshot; diff: Diff }
  /** The guard tripped and the hold is not ripe: save `hold`, send nothing, answer 409. */
  | { kind: 'trip'; hold: Hold; diff: Diff }
  /**
   * The guard tripped and the hold is ripe: send added + changed only — ALL of them, batched by
   * 10,000 — then accept. ⛔ Never truncated: the accepted snapshot records every URL as sent, so a
   * URL cut from the list here would never be offered again (codex, diff review).
   */
  | { kind: 'auto-rebaseline'; urlList: string[]; hold: Hold; next: Snapshot; diff: Diff }

/** A stored value that is not a v1 snapshot is treated as no snapshot: the run baselines. */
export function asSnapshot(v: unknown): Snapshot | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Partial<Snapshot>
  return s.v === 1 && s.urls && typeof s.urls === 'object' ? (s as Snapshot) : null
}

export function asHold(v: unknown): Hold | null {
  if (!v || typeof v !== 'object') return null
  const h = v as Partial<Hold>
  return Array.isArray(h.removed) && typeof h.count === 'number' && typeof h.firstAt === 'string' ? (h as Hold) : null
}

/** One cron run's decision, from what it read. The route only carries it out. */
export function planRun(input: {
  prev: Snapshot | null
  curr: Map<string, string>
  frozen?: readonly string[]
  hold: Hold | null
  now: Date
  rebaseline?: boolean
}): RunPlan {
  const { prev, curr, hold, now } = input
  const frozen = input.frozen ?? []
  const savedAt = now.toISOString()
  if (!prev) {
    // A first run has nothing to carry for a frozen URL, so it leaves it out; the first run that can
    // see it again records it as added.
    const urls: Record<string, string> = {}
    for (const [loc, lastmod] of curr) if (!isFrozen(loc, frozen)) urls[loc] = lastmod
    return { kind: 'baseline', next: { v: 1, savedAt, urls }, count: Object.keys(urls).length }
  }
  const diff = diffSnapshots(prev.urls, curr, frozen)
  const next: Snapshot = { v: 1, savedAt, urls: diff.next }
  if (input.rebaseline) return { kind: 'manual-rebaseline', next, diff }
  const reason = guardTrip(diff)
  if (!reason) return { kind: 'send', urlList: [...diff.added, ...diff.changed, ...diff.removed], next, diff }
  const held = nextHold(hold, diff.removed, now, reason)
  if (!shouldRebaseline(held, now)) return { kind: 'trip', hold: held, diff }
  return { kind: 'auto-rebaseline', urlList: [...diff.added, ...diff.changed], hold: held, next, diff }
}
