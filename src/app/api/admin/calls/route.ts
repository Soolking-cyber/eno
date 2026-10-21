import { after } from 'next/server'
import { z } from 'zod'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { MODE_ALL_OPEN, readCallsConfig, resetCallsConfigCache } from '@/lib/calls/server/config'
import { relayConfigured } from '@/lib/calls/server/relay'
import { sweepIsFresh, sweepStale } from '@/lib/calls/server/session'
import { afterCallEnded } from '@/lib/calls/server/finish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── ADMIN: THE CALLS SWITCH (DESIGN.md v3 §3.2 step 10; src/lib/calls/server/config.ts) ────────────────────────────
//
// GET → { mode, cohort: [{ id, email }], video, relay, relayConfigured, updatedAt, updatedBy, sweptAt }
// PUT { mode, cohortEmails?, video?, relay? } → the same, after the write. Cohort members are named by EMAIL here
// (the admin knows people by email) and stored as profile ids; an email with no profile comes back in `unknown`
// and is not stored. Turning calls OFF also ends every live call at once ('kill_switch'). Any change that narrows the
// switch (staff/beta, video off) reaches a live call at its next heartbeat, which re-judges it with a fresh read
// (eligibility.ts liveCallRefusal). This process forgets its cached switch immediately; the other edition's within 30 s.
// Admin chrome is English-only by convention.

const putBody = z.strictObject({
  mode: z.enum(['off', 'staff', 'beta', 'all']),
  cohortEmails: z.array(z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)).max(500).optional(),
  video: z.boolean().optional(),
  relay: z.enum(['cloudflare', 'eno']).optional(),
})

type ConfigRow = { mode: string; cohort: string[]; video: boolean; relay: string; updated_at: Date; updated_by: string | null; swept_at: Date | null }

async function describe() {
  const rows = await db.$queryRaw<ConfigRow[]>`
    SELECT mode, cohort::text[] AS cohort, video, relay, updated_at, updated_by, swept_at FROM public.call_config WHERE id = 1`
  const r = rows[0]
  const ids = r?.cohort ?? []
  const people = ids.length ? await db.profile.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : []
  return {
    mode: r?.mode ?? 'off',
    cohort: ids.map((id) => ({ id, email: people.find((p) => p.id === id)?.email ?? null })),
    video: r?.video ?? true,
    relay: r?.relay ?? 'cloudflare',
    relayConfigured: relayConfigured((r?.relay ?? 'cloudflare') as 'cloudflare' | 'eno'),
    updatedAt: r?.updated_at?.toISOString() ?? null,
    updatedBy: r?.updated_by ?? null,
    sweptAt: r?.swept_at?.toISOString() ?? null,
  }
}

export const GET = route({ auth: 'admin' }, async () => describe())

export const PUT = route({ auth: 'admin', body: putBody }, async ({ admin, body }) => {
  // ⛔ Not 'all' before KYC records a birth year (config.ts MODE_ALL_OPEN).
  if (body.mode === 'all' && !MODE_ALL_OPEN) throw new ApiError('invalid_input', 400)
  // ⛔ Not ON unless the sweep is running (config.ts SWEEP_FRESH_S) — 503 not_configured: enable the timer first.
  if (body.mode !== 'off' && !(await sweepIsFresh())) throw new ApiError('not_configured', 503)
  let unknown: string[] = []
  if (body.mode === 'off' && !body.cohortEmails && body.video === undefined && body.relay === undefined) {
    // ⛔ THE KILL SWITCH NEEDS NO READ (round-9 review): only `mode` changes, in SQL, so a row this process cannot read
    // (a database blip) can still be switched off. Writing back what was read is only needed when other fields change.
    await writeOrNotConfigured(db.$executeRaw`
      INSERT INTO public.call_config (id, mode, updated_at, updated_by) VALUES (1, 'off', now(), ${admin})
      ON CONFLICT (id) DO UPDATE SET mode = 'off', updated_at = now(), updated_by = EXCLUDED.updated_by`)
  } else {
    unknown = await writeWholeSwitch(admin, body)
  }
  resetCallsConfigCache()
  if (body.mode === 'off') {
    // EVERY live call, not the first thousand (commit-gate review): sweep in batches until a batch comes back short.
    for (let round = 0; round < 50; round++) {
      const batch = await sweepStale({ killAll: true, limit: 1000 })
      for (const { row, reason } of batch) after(() => afterCallEnded(row, reason))
      if (batch.length < 1000) break
    }
  }
  return { ...(await describe()), unknown }
})

/** A write that reaches a database the calls DDL has not: 503 not_configured, never a 500. */
async function writeOrNotConfigured(write: Promise<unknown>): Promise<void> {
  try {
    await write
  } catch (e) {
    if (e instanceof Error && /42P01|call_config" does not exist/.test(e.message)) throw new ApiError('not_configured', 503)
    throw e
  }
}

/** Mode plus cohort / video / relay: what was READ is written back for every field the body leaves out. */
async function writeWholeSwitch(admin: string, body: z.infer<typeof putBody>): Promise<string[]> {
  resetCallsConfigCache()
  const current = await readCallsConfig()
  // A switch that could not be READ is not "everything off": writing it back would erase the cohort and video setting.
  if (!current.readOk) throw new ApiError('not_configured', 503)
  let cohort = [...current.cohort]
  let unknown: string[] = []
  if (body.cohortEmails) {
    const emails = [...new Set(body.cohortEmails)]
    // Case-insensitive, like scripts/calls-mode.mjs: a stored "Name@Example.com" must not read as unknown.
    const found = await db.profile.findMany({
      where: { OR: emails.map((e) => ({ email: { equals: e, mode: 'insensitive' as const } })) },
      select: { id: true, email: true },
    })
    cohort = found.map((p) => p.id)
    unknown = emails.filter((e) => !found.some((p) => p.email?.toLowerCase() === e))
  }
  const video = body.video ?? current.video
  const relay = body.relay ?? current.relay
  await writeOrNotConfigured(db.$executeRaw`
    INSERT INTO public.call_config (id, mode, cohort, video, relay, updated_at, updated_by)
    VALUES (1, ${body.mode}, ${cohort}::uuid[], ${video}, ${relay}, now(), ${admin})
    ON CONFLICT (id) DO UPDATE SET mode = EXCLUDED.mode, cohort = EXCLUDED.cohort, video = EXCLUDED.video,
      relay = EXCLUDED.relay, updated_at = now(), updated_by = EXCLUDED.updated_by`)
  return unknown
}
