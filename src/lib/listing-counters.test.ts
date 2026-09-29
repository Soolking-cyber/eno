import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// Captures the SQL each helper sends. A tagged template arrives as (strings, ...values).
const sent: { sql: string; values: unknown[] }[] = []
vi.mock('@/lib/db', () => ({
  db: {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      sent.push({ sql: strings.join('$'), values })
      return Promise.resolve(1)
    },
  },
}))

const { bumpListingCounter, dropListingSave } = await import('@/lib/listing-counters')

describe('listing counters (I3a): a counter is not an edit', () => {
  it.each(['views', 'savedCount', 'contactCount'] as const)('%s: moves only that column, by id, never updatedAt', async (c) => {
    sent.length = 0
    await bumpListingCounter('L1', c)
    expect(sent).toHaveLength(1)
    expect(sent[0].sql).toBe(`UPDATE "Listing" SET "${c}" = "${c}" + 1 WHERE "id" = $`)
    expect(sent[0].values).toEqual(['L1'])
    expect(sent[0].sql).not.toMatch(/updatedAt/i)
  })

  it('an unsave clamps at 0 and does not touch updatedAt', async () => {
    sent.length = 0
    await dropListingSave('L1')
    expect(sent[0].sql).toBe('UPDATE "Listing" SET "savedCount" = GREATEST("savedCount" - 1, 0) WHERE "id" = $')
    expect(sent[0].values).toEqual(['L1'])
  })

  // ⛔ THE REGRESSION THIS COMMIT FIXES WAS ONE LINE IN A ROUTE: a Prisma `update` of a counter, which
  // stamps @updatedAt. Scan the app for any Prisma write that moves one of the three counters.
  // Covers src AND scripts (an importer or backfill is a Prisma client too), the plain object form
  // and a computed key (`[counter]: { increment: 1 }`), in update, updateMany and upsert alike.
  // ⚠️ A TRIPWIRE FOR THE SHAPES THIS CODEBASE USES, NOT A PROOF: a `data` object built elsewhere or a
  // plain `views: n` set would pass it. The rule it guards is written at the top of listing-counters.ts.
  it('no Prisma write anywhere in src or scripts moves views, savedCount or contactCount', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (name === 'generated' || name === 'node_modules') continue
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.(ts|tsx|mjs|js)$/.test(name) || /\.test\.tsx?$/.test(name)) continue
        const src = readFileSync(p, 'utf8')
        if (/(\b(views|savedCount|contactCount)\b|\[[^\]\n]*\])\s*:\s*\{\s*(increment|decrement|multiply|divide)\b/.test(src)) hits.push(p)
      }
    }
    walk(join(process.cwd(), 'src'))
    walk(join(process.cwd(), 'scripts'))
    expect(hits).toEqual([])
  })
})
