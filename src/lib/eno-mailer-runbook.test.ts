import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * infra/cloudflare/eno-mailer.README.md is the cutover and operating procedure for the app's mail:
 * the eno-mailer Worker first, and Resend as the fallback on eno.vn ONLY (owner, 2026-09-23:
 * "resend fallback"). These pin the parts of it a reviewer found wrong, so an edit cannot quietly
 * put them back:
 *   · the Cloudflare DASHBOARD is how a suppression is lifted; the API script is a laptop-only
 *     fallback whose token (Email Sending: Edit) can also SEND as both domains;
 *   · no token or key is ever typed into a command line;
 *   · steps run in an order that works (token before the KV namespace it creates; laptop and box
 *     halves apart, so the Workers token never goes on the box);
 *   · the smoke test proves a reply to sign-in mail goes nowhere, on BOTH editions;
 *   · eno.vn KEEPS RESEND_API_KEY + MAIL_FROM (the fallback) and gains MAILER_URL + MAILER_KEY; the
 *     forum container ends with MAILER_URL + MAILER_KEY only; nothing removes eno.vn's Resend;
 *   · how to see fallback use in the logs, with greps that match what src/lib/mail.ts prints.
 */

const README = readFileSync(join(process.cwd(), 'infra/cloudflare/eno-mailer.README.md'), 'utf8')

function section(heading: string): string {
  const start = README.indexOf(heading)
  expect(start, `missing section ${heading}`).toBeGreaterThanOrEqual(0)
  const next = README.indexOf('\n## ', start + heading.length)
  return README.slice(start, next === -1 ? undefined : next)
}

const codeBlocks = (text: string) => [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1])

describe('eno-mailer runbook — lifting a suppression', () => {
  const operating = section('## Operating it')

  it('the dashboard is the primary path, and it comes first', () => {
    const dashboard = operating.indexOf('Email Service → Sending →\n     **Suppressions**')
    const script = operating.indexOf('scripts/email-suppression.mjs')
    expect(dashboard).toBeGreaterThan(-1)
    expect(operating).toMatch(/primary path, no token/)
    expect(script).toBeGreaterThan(dashboard)
    expect(operating).toMatch(/API fallback, only when the dashboard cannot do it/)
  })

  it('the fallback token is short-lived, laptop-only, off the box, and revoked', () => {
    expect(operating).toMatch(/can\s+also \*send mail\* as eno\.vn and eno\.forum/)
    expect(operating).toMatch(/\*\*laptop\*\*/)
    expect(operating).toMatch(/never put it on the box or in `\/opt\/eno\/secrets`/)
    expect(operating).toMatch(/\*\*revoke it\*\*/)
    expect(operating).toMatch(/CF_EMAIL_TOKEN_FILE/)
  })

  it('⛔ no token or key is ever assigned inline on a command line', () => {
    for (const block of codeBlocks(README)) {
      expect(block).not.toMatch(/CF_EMAIL_TOKEN=/)
      expect(block).not.toMatch(/(^|\s)CF_TOKEN=[^$\s]/m)
      expect(block).not.toMatch(/MAILER_KEY=\$\(/)
    }
  })
})

describe('eno-mailer runbook — step order and where each step runs', () => {
  it('the token is created before the KV namespace it is used to create', () => {
    const token = README.indexOf('## 2. A token that can deploy')
    const kv = README.indexOf('## 3. Create the KV namespace')
    expect(token).toBeGreaterThan(-1)
    expect(kv).toBeGreaterThan(token)
  })

  it('keys: set-secret (laptop, needs the token) and the env append (box, over ssh stdin) are separate', () => {
    const keys = section('## 5. Keys')
    expect(keys).toMatch(/\*\*5a\. On your laptop\*\*/)
    expect(keys).toMatch(/\*\*5b\. The box half, over ssh from stdin\.\*\*/)
    for (const block of codeBlocks(keys)) {
      // No block both needs the Workers token and writes the box's env files.
      expect(block.includes('set-secret') && block.includes('/opt/eno/secrets/')).toBe(false)
    }
    expect(keys).toMatch(/\| \$SSH 'cat >> \/opt\/eno\/secrets\/eno-vn\.env'/)
    expect(keys).toMatch(/\| \$SSH 'cat >> \/opt\/eno\/secrets\/eno-forum\.env'/)
    expect(keys).toMatch(/revoke the step-2 token/i)
  })

  it('⛔ 5b cannot write a placeholder or empty MAILER_URL: every write and the key shred are behind url_ok', () => {
    const [block] = codeBlocks(section('**5b. The box half'))
    const lines = block.split('\n')
    const guard = lines.find((l) => l.startsWith('url_ok() {'))!
    expect(guard).toContain('^https://eno-mailer\\.[a-z0-9-]+\\.workers\\.dev/v1/send$')
    // The placeholder as written fails that guard (uppercase), so a verbatim paste writes nothing.
    const placeholder = /^URL=(\S+)/.exec(lines.find((l) => l.startsWith('URL='))!)![1]
    expect(/^https:\/\/eno-mailer\.[a-z0-9-]+\.workers\.dev\/v1\/send$/.test(placeholder)).toBe(false)
    for (const l of lines.filter((x) => x.includes('cat >> /opt/eno/secrets/') || /\brm -P\b|\bshred\b/.test(x))) {
      expect(l.startsWith('url_ok && ')).toBe(true)
    }
    expect(README).not.toMatch(/URL=https:\/\/eno-mailer\.<sub>/)
  })

  it('the smoke test runs inside the app container or from a laptop with the key over ssh', () => {
    const smoke = section('## 6. Smoke test')
    expect(smoke).toMatch(/docker exec -i --env-file "\/opt\/eno\/secrets\/eno-\$ed\.env" "eno-\$ed-app"/)
    expect(smoke).toMatch(/--key-stdin/)
  })
})

describe('eno-mailer runbook — a reply to sign-in mail goes nowhere, on BOTH editions', () => {
  const smoke = section('## 6. Smoke test')

  it('replies to the --class signin message on eno.vn AND eno.forum and requires a bounce or a drop', () => {
    expect(smoke).toMatch(/Reply to the `--class signin` message, on BOTH editions/)
    expect(smoke).toMatch(/- \*\*eno\.vn\*\*: inbound is Cloudflare Email Routing/)
    expect(smoke).toMatch(/- \*\*eno\.forum\*\*: inbound is \*\*PrivateEmail\*\*/)
    expect(smoke).toMatch(/`no-reply@eno\.forum`, exclude that address from it/)
    expect(smoke).toMatch(/Do not start step 7 until this passes/)
  })
})

describe('eno-mailer runbook — Resend is eno.vn\'s fallback, and only eno.vn\'s', () => {
  it('says the Worker is primary, eno.vn falls back to Resend, and eno.forum has no fallback', () => {
    const intro = README.slice(0, README.indexOf('## 0. Pre-flight'))
    expect(intro).toMatch(/\*\*"resend fallback"\*\*/)
    expect(intro).toMatch(/\*\*eno\.vn falls back to Resend\*\*/)
    expect(intro).toMatch(/\*\*eno\.forum has no fallback\.\*\*/)
    expect(intro).not.toMatch(/There is no fallback\s+provider/)
  })

  it('env per container: eno.vn keeps RESEND_API_KEY + MAIL_FROM and gains MAILER_*; the forum gets MAILER_* only', () => {
    const vnRow = README.split('\n').find((l) => l.startsWith('| eno.vn (`eno-vn-app`)'))
    const forumRow = README.split('\n').find((l) => l.startsWith('| eno.forum (`eno-forum-app`)'))
    expect(vnRow).toMatch(/`MAILER_URL` \+ `MAILER_KEY`/)
    expect(vnRow).toMatch(/\*\*keeps\*\* `RESEND_API_KEY` \+ `MAIL_FROM`/)
    expect(forumRow).toMatch(/`MAILER_URL` \+ `MAILER_KEY` \(the forum key\) \*\*only\*\*/)
    expect(section('## 5. Keys')).toMatch(/Do \*\*not\*\* add `RESEND_API_KEY` or `MAIL_FROM` to `eno-forum\.env`/)
  })

  it('⛔ MAIL_FROM on eno.vn is checked, and added as a BARE address (the env file is sourced by sh at build time)', () => {
    const keys = section('## 5. Keys')
    expect(keys).toMatch(/\*\*5c\. eno\.vn keeps its Resend fallback, and it needs BOTH variables\.\*\*/)
    expect(keys).toMatch(/printf '\\nMAIL_FROM=no-reply@eno\.vn\\n' \| \$SSH 'cat >> \/opt\/eno\/secrets\/eno-vn\.env'/)
    // No code block writes a display-name From (`<`/`>` are redirections when sh sources the file).
    for (const block of codeBlocks(README)) expect(block).not.toMatch(/MAIL_FROM=[^\n]*</)
  })

  it('⛔ the cutover never removes eno.vn\'s Resend: no step deletes its env, its DNS records or the key', () => {
    expect(README).not.toMatch(/## \d+\. Revoke the Resend API key/)
    expect(README).not.toMatch(/## \d+\. Remove the Resend leftovers/)
    for (const block of codeBlocks(README)) {
      expect(block.includes('eno-vn.env') && /sed -i[^\n]*RESEND_API_KEY/.test(block)).toBe(false)
    }
    const step8 = section('## 8. Take Resend out of the FORUM container only')
    expect(step8).toMatch(/sed -i '\/\^RESEND_API_KEY=\/d;\/\^MAIL_FROM=\/d' \/opt\/eno\/secrets\/eno-forum\.env/)
    expect(step8).toMatch(/\*\*Leave eno\.vn alone\.\*\*/)
    expect(step8).toMatch(/Do not revoke the Resend key/)
  })

  it('rollback no longer depends on a Resend key the runbook deletes', () => {
    const deploy = section('## 7. App deploy')
    expect(deploy).not.toMatch(/only while the Resend key still exists/)
    expect(deploy).toMatch(/eno\.vn's env still holds `RESEND_API_KEY`/)
  })
})

describe('eno-mailer runbook — seeing the fallback in the logs', () => {
  const seeing = section('## Seeing the fallback')

  it('names the alert line and greps eno.vn\'s container for it', () => {
    expect(seeing).toMatch(/It is the line to alert on/)
    expect(seeing).toMatch(/docker logs --since 24h eno-vn-app 2>&1 \| grep -c 'mail_fallback'/)
    expect(seeing).toMatch(/grep -c '"transport":"resend"'/)
    expect(seeing).toMatch(/"fallback":"unconfigured"/)
  })

  it('the sample line is the shape src/lib/mail.ts prints: a label, a masked address, one line of JSON', () => {
    const sample = seeing.split('\n').find((l) => l.startsWith('[mail] FALLBACK to Resend '))!
    expect(sample).toBeDefined()
    const [, masked, json] = /^\[mail\] FALLBACK to Resend (\S+) (\{.*\})$/.exec(sample)!
    expect(masked).toBe('a…e@gmail.com')
    expect(JSON.parse(json)).toMatchObject({ edition: 'vn', evt: 'mail_fallback', code: 'unauthorized' })
  })
})
