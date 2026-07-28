import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLIENT_PUBLISH_OUTCOMES } from './publish-funnel-codes'

/**
 * SOURCE-LEVEL guards on the client/server boundary of the publish funnel. Same idiom as
 * sharp-lazy.test.ts and sync-pairs.test.ts: assert something about the FILES, because the thing
 * that breaks here is an import, not a value.
 */

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8')

describe('⚠️ publish-funnel-codes.ts must stay importable from a client component', () => {
  it('does not import server-only, directly or transitively via the db', () => {
    // The whole reason this module exists: publish-funnel.ts is `import 'server-only'`, which is
    // a BUILD ERROR inside a 'use client' file. When the codes lived there, post-wizard.tsx could
    // not import them and duplicated the five strings as bare literals — where a typo compiles,
    // ships, and silently drops every event from that branch. A zero in the funnel would then be
    // indistinguishable from "nobody hit this".
    // ⚠️ Matches an IMPORT STATEMENT, not the words anywhere in the file — the header comment
    // explains why `server-only` is forbidden here, and a naive /server-only/ fails on its own
    // documentation. (It did, on the first run of this test.)
    const src = read('lib/publish-funnel-codes.ts')
    expect(src).not.toMatch(/^\s*import\s+['"]server-only['"]/m)
    expect(src).not.toMatch(/^\s*import\s.*from\s+['"]@\/lib\/db['"]/m)
  })

  it('the wizard takes the TYPE from this module rather than re-declaring the strings', () => {
    const wizard = read('components/marketplace/post-wizard.tsx')
    expect(wizard).toMatch(/from '@\/lib\/publish-funnel-codes'/)
    // countAttempt is typed, so a mistyped code is a tsc error rather than a silent no-op.
    expect(wizard).toMatch(/countAttempt\s*=\s*\(outcome:\s*ClientPublishOutcome\)/)
  })

  it('every code the wizard actually fires is in the allowlist', () => {
    const wizard = read('components/marketplace/post-wizard.tsx')
    const fired = [...wizard.matchAll(/countAttempt\('([a-z_]+)'\)/g)].map((m) => m[1])
    expect(fired.length).toBeGreaterThanOrEqual(5)
    for (const code of fired) expect(CLIENT_PUBLISH_OUTCOMES).toContain(code)
  })
})

describe('⚠️ the counter must never fire on the EDIT flow', () => {
  it('countAttempt returns early when `edit` is set', () => {
    // submit() is SHARED between posting and editing — it PATCHes /api/listings/<id> when `edit`
    // is present. Without this guard an edit bounced by client validation files a REFUSAL, while
    // a successful edit is a PATCH the POST-side counter never sees, so it can never file the
    // matching success. Edits would contribute only failures and drag the success rate down by an
    // amount nobody could account for. Two independent reviewers found this; it is not obvious.
    const wizard = read('components/marketplace/post-wizard.tsx')
    const body = wizard.slice(wizard.indexOf('const countAttempt'), wizard.indexOf('const submit ='))
    expect(body).toMatch(/if \(edit\) return/)
  })
})

describe('the reporting route validates with the shared allowlist', () => {
  it('imports isClientPublishOutcome rather than re-implementing the check', () => {
    const route = read('app/api/listings/publish-attempt/route.ts')
    expect(route).toMatch(/isClientPublishOutcome/)
    expect(route).toMatch(/from '@\/lib\/publish-funnel-codes'/)
  })

  it('keeps the same-origin and body-size refusals before it parses anything', () => {
    const route = read('app/api/listings/publish-attempt/route.ts')
    const beforeParse = route.slice(0, route.indexOf('await req.json()'))
    expect(beforeParse).toMatch(/sec-fetch-site/)
    expect(beforeParse).toMatch(/content-length/)
    expect(beforeParse).toMatch(/rateLimit\(/)
  })
})
