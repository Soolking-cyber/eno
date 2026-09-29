import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  contactSheetHtml, isScratchDbUrl, parseGallery, prodIdentityFrom, prodLikeRefusal, RENTALS_GUARD, reorderChanges, reorderedGallery, reorderSql, scratchRefusal,
} from './cover-reorder'

describe('isScratchDbUrl — the only databases scripts/reorder-import-covers.ts --apply may write', () => {
  it('a loopback scratch copy passes, on any port but the production tunnel’s', () => {
    expect(isScratchDbUrl('postgresql://postgres@127.0.0.1:5544/eno')).toBe(true)
    expect(isScratchDbUrl('postgresql://postgres@localhost/eno')).toBe(true)          // default port 5432
    expect(isScratchDbUrl('postgresql://postgres@[::1]:5544/eno')).toBe(true)
  })

  it('⛔ the production tunnel is loopback TOO — refused by its port, :5433', () => {
    expect(isScratchDbUrl('postgresql://postgres:x@127.0.0.1:5433/postgres')).toBe(false)
    expect(isScratchDbUrl('postgresql://postgres:x@localhost:5433/postgres')).toBe(false)
  })

  it('⛔ anything else fails closed: a remote host, a socket path, no URL, garbage', () => {
    expect(isScratchDbUrl('postgresql://postgres@db.example.com:5432/eno')).toBe(false)
    expect(isScratchDbUrl('postgresql://postgres@127.0.0.2.nip.io:5432/eno')).toBe(false)
    expect(isScratchDbUrl('postgresql:///eno?host=/var/run/postgresql')).toBe(false)
    expect(isScratchDbUrl('')).toBe(false)
    expect(isScratchDbUrl(undefined)).toBe(false)
    expect(isScratchDbUrl('not a url')).toBe(false)
  })

  it('⛔ a query parameter that moves the host pg dials is refused — the URL’s own host is not the one used', () => {
    // pg-connection-string: `?host=` / `?port=` override the authority, so these reach production.
    expect(isScratchDbUrl('postgresql://u:p@127.0.0.1:5432/db?host=db.prod.example&port=5433')).toBe(false)
    expect(isScratchDbUrl('postgresql://u:p@127.0.0.1:5544/db?port=5433')).toBe(false)
    expect(isScratchDbUrl('postgresql://u:p@localhost/db?sslmode=disable&host=10.0.0.5')).toBe(false)
    expect(isScratchDbUrl('postgresql://u:p@127.0.0.1:5544/db?hostaddr=10.0.0.5')).toBe(false)   // libpq/psql
    expect(isScratchDbUrl('postgresql://u:p@127.0.0.1:5544/db?HOST=10.0.0.5')).toBe(false)       // any case
    expect(isScratchDbUrl('postgresql://u:p@127.0.0.1:5544/db?%68ost=10.0.0.5')).toBe(false)     // percent-encoded key
    // A parameter that does not move the connection is fine.
    expect(isScratchDbUrl('postgresql://u:p@127.0.0.1:5544/db?sslmode=disable&schema=public')).toBe(true)
  })

  it('⛔ only postgres(ql): — pg reads a socket: URL’s path as a Unix socket, whatever its host says', () => {
    expect(isScratchDbUrl('socket://127.0.0.1:5432/var/run/postgresql?db=eno')).toBe(false)
    expect(isScratchDbUrl('http://127.0.0.1:5544/eno')).toBe(false)
    expect(isScratchDbUrl('postgres://postgres@127.0.0.1:5544/eno')).toBe(true)
  })
})

describe('scratchRefusal — every condition for --apply, before connecting', () => {
  // What the repo's .env names today: the SSH tunnel to production.
  const prod = prodIdentityFrom(['postgresql://postgres:x@127.0.0.1:5433/postgres', undefined, 'not a url'])
  const scratch = 'postgresql://postgres@127.0.0.1:5544/eno'

  it('learns production from the env files, and always knows the tunnel port and Supabase’s name', () => {
    expect(prod.names).toContain('postgres')
    expect(prod.ports).toContain('5433')
    const custom = prodIdentityFrom(['postgresql://u@127.0.0.1:6000/eno_prod'])
    expect(custom.names).toEqual(expect.arrayContaining(['postgres', 'eno_prod']))
    expect(custom.ports).toEqual(expect.arrayContaining(['5433', '6000']))
    expect(prodIdentityFrom([])).toEqual({ names: ['postgres'], ports: ['5433'] })
  })

  it('a loopback scratch copy passes only with the explicit opt-in', () => {
    expect(scratchRefusal(scratch, '1', prod)).toBeNull()
    expect(scratchRefusal(scratch, undefined, prod)).toMatch(/COVER_REORDER_SCRATCH=1/)
    expect(scratchRefusal(scratch, 'true', prod)).toMatch(/COVER_REORDER_SCRATCH=1/)
  })

  it('⛔ production is refused by port, by name on :5432, and by the URL guard', () => {
    expect(scratchRefusal('postgresql://postgres:x@127.0.0.1:5433/postgres', '1', prod)).toMatch(/not a loopback scratch|production/)
    expect(scratchRefusal('postgresql://postgres@127.0.0.1/postgres', '1', prod)).toMatch(/production database's name/)      // default port
    expect(scratchRefusal('postgresql://postgres@localhost:5432/postgres', '1', prod)).toMatch(/production database's name/)
    expect(scratchRefusal('postgresql://postgres@localhost:5432/eno', '1', prod)).toBeNull()                                  // not prod's name
    // A prod URL on another port, as a rewritten .env would name it.
    const moved = prodIdentityFrom(['postgresql://u@127.0.0.1:6000/eno_prod'])
    expect(scratchRefusal('postgresql://u@127.0.0.1:6000/scratch', '1', moved)).toMatch(/port 6000/)
    // ?host= / ?port= move the host pg dials — refused whatever the authority says.
    expect(scratchRefusal('postgresql://u@127.0.0.1:5544/eno?host=db.prod.example', '1', prod)).toMatch(/not a loopback scratch/)
    expect(scratchRefusal('postgresql://u@127.0.0.1:5544/eno?port=5433', '1', prod)).toMatch(/not a loopback scratch/)
    expect(scratchRefusal('', '1', prod)).toMatch(/not a loopback scratch/)
  })

  it('prodLikeRefusal — the same test on what the SERVER reports after connecting', () => {
    expect(prodLikeRefusal('postgres', '5433', prod)).toMatch(/port 5433/)
    expect(prodLikeRefusal('eno', '5433', prod)).toMatch(/port 5433/)
    expect(prodLikeRefusal('postgres', '5432', prod)).toMatch(/name/)
    // ⛔ the production NAME is refused on ANY port: a fresh tunnel to prod would carry it (codex, 2026-09-29)
    expect(prodLikeRefusal('postgres', '5544', prod)).toMatch(/name/)
    expect(prodLikeRefusal('eno', '5544', prod)).toBeNull()
  })
})

describe('parseGallery — ⛔ a gallery holding anything but URLs is left alone', () => {
  it('an array of strings is its URLs; anything else is null, never filtered down', () => {
    expect(parseGallery('["a","b"]')).toEqual(['a', 'b'])
    expect(parseGallery('[]')).toEqual([])
    expect(parseGallery('["a",{"url":"v.mp4"},"b"]')).toBeNull()
    expect(parseGallery('["a",null]')).toBeNull()
    expect(parseGallery('[1,"a"]')).toBeNull()
    expect(parseGallery('{"a":1}')).toBeNull()
    expect(parseGallery('not json')).toBeNull()
  })
})

describe('reorderChanges — ⛔ --limit bounds what is WRITTEN', () => {
  const plan = (id: string, moved: boolean) => ({ id, oldJson: `["${id}1","${id}2"]`, after: [`${id}2`, `${id}1`], moved })
  it('a moved row outside the scope (a /c/rentals head row past --limit) is counted, never written', () => {
    const got = reorderChanges([plan('a', true), plan('b', true), plan('c', false), plan('head', true)], new Set(['a', 'c']))
    expect(got.changes).toEqual([{ id: 'a', oldJson: '["a1","a2"]', newJson: '["a2","a1"]' }])
    expect(got.outOfScope).toBe(2)
    // …so neither apply.sql nor --apply can carry it.
    expect(reorderSql(got.changes, 't').apply).not.toContain("'head'")
  })
})

describe('reorderedGallery', () => {
  const imgs = ['a.webp', 'b.webp', 'c.webp', 'd.webp']
  it('the same URLs, the least-stamped of the first three first, the rest in their order', () => {
    expect(reorderedGallery(imgs, [3, 1.8, 0.9, 0])).toMatchObject({ after: ['c.webp', 'a.webp', 'b.webp', 'd.webp'], move: { from: 2 } })
  })
  it('unscored (no stamp learnt for the seller) leaves the gallery exactly as stored', () => {
    expect(reorderedGallery(imgs, [null, null, null, null])).toMatchObject({ after: imgs, move: null })
    expect(reorderedGallery([], [])).toMatchObject({ after: [], move: null })
  })
})

describe('reorderSql — what the owner reviews and runs on production', () => {
  const changes = [
    { id: 'row1', oldJson: '["a","b"]', newJson: '["b","a"]' },
    { id: "it's", oldJson: `["o'1","o2"]`, newJson: `["o2","o'1"]` },
  ]
  const sql = reorderSql(changes, 'test')

  it('⛔ each UPDATE is confined to the rentals category', () => {
    expect(RENTALS_GUARD).toBe(`"categoryId" = (SELECT id FROM "Category" WHERE slug = 'rentals') AND status = 'active'`)
    for (const f of [sql.apply, sql.rollback]) {
      const updates = f.split('\n').filter((l) => l.startsWith('UPDATE'))
      expect(updates).toHaveLength(2)
      for (const u of updates) expect(u).toContain(`AND ${RENTALS_GUARD};`)
    }
  })

  it('⛔ each UPDATE matches the value it replaces, in one transaction, and never touches updatedAt', () => {
    expect(sql.apply).toContain(`UPDATE "Listing" SET images = '["b","a"]' WHERE id = 'row1' AND images = '["a","b"]' AND ${RENTALS_GUARD};`)
    expect(sql.apply).toMatch(/^BEGIN;$/m)
    expect(sql.apply).toMatch(/^COMMIT;$/m)
    expect(sql.apply).toContain('\\set ON_ERROR_STOP on')
    expect(sql.apply).not.toMatch(/SET[^;]*updatedAt/i)
  })

  it('the rollback is the exact inverse, guarded by the NEW value', () => {
    expect(sql.rollback).toContain(`UPDATE "Listing" SET images = '["a","b"]' WHERE id = 'row1' AND images = '["b","a"]' AND ${RENTALS_GUARD};`)
  })

  it('quotes are doubled, so a value cannot close its literal', () => {
    expect(sql.apply).toContain(`SET images = '["o2","o''1"]' WHERE id = 'it''s' AND images = '["o''1","o2"]' AND ${RENTALS_GUARD};`)
  })
})

describe('contactSheetHtml', () => {
  it('shows before and after per card, outlines the moved ones, and escapes what it prints', () => {
    const html = contactSheetHtml([
      { id: 'r1', sellerId: 's', title: '<b>Room</b> & more', before: 'https://x/a.webp', after: 'https://x/c.webp', move: { from: 2, was: 3, now: 0.9 }, why: 'moved' },
      { id: 'r2', sellerId: 's', title: null, before: 'https://x/"q".webp', after: 'https://x/"q".webp', move: null, why: 'mark not visible on the cover' },
    ], { title: 'T', lines: ['a line'] })
    expect(html).toContain('&lt;b&gt;Room&lt;/b&gt; &amp; more')
    expect(html).toContain('src="https://x/&quot;q&quot;.webp"')
    expect(html.match(/<li class="moved">/g)).toHaveLength(1)
    expect(html).toContain('after — photo 3')
    expect(html).toContain('<strong>1</strong> of 2 covers would change')
    expect(html).not.toContain('<b>Room</b>')
  })
})

/**
 * The scripts open a database and the network on import, so their use of the guards is pinned at the
 * source level (the nhatot-importer-wiring.test.ts pattern). Each assertion fails if the call goes.
 */
describe('wiring', () => {
  const reorder = readFileSync('scripts/reorder-import-covers.ts', 'utf8')
  const nhatot = readFileSync('scripts/import-nhatot-com.ts', 'utf8')
  const muaban = readFileSync('scripts/import-muaban-net.ts', 'utf8')

  it('reorder-import-covers: a dry run unless --apply, and --apply refused off a scratch DB BEFORE the DB opens', () => {
    expect(reorder).toMatch(/const APPLY = argv\.includes\('--apply'\)/)
    const main = reorder.slice(reorder.indexOf('async function main('))
    const guard = main.indexOf('const refusal = APPLY ? scratchRefusal(DB_URL, process.env.COVER_REORDER_SCRATCH, PROD) : null')
    expect(guard).toBeGreaterThan(0)
    expect(main.indexOf('if (refusal) {')).toBeGreaterThan(guard)
    expect(main.indexOf('if (refusal) {')).toBeLessThan(main.indexOf('openDb('))
    // …the SERVER's own identity, checked right after connecting and before any row is read…
    const server = main.indexOf('SELECT current_database() AS db, inet_server_port() AS port')
    expect(server).toBeGreaterThan(main.indexOf('openDb('))
    expect(server).toBeLessThan(main.indexOf('rentalsCategoryId(db!)'))
    expect(main).toMatch(/prodLikeRefusal\(who\.db, String\(who\.port\), PROD\)/)
    // …and all of it before a photo is read: the seed reads (readWindow) and every row's (planRow → windowOf).
    for (const at of [guard, server]) {
      expect(at).toBeLessThan(main.indexOf('readWindow('))
      expect(at).toBeLessThan(main.indexOf('planRow('))
    }
    // Production is read from the env FILES, not process.env (a scratch run overrides that).
    expect(reorder).toMatch(/const PROD = prodIdentityFrom\(\['\.env', '\.env\.local'\]/)
    // Only the current seller's seed windows are kept (~30 KB each; a memo of every URL held ~1 GB on 19k rows).
    expect(main.match(/seedWindows\.clear\(\)/g)?.length).toBe(2)
    expect(reorder).not.toMatch(/const windows = new Map/)
    // A dry run opens the session read-only at the database.
    expect(reorder).toMatch(/options: '-c default_transaction_read_only=on'/)
  })

  it('reorder-import-covers: raw, guarded SQL — never a Prisma update (it would bump updatedAt)', () => {
    expect(reorder).toContain(`UPDATE "Listing" SET images = \${c.newJson} WHERE id = \${c.id} AND images = \${c.oldJson} AND \${RENTALS_GUARD}\``.replace('${RENTALS_GUARD}', RENTALS_GUARD))
    expect(reorder).not.toMatch(/\.listing\.update(Many)?\(/)
  })

  it('reorder-import-covers: scope = rentals + active, and only in-scope rows are written', () => {
    expect(reorder).toMatch(/where: \{ sellerId: s, categoryId, status: 'active' \}/)
    expect(reorder).toMatch(/where: \{ categoryId, verified: true, status: 'active' \}/)
    // `changes` (apply.sql AND --apply) come only from reorderChanges, filtered by the --limit scope.
    expect(reorder).toMatch(/const \{ changes, outOfScope \} = reorderChanges\(/)
    expect(reorder).toMatch(/, inScope,\s*\)/)
    expect(reorder.match(/const changes\b/g) ?? []).toHaveLength(0)
    // A gallery that is not all strings is planned as "left alone", never rewritten from its strings.
    expect(reorder).toMatch(/const parsed = parseGallery\(row\.images\)\n\s*.*\n\s*if \(!parsed\) return \{ row, images: \[\], after: \[\], scores: \[\], move: null/)
    expect(reorder).not.toMatch(/filter\(\(u\): u is string/)
  })

  it('both importers: the cover rule only under --cover-by-mark, learnt from our own stored copies', () => {
    for (const src of [nhatot, muaban]) {
      expect(src).toMatch(/const COVER_BY_MARK = (argv\.includes\('--cover-by-mark'\)|A\.coverByMark)/)
      // The extra decode only under the flag — a run without it costs what it did before.
      expect(src).toMatch(/measureImage\(buf, \{ markWindow: COVER_BY_MARK \}\)/)
      expect(src).toMatch(/markSeedUrls\(rows\.map\(\(r\) => r\.images\), isOverlayImageUrl\)/)
      expect(src).toMatch(/COVER_BY_MARK \? await learnMark\(db\) : null/)
    }
    expect(nhatot).toMatch(/const FLAGS = new Set\(\[[^\]]*'--cover-by-mark'/)
    // Refused where it would silently do nothing — the retire pass never judges photos.
    expect(nhatot).toMatch(/if \(COVER_BY_MARK && \(RETIRE \|\| \(!PROBE_PHOTOS && !APPLY\)\)\) throw/)
    // muaban: parsed and refused by parseRunArgs/modeRefusal (import-muaban-net.test.ts runs them).
    expect(muaban).toMatch(/const refused = modeRefusal\(A\)\n\s*if \(refused\) throw/)
    // muaban uploads in the order the rule returns, not the gallery's.
    expect(muaban).toMatch(/for \(const i of c\.keep\) \{/)
    expect(muaban).toMatch(/if \(urls\.length !== c\.keep\.length\)/)
  })
})
