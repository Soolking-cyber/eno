// Ops diagnostic: print NON-SECRET identity of the DBs the current env points at
// (masked host/user, db name, table sanity). Used to catch the 2026-07-12 incident
// where eno's Vercel DATABASE_URL was accidentally overwritten with another
// project's Neon URL — run it in a Vercel build (prepend to the build command on a
// preview branch) whenever builds fail with TableDoesNotExist but prod runtime works.
// Never prints credentials.
import pg from 'pg'

for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const url = process.env[name] || ''
  let host = 'unset'
  try { host = new URL(url.replace(/^postgres(ql)?:/, 'http:')).host.replace(/^[^@]*@/, '') } catch {}
  const user = (() => { try { return new URL(url.replace(/^postgres(ql)?:/, 'http:')).username } catch { return '?' } })()
  console.log(`[db-identity] ${name} host:`, host, '| user:', user.slice(0, 9) + '…' + user.slice(-6))
  if (!url) continue
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 })
  try {
    await c.connect()
    const a = await c.query('select current_database() db, version() v')
    const b = await c.query("select count(*)::int n from information_schema.tables where table_schema='public'")
    const d = await c.query("select count(*)::int n from information_schema.tables where table_schema='public' and table_name='Category'")
    console.log(`[db-identity] ${name} db:`, a.rows[0].db, '| public tables:', b.rows[0].n, '| Category present:', d.rows[0].n === 1)
  } catch (e) {
    console.log(`[db-identity] ${name} CONNECT/QUERY FAILED:`, e.message)
  } finally {
    try { await c.end() } catch {}
  }
}
