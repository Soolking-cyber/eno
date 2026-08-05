import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE LOGGER'S TWO PROMISES: it redacts, and it never throws.
 *
 * ⚠️ BOTH ARE THE KIND THAT FAIL SILENTLY. A logger that stops redacting keeps working perfectly —
 * it just starts writing phone numbers into a system with long retention, and nobody finds out
 * until someone reads the logs for an unrelated reason. A logger that throws does so only on the
 * failure path, where the exception it raises replaces the error it was meant to report and turns a
 * handled problem into a 500. Neither shows up in ordinary use, so both get tests.
 *
 * The JSON shape is asserted too, because it is a CONTRACT WITH AN EXTERNAL SYSTEM rather than a
 * house style: Cloud Logging promotes `severity` and `message`, and Error Reporting ingests on
 * `stack_trace` / `@type`. A typo in any of those produces a log line that looks fine locally and
 * silently never reaches the dashboard it was written for.
 */

const lines: { stream: 'out' | 'err'; text: string }[] = []

beforeEach(() => {
  lines.length = 0
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push({ stream: 'out', text: a.join(' ') }) })
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { lines.push({ stream: 'err', text: a.join(' ') }) })
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { lines.push({ stream: 'out', text: a.join(' ') }) })
})

afterEach(() => {
  vi.restoreAllMocks()
  // `vi.stubEnv` records and restores the original itself, so no manual save/restore — and a manual
  // one would not even typecheck: Next's types declare process.env.NODE_ENV read-only.
  vi.unstubAllEnvs()
  vi.resetModules()
})

/** Re-import under NODE_ENV=production, since the module reads it once at load. */
async function prodLogger() {
  vi.stubEnv('NODE_ENV', 'production')
  vi.resetModules()
  return await import('@/lib/log')
}

const parsed = () => JSON.parse(lines.at(-1)!.text) as Record<string, any>

describe('the Cloud Logging / Error Reporting contract', () => {
  it('an error emits the exact field names the platform reads', async () => {
    const { logError } = await prodLogger()
    logError(new Error('boom'), { op: 'trust.record' })

    const p = parsed()
    expect(p.severity).toBe('ERROR')
    expect(p.message).toContain('boom')
    expect(typeof p.stack_trace).toBe('string')
    // Optional when a stack is present, REQUIRED when it is not — so it is always set.
    expect(p['@type']).toBe('type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent')
    expect(p.op).toBe('trust.record') // context is flattened, so it is filterable in the console
  })

  it('a non-Error still carries @type, which is the case that NEEDS it', async () => {
    const { logError } = await prodLogger()
    logError('just a string')
    const p = parsed()
    expect(p.stack_trace).toBeUndefined()
    expect(p['@type']).toBe('type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent')
  })

  it('errors go to stderr and everything else to stdout', async () => {
    const { logError, logWarn, logInfo } = await prodLogger()
    logError(new Error('e')); logWarn('w'); logInfo('i')
    expect(lines.map((l) => l.stream)).toEqual(['err', 'out', 'out'])
  })

  it('severity is the level, not the stream', async () => {
    const { logWarn, logInfo } = await prodLogger()
    logWarn('careful'); logInfo('fyi')
    expect(JSON.parse(lines[0].text).severity).toBe('WARNING')
    expect(JSON.parse(lines[1].text).severity).toBe('INFO')
  })

  it('carries Next\'s `digest`, which is the code shown to the user', async () => {
    // src/app/error.tsx prints `error.digest` as "Reference". If it is not ALSO on the log entry,
    // that reference resolves to nothing and the screen is making a promise the backend cannot
    // keep. An earlier version of normaliseError destructured only message/stack/name and dropped
    // it — found by review, and otherwise findable only by someone searching for a code that was
    // never written.
    const { logError } = await prodLogger()
    const err = Object.assign(new Error('render failed'), { digest: '3752049182' })
    logError(err, { op: 'request' })
    expect(parsed().digest).toBe('3752049182')
  })

  it('context can NEVER overwrite severity, message or @type', async () => {
    // Those three are the contract with Cloud Logging: severity routes and alerts, message is what
    // the console shows, @type is what Error Reporting ingests on. A caller passing an innocent
    // `{ message: 'while saving' }` used to replace the real error text, and `{ severity: 'low' }`
    // would have produced an entry that never alerts.
    const { logError } = await prodLogger()
    logError(new Error('the real failure'), {
      message: 'context message',
      severity: 'low',
      '@type': 'nonsense',
      op: 'kept',
    } as Record<string, unknown>)
    const p = parsed()
    expect(p.message).toContain('the real failure')
    expect(p.severity).toBe('ERROR')
    expect(p['@type']).toContain('ReportedErrorEvent')
    expect(p.op).toBe('kept') // ...while ordinary context still survives
  })

  it('production emits ONE json object per line — a multi-line entry is a broken entry', async () => {
    const { logError } = await prodLogger()
    logError(new Error('line one\nline two'), { op: 'x' })
    expect(lines).toHaveLength(1)
    expect(lines[0].text.split('\n')).toHaveLength(1) // the stack is escaped inside the JSON string
    expect(() => JSON.parse(lines[0].text)).not.toThrow()
  })
})

describe('it redacts, by key and by shape', () => {
  it('a sensitive KEY is replaced whatever it holds', async () => {
    const { logError } = await prodLogger()
    logError(new Error('x'), { phone: '+84901234567', sellerEmail: 'a@b.test', refreshToken: 'abc', op: 'y' })
    const p = parsed()
    expect(p.phone).toBe('[redacted]')
    expect(p.sellerEmail).toBe('[redacted]') // substring match, so it need not be named exactly
    expect(p.refreshToken).toBe('[redacted]')
    expect(p.op).toBe('y') // and innocent keys survive, or the logger would be useless
  })

  it('a contact detail under an INNOCENT key is caught by shape', async () => {
    // The case key-matching alone misses, and the realistic one: someone logs a whole record.
    const { logError } = await prodLogger()
    logError(new Error('x'), { note: 'ring +84901234567 or mail bob@example.test' })
    const p = parsed()
    expect(p.note).not.toContain('901234567')
    expect(p.note).not.toContain('bob@example.test')
  })

  it('redacts inside the ERROR MESSAGE and the stack too', async () => {
    // The send-sms defect that started WS1 was a phone number inside the message itself.
    const { logError } = await prodLogger()
    logError(new Error('delivery failed for +84901234567'))
    const p = parsed()
    expect(p.message).not.toContain('901234567')
    expect(p.message).toContain('+849***')
  })

  it('redacts one level down without walking the whole object graph', async () => {
    const { logError } = await prodLogger()
    logError(new Error('x'), { seller: { id: 's1', phone: '+84901234567' } })
    expect(parsed().seller).toMatchObject({ id: 's1', phone: '[redacted]' })
  })
})

describe('it cannot throw, whatever it is handed', () => {
  it('a circular context does not explode', async () => {
    const { logError } = await prodLogger()
    const a: Record<string, unknown> = { op: 'circ' }
    a.self = a
    expect(() => logError(new Error('x'), a)).not.toThrow()
    expect(lines).toHaveLength(1)
  })

  it('a getter that throws does not take the logger with it', async () => {
    const { logError } = await prodLogger()
    const hostile = { op: 'hostile', get boom(): string { throw new Error('nope') } }
    expect(() => logError(new Error('x'), hostile)).not.toThrow()
    expect(parsed().boom).toBe('[unreadable]')
  })

  it('exotic values are handled rather than crashing the failure path', async () => {
    const { logError } = await prodLogger()
    expect(() => logError(null)).not.toThrow()
    expect(() => logError(undefined)).not.toThrow()
    expect(() => logError({ weird: true })).not.toThrow()
    // `BigInt(10)` rather than the `10n` literal: tsconfig targets ES2017, where `10n` will not
    // compile. A small live demonstration of the target-bump case WS3 is about.
    expect(() => logError(new Error('x'), { big: BigInt(10), fn: () => 1, sym: Symbol('s') })).not.toThrow()
    expect(lines).toHaveLength(4)
  })
})

describe('development readability', () => {
  it('dev prints human text, not JSON — an unreadable log gets ignored', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { logError } = await import('@/lib/log')
    logError(new Error('boom'), { op: 'dev' })
    expect(() => JSON.parse(lines[0].text)).toThrow() // deliberately not machine-shaped
    expect(lines[0].text).toContain('ERROR')
    expect(lines[0].text).toContain('boom')
  })

  it('but it still redacts in dev — a terminal is not a safe place either', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { logError } = await import('@/lib/log')
    logError(new Error('x'), { phone: '+84901234567' })
    expect(lines[0].text).not.toContain('901234567')
  })
})
