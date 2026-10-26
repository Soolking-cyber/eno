import { beforeEach, describe, expect, it, vi } from 'vitest'

// visa_commit_document runs as the database owner over Prisma, positionally — never through PostgREST's schema cache,
// whose name lookup failed every upload (PGRST202, 2026-10-26). Against a real Postgres 14 with the function from
// scripts/visa-commit-document-fn.mjs, this exact statement committed, replaced (old path returned) and refused a
// stranger's case (not_found).
const h = vi.hoisted(() => ({ sql: '', values: [] as unknown[], answer: null as unknown }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: { $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { h.sql = strings.join('?'); h.values = values; return [{ r: h.answer }] } },
}))
const { commitVisaDocument } = await import('./db-functions')
beforeEach(() => { h.sql = ''; h.values = []; h.answer = null })

describe('commitVisaDocument', () => {
  it('calls the function positionally with every parameter cast, the document as JSON', async () => {
    h.answer = { ok: true, old_paths: ['u/a/old.jpg'] }
    const document = { id: 'd1', kind: 'passport', storage_path: 'u/a/new.jpg' }
    expect(await commitVisaDocument({ applicationId: 'app', userId: 'user', document, replace: true })).toEqual({ ok: true, old_paths: ['u/a/old.jpg'] })
    expect(h.sql.replace(/\s+/g, ' ').trim()).toBe('SELECT public.visa_commit_document(?::uuid, ?::uuid, ?::jsonb, ?::boolean) AS r')
    expect(h.values).toEqual(['app', 'user', JSON.stringify(document), true])
  })
  it('reads a jsonb answer handed back as text, and an empty one as {}', async () => {
    h.answer = '{"ok":false,"code":"application_locked"}'
    expect(await commitVisaDocument({ applicationId: 'a', userId: 'u', document: {}, replace: false })).toEqual({ ok: false, code: 'application_locked' })
    h.answer = null
    expect(await commitVisaDocument({ applicationId: 'a', userId: 'u', document: {}, replace: false })).toEqual({})
  })
})
