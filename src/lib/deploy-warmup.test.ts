import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * infra/vn-node/eno-warmup.sh — the post-deploy warm-up eno-deploy.sh runs as step 11 (SEO wave B, H4).
 *
 * It is a shell script, so these tests RUN it, against a stub origin that stands in for the app
 * container, and read back what it asked for. What they pin:
 *   · the order — the rent index, then a snapshot from this build, then the sitemaps, then the pages
 *     (a sitemap fetched before the snapshot is warm would start the cold computation itself);
 *   · the pages that matter most are warmed last, and the first writes are read again at the end,
 *     because the page cache is an LRU smaller than the warm set (the measurement is in the script);
 *   · a failing rent index skips that site's sitemaps and pages, warns, and still exits 0;
 *   · every page goes out twice (en-US, then vi-VN), with the public Host header, and only sitemap
 *     URLs on the site's own origin (plus the rentals district links) are ever requested;
 *   · it is warn-only: nothing it meets turns into a failing exit code, and nothing outlives its budget;
 *   · it stops sending the moment a newer deploy marks itself incomplete (the deploy lock is released
 *     before the warm-up, so another deploy can start meanwhile).
 *
 * ⚠️ ASYNC execFile, NEVER execFileSync: the stub server runs in this process, and a synchronous
 * child would block the event loop that has to answer it.
 * ⚠️ THE PAGE ORDER IS ASSERTED ON THE DRY-RUN PLAN, NOT ON ARRIVAL: four workers start together, so
 * the order requests reach a server is not the order they were queued in (both reviewers, H4).
 * ⚠️ SNAPSHOT TIMES ARE RELATIVE TO THE CLOCK, so the "fresh" and "not cold" rules mean the same
 * thing whenever this runs.
 */
const ROOT = join(__dirname, '..', '..')
const SCRIPT = join(ROOT, 'infra/vn-node/eno-warmup.sh')

type Hit = { path: string; host: string; lang: string | undefined }
/** What /hcmc-rent-index.csv answers: a snapshot computed now, 503, one from before the container
 *  started and then a fresh one, or one computed after the start but before the warm-up (not cold). */
type Csv = 'fresh' | 'down' | 'stale-then-fresh' | 'warm-before'

const iso = (ms: number) => new Date(ms).toISOString()
const csvBody = (snap: string) =>
  `snapshot_utc,scope,district_slug\r\n${snap},city,all\r\n${snap},district,d1\r\n`

type StubOpts = {
  emptySitemap?: boolean
  /** Create this file when /c/rentals is first served: a newer deploy reaching its swap mid-warm-up. */
  touchOnRentals?: string
  /** Hold /hcmc-rent-index this long before answering: an origin that hangs. */
  hangMs?: number
}

function stub(site: string, csv: Csv, opts: StubOpts = {}): Promise<{ server: Server; addr: string; hits: Hit[] }> {
  const hits: Hit[] = []
  let csvCalls = 0
  const origin = `https://${site}`
  const server = createServer((req: IncomingMessage, res) => {
    const path = req.url ?? '/'
    hits.push({ path, host: req.headers.host ?? '', lang: req.headers['accept-language'] as string | undefined })
    const send = (code: number, body = '', type = 'text/html') => { res.writeHead(code, { 'Content-Type': type }); res.end(body) }
    if (path === '/hcmc-rent-index') {
      if (opts.hangMs) { setTimeout(() => { if (!res.destroyed) send(200, '<h1>late</h1>') }, opts.hangMs); return }
      return send(200, '<h1>index</h1>')
    }
    if (path === '/hcmc-rent-index.csv') {
      csvCalls++
      if (csv === 'down') return send(503, 'not yet', 'text/plain')
      if (csv === 'stale-then-fresh' && csvCalls === 1) return send(200, csvBody(iso(Date.now() - 86_400_000)), 'text/csv')
      if (csv === 'warm-before') return send(200, csvBody(iso(Date.now() - 30_000)), 'text/csv')
      return send(200, csvBody(iso(Date.now())), 'text/csv')
    }
    if (path === '/sitemap.xml') {
      return send(200, `<?xml version="1.0"?><sitemapindex>
  <sitemap><loc>${origin}/sitemaps/pages.xml</loc></sitemap>
  <sitemap><loc>${origin}/sitemaps/listings-0.xml</loc></sitemap>
  <sitemap><loc>https://elsewhere.example/sitemaps/pages.xml</loc></sitemap>
</sitemapindex>`, 'application/xml')
    }
    if (opts.emptySitemap && path.startsWith('/sitemaps/')) return send(200, '<urlset></urlset>', 'application/xml')
    if (path === '/sitemaps/pages.xml') {
      return send(200, `<urlset>
  <url><loc>${origin}</loc></url>
  <url><loc>${origin}/c/rentals</loc></url>
  <url><loc>${origin}/c/electronics</loc><lastmod>2026-09-28</lastmod></url>
  <url><loc>${origin}/guide?a=1&amp;b=2</loc></url>
  <url><loc>${origin}/gone</loc></url>
  <url><loc>https://elsewhere.example/stolen</loc></url>
</urlset>`, 'application/xml')
    }
    if (path === '/sitemaps/listings-0.xml') {
      return send(200, `<urlset><url><loc>${origin}/listings/l1</loc></url><url><loc>${origin}/c/electronics</loc></url></urlset>`, 'application/xml')
    }
    if (path === '/c/rentals') {
      if (opts.touchOnRentals && !existsSync(opts.touchOnRentals)) writeFileSync(opts.touchOnRentals, '')
      return send(200, opts.emptySitemap ? '<p>no districts</p>'
        : '<a href="/c/rentals/d1">D1</a><a href="/c/rentals/thu-duc">TD</a><a href="/c/rentals/d1">again</a><a href="/c/rentals">self</a>')
    }
    if (path === '/gone') return send(404, 'gone')
    return send(200, '<p>page</p>')
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const a = server.address()
    resolve({ server, addr: `127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`, hits })
  }))
}

/** Runs the script. Unless a test names one, the stop file is off (`--stop-file=`), so a stray
 *  /opt/eno/deploy-incomplete on the machine running the suite cannot change the result. */
function run(args: string[]): Promise<{ code: number; out: string }> {
  const all = args.some((a) => a.startsWith('--stop-file=')) ? args : [...args, '--stop-file=']
  return new Promise((resolve) => {
    execFile('bash', [SCRIPT, ...all], { env: { ...process.env, ENO_WARMUP_RETRY_WAIT: '0' }, timeout: 60_000 },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        resolve({ code, out: stdout + stderr })
      })
  })
}

const servers: Server[] = []
const dirs: string[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
async function origin(site: string, csv: Csv = 'fresh', opts: StubOpts = {}) {
  const s = await stub(site, csv, opts)
  servers.push(s.server)
  return s
}
function logDir() {
  const d = mkdtempSync(join(tmpdir(), 'warmup-test-'))
  dirs.push(d)
  return d
}
/** The container started a minute ago, as `docker inspect … .State.StartedAt` prints it. */
const since = () => iso(Date.now() - 60_000).replace('Z', '123456Z')
const tsvRows = (dir: string, sha: string) =>
  readFileSync(join(dir, `${sha}.tsv`), 'utf8').trim().split('\n').map((l) => l.split('\t'))
const PAGES = ['/', '/c/electronics', '/c/rentals/d1', '/c/rentals/thu-duc', '/gone', '/guide?a=1&b=2', '/listings/l1']

describe('eno-warmup.sh', () => {
  it('warms the rent index first, then the sitemaps, then every page in en and vi, and exits 0', async () => {
    const vn = await origin('eno.vn')
    const dir = logDir()
    const r = await run([`--vn=${vn.addr}`, '--forum=', `--dir=${dir}`, '--sha=t1', `--since=${since()}`])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/rent-index-cold [0-9.]+s \(HTTP 200\)/)
    expect(r.out).toMatch(/rent index: snapshot \S+ from this build \(container up since /)
    expect(r.out).not.toContain('NOT a cold time')

    const paths = vn.hits.map((h) => h.path)
    // The order that matters: rent index, then its CSV, then the sitemap index and its children.
    expect(paths.slice(0, 5)).toEqual([
      '/hcmc-rent-index', '/hcmc-rent-index.csv', '/sitemap.xml', '/sitemaps/pages.xml', '/sitemaps/listings-0.xml',
    ])
    // /c/rentals leads the pages, en then vi.
    expect(vn.hits.slice(5, 7).map((h) => [h.path, h.lang])).toEqual([['/c/rentals', 'en-US'], ['/c/rentals', 'vi-VN']])
    // Every other page exactly twice, once per language: sitemap locs on this origin, de-duplicated,
    // `&amp;` decoded, plus the district links read from /c/rentals.
    const pages = vn.hits.slice(7, 21)
    expect([...new Set(pages.map((h) => h.path))].sort()).toEqual(PAGES)
    for (const p of PAGES) {
      expect(pages.filter((h) => h.path === p).map((h) => h.lang).sort(), p).toEqual(['en-US', 'vi-VN'])
    }
    // Then the first writes are read again, so they are the most recently used when it ends.
    expect(vn.hits.slice(21).map((h) => [h.path, h.lang ?? '-'])).toEqual([
      ['/c/rentals', 'en-US'], ['/c/rentals', 'vi-VN'], ['/sitemap.xml', '-'],
      ['/sitemaps/pages.xml', '-'], ['/sitemaps/listings-0.xml', '-'], ['/hcmc-rent-index.csv', '-'],
    ])
    // Never another origin's URL, and always the public Host header.
    expect(paths.some((p) => p.includes('stolen') || p.includes('elsewhere'))).toBe(false)
    expect(new Set(vn.hits.map((h) => h.host))).toEqual(new Set(['eno.vn']))
    // one foreign child in the index, one foreign URL in pages.xml: each dropped with a warning
    expect(r.out.match(/\[!!\].*1 sitemap loc\(s\) not on https:\/\/eno\.vn were skipped/g)).toHaveLength(2)

    // The log: a header, one row per request, and a summary that names the miss.
    const rows = tsvRows(dir, 't1')
    expect(rows[0]).toEqual(['url', 'lang', 'http_code', 'time_starttransfer', 'time_total', 'kind'])
    expect(rows.slice(1, 4).map((x) => [x[0], x[1], x[5]])).toEqual([
      ['https://eno.vn/hcmc-rent-index', 'en', 'rent-index'],
      ['https://eno.vn/hcmc-rent-index.csv', '-', 'rent-index-csv'],
      ['https://eno.vn/sitemap.xml', '-', 'sitemap'],
    ])
    expect(rows.slice(1).every((x) => x.length === 6 && /^\d{3}$/.test(x[2]) && /^[0-9.]+$/.test(x[3]))).toBe(true)
    expect(rows.filter((x) => x[5] === 'page')).toHaveLength(2 + PAGES.length * 2)
    expect(rows.filter((x) => x[5] === 'retouch')).toHaveLength(6)
    expect(r.out).toMatch(/eno\.vn +HTTP.* 200x14/)
    expect(r.out).toMatch(/eno\.vn +HTTP.* 404x2/)
    expect(r.out).toMatch(/eno\.vn +all +n=16 +ttfb p50 [0-9.]+s +p95 [0-9.]+s +max [0-9.]+s/)
    expect(r.out).toMatch(/eno\.vn +district +n=4 /)
    expect(r.out).toContain('404 en https://eno.vn/gone')
  })

  it('queues the long tail first and home last (the dry-run plan is the queue), and fetches none of it', async () => {
    const vn = await origin('eno.vn')
    const dir = logDir()
    const r = await run([`--vn=${vn.addr}`, '--forum=', `--dir=${dir}`, '--sha=t4', '--dry-run'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('dry run: would send 14 page requests')
    expect(readFileSync(join(dir, 't4.eno.vn.plan'), 'utf8').trim().split('\n')).toEqual([
      '/listings/l1', '/gone', '/guide?a=1&b=2', '/c/rentals/d1', '/c/rentals/thu-duc', '/c/electronics', '/',
    ])
    expect(vn.hits.map((h) => h.path).filter((p) => !/^\/(hcmc-rent-index|sitemap|c\/rentals$)/.test(p))).toEqual([])
  })

  it('a rent index with no snapshot: retries 3 times, warns, skips that site, still warms the forum, exits 0', async () => {
    const vn = await origin('eno.vn', 'down')
    const forum = await origin('www.eno.forum')
    const dir = logDir()
    const r = await run([`--vn=${vn.addr}`, `--forum=${forum.addr}`, `--dir=${dir}`, '--sha=t2', `--since=${since()}`])
    expect(r.code).toBe(0)
    expect(vn.hits.filter((h) => h.path === '/hcmc-rent-index.csv')).toHaveLength(4)
    expect(vn.hits.filter((h) => h.path === '/hcmc-rent-index')).toHaveLength(4)
    // ⛔ the point of the order: no sitemap and no page on the site whose snapshot failed.
    expect(vn.hits.every((h) => h.path.startsWith('/hcmc-rent-index'))).toBe(true)
    expect(r.out).toMatch(/\[!!\].*retry 3 of 3/)
    expect(r.out).toMatch(/\[!!\].*eno\.vn: sitemaps and pages NOT warmed/)
    expect(r.out).not.toContain('[XX]')
    // The forum has no rent index (the services edition answers 404 there) and is warmed regardless.
    expect(forum.hits.some((h) => h.path.startsWith('/hcmc-rent-index'))).toBe(false)
    expect(forum.hits[0].path).toBe('/sitemap.xml')
    expect(new Set(forum.hits.map((h) => h.host))).toEqual(new Set(['www.eno.forum']))
    expect(forum.hits.filter((h) => h.path === '/listings/l1')).toHaveLength(2)
  })

  it('a snapshot older than the container is not accepted: it waits for one from this build', async () => {
    const vn = await origin('eno.vn', 'stale-then-fresh')
    const dir = logDir()
    const r = await run([`--vn=${vn.addr}`, '--forum=', `--dir=${dir}`, '--sha=t3', `--since=${since()}`])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/\[!!\].*snapshot \S+ predates /)
    expect(vn.hits.slice(0, 5).map((h) => h.path)).toEqual([
      '/hcmc-rent-index', '/hcmc-rent-index.csv', '/hcmc-rent-index', '/hcmc-rent-index.csv', '/sitemap.xml',
    ])
    expect(r.out.match(/rent-index-cold/g)).toHaveLength(1)
  })

  it('says so when rent-index-cold timed a snapshot someone else had already computed', async () => {
    const vn = await origin('eno.vn', 'warm-before')
    const dir = logDir()
    const r = await run([`--vn=${vn.addr}`, '--forum=', `--dir=${dir}`, '--sha=t7', `--since=${since()}`])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/\[!!\]\S* rent-index-cold above is NOT a cold time/)
    expect(vn.hits.some((h) => h.path === '/listings/l1')).toBe(true)
  })

  it('without --since it says freshness was not checked, never "from this build"', async () => {
    const vn = await origin('eno.vn')
    const dir = logDir()
    const r = await run([`--vn=${vn.addr}`, '--forum=', `--dir=${dir}`, '--sha=t8', '--dry-run'])
    expect(r.out).toMatch(/rent index: snapshot \S+ \(freshness not checked: no --since\)/)
    expect(r.out).not.toContain('from this build')
    const bad = await run([`--vn=${vn.addr}`, '--forum=', `--dir=${dir}`, '--sha=t9', '--dry-run', '--since=yesterday'])
    expect(bad.out).toMatch(/\[!!\]\S* --since=yesterday is not an RFC 3339 UTC time/)
  })

  it('an empty sitemap starts no page worker (GNU xargs would run one with no path)', async () => {
    const vn = await origin('eno.vn', 'fresh', { emptySitemap: true })
    const dir = logDir()
    const r = await run([`--vn=${vn.addr}`, '--forum=', `--dir=${dir}`, '--sha=t10', `--since=${since()}`])
    expect(r.code).toBe(0)
    expect(r.out).toContain('eno.vn: 2 sitemap file(s), 0 pages to warm')
    expect(vn.hits.filter((h) => h.path === '/' || h.path === '')).toEqual([])
    expect(tsvRows(dir, 't10').filter((x) => x[5] === 'page')).toHaveLength(2) // /c/rentals, en and vi
  })

  it('a spent time budget sends nothing at all and says so, still exit 0', async () => {
    const vn = await origin('eno.vn')
    const forum = await origin('www.eno.forum')
    const dir = logDir()
    const r = await run([`--vn=${vn.addr}`, `--forum=${forum.addr}`, `--dir=${dir}`, '--sha=t5', '--budget=0'])
    expect(r.code).toBe(0)
    expect(vn.hits).toEqual([])
    expect(forum.hits).toEqual([])
    expect(r.out).toMatch(/\[!!\]\S* rent index: not sent: time budget spent/)
    expect(r.out).toMatch(/\[!!\]\S* www\.eno\.forum: \/sitemap\.xml answered nothing \(time budget spent\)/)
  })

  it('a request that hangs is cut at the budget, so nothing is left running when the deploy caps it', async () => {
    const vn = await origin('eno.vn', 'fresh', { hangMs: 20_000 })
    const dir = logDir()
    const t0 = Date.now()
    const r = await run([`--vn=${vn.addr}`, '--forum=', `--dir=${dir}`, '--sha=t11', '--budget=2'])
    const took = Date.now() - t0
    expect(r.code).toBe(0)
    // curl's --max-time was cut from 180 s to the 2 s left: the script, and every curl it waits
    // on, is done within the budget, well before the stub would have answered.
    expect(took).toBeLessThan(8_000)
    expect(r.out).toMatch(/rent-index-cold [0-9.]+s \(HTTP 000\)/)
    expect(r.out).toMatch(/\[!!\]\S* rent index: CSV not sent: time budget spent/)
    expect(r.out).not.toContain('retry 1')
  }, 20_000) // the 8 s bound above is the assertion; vitest's 5 s default would pre-empt it

  it('a newer deploy already swapping: nothing is sent at all, and it says why, still exit 0', async () => {
    const vn = await origin('eno.vn')
    const forum = await origin('www.eno.forum')
    const dir = logDir()
    const stop = join(dir, 'deploy-incomplete')
    writeFileSync(stop, '')
    const r = await run([`--vn=${vn.addr}`, `--forum=${forum.addr}`, `--dir=${dir}`, '--sha=t12', `--stop-file=${stop}`])
    expect(r.code).toBe(0)
    expect(vn.hits).toEqual([])
    expect(forum.hits).toEqual([])
    expect(r.out).toContain('rent index: not sent: a newer deploy started')
    expect(r.out).toContain('www.eno.forum: /sitemap.xml answered nothing (a newer deploy started')
    expect(r.out).not.toContain('[XX]')
  })

  it('a newer deploy that starts swapping mid-warm-up stops it: nothing is sent after the marker appears', async () => {
    const dir = logDir()
    const stop = join(dir, 'deploy-incomplete')
    const vn = await origin('eno.vn', 'fresh', { touchOnRentals: stop })
    const forum = await origin('www.eno.forum')
    const r = await run([`--vn=${vn.addr}`, `--forum=${forum.addr}`, `--dir=${dir}`, '--sha=t13', `--stop-file=${stop}`])
    expect(r.code).toBe(0)
    // /c/rentals (en) is the request that met the new deploy; nothing after it went out: not its
    // vi twin, no page worker, no retouch, and nothing to the forum.
    expect(vn.hits.map((h) => h.path)).toEqual([
      '/hcmc-rent-index', '/hcmc-rent-index.csv', '/sitemap.xml', '/sitemaps/pages.xml', '/sitemaps/listings-0.xml', '/c/rentals',
    ])
    expect(forum.hits).toEqual([])
    expect(r.out).toMatch(/\[!!\]\S* eno\.vn: a newer deploy started \(\S+ exists\); 15 page request\(s\) not sent/)
    expect(tsvRows(dir, 't13').filter((x) => x[5] === 'retouch')).toHaveLength(0)
  })

  it('a closed port is a warning, not a failure', async () => {
    const dir = logDir()
    // A port that was just free: bind one, note it, close it.
    const port = await new Promise<number>((resolve) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const a = s.address()
        s.close(() => resolve(typeof a === 'object' && a ? a.port : 9))
      })
    })
    const r = await run([`--vn=127.0.0.1:${port}`, `--forum=127.0.0.1:${port}`, `--dir=${dir}`, '--sha=t6'])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/\[!!\].*CSV HTTP 000/)
    expect(r.out).toMatch(/\[!!\].*www\.eno\.forum: \/sitemap\.xml answered 000/)
  })

  it('refuses a malformed flag (the only non-zero exit)', async () => {
    expect((await run(['--nope'])).code).toBe(2)
    expect((await run(['--sha=../x'])).code).toBe(2)
    expect((await run(['--budget=ten'])).code).toBe(2)
  })
})

describe('eno-deploy.sh step 11 calls the warm-up warn-only, after the deploy is recorded', () => {
  const src = readFileSync(join(ROOT, 'infra/vn-node/eno-deploy.sh'), 'utf8')
  const step = src.indexOf('say "11. warm')
  const code = src.slice(step).split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')

  it('defines warn() beside ok() and bad(), yellow [!!], never the red [XX]', () => {
    expect(src).toMatch(/^warn\(\)\{ printf ' {2}\\033\[33m\[!!\]\\033\[0m %s\\n' "\$\*"; \}$/m)
  })

  it('releases the deploy lock first, then runs under timeout --foreground, and a failure can only warn', () => {
    const call = src.split('\n').filter((l) => l.includes('eno-warmup.sh') && !l.trim().startsWith('#'))
    expect(call).toHaveLength(1)
    expect(call[0]).toMatch(/^\s*timeout --foreground 900 bash "\$APP\/infra\/vn-node\/eno-warmup\.sh" .* \\$/)
    // the lock fd (exec 9>"$LOCK" at the top) is closed before the warm-up starts
    expect(src).toMatch(/^exec 9>"\$LOCK"/m)
    expect(code.indexOf('exec 9>&-')).toBeGreaterThan(0)
    expect(code.indexOf('exec 9>&-')).toBeLessThan(code.indexOf('eno-warmup.sh'))
    const i = src.indexOf(call[0])
    expect(src.slice(i, i + 400)).toMatch(/\|\| warn "warm-up/)
  })

  it('sits after the marker removal, so nothing in it can reach restore()', () => {
    const marker = src.indexOf('rm -f /opt/eno/deploy-incomplete\n\nsay "10. state"')
    expect(marker).toBeGreaterThan(0)
    expect(step).toBeGreaterThan(marker)
    expect(code).not.toMatch(/\brestore\b|exit 1|\bbad\b/)
  })
})
