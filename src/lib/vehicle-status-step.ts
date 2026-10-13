/**
 * THE STATUS STEP of the every-3-days vehicle refresh, with its I/O passed in — so the ORDER it writes in is tested
 * (src/lib/vehicle-status-step.test.ts), not only the plan. scripts/import-vehicle-rentals.ts --stage import calls it
 * after its upserts and the gone hides, with the database reads and writes of scripts/vehicle-rentals-status.ts.
 *
 *   1. guards per loaded source against the recorded runs (statusInputs) — a source this run did not load is untouched;
 *   2. the plan (planVehicleStatus) over every imported row;
 *   3. ⛔ on --apply only: the moves (journal first, inside applyMoves), THEN the run record. A step that dies mid-way
 *      leaves no record, so its scrape never counts as a check; a dry run writes neither.
 *
 * `refusals` — a source's step was refused (a short / stale scrape with live rows, a shrink or growth guard): the job
 * exits 3 and retries the next day. `warnings` — went through, but needs a look a retry cannot fix (a trips history
 * too young or wiped to judge Mioto; rows a moderator changed mid-run; a source mostly not judged).
 */
import type { ShopKey } from './vehicle-rental-listing'
import {
  CAR_SOURCES, PRESENCE_KIND, PRESENCE_VERSION, guardRefusals, planVehicleStatus, statusInputs,
  type CarPresence, type CarSource, type DbRow, type Move, type PlanInput, type PresenceEntry, type ShopPresence,
} from './vehicle-status-plan'

/** Above this share of a car source's HCMC records left not judged, the run warns (it changed nothing there). */
export const MAX_UNJUDGED_SHARE = 0.5

export type StatusOutcome = { refusals: string[]; warnings: string[] }
export type StatusStepDeps = {
  readRows(): Promise<(DbRow & { updatedAt: string })[]>
  applyMoves(moves: (Move & { updatedAt: string })[]): Promise<{ moved: string[] }>
  writeEntry(entry: PresenceEntry): string
  log(line: string): void
}
export type StatusStepInput = {
  apply: boolean
  cars: Partial<Record<CarSource, CarPresence>>
  bikes: Partial<Record<ShopKey, ShopPresence>> | null
  /** false when the trips history could not judge Mioto (most live cars have no snapshot 12–21 days old). */
  tripsHealthy: boolean | null
  /** Warnings found before the step (refused trips snapshots…), reported with the step's own. */
  warnings?: readonly string[]
  entries: readonly PresenceEntry[]
  fallback: Readonly<Record<string, number>>
  accept: ReadonlySet<string>
  /** externalIds this run's import created, refreshed or found unchanged — the only rows that may be revived. */
  ready: ReadonlySet<string>
  /** Per source: live rows before this run and rows the import created (the growth guard's one budget). */
  growth?: PlanInput['growth']
  /** Sources the importer refused this run (creations held): nothing of theirs moves, and their scrape is no check. */
  held?: ReadonlySet<string>
  now: number
  /** The run record's time (ISO); defaults to the clock when the record is written. */
  recordedAt?: string
}

export async function runStatusStep(deps: StatusStepDeps, input: StatusStepInput): Promise<StatusOutcome> {
  const { cars, bikes, current, guards } = statusInputs({ cars: input.cars, bikes: input.bikes, entries: input.entries, fallback: input.fallback, accept: input.accept, now: input.now })
  for (const [s, g] of Object.entries(guards)) deps.log(`  guard ${s.padEnd(15)} ${g.judged ? 'judged' : 'NOT judged'} — ${g.reason}`)

  const rows = await deps.readRows()
  const updatedAt = new Map(rows.map((r) => [r.id, r.updatedAt]))
  const live = new Set(rows.filter((r) => r.status === 'active').map((r) => r.seller as string))
  const refusals = guardRefusals(guards, live)
  const warnings = [...(input.warnings ?? [])]
  if (input.tripsHealthy === false && live.has('mioto')) {
    warnings.push('mioto: the trips history cannot judge most cars (no snapshot 12–21 days old — wiped, or a gap in runs) — those cars were neither expired, revived nor updated')
  }
  // A source whose records mostly could not be judged (BonbonCar's detail pages all failing) changes nothing and
  // would otherwise stamp a "successful" run while its prices go stale: say so.
  for (const src of CAR_SOURCES) {
    const p = input.cars[src]
    if (!p || !live.has(src)) continue
    const unjudged = [...p.verdicts.values()].filter((v) => v.kind === 'unknown').length
    if (p.verdicts.size && unjudged / p.verdicts.size > MAX_UNJUDGED_SHARE) warnings.push(`${src}: ${unjudged} of ${p.verdicts.size} HCMC cars could not be judged this run — neither updated, expired nor revived`)
  }

  const plan = planVehicleStatus({ rows, cars, bikes, ready: input.ready, force: input.accept, growth: input.growth, held: input.held })
  for (const [s, why] of Object.entries(plan.refused)) refusals.push(`${s}: ${why}`)
  // ⛔ A source refused this run — by a guard here, or upstream — is recorded as NO check: its count never becomes a
  // reference and its presence never a check (gate review: a held spike of bogus rows, recorded as accepted, made every
  // later correct scrape look short).
  for (const s of new Set([...Object.keys(plan.refused), ...(input.held ?? [])])) {
    if (current[s]) current[s] = { ...current[s], accepted: false, forced: false }
  }
  for (const [s, t] of Object.entries(plan.tally)) {
    deps.log(`  ${s.padEnd(21)} ${Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
  }
  const sample = (moves: readonly Move[]) => moves.slice(0, 5).map((m) => `${m.externalId} (${m.reason})`).join('; ')
  deps.log(`  → expire ${plan.expire.length}${plan.expire.length ? `  e.g. ${sample(plan.expire)}` : ''}`)
  deps.log(`  → revive ${plan.revive.length}${plan.revive.length ? `  e.g. ${sample(plan.revive)}` : ''}`)
  for (const r of refusals) deps.log(`  ⛔ REFUSED ${r}`)
  for (const w of warnings) deps.log(`  ⚠️ WARNING ${w}`)

  if (!input.apply) { deps.log('  DRY RUN — no status written, no run recorded.'); return { refusals, warnings } }
  const moves = [...plan.expire, ...plan.revive].map((m) => ({ ...m, updatedAt: updatedAt.get(m.id)! }))
  const res = await deps.applyMoves(moves)
  const moved = new Set(res.moved)
  deps.log(`  EXPIRED ${plan.expire.filter((m) => moved.has(m.id)).length} of ${plan.expire.length} · REVIVED ${plan.revive.filter((m) => moved.has(m.id)).length} of ${plan.revive.length} · tombstoned before and after each chunk`)
  if (res.moved.length !== moves.length) {
    warnings.push(`${moves.length - res.moved.length} row(s) changed between the read and the write — left as they are; the next run re-plans them`)
    deps.log(`  ⚠️ WARNING ${warnings.at(-1)}`)
  }
  // ⛔ The run is recorded only once its writes are through: a crashed step leaves no entry, so it never counts as a check.
  const entry: PresenceEntry = { kind: PRESENCE_KIND, version: PRESENCE_VERSION, recordedAt: input.recordedAt ?? new Date().toISOString(), sources: current }
  deps.log(`  run recorded          ${deps.writeEntry(entry)}`)
  return { refusals, warnings }
}
