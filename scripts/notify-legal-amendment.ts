// SEND THE AMENDMENT NOTICE TO EVERY REGISTERED ACCOUNT — one bell notification each (2026-10-01).
//
// Quy chế Article 15 promises every amendment is published on the platform at least 5 days ahead "kèm
// thông báo tới người sử dụng đã đăng ký tài khoản". The site-wide strip is the publication; this is the
// notice. The copy, the window and the row id live in src/lib/compliance/legal-amendment-notice.ts
// (unit-tested); this file only counts and writes.
//
// Run ON THE PUBLICATION DAY, AFTER the deploy that publishes the amendment (eno-deploy.sh's step 2b
// holds that deploy to LEGAL_AMENDMENT.published):
//   set -a; . ./.env; set +a; npx tsx scripts/notify-legal-amendment.ts            # count, read-only
//   set -a; . ./.env; set +a; npx tsx scripts/notify-legal-amendment.ts --apply    # write
//
// ⛔ --apply REFUSES outside the notice window (before the publication day, or from the in-force
// instant), and when https://eno.vn/terms does not yet show the amendment as published — a notice
// that points at texts the site does not show yet announces nothing. --site=<origin> checks another
// origin; --skip-live-check skips it (say why in the deploy notes).
// ⛔ IDEMPOTENT BY PRIMARY KEY: each row's id is `legal-amendment-<published>-<profile id>`, so a re-run
// (or a run resumed after a crash) inserts only for accounts that do not have it, never twice.
// ⚠️ ONE STATEMENT, ONE TRANSACTION: every account gets it or none does.
// ⚠️ Raw SQL, not the Prisma client: the ids are derived, not cuids, and a bell row needs nothing else.
//
// ⛔ AN IMMEDIATE AMENDMENT (LEGAL_AMENDMENT.immediate — owner, 2026-10-01: "no need for announcement")
// HAS NOTHING TO SEND: the send mode refuses, dry run included, before it touches the database.
//
// --retract — DELETE THE NOTICES THIS SCRIPT ALREADY SENT FOR THIS AMENDMENT (2026-10-01). The October 2026
// amendment's notices said it "takes effect on 7 October 2026"; made immediate, it is in force from 01/10,
// so they are false. Dry run by default (a read-only session, counts only):
//   set -a; . ./.env; set +a; npx tsx scripts/notify-legal-amendment.ts --retract            # count
//   set -a; . ./.env; set +a; npx tsx scripts/notify-legal-amendment.ts --retract --apply    # delete
// ⛔ EXACTLY THIS SCRIPT'S ROWS: id = 'legal-amendment-<published>-' || "recipientId", type 'system', url
// AMENDMENT_NOTICE_URL — the three things the INSERT below wrote. A row that merely starts with the prefix
// is counted and LEFT ALONE. --published=YYYY-MM-DD names the batch when LEGAL_AMENDMENT.published has
// since been re-dated (the sent rows keep the date they were sent under); --apply takes it only 1–6 days
// before LEGAL_AMENDMENT.published — this amendment re-dated, never another amendment's batch.
// ⛔ --retract --apply REFUSES unless the amendment is immediate (a window's notice is the announcement the
// Quy chế promises — retractable()), and unless the live /regulations already shows the immediate
// version (deleting first would leave the strip saying "7 October" and no bell) — --skip-live-check
// skips that, say why in the deploy notes.
import pg from 'pg'
import { invokedDirectly } from '../src/lib/cli-entry'
import { AMENDED, LEGAL_AMENDMENT } from '../src/lib/compliance/legal-amendment'
import { TOS_VERSION } from '../src/lib/site-legal'
import { AMENDMENT_NOTICE, AMENDMENT_NOTICE_ID_PREFIX, AMENDMENT_NOTICE_URL, noticeIdPrefix, noticeSendable, retractable } from '../src/lib/compliance/legal-amendment-notice'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

/**
 * Does the live /terms show the amendment? Asked for markdown, but the edge may answer with cached HTML
 * (next.config.ts, the markdown-negotiation deploy note) in either language — so any of the three forms
 * of "published on <date>" the page or its markdown prints counts. `?d=` defeats the edge cache.
 */
async function liveCheck(origin: string): Promise<string | null> {
  const markers = [`published on ${AMENDED.publishedEn}`, `công bố ngày ${AMENDED.publishedVi}`]
  try {
    const res = await fetch(`${origin}/terms?d=${Date.now()}`, { headers: { accept: 'text/markdown, text/html;q=0.9', 'accept-language': 'en' } })
    if (!res.ok) return `${origin}/terms answered ${res.status}`
    const page = await res.text()
    return markers.some((m) => page.includes(m)) ? null : `${origin}/terms does not show the amendment published on ${AMENDED.publishedEn} — is it deployed?`
  } catch (e) {
    return `${origin}/terms could not be fetched (${(e as Error).message})`
  }
}

/**
 * Does the live /regulations show the amendment as in force from its publication day? The Quy chế renders
 * its Vietnamese META unconditionally (both languages are the document), so the marker holds whatever
 * language the edge answers in. `?d=` defeats the edge cache.
 */
async function liveImmediateCheck(origin: string): Promise<string | null> {
  const marker = `Phiên bản ${TOS_VERSION}, có hiệu lực từ ngày ${AMENDED.inForceVi}`
  try {
    const res = await fetch(`${origin}/regulations?d=${Date.now()}`, { headers: { accept: 'text/html', 'accept-language': 'vi' } })
    if (!res.ok) return `${origin}/regulations answered ${res.status}`
    return (await res.text()).includes(marker) ? null : `${origin}/regulations does not yet say "${marker}" — deploy the immediate amendment first`
  } catch (e) {
    return `${origin}/regulations could not be fetched (${(e as Error).message})`
  }
}

/** --retract: count (read-only) or delete exactly the rows the send mode wrote for one amendment. */
async function retract(url: string, apply: boolean) {
  const published = arg('published') ?? LEGAL_AMENDMENT.published
  if (!/^\d{4}-\d{2}-\d{2}$/.test(published)) throw new Error(`--published must be YYYY-MM-DD (got ${published})`)
  const prefix = noticeIdPrefix(published)
  const origin = arg('site') ?? 'https://eno.vn'
  // With --published: only this amendment's own earlier-dated batch, never another amendment's (retractable()).
  const allowed = retractable(LEGAL_AMENDMENT, published)
  if (apply) {
    if (!allowed.ok) throw new Error(`refusing to retract: ${allowed.reason}`)
    if (!process.argv.includes('--skip-live-check')) {
      const why = await liveImmediateCheck(origin)
      if (why) throw new Error(`refusing to retract: ${why} (--skip-live-check to override)`)
      console.log(`live: ${origin}/regulations shows version ${TOS_VERSION} in force from ${AMENDED.inForceVi}`)
    }
  } else {
    if (!allowed.ok) console.log(`⚠️  --apply would refuse: ${allowed.reason}`)
    const why = await liveImmediateCheck(origin)
    console.log(why ? `⚠️  --apply would refuse until deployed: ${why}` : `live: ${origin}/regulations shows version ${TOS_VERSION} in force from ${AMENDED.inForceVi}`)
  }

  // THE predicate: what the send mode's INSERT (main, below) wrote, and nothing else.
  const MINE = `n.id = $1 || n."recipientId"::text AND n.type = 'system' AND n.url = $2`
  const c = new pg.Client({ connectionString: url, ...(apply ? {} : { options: '-c default_transaction_read_only=on' }) })
  await c.connect()
  try {
    // createdAt as the column's own text: it is a zone-less timestamp, and pg would read it as local time.
    const { rows: [k] } = await c.query<{ mine: string; read: string; prefixed: string; first: string | null; last: string | null }>(
      `SELECT count(*) FILTER (WHERE ${MINE}) AS mine,
              count(*) FILTER (WHERE ${MINE} AND n.read) AS read,
              count(*) AS prefixed,
              (min(n."createdAt") FILTER (WHERE ${MINE}))::text AS first,
              (max(n."createdAt") FILTER (WHERE ${MINE}))::text AS last
         FROM "Notification" n
        WHERE left(n.id, length($1)) = $1`,
      [prefix, AMENDMENT_NOTICE_URL],
    )
    const { rows: copies } = await c.query<{ title: string; body: string | null; n: string }>(
      `SELECT n.title, n.body, count(*) AS n FROM "Notification" n WHERE ${MINE} GROUP BY 1, 2 ORDER BY 3 DESC`,
      [prefix, AMENDMENT_NOTICE_URL],
    )
    console.log(`notices sent for the amendment published ${published} (id ${prefix}<recipient>): ${k.mine} (${k.read} read)` +
      (k.first ? `, createdAt ${k.first}${k.last !== k.first ? ` – ${k.last}` : ''}` : ''))
    for (const r of copies) console.log(`  ${r.n} × ${r.title} — ${r.body}`)
    const other = Number(k.prefixed) - Number(k.mine)
    if (other > 0) console.log(`⚠️  ${other} other row(s) start with ${prefix} but are not this script's — left alone`)
    if (!apply) {
      console.log('dry run — re-run with --retract --apply to delete them')
      return
    }
    const r = await c.query(`DELETE FROM "Notification" n WHERE ${MINE}`, [prefix, AMENDMENT_NOTICE_URL])
    console.log(`deleted ${r.rowCount ?? 0} notice(s)`)
  } finally {
    await c.end()
  }
}

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) throw new Error('Set DIRECT_URL (or DATABASE_URL) — `set -a; . ./.env; set +a` first')
  const apply = process.argv.includes('--apply')
  if (process.argv.includes('--retract')) return retract(url, apply)

  const window = noticeSendable(new Date())
  // Dry run included: there is nothing to count either.
  if (LEGAL_AMENDMENT.immediate) {
    throw new Error(`refusing: ${window.ok ? 'the amendment is immediate' : window.reason}. To remove notices already sent: --retract`)
  }
  if (!window.ok) {
    if (apply) throw new Error(`refusing to send: ${window.reason}`)
    console.log(`⚠️  outside the notice window: ${window.reason}`)
  }
  if (apply && !process.argv.includes('--skip-live-check')) {
    const origin = arg('site') ?? 'https://eno.vn'
    const why = await liveCheck(origin)
    if (why) throw new Error(`refusing to send: ${why} (--skip-live-check to override)`)
    console.log(`live: ${origin}/terms shows the amendment published on ${AMENDED.publishedEn}`)
  }

  // A count cannot write: without --apply the session itself is read-only.
  const c = new pg.Client({ connectionString: url, ...(apply ? {} : { options: '-c default_transaction_read_only=on' }) })
  await c.connect()
  try {
    const { rows } = await c.query<{ vi: string; other: string; done: string }>(
      `SELECT count(*) FILTER (WHERE p.locale = 'vi' AND n.id IS NULL)  AS vi,
              count(*) FILTER (WHERE p.locale IS DISTINCT FROM 'vi' AND n.id IS NULL) AS other,
              count(n.id) AS done
         FROM "Profile" p
         LEFT JOIN "Notification" n ON n.id = $1 || p.id::text`,
      [AMENDMENT_NOTICE_ID_PREFIX],
    )
    const { vi, other, done } = rows[0]
    console.log(`accounts still to notify: ${Number(vi) + Number(other)} (${vi} in Vietnamese, ${other} in English); already notified: ${done}`)
    console.log(`  en: ${AMENDMENT_NOTICE.en.title} — ${AMENDMENT_NOTICE.en.body}`)
    console.log(`  vi: ${AMENDMENT_NOTICE.vi.title} — ${AMENDMENT_NOTICE.vi.body}`)
    console.log(`  → ${AMENDMENT_NOTICE_URL}`)
    if (!apply) {
      console.log('dry run — re-run with --apply to send')
      return
    }
    const r = await c.query(
      `INSERT INTO "Notification" (id, "recipientId", type, title, body, url, read, "createdAt")
       SELECT $1 || p.id::text, p.id, 'system',
              CASE WHEN p.locale = 'vi' THEN $4 ELSE $2 END,
              CASE WHEN p.locale = 'vi' THEN $5 ELSE $3 END,
              $6, false, now()
         FROM "Profile" p
       ON CONFLICT (id) DO NOTHING`,
      [AMENDMENT_NOTICE_ID_PREFIX, AMENDMENT_NOTICE.en.title, AMENDMENT_NOTICE.en.body, AMENDMENT_NOTICE.vi.title, AMENDMENT_NOTICE.vi.body, AMENDMENT_NOTICE_URL],
    )
    console.log(`sent ${r.rowCount ?? 0} notice(s)`)
  } finally {
    await c.end()
  }
}

if (invokedDirectly(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
