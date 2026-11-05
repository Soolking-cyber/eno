// A person logs in to the reading account, in a visible window, in the worker's own browser profile. No cookies are exported or copied: moving them to the box is what got the account locked.
// ⛔ Says which account it saved, and refuses any name in secrets/never-read-as.txt: an account named "spare" that was really the leads account got locked because nothing ever compared the names.
// A login whose name can't be read is not used either: the worker waits for state/reader-name. Also clears the worker's stop. Prints no cookie or token.
import { chromium } from 'playwright'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = join(homedir(), 'eno-fb-import')
const PROFILE = join(HOME, 'profile')
const norm = (s) => s.normalize('NFC').trim().toLowerCase()
const NEVER = existsSync(join(HOME, 'secrets/never-read-as.txt')) ? readFileSync(join(HOME, 'secrets/never-read-as.txt'), 'utf8').split('\n').map(norm).filter(Boolean) : null
if (!NEVER?.length) { console.log('NOT STARTED: secrets/never-read-as.txt must name the accounts that may never read (the leads account)'); process.exit(1) }

mkdirSync(join(HOME, 'state'), { recursive: true })
// The worker reads only as a name this script has checked: until one is saved again, it waits.
rmSync(join(HOME, 'state/reader-name'), { force: true })
const c = await chromium.launchPersistentContext(PROFILE, { channel: 'chrome', headless: false, viewport: { width: 1200, height: 850 }, locale: 'en-US', timezoneId: 'Asia/Ho_Chi_Minh' })
const p = c.pages()[0] ?? (await c.newPage())
await p.goto('https://www.facebook.com/login/')
console.log('Log in to the reading account in the window, and answer anything Facebook asks. Waiting up to 15 minutes…')

/** The name Facebook's own page gives for whoever is logged in. Null until a real signed-in page is showing. */
async function loggedInName() {
  const ck = await c.cookies('https://www.facebook.com').catch(() => [])
  if (!ck.some((x) => x.name === 'c_user') || /^\/(login|checkpoint|two_step|two_factor)/.test(new URL(p.url()).pathname)) return null
  const html = await p.content().catch(() => '')
  const m = html.match(/"CurrentUserInitialData",\[\],\{[^}]*?"NAME":("(?:[^"\\]|\\.)*")/) ?? html.match(/"USER_ID":"\d+","NAME":("(?:[^"\\]|\\.)*")/)
  try { return m ? JSON.parse(m[1]) : null } catch { return null }
}
const until = Date.now() + 900_000
let name = null
while (Date.now() < until && !(name = await loggedInName())) await new Promise((r) => setTimeout(r, 2000))
if (name && !NEVER.includes(norm(name))) {
  await new Promise((r) => setTimeout(r, 4000))
  writeFileSync(join(HOME, 'state/reader-name'), name)
  rmSync(join(HOME, 'state/STOP'), { force: true })
  console.log(`LOGIN SAVED: ${name}`)
  await c.close().catch(() => {})
} else {
  await c.close().catch(() => {})
  // A refused account leaves nothing behind for the worker to pick up.
  if (name) { rmSync(PROFILE, { recursive: true, force: true }); console.log(`REFUSED: ${name} may never read. Its session was deleted from this profile.`) } else console.log('NOT SAVED: no name read, so this login will not be used')
}
