import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/teachers/me/import — the CV reader's wire (owner, 2026-10-15): limits in order, refusals with their own
// codes, the consent record BEFORE the file leaves, nothing stored, nothing of the CV logged, private no-store.
const h = vi.hoisted(() => ({
  limits: [] as string[],
  deny: null as string | null,
  vertex: true,
  profileExists: false,
  busy: false,
  tokens: 1_000 as number | null,
  answer: null as unknown,
  modelError: null as unknown,
  audits: [] as { action: string; detail: Record<string, unknown> }[],
  auditFails: false,
  calls: [] as string[],
  logs: [] as unknown[],
  lockValue: null as unknown,
  onModel: null as null | (() => void),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => ({ id: 'p1', email: 'a@example.com' }), getCurrentProfileId: async () => 'p1', getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (name: string) => { h.limits.push(name); return { success: h.deny !== name, resetSec: 0 } },
  kv: {
    set: async (_k: string, v: unknown) => { if (h.busy) return null; h.lockValue = v; return 'OK' },
    get: async () => h.lockValue,
    del: async () => { h.calls.push('unlock') },
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: { findUnique: async () => (h.profileExists ? { id: 't1' } : null) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $executeRaw: async () => 0 }),
  },
}))
vi.mock('@/lib/compliance/audit', () => ({
  appendAudit: async (_tx: unknown, input: { action: string; detail: Record<string, unknown> }) => {
    if (h.auditFails) throw new Error('lock timeout')
    h.calls.push(input.action)
    h.audits.push({ action: input.action, detail: input.detail })
  },
}))
vi.mock('@/lib/gemini', () => ({ getGeminiVertex: () => (h.vertex ? {} : null), GEMINI_MODEL: 'gemini-3.8-flash' }))
vi.mock('@/lib/teachers/import-ai', () => ({
  documentContents: (input: { kind: string }) => [{ kind: input.kind }],
  countDocumentTokens: async () => { h.calls.push('count'); return h.tokens },
  readTeacherDocument: async () => {
    h.calls.push('model')
    h.onModel?.()
    if (h.modelError) throw h.modelError
    return { raw: h.answer, model: 'gemini-3.8-flash' }
  },
}))
vi.mock('@/lib/log', () => ({ logWarn: (...a: unknown[]) => { h.logs.push(a) }, logError: (...a: unknown[]) => { h.logs.push(a) }, logInfo: () => {} }))

const { POST } = await import('./route')
const { TEACHER_IMPORT_NOTICE_VERSION } = await import('@/lib/teachers/import-notice')

const PDF = new Uint8Array(Buffer.from('%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF', 'latin1'))
const CV_TEXT = 'Jane Smith — English teacher. ILA Vietnam, Ho Chi Minh City, 2023 – present. CELTA 2019.'
function post(parts: { file?: Uint8Array | null; text?: string; notice?: string | null; lang?: string } = {}, init: RequestInit = {}) {
  const fd = new FormData()
  if (parts.file !== null) fd.set('file', new File([new Uint8Array(parts.file ?? PDF)], 'cv.pdf', { type: 'application/pdf' }))
  if (parts.text !== undefined) { fd.delete('file'); fd.set('text', parts.text) }
  if (parts.notice !== null) fd.set('notice', parts.notice ?? TEACHER_IMPORT_NOTICE_VERSION)
  fd.set('lang', parts.lang ?? 'en')
  return POST(new Request('https://eno.vn/api/teachers/me/import', { method: 'POST', body: fd, headers: { host: 'eno.vn' }, ...init }) as never, {} as never)
}
const ANSWER = {
  isCv: true, documentKind: 'cv', fullName: 'Jane Smith', headline: 'CELTA-certified English teacher for young learners',
  summary: 'I teach English to children. Email jane@example.com for my references.', nationalityCode: 'GB', englishLevel: 'native',
  spokenLanguages: ['French'], taughtLanguages: [], subjects: ['general-english'], ageGroups: ['kids'], statedTeachingYears: 0,
  jobs: [{ role: 'ESL Teacher', employer: 'ILA Vietnam', city: 'Ho Chi Minh City', from: '2023-02', to: '', current: true, teaching: true, subjects: [], ageGroups: [] }],
  education: [{ level: 'bachelor', field: 'English', institution: 'University of Leeds', year: 2016 }],
  certificates: [{ name: 'CELTA', type: 'celta', hours: 0, provider: 'Cambridge English', year: 2019 }],
  phone: '+44 7700 900123',
}

// The reading's "now" (job dates, the experience band) — pinned, or the expectations below age out by themselves.
beforeEach(() => { vi.useFakeTimers({ now: new Date('2026-10-15T09:00:00Z'), toFake: ['Date'] }) })
afterEach(() => { vi.useRealTimers() })

beforeEach(() => {
  Object.assign(h, { limits: [], deny: null, vertex: true, profileExists: false, busy: false, tokens: 1_000, answer: ANSWER, modelError: null, audits: [], auditFails: false, calls: [], logs: [], lockValue: null, onModel: null })
})

describe('POST /api/teachers/me/import', () => {
  it('reads a PDF: the answers on the form’s vocabulary, private and never cached', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const { import: imp } = await res.json()
    expect(imp.source).toBe('cv')
    expect(imp.fields).toMatchObject({
      fullName: 'Jane Smith', headline: 'CELTA-certified English teacher for young learners', bio: 'I teach English to children.',
      nationality: 'GB', englishLevel: 'native', languages: ['French'], subjects: ['general-english'], ageGroups: ['kids'],
      experience: [{ role: 'ESL Teacher', employer: 'ILA Vietnam', city: 'Ho Chi Minh City', from: '2023-02', to: '' }],
      experienceBand: '3-5-years', degreeLevel: 'bachelor', degreeMajor: 'English', degreeInstitution: 'University of Leeds',
      degreeYear: 2016, certificates: [{ type: 'celta', hours: null, provider: 'Cambridge English', year: 2019 }],
    })
    // Never a situation answer, a consent, or the phone among the fields; the phone is offered beside them.
    for (const k of ['livesIn', 'jobTypes', 'teachAreas', 'teachAreasConfirmed', 'phone', 'photoUrl', 'matchEmailOptIn']) expect(imp.fields).not.toHaveProperty(k)
    expect(imp.phone).toBe('+447700900123')
  })

  it('⛔ the consent record is written BEFORE anything carries the file to Google (the token count too), the outcome after, then the lock is released', async () => {
    await post()
    expect(h.calls).toEqual(['teacher.import.consent', 'count', 'model', 'teacher.import.result', 'unlock'])
    const consent = h.audits[0].detail
    expect(consent).toMatchObject({ notice: TEACHER_IMPORT_NOTICE_VERSION, kind: 'pdf', lang: 'en', host: 'eno.vn', recipient: 'Google Cloud (Vertex AI, Gemini)' })
    expect(consent.noticeSha).toMatch(/^[0-9a-f]{16}$/)
    expect(h.audits[1].detail).toMatchObject({ outcome: 'filled', model: 'gemini-3.8-flash', readId: consent.readId })
    // Field NAMES only — never a value from the CV.
    expect(JSON.stringify(h.audits)).not.toMatch(/Jane|ILA|Leeds|7700/)
  })

  it('⛔ no consent record, no call to Google at all — neither the count nor the model', async () => {
    h.auditFails = true
    const res = await post()
    expect(res.status).toBe(503)
    expect(h.calls).not.toContain('count')
    expect(h.calls).not.toContain('model')
  })

  it('a file the count refuses as too long: consented, counted, recorded as too long — never read', async () => {
    h.tokens = 120_000
    const res = await post()
    expect(res.status).toBe(413)
    expect(h.calls).toEqual(['teacher.import.consent', 'count', 'teacher.import.result', 'unlock'])
    expect(h.audits.at(-1)?.detail).toMatchObject({ outcome: 'too_long' })
  })

  it('Word text is measured as the browser counted it — CRLF from the multipart encoding is not counted twice', async () => {
    // 2,000 lines of 29 characters: 59,999 as typed (LF), 61,998 once the encoding made every break CRLF.
    const text = Array.from({ length: 2000 }, () => 'A line of a long Word CV text').join('\r\n')
    expect(text.length).toBeGreaterThan(60_000)
    expect(text.replace(/\r\n/g, '\n').length).toBeLessThanOrEqual(60_000)
    const res = await post({ text })
    expect(res.status).toBe(200)
  })

  it('the consent record names the language the page was read in — any of the eleven; anything else reads as English', async () => {
    await post({ lang: 'ko' })
    expect(h.audits[0].detail.lang).toBe('ko')
    h.audits = []
    await post({ lang: 'xx-evil' })
    expect(h.audits[0].detail.lang).toBe('en')
  })

  it('Word text read in the browser is accepted as text', async () => {
    const res = await post({ text: CV_TEXT })
    expect(res.status).toBe(200)
    expect(h.audits[0].detail.kind).toBe('text')
  })

  it.each([
    ['no Vertex client (never the API-key path)', () => { h.vertex = false }, 503, 'import_unavailable'],
    ['hourly cap', () => { h.deny = 'teacher-import' }, 429, 'import_rate_hour'],
    ['daily cap', () => { h.deny = 'teacher-import-day' }, 429, 'import_rate_day'],
    ['a connection’s daily cap — said as busy, never as the account’s own limit', () => { h.deny = 'teacher-import-ip' }, 503, 'import_capacity'],
    ['a published profile', () => { h.profileExists = true }, 409, 'teacher_exists'],
    ['a reading already running', () => { h.busy = true }, 429, 'import_busy'],
    ['the feature’s daily budget', () => { h.deny = 'teacher-import-global' }, 503, 'import_capacity'],
    // teacher onboarding's RESERVED AI budget, not the shared pool (security review 2026-10-22, item 19)
    ['the teachers’ reserved AI budget', () => { h.deny = 'ai-global-teachers' }, 503, 'import_capacity'],
    ['too many tokens to be a CV', () => { h.tokens = 120_000 }, 413, 'import_too_long'],
    ['the model refusing the file', () => { h.modelError = Object.assign(new Error('bad'), { status: 400 }) }, 422, 'import_unreadable'],
    ['the model failing', () => { h.modelError = Object.assign(new Error('boom'), { status: 503 }) }, 502, 'import_failed'],
  ])('%s → %i %s', async (_label, arrange, status, error) => {
    arrange()
    const res = await post()
    expect(res.status).toBe(status)
    expect((await res.json()).error).toBe(error)
  })

  it('⛔ limits are checked one after another — a capped account never reaches the shared counters', async () => {
    h.deny = 'teacher-import'
    await post()
    expect(h.limits).toEqual(['teacher-import'])
    h.limits = []; h.deny = null
    await post()
    expect(h.limits).toEqual(['teacher-import', 'teacher-import-day', 'teacher-import-ip', 'teacher-import-global', 'ai-global-teachers'])
  })

  it('⛔ junk never spends a shared cap — so nobody can switch the feature off for everyone with bad files', async () => {
    let res = await post({ notice: '2020-01-01' })
    expect(res.status).toBe(409)
    expect((await res.json())).toMatchObject({ error: 'notice_changed', notice: 'import' })
    res = await post({ file: new Uint8Array(Buffer.from('GIF89a......')) })
    expect(res.status).toBe(415)
    res = await post({ file: new Uint8Array(Buffer.from('%PDF-1.7 trailer << /Encrypt 5 0 R >>', 'latin1')) })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('import_locked')
    expect(h.limits.filter((l) => l === 'teacher-import-global' || l === 'ai-global-teachers' || l === 'ai-global')).toEqual([])
  })

  it('⛔ the lock is OWNED: a request whose lock was taken over (it ran past it) never frees the other one', async () => {
    // While this request reads, its lock is taken over (it expired; another request took it).
    h.onModel = () => { h.lockValue = 'another-request' }
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.calls).not.toContain('unlock')
  })

  it('the page’s hash of the notice it SHOWED is recorded beside the authored text’s', async () => {
    const fd = new FormData()
    fd.set('file', new File([new Uint8Array(PDF)], 'cv.pdf', { type: 'application/pdf' }))
    fd.set('notice', TEACHER_IMPORT_NOTICE_VERSION)
    fd.set('lang', 'ko')
    fd.set('shown', 'a'.repeat(64))
    await POST(new Request('https://eno.vn/api/teachers/me/import', { method: 'POST', body: fd, headers: { host: 'eno.vn' } }) as never, {} as never)
    expect(h.audits[0].detail).toMatchObject({ lang: 'ko', translated: true, shownSha: 'a'.repeat(64) })
  })

  it('⛔ no more than six readings at once on this server — the seventh is told it is busy, unread, and the count comes back', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    // Six readings held inside the model call.
    const slow = vi.fn(async () => { await gate; return { raw: ANSWER, model: 'gemini-3.8-flash' } })
    const ai = await import('@/lib/teachers/import-ai')
    const spy = vi.spyOn(ai, 'readTeacherDocument').mockImplementation(slow)
    const held = Array.from({ length: 6 }, () => post())
    await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(6))
    const seventh = await post()
    expect(seventh.status).toBe(503)
    expect((await seventh.json()).error).toBe('import_capacity')
    release()
    expect((await Promise.all(held)).map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200])
    spy.mockRestore()
    expect((await post()).status).toBe(200)
  })

  it('⛔ a second upload while one is being read is refused UNREAD — and spends none of the account’s readings', async () => {
    h.busy = true
    const body = new ReadableStream({ pull() { throw new Error('the body must not be read') } })
    const res = await POST(new Request('https://eno.vn/api/teachers/me/import', { method: 'POST', body, duplex: 'half' } as RequestInit) as never, {} as never)
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('import_busy')
    expect(h.limits).toEqual([])
  })

  it('a body over the cap is refused by its label, and by counting a chunked one', async () => {
    let res = await POST(new Request('https://eno.vn/api/teachers/me/import', { method: 'POST', body: 'x', headers: { 'content-length': String(9 * 1024 * 1024) } }) as never, {} as never)
    expect(res.status).toBe(413)
    const big = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(9 * 1024 * 1024)); c.close() } })
    res = await POST(new Request('https://eno.vn/api/teachers/me/import', { method: 'POST', body: big, duplex: 'half' } as RequestInit) as never, {} as never)
    expect(res.status).toBe(413)
  })

  it('not a CV, or nothing to fill → 200 with import null and the reason', async () => {
    h.answer = { isCv: false }
    let res = await post()
    expect(await res.json()).toEqual({ import: null, reason: 'not_cv' })
    h.answer = { isCv: true, fullName: 'J' }
    res = await post()
    expect(await res.json()).toEqual({ import: null, reason: 'empty' })
    expect(h.audits.at(-1)?.detail.outcome).toBe('empty')
  })

  it('⛔ nothing of the CV is logged when the model fails', async () => {
    h.modelError = new SyntaxError('Unexpected token, "Jane Smith ILA" is not valid JSON')
    await post()
    expect(JSON.stringify(h.logs)).not.toMatch(/Jane|ILA/)
    expect(h.calls).toContain('unlock')
  })

  it('⛔ a large PDF whose tokens could not be counted is not read — the count failing never lifts the cap', async () => {
    h.tokens = null
    const big = new Uint8Array(3 * 1024 * 1024)
    big.set(PDF)
    const res = await post({ file: big })
    expect(res.status).toBe(503)
    expect(h.calls).toEqual(['teacher.import.consent', 'count', 'teacher.import.result', 'unlock'])
    expect(h.audits.at(-1)?.detail).toMatchObject({ outcome: 'uncounted' })
    // A small one is read: the count failing is not a refusal by itself.
    h.calls = []
    expect((await post()).status).toBe(200)
  })

  it('a page read in a machine-translated language is recorded as such', async () => {
    await post({ lang: 'ko' })
    expect(h.audits[0].detail).toMatchObject({ lang: 'ko', translated: true })
    h.audits = []
    await post({ lang: 'vi' })
    expect(h.audits[0].detail).toMatchObject({ lang: 'vi', translated: false })
  })

  it('text too short to be a CV is refused before anything is spent', async () => {
    const res = await post({ text: 'hello' })
    expect(res.status).toBe(415)
    expect(h.limits).not.toContain('ai-global-teachers')
    expect(h.limits).not.toContain('ai-global')
  })
})
