import 'server-only'
import { db } from '@/lib/db'
import { blockingOn, isStaffProfile } from '@/lib/user-blocks'
import { logError } from '@/lib/log'

/**
 * In-app calls — THE RUNTIME SWITCH (DESIGN.md v3 §3.2 step 10): who may call right now.
 *
 *   off    nobody (the default, and what a missing table or row means)
 *   staff  the eno team only (ADMIN_EMAILS)
 *   beta   the team plus the profiles in `cohort`
 *   all    everyone the eligibility rules admit (src/lib/calls/server/eligibility.ts)
 *
 * ⚠️ A DB ROW, NOT AN ENV VAR. The repo's other kill switches are plain server env vars, which on the box means a
 * container restart to flip — and "off within 60 s, no rebuild" is the design's requirement. The row lives in
 * call_config (scripts/calls-ddl.mjs), LOGGED, so a Postgres crash cannot quietly undo a kill the way an UNLOGGED kv
 * key would.
 * ⚠️ FAILS CLOSED. An unreadable row, a missing table (the DDL not yet run on this database) or any value this build
 * does not know reads as 'off': calls are a feature that may be absent, never one that may be accidentally open.
 * ⚠️ CALLS ALSO NEED BLOCKING. Block is the user's way out of an unwanted caller (Apple 1.2 and plain decency), and
 * blocking only exists with the `ugc-safety` gate on — so without it calls are off whatever the row says (§7 item 5).
 */
export type CallsMode = 'off' | 'staff' | 'beta' | 'all'
export type RelayProvider = 'cloudflare' | 'eno'

export interface CallsConfig {
  mode: CallsMode
  cohort: ReadonlySet<string>
  video: boolean
  relay: RelayProvider
  /**
   * The row was READ (present or absent). False only when the read itself failed — new calls are still refused
   * then, but the sweep must not treat a database blip as the owner's kill switch and hang up every live call.
   */
  readOk: boolean
}

export const CALLS_OFF: CallsConfig = Object.freeze({ mode: 'off', cohort: new Set<string>(), video: false, relay: 'cloudflare', readOk: false })

const MODES: ReadonlySet<string> = new Set(['off', 'staff', 'beta', 'all'])
const RELAYS: ReadonlySet<string> = new Set(['cloudflare', 'eno'])
/**
 * How long one process trusts its read. Live calls are re-judged on every heartbeat (eligibility.ts liveCallRefusal),
 * so 'off' ends them within a beat plus this; the minute sweep (/api/cron/calls-sweep) is the backstop.
 */
export const CONFIG_CACHE_MS = 30_000

type Row = { mode: string; cohort: string[] | null; video: boolean; relay: string }

/** Pure: a row (or its absence) → the config this build obeys. Exported for tests. */
export function configFromRow(row: Row | null | undefined): CallsConfig {
  if (!row || !MODES.has(row.mode) || !RELAYS.has(row.relay)) return { ...CALLS_OFF, readOk: true }
  return {
    mode: row.mode as CallsMode,
    cohort: new Set((row.cohort ?? []).filter((id) => typeof id === 'string')),
    video: row.video === true,
    relay: row.relay as RelayProvider,
    readOk: true,
  }
}

let cached: { at: number; value: CallsConfig } | null = null

/** The switch, cached for CONFIG_CACHE_MS per process. Never throws. */
export async function readCallsConfig(now = Date.now()): Promise<CallsConfig> {
  if (cached && now - cached.at < CONFIG_CACHE_MS) return cached.value
  let value: CallsConfig
  try {
    const rows = await db.$queryRaw<Row[]>`SELECT mode, cohort::text[] AS cohort, video, relay FROM public.call_config WHERE id = 1`
    value = configFromRow(rows[0])
  } catch (e) {
    // 42P01 (no table) is the normal state of a database the DDL has not reached — not worth a log line, and as
    // good as a read: no table means no call can exist to be swept.
    const missing = e instanceof Error && /42P01|call_config" does not exist/.test(e.message)
    if (!missing) logError(e, { op: 'calls.config' })
    value = { ...CALLS_OFF, readOk: missing }
  }
  cached = { at: now, value }
  return value
}

/**
 * The switch may leave 'off' only while the sweep runs — call_config.swept_at, stamped by every run of
 * /api/cron/calls-sweep, no older than this. The sweep is what ends a call nobody is beating any more and replaces its
 * lock-screen ring; the timer is installed disabled (POLICY), so this is what makes enabling it part of turning calls on
 * (round-6 review). Both writers check it: PUT /api/admin/calls and scripts/calls-mode.mjs (which restates it).
 */
export const SWEEP_FRESH_S = 300

/**
 * ⛔ 'all' STAYS SHUT until KYC records a birth year (round-6 review). verifiedAdult (eligibility.ts) can only refuse a
 * minor whose VERIFIED document says so, and IdentityVerification.birthYear has no writer today — so in 'all' a verified
 * minor would read as an adult. Both writers refuse 'all' while this is false (scripts/calls-mode.mjs restates it);
 * flip it in the commit that makes KYC store the MRZ birth year.
 */
export const MODE_ALL_OPEN = false

/** Forget the cached row — tests, and every place that must act on the row as it is NOW (the sweep, a live re-judge). */
export function resetCallsConfigCache(): void {
  cached = null
}

/**
 * May this profile use calls at all, by the switch alone (eligibility is the next, separate question)?
 * Pure over its inputs so the decision table is testable without a database.
 */
export function modeAdmits(config: CallsConfig, profileId: string, isStaff: boolean, blocking: boolean): boolean {
  if (!blocking) return false
  switch (config.mode) {
    case 'off': return false
    case 'staff': return isStaff
    case 'beta': return isStaff || config.cohort.has(profileId)
    case 'all': return true
  }
}

/** The switch, read and applied for one profile. The staff lookup runs only in the modes that need it. */
export async function callsEnabledFor(profileId: string): Promise<{ enabled: boolean; config: CallsConfig }> {
  const config = await readCallsConfig()
  if (config.mode === 'off' || !blockingOn()) return { enabled: false, config }
  const isStaff = config.mode === 'all' ? false : await isStaffProfile(profileId)
  return { enabled: modeAdmits(config, profileId, isStaff, true), config }
}
