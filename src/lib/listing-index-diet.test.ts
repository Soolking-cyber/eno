import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * scripts/listing-index-diet-ddl.mjs (speed plan item 9) against the files that could undo it.
 *
 * What these pin: every live index carries EXACTLY the live predicate (another spelling may not be proven equal by the
 * planner); nothing is both created and dropped, or kept and dropped; no dropped index is still declared in
 * prisma/schema.prisma (a `migrate diff` would re-propose it); the indexes that stay full are still declared; and none of
 * the older DDL scripts can rebuild an index the diet removed.
 */
const ROOT = join(__dirname, '..', '..')
const { CREATES, DROPS, DROP_UNUSED, KEEP, LIVE, VERIFY, UNUSED_DAYS, keepReason, isPoolerUrl, defLabel, forcedNames } = await import('../../scripts/listing-index-diet-ddl.mjs')
const SCHEMA = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')

/** The index names Prisma derives for a model's @@index / @@unique lines (default naming, 63-character truncation). */
function prismaIndexNames(model: string): string[] {
  const block = SCHEMA.match(new RegExp(`\\nmodel ${model} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
  const names: string[] = []
  for (const m of block.matchAll(/^\s*@@(index|unique)\(\[([^\]]+)\]/gm)) {
    const fields = m[2].split(',').map((f) => f.trim().replace(/\(.*$/, ''))
    const suffix = m[1] === 'unique' ? '_key' : '_idx'
    let base = `${model}_${fields.join('_')}`
    if (base.length + suffix.length > 63) base = base.slice(0, 63 - suffix.length)
    names.push(base + suffix)
  }
  return names
}

describe('the plan', () => {
  it('every live index ends in exactly the live predicate — the one non-live exception is named', () => {
    expect(LIVE).toBe(`verified AND status = 'active'`)
    for (const ix of CREATES) {
      if (ix.name === 'Listing_soldToProfileId_pending_idx') {
        expect(ix.def).toMatch(/WHERE "soldToProfileId" IS NOT NULL$/)
        continue
      }
      expect(ix.def.endsWith(`WHERE ${LIVE}`) || ix.def.endsWith(` AND ${LIVE}`)).toBe(true)
    }
  })

  it('a copy has EXACTLY the columns of every index it replaces, in order — or the planner keeps choosing the full one', () => {
    // Postgres models heap order from an index's first column (measured: verified 1.000, rankScore −0.25). A copy led
    // by another column looked costlier than its full index for the same rows, so the full index stayed in use; a
    // dropped or reordered later column changes which queries it serves.
    const columns = (def: string) => def.match(/^public\."Listing" \(([^)]*)\)/)?.[1].split(',').map((c) => c.trim().replace(/"/g, ''))
    // Prisma's default names list every column: Model_col1_col2_…_idx (camelCase, no underscores inside a column). A
    // 63-character name MAY be truncated (…_postedA_idx): accepted only when every column it names is a real field.
    const fields = new Set((SCHEMA.match(/\nmodel Listing \{([\s\S]*?)\n\}/)?.[1] ?? '').split('\n').map((l) => l.trim().split(/\s+/)[0]))
    const columnsOfName = (name: string) => {
      const cols = name.split('_').slice(1, -1)
      return cols.every((c) => fields.has(c)) ? cols : null
    }
    for (const ix of CREATES as { name: string; def: string; replaces: string[] }[]) {
      for (const old of ix.replaces) expect(columns(ix.def), `${ix.name} replaces ${old}`).toEqual(columnsOfName(old))
    }
  })

  it('no index carries a counter column — a bumped indexed column makes every bump a non-HOT update again', () => {
    for (const ix of CREATES) expect(ix.def, ix.name).not.toMatch(/"(views|contactCount|savedCount)"/)
  })

  it('names are unique; nothing is both created and dropped, kept and dropped, or replaced twice', () => {
    const created = CREATES.map((c: { name: string }) => c.name)
    expect(new Set(created).size).toBe(created.length)
    expect(new Set(DROPS).size).toBe(DROPS.length)
    for (const n of created) expect(DROPS).not.toContain(n)
    for (const n of KEEP) {
      expect(DROPS).not.toContain(n)
      expect(created).not.toContain(n)
    }
  })

  it('drops every index it replaces, and only after its replacement exists (the drop phase checks that)', () => {
    for (const c of CREATES) for (const old of c.replaces) expect(DROPS).toContain(old)
    expect(DROPS.slice(0, DROP_UNUSED.length)).toEqual(DROP_UNUSED)
  })
})

/** Every index on production before the diet (pg_stat_user_indexes, 2026-10-16) — each must be kept or dropped. */
const PROD_BEFORE = [
  'Listing_searchText_idx', 'Listing_verified_status_categoryId_areaM2_idx', 'Listing_verified_status_categoryId_rankScore_idx',
  'Listing_verified_status_categoryId_subcategorySlug_postedAt_idx', 'Listing_verified_status_categoryId_sellerTrustScore_postedA_idx',
  'Listing_verified_status_categoryId_listingType_postedAt_idx', 'Listing_id_sellerId_key', 'Listing_sellerId_externalId_key',
  'Listing_verified_status_rankScore_idx', 'Listing_verified_categoryId_postedAt_idx', 'Listing_verified_status_brandSlug_postedAt_idx',
  'Listing_verified_price_idx', 'Listing_verified_status_sellerTrustScore_postedAt_idx', 'Listing_pkey', 'Listing_verified_status_postedAt_idx',
  'Listing_verified_postedAt_idx', 'Listing_lat_lng_idx', 'Listing_verified_status_categoryId_sellerId_idx', 'Listing_verified_status_categoryId_year_idx',
  'Listing_verified_status_categoryId_mileageKm_idx', 'Listing_verified_status_categoryId_salaryM_idx', 'Listing_sellerId_saleConfirmedAt_idx',
  'Listing_verified_status_brandSlug_model_idx', 'Listing_buildingKey_status_idx', 'Listing_categoryId_idx', 'Listing_condition_idx',
  'Listing_views_idx', 'Listing_city_idx', 'Listing_soldChannel_saleConfirmedAt_saleDeclinedAt_soldAt_idx',
  'Listing_soldToProfileId_saleConfirmedAt_saleDeclinedAt_idx', 'Listing_featured_idx', 'Listing_complianceStatus_idx',
  'ListingDailyStat_listingId_idx', 'Translation_target_idx',
]

describe('verify runs the queries the way Prisma does', () => {
  it('binds verified and status as parameters — a plan proven with literals proves nothing about Prisma', () => {
    for (const [label, sql] of VERIFY as [string, string, string[]][]) {
      if (label === "buyer's pending sale prompt") continue // a sold-row query: no live predicate to bind
      expect(sql, label).toMatch(/"verified" = \$1 AND "status" = \$2/)
      expect(sql, label).not.toMatch(/verified = true|status = 'active'/)
    }
  })

  it('verify PLANS without executing (an executed query would satisfy the idx_scan gate itself)', () => {
    const src = readFileSync(join(ROOT, 'scripts/listing-index-diet-ddl.mjs'), 'utf8')
    expect(src).toMatch(/EXPLAIN \(\$\{analyze \? 'ANALYZE, BUFFERS, ' : ''\}FORMAT JSON\)/)
    expect(src).toMatch(/await verify\(c, phase === 'verify' && process\.argv\.includes\('--analyze'\)\)/)
  })

  it('every database command that can reset the schema rebuilds the partial indexes, after the trigram extension', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    for (const k of ['db:ddl', 'db:setup', 'db:push', 'db:migrate', 'db:reset']) {
      const cmd = pkg.scripts[k]
      expect(cmd, k).toMatch(/search-index\.mjs && node scripts\/listing-index-diet-ddl\.mjs --phase=create/)
      expect(cmd, k).not.toMatch(/listing-count-index-ddl/)
    }
  })

  it('drop runs verify first and reads the scan record before it, so nothing verify reads counts as use', () => {
    const src = readFileSync(join(ROOT, 'scripts/listing-index-diet-ddl.mjs'), 'utf8')
    expect(src).toMatch(/if \(phase === 'verify' \|\| phase === 'drop'\) \{\n\s+const result = await verify\(c,/)
    expect(src).toMatch(/if \(result\.seq\) \{/)
    expect(src.indexOf("const lastScan = phase === 'drop'")).toBeLessThan(src.indexOf('const result = await verify('))
    expect(src).toMatch(/SELECT indexrelname AS name, last_idx_scan FROM pg_stat_user_indexes/)
    expect(src).toMatch(/SET LOCAL enable_indexscan = off/) // verify's sampling reads
    expect(src).toMatch(/keepReason\(\{ chosenByVerify: false, lastScan: lastScan\.get\(name\) \?\? null, statsReset \}\)/)
  })
})

describe('keepReason — an index goes only when Postgres says nothing scanned it for a week', () => {
  const now = Date.parse('2026-10-24T00:00:00Z')
  const daysAgo = (d: number) => new Date(now - d * 86_400_000)
  const old = daysAgo(27) // production's statistics reset: 2026-09-20 → 27 days

  it('a week, not hours: every nightly and weekly job gets its chance to use the old index first', () => {
    expect(UNUSED_DAYS).toBeGreaterThanOrEqual(7)
  })
  it('keeps an index scanned inside the window — whatever scanned it (a nightly job, admin search)', () => {
    expect(keepReason({ chosenByVerify: false, lastScan: daysAgo(1), statsReset: old, now })).toMatch(/not 7 days unused/)
    expect(keepReason({ chosenByVerify: false, lastScan: daysAgo(6.9), statsReset: old, now })).toMatch(/not 7 days unused/)
  })
  it('drops one last scanned before the window', () => {
    expect(keepReason({ chosenByVerify: false, lastScan: daysAgo(7.1), statsReset: old, now })).toBeNull()
  })
  it('"never scanned" counts only when the statistics are older than the window', () => {
    expect(keepReason({ chosenByVerify: false, lastScan: null, statsReset: old, now })).toBeNull()
    expect(keepReason({ chosenByVerify: false, lastScan: null, statsReset: daysAgo(2), now })).toMatch(/statistics only go back/)
    expect(keepReason({ chosenByVerify: false, lastScan: null, statsReset: null, now })).toMatch(/unknown time/)
  })
  it('keeps an index a verify shape is still planned on, however old its last scan', () => {
    expect(keepReason({ chosenByVerify: true, lastScan: daysAgo(30), statsReset: old, now })).toMatch(/verify shape/)
  })
})

describe('the script refuses what would make it lie', () => {
  it('a transaction pooler: SET, PREPARE … EXECUTE and a concurrent build need one session', () => {
    expect(isPoolerUrl('postgresql://u:p@db.example:6543/postgres')).toBe(true)
    expect(isPoolerUrl('postgresql://u:p@db.example:5432/postgres?pgbouncer=true')).toBe(true)
    expect(isPoolerUrl('postgresql://u:p@db.example:5432/postgres')).toBe(false)
    expect(isPoolerUrl('postgresql://u:p@db.example:65432/postgres')).toBe(false)
    expect(isPoolerUrl('postgresql://u:p@db.example:5432/postgres?pgbouncer=false')).toBe(false)
  })
  it('a changed definition under an old name: the label tells them apart, and create refuses the mismatch', () => {
    const [a] = CREATES as { def: string }[]
    expect(defLabel(a.def)).toBe(defLabel(a.def))
    expect(defLabel(a.def)).not.toBe(defLabel(a.def.replace('WHERE', 'WHERE "featured" AND')))
    const src = readFileSync(join(ROOT, 'scripts/listing-index-diet-ddl.mjs'), 'utf8')
    // …and an UNLABELLED one is refused too (built by hand, or a run killed between build and label): never certified.
    expect(src).toMatch(/if \(before\.note !== label\) \{[\s\S]{0,700}process\.exitCode = 1\n\s+continue/)
    expect(src).not.toMatch(/if \(!before\.note\) await q\(`COMMENT/)
    expect(src).toMatch(/await q\(`COMMENT ON INDEX public\."\$\{ix\.name\}" IS \$\{quote\(label\)\}`\)\n\s+if \(!dryRun\) console\.log\(`  \$\{ix\.name\} built/)
  })
})

describe('--force names every index it overrides — never all at once', () => {
  it('a bare --force is refused', () => {
    expect(() => forcedNames(['node', 'x', '--phase=drop', '--force'])).toThrow(/needs the indexes/)
  })
  it('names outside DROPS are refused (a typo must not pass silently)', () => {
    expect(() => forcedNames(['--phase=drop', '--force=Listing_views_idx,Listing_pkey'])).toThrow(/Listing_pkey/)
  })
  it('returns exactly the named ones; none without the flag', () => {
    expect([...forcedNames(['--phase=drop', '--force=Listing_views_idx, Listing_city_idx'])]).toEqual(['Listing_views_idx', 'Listing_city_idx'])
    expect(forcedNames(['--phase=drop']).size).toBe(0)
  })
  it('nothing overrides the sequential-scan stop, or a verify shape still planned on the index', () => {
    const src = readFileSync(join(ROOT, 'scripts/listing-index-diet-ddl.mjs'), 'utf8')
    expect(src).toMatch(/if \(result\.seq\) \{/)
    // checked BEFORE, and independently of, the forced-name test
    expect(src).toMatch(/if \(oldChosen\.has\(name\)\) \{ console\.warn\([^\n]*; continue \}\n\s+const why = keepReason\(\{ chosenByVerify: false/)
  })
})

describe('drop trusts only a replacement create built', () => {
  it('valid AND labelled with its current definition — a same-name index of another shape authorizes nothing', () => {
    const src = readFileSync(join(ROOT, 'scripts/listing-index-diet-ddl.mjs'), 'utf8')
    expect(src).toMatch(/if \(!r\?\.valid \|\| r\.note !== defLabel\(x\.def\)\) missing\.push\(x\.name\)/)
  })
})

describe('create builds every index it can', () => {
  it('one failed build is reported and the loop goes on — the rest are not left unbuilt', () => {
    const src = readFileSync(join(ROOT, 'scripts/listing-index-diet-ddl.mjs'), 'utf8')
    expect(src).toMatch(/try \{\n\s+await q\(`CREATE INDEX CONCURRENTLY IF NOT EXISTS[^\n]*\n\s+\} catch \(e\) \{[\s\S]{0,200}process\.exitCode = 1\n\s+continue/)
  })
})

describe('admin search keeps its full trigram index', () => {
  it('Listing_searchText_idx is kept and still declared; the live copy replaces nothing', () => {
    expect(KEEP).toContain('Listing_searchText_idx')
    expect(DROPS).not.toContain('Listing_searchText_idx')
    expect(CREATES.find((c: { name: string }) => c.name === 'Listing_live_searchText_trgm_idx')?.replaces).toEqual([])
  })
})

describe('every index production had is accounted for', () => {
  it('the 32 on Listing (+2) are each either kept or dropped — none left behind by an edit to the plan', () => {
    expect(PROD_BEFORE.filter((n) => n.startsWith('Listing_'))).toHaveLength(32)
    for (const n of PROD_BEFORE) expect(KEEP.includes(n) || DROPS.includes(n), n).toBe(true)
  })
})

describe('prisma/schema.prisma agrees', () => {
  it('declares no index the diet drops', () => {
    const declared = [...prismaIndexNames('Listing'), ...prismaIndexNames('ListingDailyStat'), ...prismaIndexNames('Translation')]
    for (const n of DROPS) expect(declared, n).not.toContain(n)
  })

  it('still declares the indexes that stay full', () => {
    const declared = prismaIndexNames('Listing')
    for (const n of ['Listing_verified_status_postedAt_idx', 'Listing_categoryId_idx', 'Listing_sellerId_saleConfirmedAt_idx', 'Listing_sellerId_externalId_key', 'Listing_searchText_idx']) {
      expect(declared).toContain(n)
    }
  })

  it('computes Prisma names the way production has them (the 63-character truncation)', () => {
    // A name this test derives must be the one in the database, or the "not declared" check above proves nothing.
    expect(prismaIndexNames('Listing')).toContain('Listing_verified_status_postedAt_idx')
    const long = 'Listing_verified_status_categoryId_sellerTrustScore_postedAt'
    expect((long.slice(0, 59) + '_idx')).toBe('Listing_verified_status_categoryId_sellerTrustScore_postedA_idx')
  })
})

describe('no older script rebuilds what the diet removed', () => {
  it.each(['scripts/search-index.mjs', 'scripts/geo-index-ddl.mjs', 'scripts/listing-count-index-ddl.mjs', 'scripts/building-key-ddl.mjs'])('%s', (file) => {
    const code = readFileSync(join(ROOT, file), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/create\s+index/i)
  })
})
