/**
 * FB INTAKE — pull the text of recent posts out of Facebook groups you belong to, into JSONL for
 * `scripts/demand-engine.ts`.
 *
 *   npx tsx scripts/fb-intake.ts --anon --groups expatsinhcmc  # public groups, NO account
 *   npx tsx scripts/fb-intake.ts --login                       # once: a real window, you log in
 *   npx tsx scripts/fb-intake.ts --groups 123,456 --scrolls 8  # then: headless, read-only
 *   npx tsx scripts/demand-engine.ts --in data/fb-posts.jsonl
 *
 * ⛔ READ-ONLY BY CONSTRUCTION. There is no click, no type and no submit in this file. It scrolls
 * and reads. Posting replies is a human step, and deliberately not automatable from here.
 *
 * ✅ `--anon` NEEDS NO ACCOUNT AND RISKS NONE. Measured 2026-09-21: a logged-out Chromium reading
 * `facebook.com/groups/expatsinhcmc?sorting_setting=CHRONOLOGICAL` gets real posts, the newest 38
 * minutes old. PREFER IT. It only reaches groups whose posts are public — a private group returns
 * a bare "Facebook" title and zero articles, which is the tell — and it stops after a handful of
 * posts because the login wall interrupts the scroll. Every caveat below applies only to the
 * logged-in mode.
 *
 * ⚠️ THINGS TO KNOW BEFORE YOU RELY ON THIS:
 *   · Scripted access is against Facebook's Terms of Service whether it posts or not. An account
 *     doing this can be rate-limited, checkpointed or disabled. Use an account whose loss you can
 *     absorb — NOT the one holding the catalog or the CAPI dataset.
 *   · The selectors WILL break. Facebook's markup is generated and its class names change weekly.
 *     That is why extraction here is structural (`[role=article]`, visible text) rather than
 *     class-based, and why it prints a count you are meant to sanity-check.
 *   · `.fb-state.json` is a live session cookie — as good as the password. It is gitignored; keep
 *     it that way.
 *
 * The only officially supported route to this data is the Graph API, and it does NOT cover public
 * group posts by keyword — Facebook removed that with the v2.4 `/search?type=post` deprecation and
 * has not restored it. So there is no compliant automated intake; the compliant route is a human
 * reading the groups. This script exists because you asked for the browser route with your eyes
 * open, and it stops at reading.
 */
import { config } from 'dotenv'
import { chromium, type Page } from 'playwright'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'

config({ path: '.env', quiet: true })
config({ path: '.env.local', quiet: true })

const STATE = '.fb-state.json'

/**
 * Cheap local prefilter — the shapes a "looking for" post takes in Vietnamese and English.
 * ⚠️ RECALL OVER PRECISION ON PURPOSE. jev is the classifier; this only exists so a group dump of
 * 400 posts does not become 400 API calls. A false positive costs $0.00002; a false negative
 * silently loses a customer, which is the expensive direction.
 */
const WANTED = /(c[aầ]n mua|t[iì]m mua|c[aầ]n t[iì]m|mu[oố]n mua|ai c[oó] .{0,20}(kh[oô]ng|ko|k\b)|ai b[aá]n|c[aầ]n thu[eê]|t[iì]m thu[eê]|c[aầ]n ng[uư][oơ]i|ch[oỗ] n[aà]o|[oở] đ[aâ]u|gi[uớ]i thi[eệ]u .{0,15}(ch[oỗ]|shop)|looking for|anyone (know|have|sell)|where can i|need to buy|wtb\b)/i

/**
 * Sellers' own posts, which the prefilter would otherwise wave through on "ai cần".
 * ⚠️ ANCHORED — SO THE PREAMBLE MUST BE GONE FIRST. Facebook's rendered text begins with the
 * author and a timestamp ("Hien Dinh 39 phút · FOR RENT | DUPLEX…"), so `^` matched the NAME and
 * this filter passed every seller through. `stripPreamble` below is what makes the anchor mean
 * what it says; keeping the anchor is right, because "bán" deep inside a buyer's post ("ai bán
 * cho mình") is not a seller.
 */
const SELLING = /^(b[aá]n|thanh l[yý]|pass l[aạ]i|c[aầ]n b[aá]n|gi[aả]m gi[aá]|sale\b|fs\b|for sale)/i

/**
 * Drop the author + timestamp Facebook prefixes onto every post, and redact phone numbers.
 *
 * ⛔ THIS IS A PRIVACY BOUNDARY, NOT TIDYING. Every harvested post is sent to api.typesafe.ai and
 * written to data/*.jsonl. The raw text opens with a REAL PERSON'S NAME and Vietnamese classifieds
 * routinely carry a mobile number, so shipping it verbatim is a cross-border transfer of a third
 * party's personal data — for a company registering in Vietnam under Decree 13, that is the
 * expensive kind of mistake. Neither the name nor the number helps match a product, so neither
 * leaves this function.
 */
export function stripPreamble(text: string): string {
  return text
    /**
     * ⚠️ THE TIMESTAMP HAS MANY SHAPES AND ONLY ONE WAS HANDLED. The first version matched
     * "39 phút ·" and nothing else, so "Vừa xong" (just now), "Hôm qua lúc 20:15" (yesterday) and
     * "21 tháng 9 lúc…" (a date) all kept the author's name — which both defeats the anchored
     * SELLING filter below AND ships a real person's name to an API abroad. Each form is listed
     * because a generic "strip up to the first ·" would eat the post when a name contains one.
     */
    .replace(/^.{0,90}?[\s.](?:\d+\s*(?:ph[uú]t|gi[oờ]|ng[aà]y|tu[aầ]n|thg|hrs?|hours?|mins?|minutes?|days?|[mhdw])|v[uừ]a xong|h[oô]m qua|h[oô]m nay|just now|yesterday|today|\d+\s*(?:th[aá]ng|january|february|march|april|may|june|july|august|september|october|november|december)\s*\d*)(?:\s*(?:l[uú]c|at)\s*[\d:]+\s*(?:am|pm)?)?\s*[·•]\s*(?:(?:[ĐD]ã chia s[ẻe] v[ớo]i|Shared with)\s*(?:Nh[oó]m c[oô]ng khai|Nh[oó]m ri[eê]ng t[uư]|C[oô]ng khai|Your friends|Public|Friends)?\s*)?/i, '')
    /**
     * ⛔ THE AUDIENCE LABEL IS BOUNDED TO THREE WORDS, AND THE UNBOUNDED FORM DELETED THE POST.
     * It was `[^\n]*`, written when the text still had newlines — but `harvest` joins the lines
     * with a SPACE before calling this, so there is no newline left to stop at and the group ate
     * every post carrying "Đã chia sẻ với…" or "Shared with…" down to an empty string. Measured:
     * both forms returned "". The live run escaped only because the chrome filter happened to peel
     * that line off first, which is luck, not a guard.
     * ⚠️ AND THE REPLACEMENT IS A NAMED AUDIENCE LIST, not "up to N words" — that first correction
     * ate "Public Looking for" out of an English post, turning a demand post into "a second hand
     * laptop". An unknown audience label simply stays in the text, which is harmless noise.
     */
    // Fallback: a leading "Name · " with no timestamp at all (the feed renders this too).
    .replace(/^[\p{L}\s.'-]{2,40}\s*[·•]\s*/u, '')
    /**
     * ⛔ REDACTION IS A PRIVACY BOUNDARY, NOT TIDYING. Every harvested post goes to
     * api.typesafe.ai and onto disk in data/*.jsonl. Vietnamese classifieds carry a mobile number
     * as a matter of course, often a Zalo id or an email too, and none of it helps match a
     * product. For a company registering in Vietnam under Decree 13, transferring a third party's
     * contact details abroad is the expensive kind of mistake.
     */
    // ⚠️ BOUNDED. Measured: the unbounded form does NOT in fact eat "1.200.000.000", which a
    // reviewer predicted — but a price and a phone number are the same shape of digit run, so the
    // guard costs nothing and removes the class rather than the one case that was checked.
    // ⚠️ THE LOOKAHEAD REJECTS A DIGIT, NOT A DOT. With `(?![\d.])` a sentence-final number —
    // "liên hệ 0909123456." — failed to match and the whole number went abroad unredacted, which
    // is the commonest way one is written. The lookBEHIND still carries the price guard.
    .replace(/(?<![\d.])(?:\+?84|0)\s*\d(?:[\s.\-]?\d){7,9}(?!\d)/g, '[sđt]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\bzalo\s*:?\s*[\w.]+/gi, 'zalo [id]')
    .replace(/https?:\/\/\S+/g, '[link]')
    .trim()
}

async function login() {
  const browser = await chromium.launch({ headless: false })
  const page = await browser.newContext().then((c) => c.newPage())
  await page.goto('https://www.facebook.com/')
  console.log('Log in in the window that opened, land on your feed, then press Enter here.')
  /**
   * ⚠️ `pause()` AFTER THE WAIT, OR THE COMMAND NEVER RETURNS. Reading stdin ref's it into the
   * event loop, so the script saved the session, closed the browser, printed its success line and
   * then sat there forever — which reads as a hang in the middle of a login, exactly when you are
   * least sure whether it worked.
   */
  await new Promise<void>((r) => process.stdin.once('data', () => r()))
  process.stdin.pause()
  await page.context().storageState({ path: STATE })
  await browser.close()
  console.log(`session saved -> ${STATE}  (gitignored; treat it as a password)`)
}

/**
 * ⚠️ EXTRACT BY STRUCTURE, NOT BY CLASS. Facebook's class names are generated and rotate; a
 * selector like `.x1yztbdb` works for a week. `[role=article]` is part of its accessibility
 * contract and has survived years of redesigns, so it is the one stable handle here.
 */
async function harvest(page: Page, scrolls: number): Promise<string[]> {
  const seen = new Set<string>()
  for (let i = 0; i < scrolls; i++) {
    /**
     * ⛔ TOP-LEVEL ARTICLES ONLY, AND THE NESTING IS THE PRIVACY BUG. Facebook marks up every
     * COMMENT as a `[role=article]` inside the post's own article, so reading a post's `innerText`
     * swept in each visible commenter's name and reply — people who are not the author, whose
     * names then went to an API abroad and onto disk. `stripPreamble` only ever removed the
     * LEADING author line, so it could not have caught them.
     */
    /**
     * ⛔ TOP-LEVEL ARTICLES ONLY, AND THE NESTING IS THE PRIVACY BUG. Facebook marks up every
     * COMMENT as a `[role=article]` inside the post's own article, so reading a post's `innerText`
     * swept in each visible commenter's name and reply — people who are not the author, whose
     * names then went to an API abroad and onto disk. `stripPreamble` only ever removed the
     * LEADING author line, so it could not have caught them.
     *
     * ⚠️ THE NESTED TEXT IS SUBTRACTED, NOT CLONED AWAY. The obvious fix — clone the node, remove
     * the nested articles, read `innerText` — silently breaks: `innerText` is a RENDERED-layout
     * property, and a detached clone has no layout, so it degrades to textContent and every line
     * break vanishes. The chrome filter below is line-based, so it then matched nothing and every
     * post came back with "ThíchBình luậnChia sẻ" glued to its tail. Measured on the live group.
     */
    const batch = await page.$$eval('[role="article"]', (nodes) => nodes
      .filter((n) => !n.parentElement?.closest('[role="article"]'))
      .map((n) => {
        let text = (n as HTMLElement).innerText || ''
        for (const child of Array.from(n.querySelectorAll('[role="article"]'))) {
          const t = (child as HTMLElement).innerText
          if (t) text = text.replace(t, '')
        }
        return text
      })
      .filter(Boolean))
    for (const raw of batch) {
      // Drop the chrome Facebook wraps every post in: reaction counts, the comment box, "See more".
      const text = raw.split('\n')
        // ⚠️ THE CHROME IS BILINGUAL — the group renders in whichever locale the context asks
        // for, and `vi-VN` means "Thích/Bình luận/Xem thêm", not "Like/Comment/See more". Filtering
        // only the English strings leaves every post trailing its own button bar.
        .filter((l) => l.trim() && !/^(All reactions|\d+ comments?|\d+ shares?|Like|Comment|Share|See more|Most relevant|Write a comment|View \d+|Th[íi]ch|B[ìi]nh lu[aậ]n|Chia s[ẻe]|Xem th[êe]m|T[aấ]t c[ảa] c[ảa]m x[úu]c|Vi[ếe]t b[ìi]nh lu[aậ]n|Ph[ùu] h[ợo]p nh[aấ]t|Xem \d+)/i.test(l.trim()))
        .join(' ').replace(/\s+/g, ' ')
        // ⚠️ "Xem thêm"/"See more" also ends a line INLINE, where a line-start filter cannot see
        // it — a truncated post keeps the marker and jev reads it as part of the request.
        .replace(/[…·\s]*(Xem th[êe]m|See more)\s*$/i, '').trim()
      const clean = stripPreamble(text)
      if (clean.length > 25) seen.add(clean)
    }
    await page.mouse.wheel(0, 3000)
    // ⚠️ A FIXED WAIT, NOT `networkidle`. Facebook's feed polls forever, so networkidle never
    // fires and the run hangs with no error — the failure looks like a slow site, not a bug.
    await page.waitForTimeout(2200)
  }
  return [...seen]
}

async function main() {
  const a = process.argv
  if (a.includes('--login')) return login()

  const groups = ((a.includes('--groups') ? a[a.indexOf('--groups') + 1] : '') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const scrolls = Number(a.includes('--scrolls') ? a[a.indexOf('--scrolls') + 1] : 6)
  const out = a.includes('--out') ? a[a.indexOf('--out') + 1] : 'data/fb-posts.jsonl'
  const keepAll = a.includes('--no-prefilter')

  const anon = a.includes('--anon')

  // ⚠️ `--groups` as the LAST argument makes `argv[i+1]` undefined, which used to throw a
  // TypeError on `.split` before the friendly message below could ever print.
  if (!groups.length) throw new Error('--groups <id,id,...> is required (the number or slug in the group URL)')
  if (!anon && !existsSync(STATE)) throw new Error(`no ${STATE} — run --login, or --anon for public groups`)

  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({
    ...(anon ? {} : { storageState: STATE }),
    locale: 'vi-VN',
    viewport: { width: 1280, height: 1600 },
  })
  const page = await ctx.newPage()

  const rows: { group: string; text: string }[] = []
  // ⚠️ try/finally, or a navigation timeout or the session-expired throw below leaves an orphan
  // headless Chromium running with the session cookie loaded.
  try {
  for (const g of groups) {
    // `?sorting_setting=CHRONOLOGICAL` is what makes this an intake rather than an archive — the
    // default feed is ranked, so fresh "looking for" posts sit below week-old popular ones.
    await page.goto(`https://www.facebook.com/groups/${g}?sorting_setting=CHRONOLOGICAL`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    if (!anon && page.url().includes('/login')) throw new Error('session expired — rerun with --login')

    const texts = await harvest(page, scrolls)
    const kept = keepAll ? texts : texts.filter((t) => WANTED.test(t) && !SELLING.test(t))
    for (const text of kept) rows.push({ group: g, text })
    // ⚠️ ZERO POSTS READ IS THE PRIVATE-GROUP SIGNATURE under --anon, not a broken selector.
    // Say so here, or the run looks like a silent scrape failure and sends you selector-hunting.
    console.log(`group ${g}: ${texts.length} posts read, ${kept.length} look like demand`
      + (texts.length === 0 && anon ? '   (0 = not public; this one needs --login)' : ''))
  }

  } finally {
    await browser.close()
  }
  mkdirSync('data', { recursive: true })
  writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
  console.log(`${rows.length} -> ${out}`)
  console.log(`next: npx tsx scripts/demand-engine.ts --in ${out}`)
}

/**
 * ⚠️ GUARDED — this module exports `stripPreamble`, which invites a unit test, and an unguarded
 * `main()` meant any import launched Chromium, threw on the missing `--groups` and called
 * `process.exit(1)`, taking the test runner down with it. Its sibling had the same bug.
 */
if (process.argv[1]?.includes('fb-intake')) {
  main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
}
