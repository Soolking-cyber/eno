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
import pg from 'pg'
import { invokedDirectly } from '../src/lib/cli-entry'
import { AMENDED } from '../src/lib/compliance/legal-amendment'
import { AMENDMENT_NOTICE, AMENDMENT_NOTICE_ID_PREFIX, AMENDMENT_NOTICE_URL, noticeSendable } from '../src/lib/compliance/legal-amendment-notice'

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

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) throw new Error('Set DIRECT_URL (or DATABASE_URL) — `set -a; . ./.env; set +a` first')
  const apply = process.argv.includes('--apply')

  const window = noticeSendable(new Date())
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
